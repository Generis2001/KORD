import 'dotenv/config';
import { Store } from '../src/db.js';
import { WalletStore } from '../src/wallet-store.js';
import { AgentWallet, units, confirmedHash } from '../src/agent-wallet.js';
import { loadNearConfig, assertTestnet } from '../src/near.js';
import { TEST_USDT_TOKEN_ID } from '../src/swap.js';

const cfg = loadNearConfig(); assertTestnet(cfg);
const store = new Store(process.env.MANDATE_DB || 'mandate.db');
const wallet = new AgentWallet(cfg, new WalletStore(store)), signer = wallet.poolAccount();
const dex = process.env.TESTNET_DEX_CONTRACT_ID || 'ref-finance-101.testnet';
if (!dex.endsWith('.testnet')) throw new Error('Testnet DEX required.');
const receipts: string[] = [];
const call = async (contract: string, method: string, args: object, deposit = 0n, gas = '100') => {
  const receipt = await wallet.call(signer, contract, method, args, deposit, gas);
  receipts.push(wallet.explorer(confirmedHash(receipt)));
  return receipt;
};
try {
  await wallet.register(signer, signer.accountId);
  if (await wallet.tokenBalance(signer.accountId) < units('10', 6)) await call(TEST_USDT_TOKEN_ID, 'mint', { account_id: signer.accountId, amount: units('20', 6).toString() });
  let poolId = process.env.TESTNET_DEX_POOL_ID ? Number(process.env.TESTNET_DEX_POOL_ID) : undefined;
  if (poolId === undefined) {
    const created = await call(dex, 'add_simple_pool', { tokens: ['wrap.testnet', TEST_USDT_TOKEN_ID], fee: 30 }, units('0.1', 24));
    if (typeof created.status === 'string' || !('SuccessValue' in created.status)) throw new Error('Pool creation has no final return value.');
    poolId = JSON.parse(Buffer.from(created.status.SuccessValue, 'base64').toString());
    console.log('Created testnet pool:', poolId);
  }
  if (!Number.isSafeInteger(poolId)) throw new Error('DEX did not return a pool ID.');
  const pool = await wallet.view(dex, 'get_pool', { pool_id: poolId });
  if (pool.pool_kind !== 'SIMPLE_POOL' || pool.token_account_ids.join(',') !== ['wrap.testnet', TEST_USDT_TOKEN_ID].join(',')) throw new Error('Expected a NEAR/Test USDT simple pool.');
  if (pool.amounts.some((amount: string) => BigInt(amount) > 0n)) throw new Error('Use an empty pool for this initial liquidity setup; existing liquidity is not replaced.');
  // Registration-only deposits leave no storage credit for the DEX's internal token balances.
  await call(dex, 'storage_deposit', { account_id: signer.accountId, registration_only: false }, units('0.1', 24));
  const deposits = await wallet.view(dex, 'get_deposits', { account_id: signer.accountId });
  await wallet.register(signer, signer.accountId, undefined, 'wrap.testnet');
  const needed = units('2', 24) - BigInt(deposits['wrap.testnet'] || '0');
  const wrapped = BigInt(await wallet.view('wrap.testnet', 'ft_balance_of', { account_id: signer.accountId }));
  if (needed > wrapped) await call('wrap.testnet', 'near_deposit', {}, needed - wrapped);
  for (const [token, amount] of [['wrap.testnet', units('2', 24)], [TEST_USDT_TOKEN_ID, units('10', 6)]] as const) {
    const missing = amount - BigInt(deposits[token] || '0');
    if (missing <= 0n) continue;
    const receipt = await call(token, 'ft_transfer_call', { receiver_id: dex, amount: missing.toString(), msg: '' }, 1n, '200');
    if (typeof receipt.status === 'string' || !('SuccessValue' in receipt.status)) throw new Error('Liquidity deposit has no final return value.');
    if (BigInt(JSON.parse(Buffer.from(receipt.status.SuccessValue, 'base64').toString())) !== missing) throw new Error('DEX refunded the liquidity deposit. Inspect the receipts.');
  }
  await call(dex, 'add_liquidity', { pool_id: poolId, amounts: [units('2', 24).toString(), units('10', 6).toString()], min_amounts: null }, units('0.01', 24));
  console.log(JSON.stringify({ dex, poolId, pool: await wallet.view(dex, 'get_pool', { pool_id: poolId }), receipts }, null, 2));
} finally { store.db.close(); await store.pgPool?.end(); }
