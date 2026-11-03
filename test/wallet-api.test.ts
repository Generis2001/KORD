import { PassThrough, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { KeyPair, JsonRpcProvider, baseEncode } from 'near-api-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestMessage } from '../src/wallet-auth.js';

let handleRequest: typeof import('../src/server.js')['handleRequest'];
class Reply extends Writable {
  body = '';
  statusCode = 200;
  setHeader() {}
  writeHead(status: number) { this.statusCode = status; }
  _write(chunk: Buffer, _encoding: string, next: () => void) { this.body += chunk.toString(); next(); }
}
beforeAll(async () => {
  vi.stubEnv('VERCEL', '1'); vi.stubEnv('MANDATE_DB', ':memory:');
  vi.stubEnv('POSTGRES_URL', ''); vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('NEAR_NETWORK', 'testnet'); vi.stubEnv('NEAR_ACCOUNT_ID', 'treasury.testnet');
  vi.stubEnv('NEAR_PRIVATE_KEY', KeyPair.fromRandom('ed25519').toString());
  ({ handleRequest } = await import('../src/server.js'));
});
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function request(url: string, method = 'GET', headers = {}, body = '') {
  const req = Object.assign(new PassThrough(), { url, method, headers: { host: 'localhost', 'x-mandate-account': 'alice.testnet', ...headers } });
  const reply = new Reply();
  const pending = handleRequest(req as unknown as IncomingMessage, reply as unknown as ServerResponse);
  req.end(body);
  await pending;
  return { status: reply.statusCode, data: JSON.parse(reply.body) };
}
describe('Meteor wallet authorization API', () => {
  it('configures the Meteor web wallet', async () => {
    expect(await request('/api/wallet/config')).toEqual({ status: 200, data: {
      network: 'testnet', authReceiver: 'treasury.testnet', walletUrl: 'https://wallet.meteorwallet.app'
    } });
  });

  it('rejects an address-only authorization', async () => {
    const reply = await request('/api/wallet/authorize', 'POST', {}, '{}');
    expect(reply.status).toBe(400);
    expect(reply.data.error).toContain('authorize');
  });

  it('authorizes only a proof from an installed key on the linked account', async () => {
    const key = KeyPair.fromRandom('ed25519'), timestamp = String(Date.now());
    const message = requestMessage('alice.testnet', 'POST', '/api/wallet/authorize', '{}', timestamp);
    const headers = { 'x-mandate-timestamp': timestamp, 'x-mandate-public-key': key.getPublicKey().toString(),
      'x-mandate-signature': baseEncode(key.sign(new TextEncoder().encode(message)).signature) };
    const query = vi.spyOn(JsonRpcProvider.prototype, 'query').mockResolvedValue({ nonce: 3 } as any);
    expect(await request('/api/wallet/authorize', 'POST', headers, '{}')).toEqual({ status: 200, data: { accountId: 'alice.testnet', authorized: true } });
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'alice.testnet', public_key: key.getPublicKey().toString() }));
    query.mockRejectedValueOnce(new Error('Unknown access key'));
    expect((await request('/api/wallet/authorize', 'POST', headers, '{}')).status).toBe(400);
    expect((await request('/api/wallet/authorize', 'POST', { ...headers, 'x-mandate-account': 'bob.testnet' }, '{}')).status).toBe(400);
  });
});
