import type { Store } from './db.js';

export interface WalletOperation {
  id: string;
  userAccount: string;
  action: string;
  asset: 'NEAR' | 'USDT';
  amount: string;
  recipient?: string;
  status: 'pending' | 'funding_confirmed' | 'confirmed' | 'failed' | 'needs_review';
  txHashes: string[];
  error?: string;
  phase?: 'execution' | 'funding' | 'payout';
  attempt?: { txHash: string; signerId: string; kind: 'storage' | 'execution' | 'funding' | 'payout' };
  createdAt: string;
  evidenceHash?: string;
  contractId?: string;
  mandateId?: string;
  taskId?: string;
  dex?: import('./dex.js').DexQuote & { actualOutput?: string; wrappedInput?: boolean; swapConfirmed?: boolean };
  broadcastRejected?: boolean;
}

/** Durable receipts and locks; PostgreSQL is authoritative on serverless deployments. */
export class WalletStore {
  private ready?: Promise<unknown>;
  constructor(private store: Store) {}

  private init() {
    return this.ready ??= this.store.pgPool?.query(`CREATE TABLE IF NOT EXISTS wallet_operations (
      id TEXT PRIMARY KEY, user_account TEXT NOT NULL, data TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`) ?? Promise.resolve();
  }

  async get(id: string): Promise<WalletOperation | null> {
    await this.init();
    const row = this.store.pgPool
      ? (await this.store.pgPool.query('SELECT data FROM wallet_operations WHERE id=$1', [id])).rows[0]
      : this.store.db.prepare('SELECT data FROM wallet_operations WHERE id=?').get(id) as any;
    return row ? JSON.parse(row.data) : null;
  }

  async save(op: WalletOperation) {
    await this.init();
    if (this.store.pgPool) {
      await this.store.pgPool.query(`INSERT INTO wallet_operations (id,user_account,data) VALUES ($1,$2,$3)
        ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=now()`, [op.id, op.userAccount, JSON.stringify(op)]);
    } else {
      this.store.db.prepare(`INSERT INTO wallet_operations (id,user_account,data) VALUES (?,?,?)
        ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=datetime('now')`).run(op.id, op.userAccount, JSON.stringify(op));
    }
  }

  async list(userAccount: string): Promise<WalletOperation[]> {
    await this.init();
    const rows = this.store.pgPool
      ? (await this.store.pgPool.query('SELECT data FROM wallet_operations WHERE user_account=$1 ORDER BY updated_at DESC LIMIT 50', [userAccount])).rows
      : this.store.db.prepare('SELECT data FROM wallet_operations WHERE user_account=? ORDER BY updated_at DESC LIMIT 50').all(userAccount) as any[];
    return rows.map(r => JSON.parse(r.data));
  }

  async unresolved(userAccount: string): Promise<WalletOperation | null> {
    await this.init();
    const row = this.store.pgPool
      ? (await this.store.pgPool.query("SELECT data FROM wallet_operations WHERE user_account=$1 AND data::jsonb->>'status' IN ('pending','funding_confirmed','needs_review') LIMIT 1", [userAccount])).rows[0]
      : this.store.db.prepare("SELECT data FROM wallet_operations WHERE user_account=? AND json_extract(data,'$.status') IN ('pending','funding_confirmed','needs_review') LIMIT 1").get(userAccount) as any;
    return row ? JSON.parse(row.data) : null;
  }

  async lock<T>(accounts: string[], work: () => Promise<T>): Promise<T> {
    const keys = [...new Set(accounts)].sort();
    if (this.store.pgPool) {
      const client = await this.store.pgPool.connect();
      try {
        await client.query('BEGIN');
        for (const key of keys) {
          const result = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [key]);
          if (!result.rows[0].locked) throw new Error('A wallet transaction is in progress. Retry shortly.');
        }
        return await work();
      } finally {
        try { await client.query('ROLLBACK'); } finally { client.release(); }
      }
    }
    const db = this.store.db;
    db.transaction(() => {
      for (const key of keys) {
        const existing = db.prepare('SELECT owner_pid FROM wallet_locks WHERE account_id=?').get(key) as any;
        if (existing?.owner_pid) {
          try { process.kill(existing.owner_pid, 0); }
          catch (error: any) { if (error.code === 'ESRCH') db.prepare('DELETE FROM wallet_locks WHERE account_id=? AND owner_pid=?').run(key, existing.owner_pid); }
        }
        // Recover a dead process's lock; the durable operation still requires chain reconciliation.
        const result = db.prepare('INSERT OR IGNORE INTO wallet_locks(account_id,expires_at,owner_pid) VALUES (?,?,?)').run(key, Date.now(), process.pid);
        if (!result.changes) throw new Error('A wallet transaction is in progress or needs reconciliation.');
      }
    })();
    try { return await work(); }
    finally { for (const key of keys) db.prepare('DELETE FROM wallet_locks WHERE account_id=?').run(key); }
  }
}
