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
function signProof(key: KeyPair, accountId: string, { message, nonce, recipient }: { message: string; nonce: Uint8Array; recipient: string }) {
  const str = (value: string) => { const bytes = Buffer.from(value), size = Buffer.alloc(4); size.writeUInt32LE(bytes.length); return Buffer.concat([size, bytes]); };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2147483648 + 413);
  const digest = createHash('sha256').update(Buffer.concat([tag, str(message), Buffer.from(nonce), str(recipient), Buffer.from([0])])).digest();
  return { accountId, publicKey: key.getPublicKey().toString(), signature: key.sign(digest).signature };
}
function fixture(storage = new MemoryStorage()) {
  storage.setItem('mandate_connected_wallet', 'alice.testnet');
  const provider = new JsonRpcProvider({ url: 'http://localhost:3999' });
  const query = vi.spyOn(provider, 'query').mockResolvedValue({ nonce: 3 } as any);
  const approvalKey = KeyPair.fromRandom('ed25519');
  const client = { signIn: vi.fn().mockResolvedValue('alice.testnet'), isConnected: vi.fn().mockResolvedValue(false),
    signMessage: vi.fn(async (account: string, params: { message: string; nonce: Uint8Array; recipient: string }) => signProof(approvalKey, account, params)),
    signAndSendTransaction: vi.fn(), disconnect: vi.fn().mockResolvedValue(undefined) };
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
  it('verifies the saved key but opens fresh Meteor approvals for spend and allowlist requests after reload', async () => {
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
      const request = restored.request.mock.calls.find(([path]) => path === url)![1];
      expect(request.headers.get('x-mandate-auth-type')).toBe('nep413');
      expect(request.headers.get('x-mandate-public-key')).not.toBe(auth.publicKey);
    }
    expect(restored.createClient).toHaveBeenCalledTimes(1);
    expect(restored.client.signMessage).toHaveBeenCalledTimes(2);
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

  it('requires a fresh Meteor signature for address-only links without saving it as automatic authorization', async () => {
    const f = fixture();
    const options = { method: 'POST', headers: { 'x-mandate-account': 'alice.testnet' }, body: '{}' };
    f.client.signMessage.mockRejectedValueOnce(new Error('Action was cancelled'));
    await expect(f.wallet.fetch('/api/wallet/execute', options)).rejects.toThrow('cancelled');
    expect(f.request.mock.calls.some(([url]) => url === '/api/wallet/execute')).toBe(false);
    expect((await f.wallet.fetch('/api/wallet/execute', options)).ok).toBe(true);
    expect(f.wallet.authorized('alice.testnet')).toBe(false);
  });

  it.each([
    'Send 2 USDT to payee.testnet', 'Please Mandate, withdraw 1 NEAR', 'Stake 1 NEAR', 'Unstake 3 USDT',
    'Claim 1 NEAR', 'Swap 1 NEAR for USDT', 'Exchange 2 USDT for NEAR',
    'Refund escrow m_' + 'a'.repeat(40), 'Add payee.testnet to my allowlist',
    'Research solar energy; research fee 0.037 NEAR',
    'Research solar energy and authorize a research fee of 0.037 testnet NEAR to researcher.testnet',
    'Research solar energy. pay 0.037 NEAR for research.',
    'Research solar energy; escrow 0.037 NEAR to researcher.testnet',
  ])('opens a new, request-bound approval every time for %s', async message => {
    const f = fixture();
    await f.wallet.authorize('alice.testnet');
    const options = { method: 'POST', headers: { 'x-mandate-account': 'alice.testnet' }, body: JSON.stringify({ message }) };
    expect((await f.wallet.fetch('/api/chat', options)).ok).toBe(true);
    expect((await f.wallet.fetch('/api/chat', options)).ok).toBe(true);
    expect(f.client.signMessage).toHaveBeenCalledTimes(2);
    const first = f.client.signMessage.mock.calls[0][1], second = f.client.signMessage.mock.calls[1][1];
    expect(first.message).toContain('\n\nApprove this agent action:\n' + options.body);
    expect(first.recipient).toBe('mandate');
    expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(false);
  });

  it.each([
    'What is my wallet balance?', 'Research solar energy in Nigeria', 'Research solar energy; budget 10 NEAR',
    'Research solar energy; research fee 0 NEAR', 'Research office chairs with a $500 budget',
    'Deposit 2 NEAR', 'Fund treasury with 3 USDT', 'Claim testnet NEAR from the faucet',
    'Research providers that advertise a research fee 2 NEAR on their pages',
  ])('uses saved authorization without a spending popup for %s', async message => {
    const original = fixture();
    await original.wallet.authorize('alice.testnet');
    const f = fixture(original.storage);
    expect((await f.wallet.fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message }) })).ok).toBe(true);
    expect(f.createClient).not.toHaveBeenCalled();
    expect(f.client.signMessage).not.toHaveBeenCalled();
  });

  it('blocks cancelled approvals, a mismatched signer and a wallet changed during approval before submission', async () => {
    const f = fixture();
    await f.wallet.authorize('alice.testnet');
    const options = { method: 'POST', body: '{"action":"withdraw","asset":"NEAR","amount":"1"}' };
    f.client.signMessage.mockRejectedValueOnce(new Error('Action was cancelled'));
    await expect(f.wallet.fetch('/api/wallet/execute', options)).rejects.toThrow('cancelled');
    f.client.signMessage.mockResolvedValueOnce(signProof(KeyPair.fromRandom('ed25519'), 'bob.testnet', { message: 'wrong account', nonce: new Uint8Array(32), recipient: 'mandate' }));
    await expect(f.wallet.fetch('/api/wallet/execute', options)).rejects.toThrow('linked account');
    let finish: () => void = () => {};
    f.client.signMessage.mockImplementationOnce(async (account, params) => {
      await new Promise<void>(resolve => { finish = resolve; });
      return signProof(KeyPair.fromRandom('ed25519'), account, params);
    });
    const pending = f.wallet.fetch('/api/wallet/execute', options);
    await vi.waitFor(() => expect(f.client.signMessage).toHaveBeenCalledTimes(3));
    await f.wallet.disconnect('alice.testnet');
    finish();
    await expect(pending).rejects.toThrow('wallet changed');
    expect(f.request.mock.calls.some(([url]) => url === '/api/wallet/execute')).toBe(false);
  });

  it('keeps approved unstake collection automatic while explicit claims and other actions need fresh approval', async () => {
    const original = fixture();
    await original.wallet.authorize('alice.testnet');
    const f = fixture(original.storage);
    const options = { method: 'POST', body: '{"action":"claim","asset":"NEAR","amount":"1"}' };
    expect((await f.wallet.fetch('/api/wallet/execute', { ...options, continuingUnstake: true })).ok).toBe(true);
    expect(f.client.signMessage).not.toHaveBeenCalled();
    expect(f.request.mock.calls[0][1]).not.toHaveProperty('continuingUnstake');
    expect((await f.wallet.fetch('/api/wallet/execute', options)).ok).toBe(true);
    expect((await f.wallet.fetch('/api/wallet/execute', { ...options, continuingUnstake: true, body: '{"action":"withdraw","asset":"NEAR","amount":"1"}' })).ok).toBe(true);
    expect(f.client.signMessage).toHaveBeenCalledTimes(2);
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
