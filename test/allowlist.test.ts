import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/db.js';

const stores: Store[] = [], directories: string[] = [];
const create = (path?: string) => { const store = new Store(path); stores.push(store); return store; };
afterEach(() => {
  vi.unstubAllEnvs();
  for (const store of stores.splice(0)) if (store.db.open) store.db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const attach = (store: Store, query: any) => Object.defineProperty(store, 'pgPool', { value: { query } });
function cloud() {
  const profiles = new Set<string>(), payees = new Map<string, any>();
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql.startsWith('CREATE TABLE')) return { rows: [], rowCount: 0 };
    const [owner, recipient, label] = args, key = owner + '/' + recipient;
    if (sql.startsWith('WITH created')) {
      if (!profiles.has(owner)) {
        profiles.add(owner);
        for (const seed of JSON.parse(recipient)) payees.set(owner + '/' + seed.account_id, { ...seed, added_at: new Date() });
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('INSERT INTO approved_payees')) { payees.set(key, { account_id: recipient, label, added_at: new Date() }); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('DELETE')) return { rows: [], rowCount: Number(payees.delete(key)) };
    if (sql.startsWith('SELECT 1')) return { rows: payees.has(key) ? [{ '?column?': 1 }] : [] };
    return { rows: [...payees].filter(([key]) => key.startsWith(owner + '/')).map(([, value]) => value) };
  });
  return { query, payees };
}
describe('durable wallet-scoped approved payees', () => {
  it('keeps added payees and labels after reopening SQLite, and keeps removals removed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mandate-payees-')); directories.push(dir);
    const path = join(dir, 'payees.db'), first = create(path);
    await first.addToAllowlist(' BOB.testnet ', 'Invoice payee', 'ALICE.testnet');
    first.db.close();
    const second = create(path);
    expect(await second.isAllowed('bob.testnet', 'alice.testnet')).toBe(true);
    expect(await second.getAllowlist('alice.testnet')).toContainEqual(expect.objectContaining({ accountId: 'bob.testnet', label: 'Invoice payee' }));
    await second.removeFromAllowlist('bob.testnet', 'alice.testnet');
    await second.removeFromAllowlist('mandate-generis-researcher.testnet', 'alice.testnet');
    second.db.close();
    const third = create(path);
    expect(await third.isAllowed('bob.testnet', 'alice.testnet')).toBe(false);
    expect(await third.isAllowed('mandate-generis-researcher.testnet', 'alice.testnet')).toBe(false);
  });
  it('allows different users to approve the same payee without overwriting or deleting each other', async () => {
    const store = create();
    await store.addToAllowlist('vendor.testnet', 'Alice vendor', 'alice.testnet');
    await store.addToAllowlist('vendor.testnet', 'Bob vendor', 'bob.testnet');
    expect((await store.getAllowlist('alice.testnet')).find(row => row.accountId === 'vendor.testnet')?.label).toBe('Alice vendor');
    await store.removeFromAllowlist('vendor.testnet', 'alice.testnet');
    expect(await store.isAllowed('vendor.testnet', 'bob.testnet')).toBe(true);
  });
  it('migrates old personal SQLite approvals once and does not revive a deleted legacy entry', async () => {
    const store = create();
    store.db.prepare('INSERT INTO allowlist(account_id,label,user_account) VALUES(?,?,?)').run('legacy.testnet', 'Saved previously', 'alice.testnet');
    expect(await store.isAllowed('legacy.testnet', 'alice.testnet')).toBe(true);
    expect(await store.isAllowed('legacy.testnet', 'bob.testnet')).toBe(false);
    await store.removeFromAllowlist('legacy.testnet', 'alice.testnet');
    expect(await store.isAllowed('legacy.testnet', 'alice.testnet')).toBe(false);
  });
  it('restores cloud approvals on a new server instance and respects deletions and owner isolation', async () => {
    const pg = cloud(), first = create(); attach(first, pg.query);
    await first.addToAllowlist('vendor.testnet', 'Cloud vendor', 'alice.testnet');
    await first.removeFromAllowlist('mandate-generis-researcher.testnet', 'alice.testnet');
    const second = create(); attach(second, pg.query);
    expect(await second.isAllowed('vendor.testnet', 'alice.testnet')).toBe(true);
    expect(await second.isAllowed('vendor.testnet', 'bob.testnet')).toBe(false);
    expect(await second.isAllowed('mandate-generis-researcher.testnet', 'alice.testnet')).toBe(false);
    await second.removeFromAllowlist('vendor.testnet', 'alice.testnet');
    expect(await first.isAllowed('vendor.testnet', 'alice.testnet')).toBe(false);
  });
  it('awaits the PostgreSQL write before acknowledging a newly approved payee', async () => {
    const store = create();
    let release: (result: any) => void = () => {};
    const pending = new Promise(resolve => { release = resolve; });
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockReturnValueOnce(pending);
    attach(store, query);
    let finished = false;
    const saving = store.addToAllowlist('vendor.testnet', 'Saved payee', 'alice.testnet').then(() => { finished = true; });
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(3));
    expect(finished).toBe(false);
    expect(query.mock.calls[2][1]).toEqual(['alice.testnet', 'vendor.testnet', 'Saved payee']);
    release({ rows: [], rowCount: 1 }); await saving;
    expect(finished).toBe(true);
  });
  it('fails closed on cloud errors instead of using cached local approvals', async () => {
    const store = create(); await store.addToAllowlist('vendor.testnet', 'Local copy', 'alice.testnet');
    attach(store, vi.fn().mockRejectedValue(new Error('Database unavailable')));
    await expect(store.isAllowed('vendor.testnet', 'alice.testnet')).rejects.toThrow('Database unavailable');
    await expect(store.getAllowlist('alice.testnet')).rejects.toThrow('Database unavailable');
    await expect(store.addToAllowlist('other.testnet', 'New payee', 'alice.testnet')).rejects.toThrow('Database unavailable');
  });
  it('requires a durable database for serverless approvals', async () => {
    const store = create(); vi.stubEnv('VERCEL', '1');
    await expect(store.addToAllowlist('vendor.testnet', 'Payee', 'alice.testnet')).rejects.toThrow('DATABASE_URL');
  });
});
