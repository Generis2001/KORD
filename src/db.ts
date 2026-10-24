import pg from "pg";
const { Pool } = pg;
import Database from "better-sqlite3";
import type { Cents, Decision, Mandate, SpendState, Task, TaskStatus } from "./types.js";

export type PaymentStatus = "denied" | "pending" | "confirmed" | "failed";

export interface SwapRecord {
  id: string;
  userAccount: string;
  agentAccount: string;
  inputNear: number;
  outputToken: string;
  outputAmount: number;
  minOutputAmount: number;
  exchangeRate: number;
  destinationWallet: string;
  status: "funding_confirmed" | "payout_confirmed" | "failed";
  storageTxHash?: string | null;
  fundingTxHash?: string | null;
  payoutTxHash?: string | null;
  note?: string | null;
  errorReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

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


export const NEON_POSTGRES_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "postgresql://neondb_owner:npg_S3zZHhxodIk4@ep-cold-grass-apvo72sg.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";

export class Store {
  readonly pgPool: pg.Pool | null = null;
  readonly db: Database.Database;

  constructor(path = ":memory:") {
    const isVercel = Boolean(process.env.VERCEL);
    let targetPath = path;
    if (isVercel) {
      try {
        targetPath = '/tmp/mandate.db';
        this.db = new Database(targetPath);
      } catch {
        this.db = new Database(':memory:');
      }
    } else {
      this.db = new Database(targetPath);
    }

    try {
      this.pgPool = new pg.Pool({
        connectionString: NEON_POSTGRES_URL,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 10000
      });
      this.pgPool.query("ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS balance_usdt REAL DEFAULT 60.00").catch(() => {});
    } catch {
      this.pgPool = null;
    }
    if (!isVercel) {
      try {
        this.db.pragma("journal_mode = WAL");
      } catch {}
    }
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
        user_account TEXT NOT NULL DEFAULT 'default',
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, mandate_id TEXT NOT NULL, event TEXT NOT NULL,
        detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS allowlist (
        account_id TEXT PRIMARY KEY, label TEXT NOT NULL,
        user_account TEXT NOT NULL DEFAULT 'default',
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
        user_account TEXT NOT NULL DEFAULT 'default',
        note TEXT,
        tx_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS user_accounts (
        account_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        balance_near REAL NOT NULL DEFAULT 10.00,
        balance_usdt REAL NOT NULL DEFAULT 60.00,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS agent_swaps (
        id TEXT PRIMARY KEY,
        user_account TEXT NOT NULL,
        agent_account TEXT NOT NULL,
        input_near REAL NOT NULL,
        output_token TEXT NOT NULL,
        output_amount REAL NOT NULL,
        min_output_amount REAL NOT NULL,
        exchange_rate REAL NOT NULL,
        destination_wallet TEXT NOT NULL,
        status TEXT NOT NULL,
        storage_tx_hash TEXT,
        funding_tx_hash TEXT,
        payout_tx_hash TEXT,
        note TEXT,
        error_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_account TEXT NOT NULL,
        title TEXT NOT NULL,
        messages_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    `);

    // Safe schema migrations for existing DB instances
    try { this.db.exec("ALTER TABLE user_accounts ADD COLUMN balance_usdt REAL DEFAULT 60.00"); } catch {}
    if (this.pgPool) {
      this.pgPool.query("ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS balance_usdt REAL DEFAULT 60.00").catch(() => {});
    }

    try { this.db.exec("ALTER TABLE allowlist ADD COLUMN user_account TEXT DEFAULT 'default'"); } catch {}
    try { this.db.exec("ALTER TABLE treasury_ledger ADD COLUMN user_account TEXT DEFAULT 'default'"); } catch {}
    try { this.db.exec("ALTER TABLE payments ADD COLUMN user_account TEXT DEFAULT 'default'"); } catch {}

    // Initialize default allowlist
    const defaultAccounts = [
      { accountId: "mandate-generis-researcher.testnet", label: "Researcher Agent" },
      { accountId: "mandate-generis-analyst.testnet", label: "Analyst Agent" },
      { accountId: "mandate-generis-verifier.testnet", label: "Verifier Agent" },
      { accountId: "mandate-generis-escrow.testnet", label: "NEAR Escrow Contract" },
    ];
    for (const acc of defaultAccounts) {
      this.db.prepare("INSERT OR IGNORE INTO allowlist (account_id, label, user_account) VALUES (?, ?, 'default')").run(acc.accountId, acc.label);
    }

    // Seed initial verified ledger records if empty
    try {
      const paymentCount = (this.db.prepare("SELECT COUNT(*) as cnt FROM payments").get() as any)?.cnt ?? 0;
      if (paymentCount === 0) {
        const initialSettlements = [
          {
            mandate_id: "mandate-research-stablecoins",
            task_id: "task-research-1",
            recipient: "mandate-generis-researcher.testnet",
            amount: "400", // $4.00 (0.40 NEAR)
            status: "confirmed",
            onchain: 1,
            network: "testnet",
            tx_hash: "Ath7EXyysY1PfLQEeL6kPFcr5BuvjouufM8ymtz9CR6x",
            note: "Disbursed research fee for verified stablecoin corridor deliverable",
            user_account: "default"
          },
          {
            mandate_id: "mandate-analysis-corridors",
            task_id: "task-analysis-1",
            recipient: "mandate-generis-analyst.testnet",
            amount: "350", // $3.50 (0.35 NEAR)
            status: "confirmed",
            onchain: 1,
            network: "testnet",
            tx_hash: "EnLMQPqHNxNvcEuhFZy8rzWUN8zQcPfVn6rL7dKx9mX4",
            note: "Verified analysis fee: vendor pricing & corridor comparative matrix",
            user_account: "default"
          },
          {
            mandate_id: "mandate-guardrail-test",
            task_id: "task-intercept-1",
            recipient: "uline-commercial.testnet",
            amount: "1890000", // $18,900.00
            status: "denied",
            onchain: 0,
            network: "testnet",
            tx_hash: null,
            note: "UNAUTHORIZED_PURCHASE: User restriction prohibits goods procurement without prior human approval",
            user_account: "default"
          }
        ];
        const insertStmt = this.db.prepare("INSERT INTO payments (mandate_id, task_id, recipient, amount, status, onchain, network, tx_hash, note, user_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const p of initialSettlements) {
          insertStmt.run(p.mandate_id, p.task_id, p.recipient, p.amount, p.status, p.onchain, p.network, p.tx_hash, p.note, p.user_account);
        }
      }
    } catch {}
  }

  // --- User Account Operations ---
  getOrCreateUser(userAccount: string, initialBalance = 10.00): { accountId: string; balanceNear: number } {
    const acc = userAccount.trim().toLowerCase();
    const existing = this.db.prepare("SELECT * FROM user_accounts WHERE account_id=?").get(acc) as any;
    if (existing) {
      return { accountId: existing.account_id, balanceNear: Number(existing.balance_near) };
    }
    this.db.prepare("INSERT INTO user_accounts (account_id, label, balance_near, balance_usdt) VALUES (?, ?, ?, ?)").run(acc, `User ${acc}`, initialBalance, 60.00);
    if (this.pgPool) {
      this.pgPool.query("INSERT INTO user_accounts (account_id, label, balance_near, balance_usdt) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id) DO NOTHING", [acc, `User ${acc}`, initialBalance, 60.00]).catch(() => {});
    }
    // Seed user's personal allowlist with default specialized agents
    const defaultAgents = [
      "mandate-generis-researcher.testnet",
      "mandate-generis-analyst.testnet",
      "mandate-generis-verifier.testnet",
      "mandate-generis-escrow.testnet"
    ];
    for (const ag of defaultAgents) {
      this.db.prepare("INSERT OR IGNORE INTO allowlist (account_id, label, user_account) VALUES (?, 'Specialized Agent', ?)").run(ag, acc);
    }
    return { accountId: acc, balanceNear: initialBalance };
  }

  getUserBalance(userAccount: string): number {
    const acc = userAccount.trim().toLowerCase();
    const row = this.db.prepare("SELECT balance_near FROM user_accounts WHERE account_id=?").get(acc) as any;
    if (row) return Number(row.balance_near);
    return this.getOrCreateUser(acc).balanceNear;
  }

  listUsers(): { accountId: string; balanceNear: number }[] {
    // Exclude auto-generated client- and default-user accounts
    const rows = this.db.prepare("SELECT account_id, balance_near FROM user_accounts WHERE account_id NOT LIKE 'client-%' AND account_id != 'default-user.testnet' ORDER BY created_at DESC").all() as any[];
    if (rows.length === 0) {
      this.getOrCreateUser('generis.testnet', 10.00);
      return [{ accountId: 'generis.testnet', balanceNear: 10.00 }];
    }
    return rows.map(r => ({ accountId: r.account_id, balanceNear: Number(r.balance_near) }));
  }

  deleteUser(userAccount: string): boolean {
    const acc = userAccount.trim().toLowerCase();
    const res = this.db.prepare("DELETE FROM user_accounts WHERE account_id=?").run(acc);
    return res.changes > 0;
  }

  setUserBalance(userAccount: string, balance: number): void {
    const acc = userAccount.trim().toLowerCase();
    this.db.prepare("INSERT INTO user_accounts (account_id, label, balance_near) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET balance_near=excluded.balance_near").run(acc, `User ${acc}`, balance);
    if (this.pgPool) {
      this.pgPool.query("INSERT INTO user_accounts (account_id, label, balance_near) VALUES ($1, $2, $3) ON CONFLICT(account_id) DO UPDATE SET balance_near=EXCLUDED.balance_near", [acc, `User ${acc}`, balance]).catch(() => {});
    }
  }

  fundUserBalance(userAccount: string, amountNear: number, note: string): number {
    const current = this.getUserBalance(userAccount);
    const newBal = current + amountNear;
    this.setUserBalance(userAccount, newBal);
    this.db.prepare("INSERT INTO treasury_ledger (type, amount_near, balance_after, user_account, note) VALUES ('FUND', ?, ?, ?, ?)").run(amountNear, newBal, userAccount, note);
    return newBal;
  }

  deductUserBalance(userAccount: string, amountNear: number, note: string, txHash?: string): number {
    const current = this.getUserBalance(userAccount);
    const newBal = current >= amountNear ? current - amountNear : 0;
    this.setUserBalance(userAccount, newBal);
    this.db.prepare("INSERT INTO treasury_ledger (type, amount_near, balance_after, user_account, note, tx_hash) VALUES ('DISBURSE', ?, ?, ?, ?, ?)").run(amountNear, newBal, userAccount, note, txHash || null);
    return newBal;
  }

  
  getUserUsdtBalance(userAccount: string): number {
    const acc = userAccount.trim().toLowerCase();
    try {
      const row = this.db.prepare("SELECT balance_usdt FROM user_accounts WHERE account_id=?").get(acc) as any;
      if (row && row.balance_usdt !== null && row.balance_usdt !== undefined) {
        return Number(row.balance_usdt);
      }
    } catch {}
    return 60.00;
  }

  setUserUsdtBalance(userAccount: string, balance: number): void {
    const acc = userAccount.trim().toLowerCase();
    const cleanBal = Math.max(0, balance);
    try {
      this.db.prepare("INSERT INTO user_accounts (account_id, label, balance_near, balance_usdt) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET balance_usdt=excluded.balance_usdt").run(acc, `User ${acc}`, 10.00, cleanBal);
      if (this.pgPool) {
        this.pgPool.query("INSERT INTO user_accounts (account_id, label, balance_near, balance_usdt) VALUES ($1, $2, $3, $4) ON CONFLICT(account_id) DO UPDATE SET balance_usdt=EXCLUDED.balance_usdt", [acc, `User ${acc}`, 10.00, cleanBal]).catch(() => {});
      }
    } catch {}
  }

  fundUserUsdtBalance(userAccount: string, amountUsdt: number): number {
    const current = this.getUserUsdtBalance(userAccount);
    const newBal = current + amountUsdt;
    this.setUserUsdtBalance(userAccount, newBal);
    return newBal;
  }

  deductUserUsdtBalance(userAccount: string, amountUsdt: number): number {
    const current = this.getUserUsdtBalance(userAccount);
    const newBal = current >= amountUsdt ? current - amountUsdt : 0;
    this.setUserUsdtBalance(userAccount, newBal);
    return newBal;
  }

  // --- Allowlist Operations (User-Aware) ---
  getAllowlist(userAccount = 'default'): AllowlistEntry[] {
    const rows = this.db.prepare("SELECT account_id, label, added_at FROM allowlist WHERE user_account=? OR user_account='default' GROUP BY account_id ORDER BY added_at DESC").all(userAccount) as any[];
    return rows.map((r) => ({ accountId: r.account_id, label: r.label, addedAt: r.added_at }));
  }

  addToAllowlist(accountId: string, label = "Approved Payee", userAccount = 'default'): void {
    this.db.prepare("INSERT OR REPLACE INTO allowlist (account_id, label, user_account) VALUES (?, ?, ?)").run(accountId.trim().toLowerCase(), label, userAccount);
  }

  removeFromAllowlist(accountId: string, userAccount = 'default'): boolean {
    const info = this.db.prepare("DELETE FROM allowlist WHERE account_id=? AND (user_account=? OR user_account='default')").run(accountId.trim().toLowerCase(), userAccount);
    return info.changes > 0;
  }

  isAllowed(accountId: string, userAccount = 'default'): boolean {
    const row = this.db.prepare("SELECT 1 FROM allowlist WHERE account_id=? AND (user_account=? OR user_account='default')").get(accountId.trim().toLowerCase(), userAccount);
    return Boolean(row);
  }

  // --- Treasury State Operations (Global default fallback) ---
  getTreasuryBalance(): number {
    const row = this.db.prepare("SELECT balance_near FROM treasury_state WHERE id = 1").get() as any;
    if (row && typeof row.balance_near === 'number') {
      return row.balance_near;
    }
    return 10.00;
  }

  setTreasuryBalance(bal: number): void {
    this.db.prepare("INSERT INTO treasury_state (id, account_id, balance_near, last_updated) VALUES (1, 'mandate-generis-treasury.testnet', ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET balance_near=excluded.balance_near, last_updated=datetime('now')").run(bal);
  }

  deductTreasury(amountNear: number, note: string, txHash?: string): number {
    const current = this.getTreasuryBalance();
    const newBal = current >= amountNear ? current - amountNear : 0;
    this.setTreasuryBalance(newBal);
    this.db.prepare("INSERT INTO treasury_ledger (type, amount_near, balance_after, note, tx_hash) VALUES ('DISBURSE', ?, ?, ?, ?)").run(amountNear, newBal, note, txHash || null);
    return newBal;
  }

  fundTreasury(amountNear: number, note: string): number {
    const current = this.getTreasuryBalance();
    const newBal = current + amountNear;
    this.setTreasuryBalance(newBal);
    this.db.prepare("INSERT INTO treasury_ledger (type, amount_near, balance_after, note) VALUES ('FUND', ?, ?, ?)").run(amountNear, newBal, note);
    return newBal;
  }

  // --- Settlement Ledger (Directly on active connection) ---
  getLedger(userAccount?: string): any[] {
    try {
      const sql = userAccount && userAccount !== 'default'
        ? "SELECT * FROM payments WHERE user_account=? OR user_account='default' ORDER BY id DESC LIMIT 50"
        : "SELECT * FROM payments ORDER BY id DESC LIMIT 50";
      const paymentRows = userAccount && userAccount !== 'default'
        ? this.db.prepare(sql).all(userAccount) as any[]
        : this.db.prepare(sql).all() as any[];

      const pList = paymentRows.map((r) => ({
        id: r.id,
        mandateId: r.mandate_id,
        taskId: r.task_id,
        recipient: r.recipient,
        amountDollars: (Number(r.amount) / 100).toFixed(2),
        amountNear: (Number(r.amount) / 1000).toFixed(2),
        status: r.status,
        onchain: Boolean(r.onchain),
        txHash: r.tx_hash || null,
        note: r.note || '',
        createdAt: r.created_at,
        explorerUrl: r.tx_hash ? `https://testnet.nearblocks.io/txns/${r.tx_hash}` : null
      }));

      // Merge Agent Swaps into Settlement Ledger
      let sList: any[] = [];
      try {
        const swapRows = userAccount && userAccount !== 'default'
          ? this.db.prepare("SELECT * FROM agent_swaps WHERE user_account=? ORDER BY created_at DESC LIMIT 30").all(userAccount) as any[]
          : this.db.prepare("SELECT * FROM agent_swaps ORDER BY created_at DESC LIMIT 30").all() as any[];

        sList = swapRows.map((s) => ({
          id: s.id,
          mandateId: 'agent-swap',
          taskId: 'token-exchange',
          recipient: s.destination_wallet,
          amountDollars: Number(s.output_amount).toFixed(2) + ' USDT',
          amountNear: Number(s.input_near).toFixed(2),
          status: s.status === 'payout_confirmed' ? 'confirmed' : s.status,
          onchain: Boolean(s.payout_tx_hash),
          txHash: s.payout_tx_hash || s.funding_tx_hash || null,
          note: s.note || `Agent Swap: ${s.input_near} NEAR -> ${s.output_amount} Test USDT`,
          createdAt: s.created_at,
          explorerUrl: s.payout_tx_hash ? `https://testnet.nearblocks.io/txns/${s.payout_tx_hash}` : null
        }));
      } catch {}

      const combined = [...pList, ...sList].sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      return combined.slice(0, 50);
    } catch {
      return [];
    }
  }

  
  async syncFromPostgres(): Promise<void> {
    if (!this.pgPool) return;
    try {
      const uRes = await this.pgPool.query("SELECT account_id, label, balance_near, COALESCE(balance_usdt, 60.00) as balance_usdt FROM user_accounts");
      for (const row of uRes.rows) {
        this.db.prepare("INSERT INTO user_accounts (account_id, label, balance_near, balance_usdt) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET balance_near=excluded.balance_near, balance_usdt=excluded.balance_usdt").run(row.account_id, row.label, Number(row.balance_near), Number(row.balance_usdt));
      }
      const cRes = await this.pgPool.query("SELECT id, user_account, title, messages_json, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50");
      for (const row of cRes.rows) {
        const msgStr = typeof row.messages_json === 'string' ? row.messages_json : JSON.stringify(row.messages_json || []);
        this.db.prepare("INSERT INTO conversations (id, user_account, title, messages_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, messages_json=excluded.messages_json, updated_at=excluded.updated_at").run(row.id, row.user_account, row.title, msgStr, new Date(row.updated_at).toISOString());
      }
    } catch (e) {
      // Offline or network error; local SQLite remains active
    }
  }

  async getConversationsAsync(userAccount: string): Promise<any[]> {
    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          "SELECT id, title, messages_json, updated_at FROM conversations WHERE LOWER(user_account) = LOWER($1) ORDER BY updated_at DESC LIMIT 30",
          [userAccount.trim().toLowerCase()]
        );
        if (res.rows.length > 0) {
          return res.rows.map(r => ({
            id: r.id,
            title: r.title,
            updatedAt: r.updated_at,
            messages: typeof r.messages_json === 'string' ? JSON.parse(r.messages_json) : (r.messages_json || [])
          }));
        }
      } catch (err) {
        console.error("PG getConversations error:", err);
      }
    }
    return this.getConversations(userAccount);
  }

  async listUsersAsync(): Promise<{ accountId: string; balanceNear: number }[]> {
    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          "SELECT account_id, balance_near FROM user_accounts WHERE account_id NOT LIKE 'client-%' AND account_id != 'default-user.testnet' ORDER BY created_at ASC"
        );
        if (res.rows.length > 0) {
          return res.rows.map(r => ({ accountId: r.account_id, balanceNear: Number(r.balance_near) }));
        }
      } catch {}
    }
    return this.listUsers();
  }

  // --- Conversations / Chat History ---
  getConversations(userAccount: string): any[] {
    try {
      const rows = this.db.prepare("SELECT id, title, messages_json, updated_at FROM conversations WHERE user_account=? ORDER BY updated_at DESC LIMIT 30").all(userAccount) as any[];
      return rows.map(r => ({
        id: r.id,
        title: r.title,
        updatedAt: r.updated_at,
        messages: JSON.parse(r.messages_json || '[]')
      }));
    } catch {
      return [];
    }
  }

  getConversation(id: string): any {
    try {
      const row = this.db.prepare("SELECT * FROM conversations WHERE id=?").get(id) as any;
      if (!row) return null;
      return { id: row.id, userAccount: row.user_account, title: row.title, messages: JSON.parse(row.messages_json || '[]'), updatedAt: row.updated_at };
    } catch {
      return null;
    }
  }

  saveConversation(id: string, userAccount: string, title: string, messages: any[]): void {
    try {
      this.db.prepare("INSERT INTO conversations (id, user_account, title, messages_json, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET title=excluded.title, messages_json=excluded.messages_json, updated_at=datetime('now')").run(id, userAccount, title, JSON.stringify(messages));
    } catch {}
  }

  deleteConversation(id: string): boolean {
    try {
      const res = this.db.prepare("DELETE FROM conversations WHERE id=?").run(id);
    if (this.pgPool) {
      this.pgPool.query("DELETE FROM conversations WHERE id=$1", [id]).catch(() => {});
    }
      return res.changes > 0;
    } catch {
      return false;
    }
  }

  // --- Core Mandates, Tasks & Payments ---
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
      allowedServices: m_allowedServices(r),
      maxRetries: r.max_retries, status: r.status,
    };
  }

  createTask(t: Task) {
    this.db
      .prepare("INSERT OR REPLACE INTO tasks VALUES (?,?,?,?,?,?,?,?)")
      .run(t.id, t.mandateId, t.role, t.agentAccount, t.description, t.status, t.retries, JSON.stringify(t.evidence));
  }

  getTask(id: string): Task {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as any;
    if (!r) throw new Error(`Task ${id} not found`);
    return {
      id: r.id, mandateId: r.mandate_id, role: r.role, agentAccount: r.agent_account,
      description: r.description, status: r.status, retries: r.retries,
      evidence: JSON.parse(r.evidence),
    };
  }

  updateTask(id: string, patch: Partial<Pick<Task, "status" | "retries" | "evidence">>) {
    const cur = this.getTask(id);
    const status = patch.status ?? cur.status;
    const retries = patch.retries ?? cur.retries;
    const evidence = patch.evidence ? JSON.stringify(patch.evidence) : JSON.stringify(cur.evidence);
    this.db.prepare("UPDATE tasks SET status=?, retries=?, evidence=? WHERE id=?").run(status, retries, evidence, id);
  }

  recordPayment(p: Omit<PaymentRow, "id"> & { userAccount?: string }): number {
    const userAcc = p.userAccount || 'default';
    const r = this.db
      .prepare(
        "INSERT INTO payments (mandate_id, task_id, recipient, amount, status, onchain, network, tx_hash, note, user_account) VALUES (?,?,?,?,?,?,?,?,?,?)"
      )
      .run(p.mandateId, p.taskId, p.recipient, p.amount.toString(), p.status, p.onchain ? 1 : 0, p.network, p.txHash, p.note, userAcc);
    return Number(r.lastInsertRowid);
  }

  updatePayment(id: number, patch: Partial<Pick<PaymentRow, "status" | "onchain" | "network" | "txHash" | "note">>) {
    const r = this.db.prepare("SELECT * FROM payments WHERE id=?").get(id) as any;
    if (!r) throw new Error(`Payment ${id} not found`);
    const status = patch.status ?? r.status;
    const onchain = patch.onchain !== undefined ? (patch.onchain ? 1 : 0) : r.onchain;
    const network = patch.network !== undefined ? patch.network : r.network;
    const txHash = patch.txHash !== undefined ? patch.txHash : r.tx_hash;
    const note = patch.note !== undefined ? patch.note : r.note;
    this.db
      .prepare("UPDATE payments SET status=?, onchain=?, network=?, tx_hash=?, note=? WHERE id=?")
      .run(status, onchain, network, txHash, note, id);
  }

  listPayments(mandateId: string): PaymentRow[] {
    const rows = this.db.prepare("SELECT * FROM payments WHERE mandate_id = ? ORDER BY id ASC").all(mandateId) as any[];
    return rows.map((r: any) => ({
      id: r.id,
      mandateId: r.mandate_id,
      taskId: r.task_id,
      recipient: r.recipient,
      amount: BigInt(r.amount),
      status: r.status,
      onchain: Boolean(r.onchain),
      network: r.network,
      txHash: r.tx_hash,
      note: r.note,
    }));
  }

  getSpendState(mandateId: string): SpendState {
    const rows = this.db
      .prepare("SELECT recipient, amount FROM payments WHERE mandate_id=? AND status IN ('pending', 'confirmed')")
      .all(mandateId) as { recipient: string; amount: string }[];
    let totalSpent = 0n;
    const spentByRecipient: Record<string, Cents> = {};
    for (const r of rows) {
      const a = BigInt(r.amount);
      totalSpent += a;
      spentByRecipient[r.recipient] = (spentByRecipient[r.recipient] ?? 0n) + a;
    }
    return { totalSpent, spentByRecipient };
  }

  audit(mandateId: string, event: string, detail: unknown) {
    this.db.prepare("INSERT INTO audit_log (mandate_id, event, detail) VALUES (?,?,?)").run(mandateId, event, JSON.stringify(detail));
  }

  auditLog(mandateId: string) {
    return (this.db.prepare("SELECT * FROM audit_log WHERE mandate_id=? ORDER BY id ASC").all(mandateId) as any[]).map((r) => ({
      id: r.id, mandateId: r.mandate_id, event: r.event, detail: JSON.parse(r.detail), createdAt: r.created_at,
    }));
  }

  // --- Agent Swap & Payout Records ---
  createSwapRecord(swap: SwapRecord): void {
    try {
      this.db.prepare(`
        INSERT INTO agent_swaps (
          id, user_account, agent_account, input_near, output_token,
          output_amount, min_output_amount, exchange_rate, destination_wallet,
          status, storage_tx_hash, funding_tx_hash, payout_tx_hash, note, error_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        swap.id, swap.userAccount, swap.agentAccount, swap.inputNear, swap.outputToken,
        swap.outputAmount, swap.minOutputAmount, swap.exchangeRate, swap.destinationWallet,
        swap.status, swap.storageTxHash || null, swap.fundingTxHash || null,
        swap.payoutTxHash || null, swap.note || null, swap.errorReason || null
      );
    } catch (e: any) {
      console.warn('createSwapRecord error:', e.message);
    }
  }

  updateSwapRecord(id: string, patch: Partial<SwapRecord>): void {
    try {
      const existing = this.getSwapRecord(id);
      if (!existing) return;
      const status = patch.status ?? existing.status;
      const storageTx = patch.storageTxHash !== undefined ? patch.storageTxHash : existing.storageTxHash;
      const payoutTx = patch.payoutTxHash !== undefined ? patch.payoutTxHash : existing.payoutTxHash;
      const errorReason = patch.errorReason !== undefined ? patch.errorReason : existing.errorReason;
      this.db.prepare(`
        UPDATE agent_swaps
        SET status = ?, storage_tx_hash = ?, payout_tx_hash = ?, error_reason = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(status, storageTx, payoutTx, errorReason, id);
    } catch (e: any) {
      console.warn('updateSwapRecord error:', e.message);
    }
  }

  getSwapRecord(id: string): SwapRecord | null {
    try {
      const r = this.db.prepare("SELECT * FROM agent_swaps WHERE id = ?").get(id) as any;
      if (!r) return null;
      return {
        id: r.id,
        userAccount: r.user_account,
        agentAccount: r.agent_account,
        inputNear: r.input_near,
        outputToken: r.output_token,
        outputAmount: r.output_amount,
        minOutputAmount: r.min_output_amount,
        exchangeRate: r.exchange_rate,
        destinationWallet: r.destination_wallet,
        status: r.status,
        storageTxHash: r.storage_tx_hash,
        fundingTxHash: r.funding_tx_hash,
        payoutTxHash: r.payout_tx_hash,
        note: r.note,
        errorReason: r.error_reason,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      };
    } catch {
      return null;
    }
  }

  listSwaps(userAccount?: string): SwapRecord[] {
    try {
      let rows: any[];
      if (userAccount && userAccount !== 'all') {
        rows = this.db.prepare("SELECT * FROM agent_swaps WHERE user_account = ? ORDER BY created_at DESC").all(userAccount) as any[];
      } else {
        rows = this.db.prepare("SELECT * FROM agent_swaps ORDER BY created_at DESC").all() as any[];
      }
      return rows.map((r: any) => ({
        id: r.id,
        userAccount: r.user_account,
        agentAccount: r.agent_account,
        inputNear: r.input_near,
        outputToken: r.output_token,
        outputAmount: r.output_amount,
        minOutputAmount: r.min_output_amount,
        exchangeRate: r.exchange_rate,
        destinationWallet: r.destination_wallet,
        status: r.status,
        storageTxHash: r.storage_tx_hash,
        fundingTxHash: r.funding_tx_hash,
        payoutTxHash: r.payout_tx_hash,
        note: r.note,
        errorReason: r.error_reason,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));
    } catch {
      return [];
    }
  }

  atomic<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

function m_allowedServices(r: any): string[] {
  try {
    return JSON.parse(r.allowed_services || '[]');
  } catch {
    return ["supplier_research", "quotation_analysis", "deliverable_audit", "market_research"];
  }
}
