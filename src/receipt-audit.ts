import { confirmedHash, units } from './agent-wallet.js';
import { parseEscrowEvents } from './near.js';
import type { WalletOperation } from './wallet-store.js';
import { TEST_USDT_TOKEN_ID } from './swap.js';
import { deliveredOutput } from './dex.js';

/** Checks the actual transaction actions, not just a stored label or explorer URL. */
export function auditWalletReceipt(operation: WalletOperation, receipt: any, agentId: string, signerId: string, providers: { NEAR?: string; USDT?: string } = {}) {
  const hash = operation.txHashes.at(-1);
  if (confirmedHash(receipt) !== hash || receipt.transaction?.signer_id !== signerId) throw new Error('Receipt hash or signer does not match the saved transaction.');
  const transaction = receipt.transaction;
  const calls = (transaction.actions || []).flatMap((action: any) => {
    if (!action.FunctionCall) return [];
    const fn = action.FunctionCall;
    return [{ method: fn.method_name, args: JSON.parse(Buffer.from(fn.args, 'base64').toString()), deposit: BigInt(fn.deposit || 0) }];
  });
  const transferAmount = (transaction.actions || []).reduce((total: bigint, action: any) => total + BigInt(action.Transfer?.deposit || 0), 0n);
  const amount = operation.amount === '0' ? 0n : units(operation.amount, operation.asset === 'NEAR' ? 24 : 6);
  const swapQuote = operation.market || operation.dex;
  if (operation.action === 'swap' && swapQuote && BigInt(swapQuote.amountIn) !== amount) throw new Error('Saved swap input does not match the recorded amount.');
  if (operation.market?.actualOutput && operation.market.actualOutput !== operation.market.expectedOutput) throw new Error('Saved market payout does not match the quoted amount.');
  let supported = false;
  if (operation.action === 'swap' && operation.dex) {
    const quote = operation.dex;
    if (operation.asset === 'NEAR') {
      supported = quote.actualOutput !== undefined && transaction.receiver_id === quote.tokenIn && calls.some((call: any) => {
        if (call.method !== 'ft_transfer_call' || call.args.receiver_id !== quote.contractId || call.args.amount !== quote.amountIn) return false;
        const trade = JSON.parse(call.args.msg).actions?.[0];
        return trade?.pool_id === quote.poolId && trade.token_in === quote.tokenIn && trade.token_out === quote.tokenOut && trade.amount_in === quote.amountIn && trade.min_amount_out === quote.minOutput;
      }) && BigInt(JSON.parse(Buffer.from(receipt.status.SuccessValue, 'base64').toString())) === BigInt(quote.amountIn)
        && deliveredOutput(receipt, quote, agentId) === BigInt(quote.actualOutput);
    } else {
      supported = quote.actualOutput !== undefined && transaction.receiver_id === quote.wrapId
        && calls.some((call: any) => call.method === 'near_withdraw' && call.args.amount === quote.actualOutput);
    }
  } else if (['deposit', 'withdraw', 'send', 'swap'].includes(operation.action)) {
    const target = operation.action === 'deposit' || operation.action === 'swap' ? agentId : operation.recipient;
    const native = operation.action === 'swap' ? operation.asset === 'USDT' : operation.asset === 'NEAR';
    const expected = operation.action === 'swap'
      ? operation.market ? BigInt(operation.market.expectedOutput) : operation.asset === 'NEAR' ? amount * 5n / 10n ** 18n : amount * 10n ** 18n / 5n
      : amount;
    supported = native ? transaction.receiver_id === target && transferAmount === expected
      : transaction.receiver_id === TEST_USDT_TOKEN_ID && calls.some((call: any) => call.method === 'ft_transfer' && call.args.receiver_id === target && BigInt(call.args.amount) === expected);
  } else if (operation.action === 'stake') {
    const provider = operation.contractId || providers[operation.asset];
    supported = Boolean(provider) && (operation.asset === 'NEAR' ? transaction.receiver_id === provider && calls.some((call: any) => call.method === 'deposit_and_stake' && call.deposit === amount)
      : transaction.receiver_id === TEST_USDT_TOKEN_ID && calls.some((call: any) => call.method === 'ft_transfer_call' && call.args.receiver_id === provider && BigInt(call.args.amount) === amount && JSON.parse(call.args.msg).action === 'stake') && BigInt(JSON.parse(Buffer.from(receipt.status.SuccessValue, 'base64').toString())) === amount);
  } else if (['unstake', 'claim'].includes(operation.action)) {
    const provider = operation.contractId || providers[operation.asset];
    supported = Boolean(provider) && transaction.receiver_id === provider && calls.some((call: any) => call.method === (operation.action === 'claim' ? 'withdraw' : 'unstake') && BigInt(call.args.amount) === amount);
  } else if (operation.action === 'escrow_fund') {
    supported = transaction.receiver_id === operation.contractId && calls.some((call: any) => call.method === 'create_mandate' && call.args.mandate_id === operation.mandateId && call.deposit === amount);
  } else if (operation.action === 'escrow_release') {
    supported = transaction.receiver_id === operation.contractId && calls.some((call: any) => call.method === 'approve_payment' && call.args.mandate_id === operation.mandateId && call.args.task_id === operation.taskId && call.args.agent === operation.recipient && BigInt(call.args.amount) === amount && call.args.evidence_hash === operation.evidenceHash) && parseEscrowEvents(receipt).confirmed && !parseEscrowEvents(receipt).failed;
  } else if (['escrow_refund', 'escrow_close'].includes(operation.action)) {
    supported = transaction.receiver_id === operation.contractId && calls.some((call: any) => call.method === (operation.action === 'escrow_close' ? 'close_mandate' : 'refund_remaining') && call.args.mandate_id === operation.mandateId) && (operation.action === 'escrow_close' || Buffer.from(receipt.status.SuccessValue, 'base64').toString() === 'true');
  }
  if (!supported) throw new Error('On-chain action, amount or recipient does not match the recorded operation.');
  return `Confirmed ${operation.action} ${operation.amount} ${operation.asset}; signer ${signerId}; receiver ${transaction.receiver_id}; transaction ${hash}.`;
}
