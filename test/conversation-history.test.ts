import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) || null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}
const source = readFileSync(new URL('../public/conversations.js', import.meta.url), 'utf8');
const getHistoryClass = () => {
  const window: any = {};
  runInNewContext(source, { window, crypto: webcrypto });
  return window.ConversationHistory;
};
function fixture() {
  const storage = new MemoryStorage(), remote = new Map<string, any>();
  let online = true;
  const request = vi.fn(async (url: string, options: any = {}) => {
    if (!online) throw new Error('Offline');
    const account = options.headers['x-mandate-account'];
    const payload = options.body && JSON.parse(options.body);
    if (options.method === 'POST') {
      remote.set(account + '/' + payload.id, { ...payload, updatedAt: new Date().toISOString() });
      return { ok: true };
    }
    if (options.method === 'DELETE') {
      remote.delete(account + '/' + payload.id);
      return { ok: true };
    }
    const id = new URL(url, 'http://localhost').searchParams.get('id');
    if (id) {
      const record = remote.get(account + '/' + id);
      return { ok: !!record, status: record ? 200 : 404, json: async () => record };
    }
    return { ok: true, json: async () => [...remote].filter(([key]) => key.startsWith(account + '/')).map(([,record]) => ({ id: record.id, title: record.title, updatedAt: record.updatedAt })) };
  });
  const History = getHistoryClass();
  return { storage, remote, request, setOnline: (value: boolean) => { online = value; },
    history: (account = 'alice.testnet', onError = vi.fn()) => new History(account, { storage, request, onError }) };
}
const user = { role: 'user', text: 'Show my balance' };
const reply = { role: 'assistant', data: { type: 'text', message: '8 NEAR', txHash: 'receipt' } };

describe('browser conversation persistence', () => {
  it('restores the active conversation and full assistant responses on reload', async () => {
    const f = fixture(), first = f.history();
    const chat = first.create();
    first.append(chat.id, user); first.append(chat.id, reply);
    await first.flush();
    const reloaded = f.history();
    expect(reloaded.activeId).toBe(chat.id);
    expect(reloaded.get(chat.id).messages).toEqual([user, reply]);
    await reloaded.refresh();
    expect((await reloaded.load(chat.id)).messages).toEqual([user, reply]);
  });
  it('backs up the first user message before a network request or assistant reply', () => {
    const f = fixture(), history = f.history(), chat = history.create();
    history.append(chat.id, user);
    expect(f.history().get(chat.id).messages).toEqual([user]);
    expect(f.request).not.toHaveBeenCalled();
  });
  it('keeps offline chats through reload and retries their cloud saves on reconnect', async () => {
    const f = fixture(); f.setOnline(false);
    const onError = vi.fn(), history = f.history('alice.testnet', onError), chat = history.create();
    history.append(chat.id, user); history.append(chat.id, reply);
    await history.flush();
    expect(onError).toHaveBeenCalledWith('Conversation saved locally; cloud sync will retry when you return or reconnect.');
    const reloaded = f.history();
    expect(reloaded.get(chat.id).pending).toBe(true);
    expect((await reloaded.load(chat.id)).messages).toEqual([user,reply]);
    await expect(reloaded.refresh()).rejects.toThrow('Showing saved conversations from this browser');
    expect(reloaded.get(chat.id).messages).toEqual([user,reply]);
    f.setOnline(true); await reloaded.refresh();
    expect(f.remote.get('alice.testnet/' + chat.id).messages).toEqual([user,reply]);
    expect(reloaded.get(chat.id).pending).toBe(false);
  });
  it('keeps a delayed reply attached to its original chat when a new conversation is open', async () => {
    const f = fixture(), history = f.history(), old = history.create();
    history.append(old.id, user);
    const current = history.create();
    history.append(current.id, { role: 'user', text: 'Another mandate' });
    history.append(old.id, reply);
    await history.flush();
    expect(history.activeId).toBe(current.id);
    expect(history.get(current.id).messages).toHaveLength(1);
    expect((await history.load(old.id)).messages).toEqual([user, reply]);
  });
  it('keeps histories and the active thread separate for each wallet', async () => {
    const f = fixture(), alice = f.history(), chat = alice.create();
    alice.append(chat.id, user); await alice.flush();
    const bob = f.history('bob.testnet');
    await bob.refresh();
    expect(bob.list()).toHaveLength(0);
    expect(bob.get(chat.id)).toBeUndefined();
    expect(f.history().activeId).toBe(chat.id);
  });
  it('serializes save requests so an older snapshot cannot finish after a newer one', async () => {
    const f = fixture(), history = f.history(), chat = history.create();
    let release = () => {};
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const write = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(async (url, options) => { await blocked; return write(url, options); });
    history.append(chat.id, user);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    history.append(chat.id, reply);
    expect(f.request).toHaveBeenCalledTimes(1);
    release(); await history.flush();
    expect(f.remote.get('alice.testnet/' + chat.id).messages).toEqual([user, reply]);
  });
  it('does not replace an unsaved new message with an older in-flight history read', async () => {
    const f = fixture(), history = f.history(), chat = history.create();
    history.append(chat.id, user); await history.flush();
    const liveArray = history.get(chat.id).messages;
    let release: (value: any) => void = () => {};
    const read = new Promise(resolve => { release = resolve; });
    f.request.mockImplementationOnce(async () => read as any);
    const loading = history.load(chat.id);
    history.append(chat.id, reply);
    release({ ok: true, json: async () => ({ id: chat.id, title: 'Old', messages: [user], updatedAt: new Date().toISOString() }) });
    expect((await loading).messages).toBe(liveArray);
    expect(liveArray).toEqual([user, reply]);
    await history.flush();
  });
  it('keeps a newly synced reply when an older history-list request returns empty', async () => {
    const f = fixture(), history = f.history(), chat = history.create();
    history.append(chat.id, user); await history.flush();
    let release: (value: any) => void = () => {};
    const read = new Promise(resolve => { release = resolve; });
    f.request.mockImplementationOnce(async () => read as any);
    const refreshing = history.refresh();
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
    history.append(chat.id, reply); await history.flush();
    release({ ok: true, json: async () => [] });
    await refreshing;
    expect(history.get(chat.id).messages).toEqual([user, reply]);
    expect(f.history().get(chat.id).messages).toEqual([user, reply]);
  });
  it('opens older conversations by ID beyond the previous sidebar limit', async () => {
    const f = fixture();
    for (let index = 0; index < 45; index++) f.remote.set('alice.testnet/conv_' + index, { id: 'conv_' + index, title: 'Chat ' + index, messages: [user,reply], updatedAt: new Date().toISOString() });
    const history = f.history(); await history.refresh();
    expect(history.list()).toHaveLength(45);
    expect((await history.load('conv_0')).messages).toEqual([user,reply]);
  });
  it('preserves the local chat when deletion fails and removes it only after confirmation', async () => {
    const f = fixture(), history = f.history(), chat = history.create();
    history.append(chat.id, user); await history.flush();
    f.request.mockResolvedValueOnce({ ok: false } as any);
    await expect(history.remove(chat.id)).rejects.toThrow('deleted');
    expect(f.history().get(chat.id).messages).toEqual([user]);
    await history.remove(chat.id);
    expect(f.history().get(chat.id)).toBeUndefined();
  });
});
