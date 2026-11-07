import { describe, expect, it } from 'vitest';
import { auditWalletReceipt } from '../src/receipt-audit.js';
import { units } from '../src/agent-wallet.js';
import type { WalletOperation } from '../src/wallet-store.js';
import { TEST_USDT_TOKEN_ID } from '../src/swap.js';

const op: WalletOperation = { id: 'saved-operation', userAccount: 'alice.testnet', action: 'send', asset: 'NEAR', amount: '1', recipient: 'bob.testnet', status: 'confirmed', txHashes: ['hash'], createdAt: new Date().toISOString() };
const native = () => ({ transaction: { hash: 'hash', signer_id: 'agent.testnet', receiver_id: 'bob.testnet', actions: [{ Transfer: { deposit: units('1', 24).toString() } }] }, status: { SuccessValue: '' } });
const call = (method: string, args: object) => ({ FunctionCall: { method_name: method, args: Buffer.from(JSON.stringify(args)).toString('base64'), deposit: '0' } });
describe('real settlement receipt auditing', () => {
  it('accepts the exact confirmed native transfer', () => expect(auditWalletReceipt(op, native(), 'agent.testnet', 'agent.testnet')).toContain('Confirmed send 1 NEAR'));
  it.each(['amount', 'recipient', 'signer', 'hash'])('rejects an altered %s even with a success status', field => {
    const receipt = native();
    if (field === 'amount') receipt.transaction.actions[0].Transfer.deposit = units('2', 24).toString();
    if (field === 'recipient') receipt.transaction.receiver_id = 'other.testnet';
    if (field === 'signer') receipt.transaction.signer_id = 'other.testnet';
    if (field === 'hash') receipt.transaction.hash = 'other-hash';
    expect(() => auditWalletReceipt(op, receipt, 'agent.testnet', 'agent.testnet')).toThrow();
  });
  it('checks the token transfer amount and recipient from the actual call', () => {
    const receipt: any = native(); receipt.transaction.receiver_id = TEST_USDT_TOKEN_ID;
    receipt.transaction.actions = [call('ft_transfer', { receiver_id: 'bob.testnet', amount: '1000000' })];
    expect(auditWalletReceipt({ ...op, asset: 'USDT' }, receipt, 'agent.testnet', 'agent.testnet')).toContain('1 USDT');
    receipt.transaction.actions = [call('ft_transfer', { receiver_id: 'bob.testnet', amount: '2000000' })];
    expect(() => auditWalletReceipt({ ...op, asset: 'USDT' }, receipt, 'agent.testnet', 'agent.testnet')).toThrow();
  });
  it('audits a market payout against its saved exact amount rather than the former fixed rate', () => {
    const operation: WalletOperation = { ...op, action: 'swap', amount: '0.1', market: {
      amountIn: units('0.1', 24).toString(), expectedOutput: '300000', actualOutput: '300000', minOutput: '294000', outputDecimals: 6,
      nearPriceUsd: '3', usdtPriceUsd: '1', priceSource: 'https://api.ref.finance/list-token-price', quotedAt: op.createdAt, expiresAt: op.createdAt,
    } };
    const receipt: any = native();
    receipt.transaction.receiver_id = TEST_USDT_TOKEN_ID;
    receipt.transaction.actions = [call('ft_transfer', { receiver_id: 'agent.testnet', amount: '300000' })];
    expect(auditWalletReceipt(operation, receipt, 'agent.testnet', 'agent.testnet')).toContain('Confirmed swap');
    expect(() => auditWalletReceipt({ ...operation, amount: '0.2' }, receipt, 'agent.testnet', 'agent.testnet')).toThrow('input');
    receipt.transaction.actions = [call('ft_transfer', { receiver_id: 'agent.testnet', amount: '500000' })];
    expect(() => auditWalletReceipt(operation, receipt, 'agent.testnet', 'agent.testnet')).toThrow('amount');
  });
  it('audits the actual Ref pool output and saved minimum independently of a fixed rate', () => {
    const operation: WalletOperation = { ...op, action: 'swap', amount: '0.1', dex: {
      contractId: 'ref.testnet', poolId: 57, wrapId: 'wrap.testnet', tokenIn: 'wrap.testnet', tokenOut: TEST_USDT_TOKEN_ID,
      amountIn: units('0.1', 24).toString(), expectedOutput: '300000', actualOutput: '300000', minOutput: '294000',
      outputDecimals: 6, reserveOut: '10000000', feeBps: 30, quotedAt: op.createdAt,
    } };
    const quote = operation.dex!;
    const receipt: any = native();
    receipt.transaction.receiver_id = quote.tokenIn;
    receipt.transaction.actions = [call('ft_transfer_call', { receiver_id: quote.contractId, amount: quote.amountIn,
      msg: JSON.stringify({ actions: [{ pool_id: quote.poolId, token_in: quote.tokenIn, token_out: quote.tokenOut, amount_in: quote.amountIn, min_amount_out: quote.minOutput }] }) })];
    receipt.status.SuccessValue = Buffer.from(JSON.stringify(quote.amountIn)).toString('base64');
    receipt.receipts_outcome = [{ outcome: { executor_id: quote.tokenOut, logs: ['Transfer 300000 from ref.testnet to agent.testnet'] } }];
    expect(auditWalletReceipt(operation, receipt, 'agent.testnet', 'agent.testnet')).toContain('Confirmed swap');
    receipt.receipts_outcome[0].outcome.logs = ['Transfer 200000 from ref.testnet to agent.testnet'];
    expect(() => auditWalletReceipt(operation, receipt, 'agent.testnet', 'agent.testnet')).toThrow('minimum');
  });
  it('rejects a failed on-chain execution', () => expect(() => auditWalletReceipt(op, { ...native(), status: { Failure: 'failed' } }, 'agent.testnet', 'agent.testnet')).toThrow('failed'));
  it.each(['stake', 'unstake', 'claim'])('requires the saved staking provider for %s receipts', action => {
    const operation = { ...op, action, contractId: 'staking.testnet' };
    const receipt: any = native();
    receipt.transaction.receiver_id = 'staking.testnet';
    const fn = call(action === 'stake' ? 'deposit_and_stake' : action === 'claim' ? 'withdraw' : 'unstake', { amount: units('1', 24).toString() });
    if (action === 'stake') fn.FunctionCall.deposit = units('1', 24).toString();
    receipt.transaction.actions = [fn];
    expect(auditWalletReceipt(operation, receipt, 'agent.testnet', 'agent.testnet')).toContain('Confirmed');
    receipt.transaction.receiver_id = 'fake-staking.testnet';
    expect(() => auditWalletReceipt(operation, receipt, 'agent.testnet', 'agent.testnet')).toThrow('recipient');
  });
});
