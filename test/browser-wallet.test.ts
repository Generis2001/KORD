import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
import { JsonRpcProvider, KeyPair } from 'near-api-js';
import { verifyWalletRequest } from '../src/wallet-auth.js';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) || null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const source = readFileSync(new URL('../public/wallet.js', import.meta.url), 'utf8');
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture(storage = new MemoryStorage()) {
  storage.setItem('mandate_connected_wallet', 'alice.testnet');
  const provider = new JsonRpcProvider({ url: 'http://localhost:3999' });
  const query = vi.spyOn(provider, 'query').mockResolvedValue({ nonce: 3 } as any);
  const client = { signIn: vi.fn().mockResolvedValue('alice.testnet'), isConnected: vi.fn().mockResolvedValue(false),
    signMessage: vi.fn(), signAndSendTransaction: vi.fn(), disconnect: vi.fn().mockResolvedValue(undefined) };
  const createClient = vi.fn().mockResolvedValue(client);
  const request = vi.fn(async (url: string, options: any = {}) => {
    if (url === '/api/wallet/config') return response({ network: 'testnet', walletUrl: 'https://wallet.meteorwallet.app', authReceiver: 'treasury.testnet' });
    if (url === '/api/wallet/deposit/confirm') return response({ success: true });
    try {
      await verifyWalletRequest(provider, options.headers.get('x-mandate-account') || storage.getItem('mandate_connected_wallet')!,
        options.method, url, options.body || '', Object.fromEntries(options.headers));
      return response({ authorized: true });
    } catch (error: any) { return response({ error: error.message }, 400); }
  });
  const location = { origin: 'http://localhost:3000', pathname: '/', assign: vi.fn() };
  const window: any = { mandateMeteor: { createClient } };
  runInNewContext(source, { window, localStorage: storage, crypto: webcrypto, fetch: request, location, Headers, URL, TextEncoder, btoa, atob });
  return { wallet: window.mandateWallet, client, createClient, request, query, storage, location };
}

describe('Meteor browser wallet flow', () => {
  it('verifies authorization before persisting a key, then signs spend and allowlist requests after reload', async () => {
    const f = fixture();
    expect(f.wallet.authorized('alice.testnet')).toBe(false);
    expect(await f.wallet.authorize('alice.testnet')).toBe('alice.testnet');
    const auth = JSON.parse(f.storage.getItem('mandate_auth_alice.testnet')!);
    expect(f.client.signIn).toHaveBeenCalledWith(auth.publicKey);
    expect(f.query).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'alice.testnet', public_key: auth.publicKey }));
    expect(f.wallet.authorized('alice.testnet')).toBe(true);
    const restored = fixture(f.storage);
    for (const [method, url, body] of [['POST', '/api/wallet/execute', '{"action":"withdraw","asset":"NEAR","amount":"1"}'], ['DELETE', '/api/allowlist', '{"accountId":"payee.testnet"}']]) {
      const result = await restored.wallet.fetch(url, { method, headers: { 'x-mandate-account': 'alice.testnet' }, body });
      expect(result.ok).toBe(true);
    }
    expect(restored.createClient).not.toHaveBeenCalled();
    expect(f.location.assign).not.toHaveBeenCalled();
  });

  it('keeps canceled approvals and account mismatches unauthorized', async () => {
    const f = fixture();
    f.client.signIn.mockRejectedValueOnce(new Error('Action was cancelled'));
    await expect(f.wallet.authorize('alice.testnet')).rejects.toThrow('cancelled');
    f.client.signIn.mockResolvedValueOnce('bob.testnet');
    await expect(f.wallet.authorize('alice.testnet')).rejects.toThrow('alice.testnet');
    expect(f.wallet.authorized('alice.testnet')).toBe(false);
    expect(f.wallet.authorized('bob.testnet')).toBe(false);
    expect(f.storage.getItem('mandate_connected_wallet')).toBe('alice.testnet');
    expect(f.request.mock.calls.some(([url]) => url === '/api/wallet/authorize')).toBe(false);
  });

  it('rejects an uninstalled key and permits a later authorization retry', async () => {
    const f = fixture();
    f.query.mockRejectedValueOnce(new Error('Unknown access key'));
    await expect(f.wallet.authorize('alice.testnet')).rejects.toThrow('access key');
    expect(f.wallet.authorized('alice.testnet')).toBe(false);
    expect(await f.wallet.authorize('alice.testnet')).toBe('alice.testnet');
  });

  it('retries a temporary configuration failure instead of caching it', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(response({ error: 'Wallet configuration is unavailable.' }, 503));
    await expect(f.wallet.authorize('alice.testnet')).rejects.toThrow('configuration');
    expect(await f.wallet.authorize('alice.testnet')).toBe('alice.testnet');
    expect(f.createClient).toHaveBeenCalledTimes(1);
  });

  it('shares one SDK client across concurrent wallet requests', async () => {
    const f = fixture();
    const options = { method: 'POST', headers: { 'x-mandate-account': 'alice.testnet' }, body: '{}' };
    await Promise.all([f.wallet.fetch('/api/wallet/execute', options), f.wallet.fetch('/api/wallet/reconcile', options)]);
    expect(f.createClient).toHaveBeenCalledTimes(1);
    expect(f.request.mock.calls.filter(([url]) => url === '/api/wallet/config')).toHaveLength(1);
  });

  it('does not restore authorization when disconnected during a wallet prompt', async () => {
    const f = fixture();
    let finishSignIn: (account: string) => void = () => {};
    f.client.signIn.mockImplementation(() => new Promise(resolve => { finishSignIn = resolve; }));
    const pending = f.wallet.authorize('alice.testnet');
    await vi.waitFor(() => expect(f.client.signIn).toHaveBeenCalled());
    await f.wallet.disconnect('alice.testnet');
    finishSignIn('alice.testnet');
    await expect(pending).rejects.toThrow('wallet changed');
    expect(f.wallet.authorized('alice.testnet')).toBe(false);
    expect(f.client.disconnect).toHaveBeenCalledWith('alice.testnet');
  });

  it('leaves address-only links unauthorized and verifies fresh Meteor NEP-413 proofs', async () => {
    const f = fixture();
    const options = { method: 'POST', headers: { 'x-mandate-account': 'alice.testnet' }, body: '{}' };
    expect((await f.wallet.fetch('/api/wallet/execute', options)).ok).toBe(false);
    const key = KeyPair.fromRandom('ed25519');
    f.client.isConnected.mockResolvedValue(true);
    f.client.signMessage.mockImplementation(async (_account, { message, nonce, recipient }) => {
      const str = (value: string) => { const bytes = Buffer.from(value), size = Buffer.alloc(4); size.writeUInt32LE(bytes.length); return Buffer.concat([size, bytes]); };
      const tag = Buffer.alloc(4); tag.writeUInt32LE(2147483648 + 413);
      const digest = createHash('sha256').update(Buffer.concat([tag, str(message), Buffer.from(nonce), str(recipient), Buffer.from([0])])).digest();
      return { accountId: 'alice.testnet', publicKey: key.getPublicKey().toString(), signature: key.sign(digest).signature };
    });
    expect((await f.wallet.fetch('/api/wallet/execute', options)).ok).toBe(true);
    expect(f.wallet.authorized('alice.testnet')).toBe(false);
  });

  it('signs deposits in Meteor and confirms only a returned transaction hash', async () => {
    const f = fixture();
    const deposit = { walletTransaction: { signerId: 'alice.testnet', receiverId: 'agent.testnet', actions: [] } };
    f.client.signAndSendTransaction.mockResolvedValueOnce({ transaction: { hash: 'deposit-hash' } });
    expect(await f.wallet.signDeposit(deposit)).toEqual({ success: true });
    expect(f.client.signAndSendTransaction).toHaveBeenCalledWith(deposit.walletTransaction);
    expect(f.request).toHaveBeenCalledWith('/api/wallet/deposit/confirm', expect.objectContaining({ body: '{"txHash":"deposit-hash"}' }));
    await expect(f.wallet.signDeposit({ walletTransaction: { ...deposit.walletTransaction, signerId: 'bob.testnet' } })).rejects.toThrow('linked account');
    f.client.signAndSendTransaction.mockResolvedValueOnce({});
    await expect(f.wallet.signDeposit(deposit)).rejects.toThrow('transaction hash');
    expect(f.request.mock.calls.filter(([url]) => url === '/api/wallet/deposit/confirm')).toHaveLength(1);
  });
});
