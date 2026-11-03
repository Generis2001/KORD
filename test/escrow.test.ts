import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { KeyPair } from 'near-api-js';
import { Store } from '../src/db.js';
import { WalletStore } from '../src/wallet-store.js';
import { AgentWallet, units } from '../src/agent-wallet.js';
import { VerifiedEscrow } from '../src/escrow.js';

let store: Store, wallet: AgentWallet, escrow: VerifiedEscrow, state: any, calls: any[], failFunding: boolean, failRelease: boolean;
const config = { contractId: 'escrow.testnet', verifier: 'verifier.testnet', key: KeyPair.fromRandom('ed25519').toString() };
const request = { id: 'verified-mandate-id', amount: '0.01', recipient: 'researcher.testnet', evidenceHash: 'a'.repeat(64) };
const event = (name: string) => 'EVENT_JSON:' + JSON.stringify({ standard: 'mandate_escrow', version: '1.0.0', event: name, data: {} });
beforeEach(() => {
  store = new Store(':memory:'); state = null; calls = []; failFunding = false; failRelease = false;
  wallet = new AgentWallet({ network: 'testnet', rpcUrl: 'https://test.rpc.fastnear.com', accountId: 'treasury.testnet', privateKey: KeyPair.fromRandom('ed25519').toString(), yoctoPerCent: 10n ** 21n }, new WalletStore(store), ((accountId: string) => ({ accountId })) as any);
  vi.spyOn(wallet, 'nativeBalance').mockResolvedValue(units('5', 24));
  vi.spyOn(wallet.provider, 'query').mockResolvedValue({ permission: 'FullAccess' } as any);
  vi.spyOn(wallet, 'view').mockImplementation(async () => state);
  vi.spyOn(wallet, 'call').mockImplementation(async (account, contract, method, args: any, deposit = 0n, _gas, op) => {
    const saved = await wallet.receipts.get(op!.id);
    expect(saved?.status).toBe('pending');
    calls.push({ signer: account.accountId, contract, method, args, deposit });
    if (method === 'create_mandate') {
      if (failFunding) throw new Error('Ambiguous broadcast');
      state = { owner: account.accountId, verifier: args.verifier, budget: deposit.toString(), per_agent_cap: args.per_agent_cap, allowed_agents: args.allowed_agents, status: 'Active', remaining: deposit.toString() };
    }
    if (method === 'close_mandate') state.status = 'Closed';
    if (method === 'refund_remaining') state.remaining = '0';
    const logs = method === 'approve_payment' ? [event(failRelease ? 'payment_failed' : 'payment_confirmed')] : [];
    if (method === 'approve_payment' && !failRelease) state.remaining = '0';
    return { transaction: { hash: 'tx-' + calls.length }, status: { SuccessValue: method === 'refund_remaining' ? Buffer.from('true').toString('base64') : '' }, receipts_outcome: [{ outcome: { logs, status: { SuccessValue: '' } } }] } as any;
  });
  escrow = new VerifiedEscrow(wallet, config);
});
afterEach(() => { store.db.close(); vi.restoreAllMocks(); });

describe('verifier-gated testnet escrow', () => {
  it('funds from the owner agent wallet and releases only through the verifier contract call', async () => {
    const operation = await escrow.settle('alice.testnet', request);
    expect(operation).toMatchObject({ action: 'escrow_release', status: 'confirmed', evidenceHash: request.evidenceHash });
    expect(operation.fundingTxHashes).toEqual(['tx-1']);
    expect(operation.txHashes).toEqual(['tx-2']);
    expect(await wallet.receipts.get(operation.id)).toMatchObject({ fundingTxHashes: ['tx-1'], txHashes: ['tx-2'] });
    expect(calls.map(call => call.method)).toEqual(['create_mandate', 'approve_payment']);
    expect(calls[0].signer).toBe(wallet.identity('alice.testnet').accountId);
    expect(calls[0].deposit).toBe(units('0.01', 24));
    expect(calls[1].signer).toBe(config.verifier);
    expect(calls[1].args.evidence_hash).toBe(request.evidenceHash);
    expect(calls[1].deposit).toBe(0n);
  });
  it('does not fund or release twice when the same request is retried', async () => {
    const first = await escrow.settle('alice.testnet', request);
    expect(await escrow.settle('alice.testnet', request)).toEqual(first);
    expect(calls).toHaveLength(2);
    await expect(escrow.settle('alice.testnet', { ...request, amount: '0.02' })).rejects.toThrow('already used');
  });
  it('does not release if funding is ambiguous, and keeps a durable review receipt', async () => {
    failFunding = true;
    const operation = await escrow.settle('alice.testnet', request);
    expect(operation).toMatchObject({ action: 'escrow_fund', status: 'needs_review' });
    expect(calls).toHaveLength(1);
    expect(await wallet.receipts.get(operation.id)).toMatchObject({ status: 'needs_review' });
  });
  it('does not claim payment success from a successful transaction with a failed contract payout', async () => {
    failRelease = true;
    const operation = await escrow.settle('alice.testnet', request);
    expect(operation.status).toBe('needs_review');
    expect(operation.txHashes).toHaveLength(0);
    expect(operation.fundingTxHashes).toEqual(['tx-1']);
  });
  it('retains funded escrow proof when a state lookup fails before release', async () => {
    vi.mocked(wallet.view).mockRejectedValueOnce(new Error('RPC unavailable'));
    const operation = await escrow.settle('alice.testnet', request);
    expect(operation).toMatchObject({ status: 'needs_review', error: 'RPC unavailable', fundingTxHashes: ['tx-1'], txHashes: [] });
    expect(calls).toHaveLength(1);
    expect(await escrow.settle('alice.testnet', request)).toEqual(operation);
    expect(calls).toHaveLength(1);
  });
  it('restores funding hashes on an older release record without resending funds', async () => {
    const operation = await escrow.settle('alice.testnet', request);
    delete operation.fundingTxHashes;
    await wallet.receipts.save(operation);
    const restored = await escrow.settle('alice.testnet', request);
    expect(restored.fundingTxHashes).toEqual(['tx-1']);
    expect(calls).toHaveLength(2);
  });
  it('blocks missing configuration, mainnet, invalid proof and over-limit amounts before signing', async () => {
    await expect(new VerifiedEscrow(wallet, { contractId: '', verifier: '', key: '' }).settle('alice.testnet', request)).rejects.toThrow('requires');
    await expect(escrow.settle('alice.testnet', { ...request, evidenceHash: 'fake' })).rejects.toThrow('proof');
    await expect(escrow.settle('alice.testnet', { ...request, amount: '21' })).rejects.toThrow('limit');
    wallet.cfg.network = 'mainnet';
    await expect(escrow.settle('alice.testnet', request)).rejects.toThrow('testnet funds only');
    expect(calls).toHaveLength(0);
  });
  it('requires gas funds before creating or approving escrow', async () => {
    vi.mocked(wallet.nativeBalance).mockResolvedValue(0n);
    await expect(escrow.settle('alice.testnet', request)).rejects.toThrow('Deposit');
    expect(calls).toHaveLength(0);
  });
  it('rejects invalid or unauthorized verifier keys before funding', async () => {
    await expect(new VerifiedEscrow(wallet, { ...config, key: 'ed25519:...' }).settle('alice.testnet', request)).rejects.toThrow('valid testnet verifier');
    vi.mocked(wallet.provider.query).mockResolvedValue({ permission: { FunctionCall: { receiver_id: 'other.testnet', method_names: [] } } } as any);
    await expect(escrow.settle('alice.testnet', request)).rejects.toThrow('cannot approve');
    expect(calls).toHaveLength(0);
  });
  it('closes and refunds unspent funds to the agent owner, without duplicate refunds', async () => {
    failRelease = true;
    const release = await escrow.settle('alice.testnet', request);
    release.status = 'failed'; await wallet.receipts.save(release);
    const refunded = await escrow.refund('alice.testnet', release.mandateId!);
    expect(refunded).toMatchObject({ action: 'escrow_refund', status: 'confirmed', recipient: wallet.identity('alice.testnet').accountId });
    expect(calls.slice(-2).map(call => call.method)).toEqual(['close_mandate', 'refund_remaining']);
    const count = calls.length;
    expect(await escrow.refund('alice.testnet', release.mandateId!)).toEqual(refunded);
    expect(calls).toHaveLength(count);
  });
  it('does not refund another user or a mandate with no remaining funds', async () => {
    const released = await escrow.settle('alice.testnet', request);
    await expect(escrow.refund('bob.testnet', released.mandateId!)).rejects.toThrow('belong');
    await expect(escrow.refund('alice.testnet', released.mandateId!)).rejects.toThrow('No unspent');
  });
});
