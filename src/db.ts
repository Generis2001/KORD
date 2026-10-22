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
  onchain: boolean; // true only when a real network transaction was confirmed
  network: string | null;
  txHash: string | null;
  note: string | null;
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
    `);
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

  /** Spend counts confirmed AND pending payments, so a slow transaction cannot be double-spent. */
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

  /** Run fn inside one SQLite transaction so check-then-reserve is atomic. */
  atomic<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export type { Decision, TaskStatus };
