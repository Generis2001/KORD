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
