import { PassThrough, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { KeyPair, JsonRpcProvider, baseEncode } from 'near-api-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestMessage } from '../src/wallet-auth.js';
import { Store } from '../src/db.js';
import { VerifiedEscrow } from '../src/escrow.js';

const run = vi.hoisted(() => vi.fn());
vi.mock('../src/runner.js', () => ({ runAutonomousMandate: run }));
let handleRequest: typeof import('../src/server.js')['handleRequest'];
const owner = 'alice.testnet', key = KeyPair.fromRandom('ed25519');
class Reply extends Writable {
  body = ''; statusCode = 200;
  headers: Record<string, string> = {};
  setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
  writeHead(status: number, headers: Record<string, string>) { this.statusCode = status; for (const [name, value] of Object.entries(headers)) this.setHeader(name, value); }
  _write(chunk: Buffer, _encoding: string, next: () => void) { this.body += chunk.toString(); next(); }
}
beforeAll(async () => {
  vi.stubEnv('VERCEL', '1'); vi.stubEnv('KORD_DB', ':memory:');
  vi.stubEnv('POSTGRES_URL', ''); vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('NEAR_NETWORK', 'testnet'); vi.stubEnv('NEAR_ACCOUNT_ID', 'treasury.testnet');
  vi.stubEnv('NEAR_PRIVATE_KEY', KeyPair.fromRandom('ed25519').toString());
  ({ handleRequest } = await import('../src/server.js'));
});
afterEach(() => { vi.restoreAllMocks(); run.mockReset(); vi.stubEnv('LOCAL_AI_ENABLED', 'false'); });
afterAll(() => vi.unstubAllEnvs());
function proof(method: string, url: string, body = '') {
  const timestamp = String(Date.now());
  return { 'x-kord-public-key': key.getPublicKey().toString(), 'x-kord-timestamp': timestamp,
    'x-kord-signature': baseEncode(key.sign(new TextEncoder().encode(requestMessage(owner, method, url, body, timestamp))).signature) };
}
async function request(url: string, method = 'GET', body = '', headers: Record<string, string> = {}) {
  const req = Object.assign(new PassThrough(), { url, method, headers: { host: 'localhost', 'x-kord-account': owner, ...headers } });
  const reply = new Reply(), pending = handleRequest(req as unknown as IncomingMessage, reply as unknown as ServerResponse);
  req.end(body); await pending;
  return { status: reply.statusCode, headers: reply.headers, data: JSON.parse(reply.body) };
}
describe('private history and admitted research authorization', () => {
  it('blocks address-only history reads, writes and deletion before touching conversations', async () => {
    const list = vi.spyOn(Store.prototype, 'getConversationsAsync'), save = vi.spyOn(Store.prototype, 'saveConversation'), remove = vi.spyOn(Store.prototype, 'deleteConversation');
    for (const method of ['GET', 'POST', 'DELETE']) expect((await request('/api/conversations', method, method === 'GET' ? '' : '{"id":"conv_private","messages":[]}')).status).toBe(401);
    expect(list).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it('binds private history reads to the owner and the exact query', async () => {
    vi.spyOn(JsonRpcProvider.prototype, 'query').mockResolvedValue({ nonce: 3 } as any);
    const read = vi.spyOn(Store.prototype, 'getConversationAsync').mockResolvedValue({ id: 'conv_private', messages: [], title: 'KORD' } as any);
    const url = '/api/conversations?id=conv_private', headers = proof('GET', url);
    expect((await request(url, 'GET', '', headers)).status).toBe(200);
    expect(read).toHaveBeenCalledWith('conv_private', owner);
    expect((await request(url, 'GET', '', { ...headers, 'x-kord-account': 'bob.testnet' })).status).toBe(401);
    expect((await request('/api/conversations?id=another', 'GET', '', headers)).status).toBe(401);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('checks signed conversation writes and deletes', async () => {
    vi.spyOn(JsonRpcProvider.prototype, 'query').mockResolvedValue({ nonce: 3 } as any);
    const save = vi.spyOn(Store.prototype, 'saveConversation').mockResolvedValue(undefined), remove = vi.spyOn(Store.prototype, 'deleteConversation').mockResolvedValue(true);
    const body = '{"id":"conv_private","title":"KORD","messages":[]}';
    expect((await request('/api/conversations', 'POST', body, proof('POST', '/api/conversations', body))).status).toBe(200);
    expect(save).toHaveBeenCalledWith('conv_private', owner, 'KORD', []);
    const deleted = '{"id":"conv_private"}';
    expect((await request('/api/conversations', 'DELETE', deleted, proof('DELETE', '/api/conversations', deleted))).status).toBe(200);
    expect(remove).toHaveBeenCalledWith('conv_private', owner);
    expect((await request('/api/conversations', 'POST', body + ' ', proof('POST', '/api/conversations', body))).status).toBe(401);
  });
  it('requires wallet ownership before invoking enabled local inference', async () => {
    vi.stubEnv('LOCAL_AI_ENABLED', 'true');
    const result = await request('/api/chat', 'POST', '{"message":"Research solar energy in Nigeria"}');
    expect(result.status).toBe(401); expect(run).not.toHaveBeenCalled();
  });
  it.each([false, true])('rechecks key revocation after a long research job (revoked=%s)', async revoked => {
    vi.stubEnv('LOCAL_AI_ENABLED', 'true');
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const query = vi.spyOn(JsonRpcProvider.prototype, 'query').mockResolvedValueOnce({ nonce: 3 } as any);
    if (revoked) query.mockRejectedValueOnce(new Error('Key revoked'));
    else query.mockResolvedValueOnce({ nonce: 3 } as any);
    vi.spyOn(Store.prototype, 'isAllowed').mockResolvedValue(true);
    const settle = vi.spyOn(VerifiedEscrow.prototype, 'settle').mockResolvedValue({ status: 'confirmed' } as any);
    const terms = { id: 'kord_long_research', amount: '0.037', recipient: 'researcher.testnet', evidenceHash: 'a'.repeat(64) };
    run.mockImplementation(async options => {
      clock.mockReturnValue(now + 180_000);
      await options.settleEscrow(terms);
      return { mandate: { id: terms.id, status: 'completed' } };
    });
    const body = JSON.stringify({ id: terms.id, message: 'Research solar energy; research fee 0.037 NEAR to researcher.testnet' });
    const result = await request('/api/chat', 'POST', body, proof('POST', '/api/chat', body));
    expect(query).toHaveBeenCalledTimes(2);
    if (revoked) { expect(settle).not.toHaveBeenCalled(); expect(result.status).toBe(500); }
    else { expect(settle).toHaveBeenCalledWith(owner, terms); expect(result.status).toBe(200); }
  });
});
