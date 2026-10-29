import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyPair, KeyPairSigner, createTransaction, actions, decodeTransaction, baseEncode } from 'near-api-js';
import { Store } from '../src/db.js';
import { AgentWallet, units, decimal, confirmedHash, GAS_RESERVE } from '../src/agent-wallet.js';
import { WalletStore } from '../src/wallet-store.js';
import { parseWalletCommand } from '../src/wallet-command.js';
import { TEST_USDT_TOKEN_ID } from '../src/swap.js';

const cfg = { network: 'testnet', rpcUrl: 'http://localhost:3999', accountId: 'treasury.testnet', privateKey: KeyPair.fromRandom('ed25519').toString(), yoctoPerCent: 10n ** 21n };
const owner = 'alice.testnet';
let db: Store, wallet: AgentWallet, near: Map<string, bigint>, tokens: Map<string, bigint>, staked: Record<string, bigint>, unstaked: Record<string, bigint>, mature: boolean, serial: number;
let factory: ReturnType<typeof vi.fn>;
const result = (value = '') => ({ transaction: { hash: `tx-${++serial}` }, status: { SuccessValue: value }, receipts_outcome: [] });
beforeEach(() => {
  vi.stubEnv('NEAR_STAKING_POOL_ID', 'validator.pool.testnet');
  vi.stubEnv('USDT_STAKING_CONTRACT_ID', 'yield.testnet');
  vi.stubEnv('AGENT_WALLET_MASTER_KEY', 'test-wallet-master-key');
  db = new Store(':memory:');
  near = new Map(); tokens = new Map(); staked = { NEAR: 0n, USDT: 0n }; unstaked = { NEAR: 0n, USDT: 0n }; mature = false; serial = 0;
  factory = vi.fn((accountId: string) => ({ accountId, transfer: vi.fn(async ({ receiverId, amount }) => {
    near.set(accountId, near.get(accountId)! - amount);
    near.set(receiverId, (near.get(receiverId) || 0n) + amount);
    return result();
  }) }));
  wallet = new AgentWallet(cfg, new WalletStore(db), factory as any);
  const agent = wallet.identity(owner).accountId;
  near.set(agent, units('10', 24)); near.set(owner, units('20', 24)); near.set(cfg.accountId, units('100', 24));
  tokens.set(agent, units('40', 6)); tokens.set(owner, units('60', 6)); tokens.set(cfg.accountId, units('1000', 6));
  vi.spyOn(wallet, 'nativeBalance').mockImplementation(async id => near.get(id) || 0n);
  vi.spyOn(wallet, 'tokenBalance').mockImplementation(async id => tokens.get(id) || 0n);
  vi.spyOn(wallet, 'transact').mockImplementation(async (account, recipient, actions): Promise<any> => {
    if (!actions[0].transfer) throw new Error('Unexpected test transaction');
    return account.transfer({ receiverId: recipient, amount: actions[0].transfer.deposit });
  });
  vi.spyOn(wallet, 'view').mockImplementation(async (contract, method) => {
    if (method === 'storage_balance_of') return { total: '1250000000000000000000' };
    if (method === 'get_position') return { staked: staked.USDT.toString(), unstaked: unstaked.USDT.toString(), withdrawable: mature ? unstaked.USDT.toString() : '0' };
    if (method === 'get_account_staked_balance') return staked.NEAR.toString();
    if (method === 'get_account_unstaked_balance') return unstaked.NEAR.toString();
    if (method === 'is_account_unstaked_balance_available') return mature;
    throw new Error(`Unexpected view ${method}`);
  });
  vi.spyOn(wallet, 'call').mockImplementation(async (account, contract, method, args: any, deposit = 0n): Promise<any> => {
    const asset = contract === wallet.nearPool ? 'NEAR' : 'USDT';
    const amount = BigInt(args.amount || deposit);
    if (method === 'ft_transfer') {
      tokens.set(account.accountId, tokens.get(account.accountId)! - amount);
      tokens.set(args.receiver_id, (tokens.get(args.receiver_id) || 0n) + amount);
    } else if (method === 'deposit_and_stake' || method === 'ft_transfer_call') {
      const balances = asset === 'NEAR' ? near : tokens;
      balances.set(account.accountId, balances.get(account.accountId)! - amount);
      staked[asset] += amount;
      if (method === 'ft_transfer_call') return result(Buffer.from(JSON.stringify(amount.toString())).toString('base64'));
    } else if (method === 'unstake') { staked[asset] -= amount; unstaked[asset] += amount; }
    else if (method === 'withdraw') {
      unstaked[asset] -= amount;
      const balances = asset === 'NEAR' ? near : tokens;
      balances.set(account.accountId, balances.get(account.accountId)! + amount);
    } else if (method !== 'storage_deposit') throw new Error(`Unexpected call ${method}`);
    return result();
  });
});
afterEach(() => { db.db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const execute = (action: string, asset: 'NEAR' | 'USDT', amount: string, extra = {}) => wallet.execute(owner, { id: `operation-${++serial}`, action, asset, amount, ...extra });

describe('isolated on-chain agent wallets', () => {
  it('derives stable, distinct signing accounts and never exposes keys in a snapshot', async () => {
    const identity = wallet.identity(owner);
    expect(identity.accountId).toMatch(/^[a-f0-9]{64}$/);
    expect(identity).toEqual(wallet.identity(owner));
    expect(identity.accountId).not.toBe(wallet.identity('bob.testnet').accountId);
    const publicBytes = KeyPair.fromString(identity.key).getPublicKey().data;
    expect(Buffer.from(publicBytes).toString('hex')).toBe(identity.accountId);
    const snapshot = await wallet.snapshot(owner);
    expect(snapshot).not.toHaveProperty('key');
    expect(snapshot.linked.near).toBe(decimal(units('20', 24), 24));
    expect(snapshot.balanceNear).toBe(decimal(units('10', 24), 24));
  });
  it('gives new profiles zero synthetic balance', () => {
    expect(db.getUserBalance('new.testnet')).toBe(0);
    expect(db.getUserUsdtBalance('new.testnet')).toBe(0);
  });
  it.each(['NEAR', 'USDT'] as const)('withdraws %s from the agent back to its owner', async asset => {
    const op = await execute('withdraw', asset, '2', { recipient: 'attacker.testnet' });
    expect(op).toMatchObject({ status: 'confirmed', recipient: owner });
    const snapshot = await wallet.snapshot(owner);
    expect(Number(asset === 'NEAR' ? snapshot.balanceNear : snapshot.userUsdt)).toBe(asset === 'NEAR' ? 8 : 38);
    expect(Number(asset === 'NEAR' ? snapshot.linked.near : snapshot.linked.usdt)).toBe(asset === 'NEAR' ? 22 : 62);
  });
  it('sends USDT without crediting the linked owner', async () => {
    await execute('send', 'USDT', '3', { recipient: 'bob.testnet' });
    expect(tokens.get('bob.testnet')).toBe(units('3', 6));
    expect(tokens.get(owner)).toBe(units('60', 6));
  });
  it('keeps swapped USDT inside the agent and transfers the NEAR input to the pool', async () => {
    const op = await execute('swap', 'NEAR', '2');
    expect(op.txHashes).toHaveLength(2);
    expect(op.status).toBe('confirmed');
    const snapshot = await wallet.snapshot(owner);
    expect(Number(snapshot.balanceNear)).toBe(8);
    expect(Number(snapshot.userUsdt)).toBe(50);
    expect(Number(snapshot.linked.usdt)).toBe(60);
    expect(near.get(cfg.accountId)).toBe(units('102', 24));
  });
  it('swaps USDT back to real NEAR in the agent wallet', async () => {
    await execute('swap', 'USDT', '5');
    const snapshot = await wallet.snapshot(owner);
    expect(Number(snapshot.balanceNear)).toBe(11);
    expect(Number(snapshot.userUsdt)).toBe(35);
    expect(near.get(owner)).toBe(units('20', 24));
  });
  it('retains NEAR for gas and rejects insufficient funds before signing', async () => {
    await expect(execute('withdraw', 'NEAR', '10')).rejects.toThrow('Insufficient');
    expect(factory).not.toHaveBeenCalledWith(cfg.accountId, expect.anything());
    expect(near.get(wallet.identity(owner).accountId)).toBe(units('10', 24));
    expect(GAS_RESERVE).toBeGreaterThan(0n);
  });
  it('enforces spending caps and minimum output without changing balances', async () => {
    await expect(execute('send', 'USDT', '101', { recipient: 'bob.testnet' })).rejects.toThrow('limit');
    await expect(execute('swap', 'NEAR', '2', { minOutput: '11' })).rejects.toThrow('minimum');
    expect(tokens.get(wallet.identity(owner).accountId)).toBe(units('40', 6));
  });
  it('returns a durable result for retries instead of signing twice', async () => {
    const req = { id: 'repeat-operation', action: 'withdraw', asset: 'NEAR' as const, amount: '1' };
    const op = await wallet.execute(owner, req);
    expect(await wallet.execute(owner, req)).toEqual(op);
    expect(near.get(wallet.identity(owner).accountId)).toBe(units('9', 24));
    await expect(wallet.execute('bob.testnet', req)).rejects.toThrow('another transaction');
  });
  it('serializes concurrent operations on the same account', async () => {
    const results = await Promise.allSettled([execute('withdraw', 'NEAR', '6'), execute('withdraw', 'NEAR', '6')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(near.get(wallet.identity(owner).accountId)).toBe(units('4', 24));
  });
  it('pauses further spending after a swap payout timeout without fabricating output', async () => {
    vi.mocked(wallet.call).mockRejectedValueOnce(new Error('RPC timeout'));
    const op = await execute('swap', 'NEAR', '2');
    expect(op.status).toBe('needs_review');
    expect(op.txHashes).toHaveLength(1);
    expect(near.get(wallet.identity(owner).accountId)).toBe(units('8', 24));
    expect(tokens.get(wallet.identity(owner).accountId)).toBe(units('40', 6));
    await expect(execute('withdraw', 'NEAR', '1')).rejects.toThrow('reconciliation');
  });
  it('resumes a funded swap without sending its input again', async () => {
    vi.mocked(wallet.call).mockRejectedValueOnce(new Error('RPC unavailable before signing payout'));
    const op = await execute('swap', 'NEAR', '2');
    expect((await wallet.reconcile(owner, op.id)).status).toBe('funding_confirmed');
    expect((await wallet.resumeSwap(owner, op.id)).status).toBe('confirmed');
    expect(near.get(wallet.identity(owner).accountId)).toBe(units('8', 24));
    expect(tokens.get(wallet.identity(owner).accountId)).toBe(units('50', 6));
    await expect(wallet.resumeSwap(owner, op.id)).rejects.toThrow('Reconcile');
  });
  it('saves an exact signed hash before broadcast so a timeout can be checked safely', async () => {
    vi.mocked(wallet.transact).mockRestore();
    const identity = wallet.identity(owner);
    const transaction = createTransaction(identity.accountId, KeyPair.fromString(identity.key).getPublicKey(), owner, 4n, [actions.transfer(units('1',24))], new Uint8Array(32));
    const signed = await KeyPairSigner.fromSecretKey(identity.key).signTransaction(transaction);
    const fakeAccount = { accountId: identity.accountId, createSignedTransaction: vi.fn().mockResolvedValue(signed.signedTransaction) };
    factory.mockReturnValue(fakeAccount);
    const broadcast = vi.spyOn(wallet.provider, 'sendTransactionUntil').mockImplementation(async () => {
      const saved = await wallet.receipts.get('hash-before-broadcast');
      expect(saved?.attempt?.txHash).toBe(baseEncode(signed.txHash));
      throw new Error('Network timeout');
    });
    const op = await wallet.execute(owner, { id: 'hash-before-broadcast', action: 'withdraw', asset: 'NEAR', amount: '1' });
    expect(op.status).toBe('needs_review');
    expect(broadcast).toHaveBeenCalledTimes(1);
    vi.spyOn(wallet.provider, 'viewTransactionStatusWithReceipts').mockResolvedValue({ ...result(), transaction: { hash: baseEncode(signed.txHash), signer_id: identity.accountId } } as any);
    expect((await wallet.reconcile(owner, op.id)).status).toBe('confirmed');
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
  it('keeps spending paused when the saved receipt cannot be found', async () => {
    const op = { id: 'unknown-receipt', userAccount: owner, action: 'withdraw', asset: 'NEAR' as const, amount: '1', status: 'needs_review' as const,
      txHashes: [], attempt: { txHash: 'missing', signerId: wallet.identity(owner).accountId, kind: 'execution' as const }, createdAt: new Date().toISOString() };
    await wallet.receipts.save(op);
    vi.spyOn(wallet.provider, 'viewTransactionStatusWithReceipts').mockRejectedValue(new Error('Unknown transaction'));
    await expect(wallet.reconcile(owner, op.id)).rejects.toThrow('Unknown transaction');
    expect((await wallet.receipts.get(op.id))?.status).toBe('needs_review');
  });
  it('conclusively failed receipts release the spending pause', async () => {
    const id = 'failed-chain-receipt', txHash = 'known-failed-hash';
    await wallet.receipts.save({ id, userAccount: owner, action: 'withdraw', asset: 'NEAR', amount: '1', status: 'needs_review',
      txHashes: [], attempt: { txHash, signerId: wallet.identity(owner).accountId, kind: 'execution' }, createdAt: new Date().toISOString() });
    vi.spyOn(wallet.provider, 'viewTransactionStatusWithReceipts').mockResolvedValue({ transaction: { hash: txHash, signer_id: wallet.identity(owner).accountId }, status: { Failure: 'insufficient gas' } } as any);
    expect((await wallet.reconcile(owner, id)).status).toBe('failed');
    expect(await wallet.receipts.unresolved(owner)).toBeNull();
  });
  it.each(['NEAR', 'USDT'] as const)('stakes and unstakes %s, collecting only after cooldown', async asset => {
    expect((await execute('stake', asset, '2')).status).toBe('confirmed');
    let pos = await wallet.position(owner, asset);
    expect(Number(pos.staked)).toBe(2);
    expect((await execute('unstake', asset, '1')).status).toBe('confirmed');
    pos = await wallet.position(owner, asset);
    expect(Number(pos.staked)).toBe(1);
    expect(Number(pos.unstaked)).toBe(1);
    await expect(execute('claim', asset, '1')).rejects.toThrow('cooldown');
    mature = true;
    expect((await execute('claim', asset, '1')).status).toBe('confirmed');
    expect(Number((await wallet.position(owner, asset)).unstaked)).toBe(0);
  });
  it('refuses a refunded USDT stake rather than reporting success', async () => {
    vi.mocked(wallet.call).mockResolvedValueOnce(result(Buffer.from('"0"').toString('base64')) as any);
    const op = await execute('stake', 'USDT', '2');
    expect(op.status).toBe('needs_review');
    expect(staked.USDT).toBe(0n);
  });
  it('requires a configured provider and sufficient staked balance', async () => {
    await expect(execute('unstake', 'NEAR', '1')).rejects.toThrow('staked balance');
    vi.stubEnv('USDT_STAKING_CONTRACT_ID', '');
    const unconfigured = new AgentWallet(cfg, new WalletStore(db), factory as any);
    expect((await unconfigured.position(owner, 'USDT')).configured).toBe(false);
  });
  it('rejects receipt failures, missing hashes, and unconfirmed responses', () => {
    expect(() => confirmedHash({ status: { Failure: 'denied' } })).toThrow('failed');
    expect(() => confirmedHash({ status: { SuccessValue: '' } })).toThrow('no hash');
    expect(() => confirmedHash({ transaction: { hash: 'abc' } })).toThrow('pending');
    expect(() => confirmedHash({ ...result(), receipts_outcome: [{ outcome: { status: { Failure: 'refund' } } }] })).toThrow('failed');
  });
  it('prepares a wallet-signed NEAR deposit targeting the isolated implicit account', async () => {
    vi.spyOn(wallet.provider, 'query').mockResolvedValue({ keys: [{ public_key: KeyPair.fromRandom('ed25519').getPublicKey().toString(), access_key: { permission: 'FullAccess', nonce: 3 } }] } as any);
    vi.spyOn(wallet.provider, 'viewBlock').mockResolvedValue({ header: { hash: baseEncode(new Uint8Array(32)) } } as any);
    const deposit = await wallet.prepareDeposit(owner, 'NEAR', '1');
    const tx = decodeTransaction(Buffer.from(deposit.transaction, 'base64'));
    expect(tx.signerId).toBe(owner);
    expect(tx.receiverId).toBe(wallet.identity(owner).accountId);
    expect(tx.actions[0].transfer?.deposit).toBe(units('1', 24));
    expect(tx.nonce).toBe(4n);
  });
  it('verifies a real deposit recipient and signer, and replay never credits a database quota', async () => {
    const txHash = baseEncode(new Uint8Array(32).fill(2));
    const tx = { ...result(), transaction: { hash: txHash, signer_id: owner, receiver_id: wallet.identity(owner).accountId, actions: [{ Transfer: { deposit: units('2', 24).toString() } }] } };
    vi.spyOn(wallet.provider, 'viewTransactionStatusWithReceipts').mockResolvedValue(tx as any);
    await wallet.confirmDeposit(owner, txHash);
    await wallet.confirmDeposit(owner, txHash);
    expect(await wallet.receipts.list(owner)).toHaveLength(1);
    expect(db.getUserBalance(owner)).toBe(0);
    tx.transaction.receiver_id = 'attacker.testnet';
    await expect(wallet.confirmDeposit(owner, txHash)).rejects.toThrow('did not deposit');
  });
});

describe('single financial commands and exact amounts', () => {
  it.each(['NEAR', 'USDT'])('parses deposit, withdrawal, stake and unstake for %s', asset => {
    for (const action of ['deposit', 'withdraw', 'stake', 'unstake']) expect(parseWalletCommand(`Mandate ${action} 2.5 ${asset}`)).toMatchObject({ action, amount: '2.5', asset });
  });
  it('keeps swaps internal and rejects ambiguous or malformed commands', () => {
    expect(parseWalletCommand('Swap 2 NEAR for Test USDT')).toMatchObject({ action: 'swap', asset: 'NEAR' });
    expect(parseWalletCommand('Send 2 USDT to bob.testnet')).toMatchObject({ action: 'send', recipient: 'bob.testnet' });
    expect(parseWalletCommand('I received 5 NEAR')).toBeNull();
    expect(parseWalletCommand('Stake -2 NEAR')).toBeNull();
    expect(() => parseWalletCommand('Swap 2 NEAR to bob.testnet')).toThrow();
    expect(() => parseWalletCommand('Send 2 NEAR')).toThrow('recipient');
  });
  it('preserves atomic units and rejects excess precision, negative, infinite and exponent values', () => {
    expect(units('0.000001', 6)).toBe(1n);
    expect(units('0.000000000000000000000001', 24)).toBe(1n);
    for (const value of ['0', '-1', 'Infinity', '1e2', '1.0000001']) expect(() => units(value, 6)).toThrow();
  });
});
