import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { KeyPair, baseEncode, JsonRpcProvider } from 'near-api-js';
import { requestMessage, verifyWalletRequest } from '../src/wallet-auth.js';

describe('wallet ownership proofs', () => {
  it('checks an installed access key and binds its proof to the account, path, body and timestamp', async () => {
    const key = KeyPair.fromRandom('ed25519');
    const provider = new JsonRpcProvider({ url: 'http://localhost:3999' });
    const query = vi.spyOn(provider, 'query').mockResolvedValue({ nonce: 3 } as any);
    const timestamp = String(Date.now());
    const body = '{"action":"withdraw","amount":"1","asset":"NEAR"}';
    const message = new TextEncoder().encode(requestMessage('alice.testnet', 'POST', '/api/wallet/execute', body, timestamp));
    const headers = { 'x-mandate-timestamp': timestamp, 'x-mandate-public-key': key.getPublicKey().toString(), 'x-mandate-signature': baseEncode(key.sign(message).signature) };
    await verifyWalletRequest(provider, 'alice.testnet', 'POST', '/api/wallet/execute', body, headers);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'alice.testnet', public_key: key.getPublicKey().toString() }));
    await expect(verifyWalletRequest(provider, 'bob.testnet', 'POST', '/api/wallet/execute', body, headers)).rejects.toThrow('Invalid');
    await expect(verifyWalletRequest(provider, 'alice.testnet', 'POST', '/api/wallet/execute', body + ' ', headers)).rejects.toThrow('Invalid');
    await expect(verifyWalletRequest(provider, 'alice.testnet', 'POST', '/api/wallet/deposit', body, headers)).rejects.toThrow('Invalid');
    query.mockRejectedValueOnce(new Error('Unknown access key'));
    await expect(verifyWalletRequest(provider, 'alice.testnet', 'POST', '/api/wallet/execute', body, headers)).rejects.toThrow('access key');
  });
  it('rejects address-only requests and expired signatures', async () => {
    const provider = new JsonRpcProvider({ url: 'http://localhost:3999' });
    await expect(verifyWalletRequest(provider, 'alice.testnet', 'POST', '/api/wallet/execute', '', {})).rejects.toThrow('authorize');
    await expect(verifyWalletRequest(provider, 'alice.testnet', 'POST', '/api/wallet/execute', '', { 'x-mandate-timestamp': String(Date.now() - 61_000), 'x-mandate-public-key': 'key', 'x-mandate-signature': 'signature' })).rejects.toThrow('authorize');
  });
  it('verifies NEP-413 proofs from injected wallets', async () => {
    const key = KeyPair.fromRandom('ed25519');
    const provider = new JsonRpcProvider({ url: 'http://localhost:3999' });
    vi.spyOn(provider, 'query').mockResolvedValue({ nonce: 3 } as any);
    const timestamp = String(Date.now()), body = '{}';
    const str = (value: string) => { const data = Buffer.from(value), len = Buffer.alloc(4); len.writeUInt32LE(data.length); return Buffer.concat([len, data]); };
    const tag = Buffer.alloc(4); tag.writeUInt32LE(2147483648 + 413);
    const nonce = Buffer.alloc(32, 7);
    const message = requestMessage('alice.testnet', 'POST', '/api/wallet/execute', body, timestamp);
    const digest = createHash('sha256').update(Buffer.concat([tag, str(message), nonce, str('mandate'), Buffer.from([0])])).digest();
    const headers = { 'x-mandate-auth-type': 'nep413', 'x-mandate-nonce': nonce.toString('base64'), 'x-mandate-timestamp': timestamp,
      'x-mandate-public-key': key.getPublicKey().toString(), 'x-mandate-signature': Buffer.from(key.sign(digest).signature).toString('base64') };
    await verifyWalletRequest(provider, 'alice.testnet', 'POST', '/api/wallet/execute', body, headers);
  });
});
