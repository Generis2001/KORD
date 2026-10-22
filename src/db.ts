import Database from "better-sqlite3";
import type { Cents, Decision, Mandate, SpendState, Task, TaskStatus } from "./types.js";

export type PaymentStatus = "denied" | "pending" | "confirmed" | "failed";

export interface PaymentRow {
  id: number;
  mandateId: string;
  taskId: string;
  recipient: string;
  amount: Cents;
  status: PaymentStatus;
  onchain: boolean;
  network: string | null;
  txHash: string | null;
  note: string | null;
}

export interface AllowlistEntry {
  accountId: string;
  label: string;
  addedAt: string;
}

export class Store {
  readonly db: Database.Database;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mandates (
        id TEXT PRIMARY KEY, goal TEXT NOT NULL, total_budget TEXT NOT NULL,
        per_agent_cap TEXT NOT NULL, allowed_recipients TEXT NOT NULL,
        allowed_asset TEXT NOT NULL, max_retries INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, role TEXT NOT NULL,
        agent_account TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
        retries INTEGER NOT NULL DEFAULT 0, evidence TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, mandate_id TEXT NOT NULL, task_id TEXT NOT NULL,
        recipient TEXT NOT NULL, amount TEXT NOT NULL, status TEXT NOT NULL,
        onchain INTEGER NOT NULL DEFAULT 0, network TEXT, tx_hash TEXT, note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, mandate_id TEXT NOT NULL, event TEXT NOT NULL,
        detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS allowlist (
        account_id TEXT PRIMARY KEY, label TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS treasury_state (
        id INTEGER PRIMARY KEY,
        account_id TEXT NOT NULL,
        balance_near REAL NOT NULL,
        last_updated TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS treasury_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        amount_near REAL NOT NULL,
        balance_after REAL NOT NULL,
        note TEXT,
        tx_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
    `);

    // Seed initial allowlist if empty
    const count = (this.db.prepare("SELECT COUNT(*) as c FROM allowlist").get() as any)?.c;
    if (!count || count === 0) {
      const initStmt = this.db.prepare("INSERT OR IGNORE INTO allowlist (account_id, label) VALUES (?, ?)");
      initStmt.run("mandate-generis-researcher.testnet", "Researcher Agent");
      initStmt.run("mandate-generis-analyst.testnet", "Analyst Agent");
      initStmt.run("mandate-generis-verifier.testnet", "Verifier Agent");
      initStmt.run("mandate-generis-escrow.testnet", "NEAR Escrow Contract");
    }

    // Seed initial treasury balance if empty
    const tState = this.db.prepare("SELECT balance_near FROM treasury_state WHERE id = 1").get() as any;
    if (!tState) {
      this.db.prepare("INSERT OR REPLACE INTO treasury_state (id, account_id, balance_near) VALUES (1, ?, ?)").run("mandate-generis-treasury.testnet", 13.39);
    }
  }

  // Treasury State Methods
  getTreasuryBalance(): number {
    const row = this.db.prepare("SELECT balance_near FROM treasury_state WHERE id = 1").get() as any;
    return row ? Number(row.balance_near) : 13.39;
  }

  setTreasuryBalance(bal: number) {
    this.db.prepare("UPDATE treasury_state SET balance_near = ?, last_updated = datetime('now') WHERE id = 1").run(bal);
  }

  deductTreasury(amountNear: number, note = "Payment disbursement", txHash: string | null = null): number {
    const current = this.getTreasuryBalance();
    const after = Math.max(0, Number((current - amountNear).toFixed(4)));
    this.setTreasuryBalance(after);
    this.db.prepare("INSERT INTO treasury_ledger (type, amount_near, balance_after, note, tx_hash) VALUES ('payout', ?, ?, ?, ?)").run(amountNear, after, note, txHash);
    this.audit("treasury", "TREASURY_DEDUCTED", { amountNear, balanceAfter: after, txHash });
    return after;
  }

  fundTreasury(amountNear: number, note = "Treasury deposit", txHash: string | null = null): number {
    const current = this.getTreasuryBalance();
    const after = Number((current + amountNear).toFixed(4));
    this.setTreasuryBalance(after);
    this.db.prepare("INSERT INTO treasury_ledger (type, amount_near, balance_after, note, tx_hash) VALUES ('deposit', ?, ?, ?, ?)").run(amountNear, after, note, txHash);
    this.audit("treasury", "TREASURY_FUNDED", { amountNear, balanceAfter: after, txHash });
    return after;
  }

  // Allowlist Methods
  getAllowlist(): AllowlistEntry[] {
    return (this.db.prepare("SELECT account_id as accountId, label, added_at as addedAt FROM allowlist ORDER BY added_at DESC").all() as any[]) || [];
  }

  addToAllowlist(accountId: string, label = "Approved Recipient") {
    this.db.prepare("INSERT OR REPLACE INTO allowlist (account_id, label) VALUES (?, ?)").run(accountId, label);
    this.audit("allowlist", "ALLOWLIST_ADDED", { accountId, label });
  }

  removeFromAllowlist(accountId: string) {
    this.db.prepare("DELETE FROM allowlist WHERE account_id = ?").run(accountId);
    this.audit("allowlist", "ALLOWLIST_REMOVED", { accountId });
  }

  isAllowed(accountId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM allowlist WHERE account_id = ?").get(accountId);
    return Boolean(row);
  }

  createMandate(m: Mandate) {
    this.db
      .prepare("INSERT OR REPLACE INTO mandates VALUES (?,?,?,?,?,?,?,?)")
      .run(m.id, m.goal, m.totalBudget.toString(), m.perAgentCap.toString(), JSON.stringify(m.allowedRecipients), m.allowedAsset, m.maxRetries, m.status);
    this.audit(m.id, "MANDATE_CREATED", { goal: m.goal, totalBudget: m.totalBudget.toString(), perAgentCap: m.perAgentCap.toString() });
  }

  getMandate(id: string): Mandate {
    const r = this.db.prepare("SELECT * FROM mandates WHERE id=?").get(id) as any;
    if (!r) throw new Error(`Mandate ${id} not found`);
    return {
      id: r.id, goal: r.goal, totalBudget: BigInt(r.total_budget), perAgentCap: BigInt(r.per_agent_cap),
      allowedRecipients: JSON.parse(r.allowed_recipients), allowedAsset: r.allowed_asset,
      maxRetries: r.max_retries, status: r.status,
    };
  }

  createTask(t: Task) {
    this.db
      .prepare("INSERT OR REPLACE INTO tasks VALUES (?,?,?,?,?,?,?,?)")
      .run(t.id, t.mandateId, t.role, t.agentAccount, t.description, t.status, t.retries, JSON.stringify(t.evidence));
    this.audit(t.mandateId, "TASK_CREATED", { taskId: t.id, role: t.role, agent: t.agentAccount });
  }

  getTask(id: string): Task {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as any;
    if (!r) throw new Error(`Task ${id} not found`);
    return {
      id: r.id, mandateId: r.mandate_id, role: r.role, agentAccount: r.agent_account,
      description: r.description, status: r.status, retries: r.retries, evidence: JSON.parse(r.evidence),
    };
  }

  updateTask(id: string, patch: Partial<Pick<Task, "status" | "retries" | "evidence">>) {
    const t = { ...this.getTask(id), ...patch };
    this.db.prepare("UPDATE tasks SET status=?, retries=?, evidence=? WHERE id=?").run(t.status, t.retries, JSON.stringify(t.evidence), id);
  }

  getSpendState(mandateId: string): SpendState {
    const rows = this.db
      .prepare("SELECT recipient, amount FROM payments WHERE mandate_id=? AND status IN ('pending','confirmed')")
      .all(mandateId) as { recipient: string; amount: string }[];
    const state: SpendState = { totalSpent: 0n, spentByRecipient: {} };
    for (const r of rows) {
      const a = BigInt(r.amount);
      state.totalSpent += a;
      state.spentByRecipient[r.recipient] = (state.spentByRecipient[r.recipient] ?? 0n) + a;
    }
    return state;
  }

  recordPayment(p: Omit<PaymentRow, "id">): number {
    const res = this.db
      .prepare("INSERT INTO payments (mandate_id,task_id,recipient,amount,status,onchain,network,tx_hash,note) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(p.mandateId, p.taskId, p.recipient, p.amount.toString(), p.status, p.onchain ? 1 : 0, p.network, p.txHash, p.note);
    return Number(res.lastInsertRowid);
  }

  updatePayment(id: number, patch: Pick<PaymentRow, "status" | "onchain" | "network" | "txHash" | "note">) {
    this.db
      .prepare("UPDATE payments SET status=?, onchain=?, network=?, tx_hash=?, note=? WHERE id=?")
      .run(patch.status, patch.onchain ? 1 : 0, patch.network, patch.txHash, patch.note, id);
  }

  listPayments(mandateId: string): PaymentRow[] {
    return (this.db.prepare("SELECT * FROM payments WHERE mandate_id=? ORDER BY id").all(mandateId) as any[]).map((r) => ({
      id: r.id, mandateId: r.mandate_id, taskId: r.task_id, recipient: r.recipient, amount: BigInt(r.amount),
      status: r.status, onchain: !!r.onchain, network: r.network, txHash: r.tx_hash, note: r.note,
    }));
  }

  audit(mandateId: string, event: string, detail: unknown) {
    this.db.prepare("INSERT INTO audit_log (mandate_id,event,detail) VALUES (?,?,?)").run(mandateId, event, JSON.stringify(detail));
  }

  auditLog(mandateId: string) {
    return this.db.prepare("SELECT id,event,detail,created_at FROM audit_log WHERE mandate_id=? ORDER BY id").all(mandateId) as {
      id: number; event: string; detail: string; created_at: string;
    }[];
  }

  atomic<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export type { Decision, TaskStatus };
