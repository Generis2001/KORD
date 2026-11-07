import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { KeyPair } from 'near-api-js';
import { Store } from '../src/db.js';
import { WalletStore } from '../src/wallet-store.js';
import { AgentWallet, units, decimal } from '../src/agent-wallet.js';
import { TestnetDex, deliveredOutput } from '../src/dex.js';

const token = 'usdt.fakes.testnet', dex = 'ref-finance-101.testnet', wrap = 'wrap.testnet';
const cfg = { network: 'testnet', rpcUrl: 'http://localhost:3999', accountId: 'treasury.testnet', privateKey: KeyPair.fromRandom('ed25519').toString(), yoctoPerCent: 10n ** 21n };
let db: Store, wallet: AgentWallet, count: number;
let read: ReturnType<typeof vi.fn<(contract: string, method: string, args: any) => Promise<any>>>;
beforeEach(() => {
  vi.stubEnv('SWAP_MODE', 'ref'); vi.stubEnv('TESTNET_DEX_POOL_ID', '118');
  db = new Store(':memory:'); count = 0;
  wallet = new AgentWallet(cfg, new WalletStore(db), ((accountId: string) => ({ accountId })) as any);
  read = vi.fn(async (_contract: string, method: string, args: any) => {
    if (method === 'get_pool') return { pool_kind: 'SIMPLE_POOL', token_account_ids: [wrap, token], amounts: [units('10', 24).toString(), units('50', 6).toString()], total_fee: 30 };
    if (method === 'ft_metadata') return { decimals: 6 };
    if (method === 'storage_balance_of') return { total: '1250000000000000000000' };
    if (method === 'get_return') return args.token_in === wrap ? (args.amount_in === units('1', 24).toString() ? '4500000' : '8000000') : units('1.8', 24).toString();
    throw new Error('Unexpected view ' + method);
  });
  vi.spyOn(wallet, 'view').mockImplementation(read);
  vi.spyOn(wallet, 'nativeBalance').mockResolvedValue(units('10', 24));
  vi.spyOn(wallet, 'tokenBalance').mockResolvedValue(units('40', 6));
  vi.spyOn(wallet, 'call').mockImplementation(async (account, contract, method, _args, _deposit, _gas, op) => {
    const hash = 'test-' + ++count;
    if (op) { op.attempt = { txHash: hash, signerId: account.accountId, kind: op.phase || 'execution' }; await wallet.receipts.save(op); }
    const outputToken = contract === wrap ? token : wrap;
    return { transaction: { hash, signer_id: account.accountId }, status: { SuccessValue: Buffer.from(method === 'ft_transfer_call' ? JSON.stringify(op!.dex!.amountIn) : '').toString('base64') }, receipts_outcome: method === 'ft_transfer_call' ? [{ outcome: { executor_id: outputToken, status: { SuccessValue: '' }, logs: ['EVENT_JSON:' + JSON.stringify({ standard: 'nep141', event: 'ft_transfer', data: [{ old_owner_id: dex, new_owner_id: account.accountId, amount: op!.dex!.expectedOutput }] })] } }] : [] } as any;
  });
});
afterEach(() => { db.db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('reserve-based testnet DEX', () => {
  it('uses current contract returns rather than a constant exchange rate', async () => {
    const service = new TestnetDex(cfg, token, read);
    const one = await service.quote('NEAR', '1'), two = await service.quote('NEAR', '2');
    expect(one.expectedOutput).toBe('4500000'); expect(two.expectedOutput).toBe('8000000');
    expect(one.minOutput).toBe('4410000'); expect(two.minOutput).toBe('7840000');
    expect(read).toHaveBeenCalledWith(dex, 'get_return', expect.objectContaining({ amount_in: units('2', 24).toString() }));
  });
  it('rejects mainnet, wrong pool assets, empty reserves and incompatible decimals', async () => {
    await expect(new TestnetDex({ ...cfg, network: 'mainnet' }, token, read).quote('NEAR', '1')).rejects.toThrow('testnet only');
    read.mockImplementationOnce(async () => ({ pool_kind: 'SIMPLE_POOL', token_account_ids: [wrap, 'wrong.testnet'] }));
    await expect(new TestnetDex(cfg, token, read).quote('NEAR', '1')).rejects.toThrow('must contain');
    read.mockImplementationOnce(async () => ({ pool_kind: 'SIMPLE_POOL', token_account_ids: [wrap, token], amounts: ['0', '0'] }));
    await expect(new TestnetDex(cfg, token, read).quote('NEAR', '1')).rejects.toThrow('no liquidity');
    read.mockImplementationOnce(async () => ({ pool_kind: 'SIMPLE_POOL', token_account_ids: [wrap, token], amounts: ['1', '1'] }));
    read.mockImplementationOnce(async () => ({ decimals: 18 }));
    await expect(new TestnetDex(cfg, token, read).quote('NEAR', '1')).rejects.toThrow('6 decimals');
  });
  it('blocks a minimum above the live return before signing', async () => {
    await expect(wallet.execute('alice.testnet', { id: randomUUID(), action: 'swap', asset: 'NEAR', amount: '1', minOutput: '5' })).rejects.toThrow('minimum');
    expect(wallet.call).not.toHaveBeenCalled();
  });
  it('wraps NEAR and executes on the DEX without sending input to the treasury', async () => {
    const request = { id: randomUUID(), action: 'swap', asset: 'NEAR' as const, amount: '1' };
    const op = await wallet.execute('alice.testnet', request);
    expect(op.status).toBe('confirmed'); expect(op.dex?.actualOutput).toBe('4500000');
    expect(wallet.call).toHaveBeenCalledWith(expect.anything(), wrap, 'near_deposit', {}, units('1', 24), '40', expect.anything());
    const swap = vi.mocked(wallet.call).mock.calls.find(call => call[2] === 'ft_transfer_call')!;
    const args = swap[3] as any;
    expect(args.receiver_id).toBe(dex); expect(JSON.parse(args.msg).actions[0].min_amount_out).toBe('4410000');
    await wallet.execute('alice.testnet', request);
    expect(vi.mocked(wallet.call).mock.calls.filter(call => call[2] === 'ft_transfer_call')).toHaveLength(1);
  });
  it('resumes only unwrapping after a successful USDT swap and an unwrap timeout', async () => {
    const normal = vi.mocked(wallet.call).getMockImplementation()!;
    let fail = true;
    vi.mocked(wallet.call).mockImplementation(async (...args) => {
      if (args[2] === 'near_withdraw' && fail) { fail = false; throw new Error('RPC offline before signing'); }
      return normal(...args);
    });
    const op = await wallet.execute('alice.testnet', { id: randomUUID(), action: 'swap', asset: 'USDT', amount: '10' });
    expect(op.status).toBe('needs_review'); expect(op.dex?.swapConfirmed).toBe(true);
    expect((await wallet.reconcile('alice.testnet', op.id)).status).toBe('funding_confirmed');
    const resumed = await wallet.resumeSwap('alice.testnet', op.id);
    expect(resumed.status).toBe('confirmed');
    expect(vi.mocked(wallet.call).mock.calls.filter(call => call[2] === 'ft_transfer_call')).toHaveLength(1);
    expect(decimal(BigInt(resumed.dex!.actualOutput!), 24)).toBe('1.800000000000000000000000');
  });
  it('requires token output receipts from the right contract and parties', async () => {
    const quote = await new TestnetDex(cfg, token, read).quote('NEAR', '1');
    expect(() => deliveredOutput({ receipts_outcome: [{ outcome: { executor_id: 'forged.testnet', logs: ['Transfer 4500000 from ' + dex + ' to alice.testnet'] } }] }, quote, 'alice.testnet')).toThrow('receipt');
    expect(deliveredOutput({ receipts_outcome: [{ outcome: { executor_id: token, logs: ['Transfer 4500000 from ' + dex + ' to alice.testnet'] } }] }, quote, 'alice.testnet')).toBe(4500000n);
  });
  it('counts one transfer once when both token log formats or duplicate receipts are present', async () => {
    const quote = await new TestnetDex(cfg, token, read).quote('NEAR', '1');
    const receipt = { id: 'same-receipt', outcome: { executor_id: token, logs: [
      'Transfer 4500000 from ' + dex + ' to alice.testnet',
      'EVENT_JSON:' + JSON.stringify({ standard: 'nep141', event: 'ft_transfer', data: [{ old_owner_id: dex, new_owner_id: 'alice.testnet', amount: '4500000' }] }),
    ] } };
    expect(deliveredOutput({ receipts_outcome: [receipt, receipt] }, quote, 'alice.testnet')).toBe(4500000n);
  });
  it('resumes a wrapped NEAR input when the swap fails before signing', async () => {
    const normal = vi.mocked(wallet.call).getMockImplementation()!;
    let fail = true;
    vi.mocked(wallet.call).mockImplementation(async (...args) => {
      if (args[2] === 'ft_transfer_call' && fail) { fail = false; throw new Error('RPC offline before signing'); }
      return normal(...args);
    });
    const op = await wallet.execute('alice.testnet', { id: randomUUID(), action: 'swap', asset: 'NEAR', amount: '1' });
    expect(op.dex?.wrappedInput).toBe(true);
    expect(op.attempt).toBeUndefined();
    expect((await wallet.reconcile('alice.testnet', op.id)).status).toBe('funding_confirmed');
    expect((await wallet.resumeSwap('alice.testnet', op.id)).status).toBe('confirmed');
    expect(vi.mocked(wallet.call).mock.calls.filter(call => call[2] === 'near_deposit')).toHaveLength(1);
  });
});
