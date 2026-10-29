import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/db.js';

const messages = [{ role: 'user', text: 'Show my balance' }, { role: 'assistant', data: { type: 'text', message: '8 NEAR', txHash: 'receipt' } }];
const stores: Store[] = [];
const directories: string[] = [];
const create = (path?: string) => { const store = new Store(path); stores.push(store); return store; };
const postgres = (store: Store, query: any) => Object.defineProperty(store, 'pgPool', { value: { query } });
afterEach(() => {
  vi.unstubAllEnvs();
  for (const store of stores.splice(0)) if (store.db.open) store.db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('durable conversation storage', () => {
  it('keeps full user messages and assistant receipts after reopening the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mandate-conversations-'));
    directories.push(directory);
    const path = join(directory, 'history.db');
    const first = create(path);
    await first.saveConversation('conv_saved', 'ALICE.testnet', 'Balance', messages);
    first.db.close();
    const second = create(path);
    expect((await second.getConversationAsync('conv_saved', 'alice.testnet'))?.messages).toEqual(messages);
    expect((await second.getConversationsAsync('alice.testnet'))[0]).toMatchObject({ id: 'conv_saved', title: 'Balance' });
  });
  it('lists conversations beyond the old 30-chat limit without loading every message body', async () => {
    const store = create();
    for (let index = 0; index < 45; index++) await store.saveConversation('conv_' + index, 'alice.testnet', 'Chat ' + index, messages);
    const list = await store.getConversationsAsync('alice.testnet');
    expect(list).toHaveLength(45);
    expect(list[0]).not.toHaveProperty('messages');
    expect((await store.getConversationAsync('conv_0', 'alice.testnet'))?.messages).toEqual(messages);
  });
  it('scopes loading, overwriting and deleting conversation IDs to their wallet account', async () => {
    const store = create();
    await store.saveConversation('conv_private', 'alice.testnet', 'Alice', messages);
    expect(await store.getConversationAsync('conv_private', 'bob.testnet')).toBeNull();
    expect(await store.getConversationsAsync('bob.testnet')).toEqual([]);
    await expect(store.saveConversation('conv_private', 'bob.testnet', 'Overwrite', [])).rejects.toThrow('account');
    expect(await store.deleteConversation('conv_private', 'bob.testnet')).toBe(false);
    expect((await store.getConversationAsync('conv_private', 'alice.testnet'))?.messages).toEqual(messages);
    expect(await store.deleteConversation('conv_private', 'alice.testnet')).toBe(true);
  });
  it('awaits a PostgreSQL write before reporting success', async () => {
    const store = create();
    let complete: (value: any) => void = () => {};
    const write = new Promise(resolve => { complete = resolve; });
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockReturnValueOnce(write);
    postgres(store, query);
    let finished = false;
    const saving = store.saveConversation('conv_cloud', 'Alice.testnet', 'Cloud', messages).then(() => { finished = true; });
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(finished).toBe(false);
    expect(query.mock.calls[1][1]).toEqual(['conv_cloud', 'alice.testnet', 'Cloud', JSON.stringify(messages)]);
    complete({ rows: [{ id: 'conv_cloud' }] });
    await saving;
    expect(finished).toBe(true);
  });
  it('propagates cloud save failures instead of acknowledging temporary SQLite storage', async () => {
    const store = create();
    postgres(store, vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('Database unavailable')));
    await expect(store.saveConversation('conv_failed', 'alice.testnet', 'Failed', messages)).rejects.toThrow('Database unavailable');
    expect(store.getConversation('conv_failed', 'alice.testnet')).toBeNull();
  });
  it('treats an empty PostgreSQL result as empty rather than reviving deleted SQLite copies', async () => {
    const store = create();
    await store.saveConversation('conv_deleted', 'alice.testnet', 'Old', messages);
    postgres(store, vi.fn().mockResolvedValue({ rows: [] }));
    expect(await store.getConversationsAsync('alice.testnet')).toEqual([]);
    expect(await store.getConversationAsync('conv_deleted', 'alice.testnet')).toBeNull();
  });
  it.each([JSON.stringify(messages), messages])('reads message data from both PostgreSQL text and JSON columns', async value => {
    const store = create();
    postgres(store, vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'conv_old', user_account: 'alice.testnet', title: 'Old', messages_json: value, updated_at: new Date('2026-10-29T12:00:00Z') }] }));
    expect((await store.getConversationAsync('conv_old', 'alice.testnet'))?.messages).toEqual(messages);
  });
  it('never reports a serverless temporary file as a durable conversation save', async () => {
    const store = create();
    vi.stubEnv('VERCEL', '1');
    await expect(store.saveConversation('conv_serverless', 'alice.testnet', 'Chat', messages)).rejects.toThrow('DATABASE_URL');
  });
});
