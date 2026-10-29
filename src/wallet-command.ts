import type { Asset } from './agent-wallet.js';

/** Explicit financial commands only; unrecognised prose never becomes a transaction. */
export function parseWalletCommand(prompt: string): { action: string; asset: Asset; amount: string; recipient?: string } | null {
  const text = prompt.trim().toLowerCase().replace(/^(?:please\s+)?(?:mandate[, :]*)?\s*/, '');
  const match = text.match(/^(deposit|fund(?:\s+treasury)?(?:\s+with)?|withdraw|stake|unstake|claim|swap|exchange|pay|send|transfer)\s+([0-9]+(?:\.[0-9]+)?)\s+(?:test\s+)?(near|usdt)\b(.*)$/);
  if (!match) return null;
  const [, verb, amount, token, tail] = match;
  const action = /^fund/.test(verb) ? 'deposit' : verb === 'exchange' ? 'swap' : ['pay', 'transfer'].includes(verb) ? 'send' : verb;
  const recipient = action === 'send' ? tail.match(/^\s+(?:to\s+)?([a-z0-9._-]+)(?:\s|$)/)?.[1] : undefined;
  if (action === 'send' && !recipient) throw new Error('Specify a recipient, for example: Send 2 USDT to alice.testnet.');
  // Swaps stay in the agent wallet. External payouts are explicit send/withdraw commands.
  if (action === 'swap' && tail.trim() && !/^\s+(?:for|to)\s+(?:test\s+)?(?:near|usdt)\s*$/.test(tail)) throw new Error('Swap into your agent wallet, then send or withdraw the output.');
  if (action === 'swap' && new RegExp(`\\b${token}\\b`).test(tail)) throw new Error('Choose the other asset for your swap.');
  return { action, amount, asset: token.toUpperCase() as Asset, recipient };
}
