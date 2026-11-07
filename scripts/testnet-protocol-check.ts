import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { actions } from 'near-api-js';
import { Store } from '../src/db.js';
import { WalletStore, type WalletOperation } from '../src/wallet-store.js';
import { AgentWallet, confirmedHash, units } from '../src/agent-wallet.js';
import { loadNearConfig, assertTestnet } from '../src/near.js';
import { TEST_USDT_TOKEN_ID, AgentSwapService, swapMode } from '../src/swap.js';
import { parseWalletCommand } from '../src/wallet-command.js';

const cfg = loadNearConfig(); assertTestnet(cfg);
const store = new Store(process.env.MANDATE_DB || 'mandate.db');
const wallet = new AgentWallet(cfg, new WalletStore(store));
const owner = cfg.accountId, account = wallet.poolAccount(), agent = wallet.identity(owner).accountId;
const receipts: object[] = [];
async function command(text: string) {
  const request = parseWalletCommand(text); assert(request, 'Unrecognized command');
  const op = await wallet.execute(owner, { ...request, id: 'live-' + randomUUID() });
  console.log(text, op.status, op.error || '');
  assert.equal(op.status, 'confirmed', 'Reconcile operation ' + op.id + ': ' + op.error);
  receipts.push({ command: text, id: op.id, transactions: op.txHashes.map(h => wallet.explorer(h)), output: (op.market || op.dex)?.actualOutput, priceSource: op.market?.priceSource });
  return op;
}
try {
  if (!process.argv.includes('--execute')) {
    const mode = swapMode();
    const [near, usdt, quote] = await Promise.all([wallet.position(owner, 'NEAR'), wallet.position(owner, 'USDT'),
      new AgentSwapService().getQuote('0.1')]);
    console.log(JSON.stringify({ network: cfg.network, owner, agent, swapMode: mode, staking: { NEAR: near, USDT: usdt }, quote }, null, 2));
  } else {
    if (await wallet.receipts.unresolved(owner)) throw new Error('Reconcile existing wallet operations before the live protocol check.');
    if (await wallet.nativeBalance(agent) < units('1', 24)) {
      const op: WalletOperation = { id: 'live-deposit-' + randomUUID(), userAccount: owner, action: 'deposit', asset: 'NEAR', amount: '1', recipient: agent, status: 'pending', txHashes: [], createdAt: new Date().toISOString() };
      await wallet.receipts.save(op);
      try { op.txHashes.push(confirmedHash(await wallet.transact(account, agent, [actions.transfer(units('1', 24))], op))); op.status = 'confirmed'; }
      catch (error: any) { op.status = 'needs_review'; op.error = error.message; }
      await wallet.receipts.save(op); assert.equal(op.status, 'confirmed', 'Test deposit needs reconciliation: ' + op.id);
      receipts.push({ command: 'Fund isolated agent wallet', transactions: op.txHashes.map(h => wallet.explorer(h)) });
    }
    if (process.argv.includes('--staking')) {
      await wallet.register(account, agent);
      // Ref's development token has a public mint method. No mainnet token is touched.
      if (await wallet.tokenBalance(agent) < units('10', 6)) {
        const minted = await wallet.call(account, TEST_USDT_TOKEN_ID, 'mint', { account_id: agent, amount: units('20', 6).toString() }, 0n, '60');
        receipts.push({ command: 'Mint faucet Test USDT', transactions: [wallet.explorer(confirmedHash(minted))] });
      }
      const initial = await wallet.tokenBalance(agent);
      const nearBefore = await wallet.position(owner, 'NEAR');
      await command('Stake 0.1 NEAR');
      assert(BigInt((await wallet.position(owner, 'NEAR')).staked.replace('.', '')) > BigInt(nearBefore.staked.replace('.', '')));
      await command('Unstake 0.1 NEAR');
      const near = await wallet.position(owner, 'NEAR');
      console.log('NEAR unstaking position (validator epoch cooldown):', JSON.stringify(near));
      await command('Stake 5 USDT');
      assert.equal((await wallet.position(owner, 'USDT')).staked, '5.000000');
      await command('Unstake 5 USDT');
      assert.equal((await wallet.position(owner, 'USDT')).withdrawable, '0.000000');
      for (let attempt = 0; attempt < 12 && !(await wallet.position(owner, 'USDT')).available; attempt++) await new Promise(resolve => setTimeout(resolve, 10_000));
      assert((await wallet.position(owner, 'USDT')).available, 'Vault cooldown has not matured.');
      await command('Claim 5 USDT');
      assert.equal(await wallet.tokenBalance(agent), initial, 'Staked Test USDT principal must return to the agent.');
      assert.equal((await wallet.position(owner, 'USDT')).unstaked, '0.000000');
    }
    if (process.argv.includes('--swap')) {
      const tokenBefore = await wallet.tokenBalance(agent);
      const swap = await command('Swap 0.1 NEAR for USDT');
      const actualOutput = (swap.market || swap.dex)?.actualOutput;
      assert(actualOutput, 'Protocol swaps require SWAP_MODE=market or SWAP_MODE=ref with a confirmed output.');
      assert.equal(await wallet.tokenBalance(agent) - tokenBefore, BigInt(actualOutput));
      const nearBefore = await wallet.nativeBalance(agent);
      await command('Swap 0.1 USDT for NEAR');
      console.log('Native NEAR before/after reverse swap:', nearBefore.toString(), (await wallet.nativeBalance(agent)).toString(), '(includes gas)');
    }
    console.log(JSON.stringify({ network: 'testnet', owner, agent, receipts, staking: { NEAR: await wallet.position(owner, 'NEAR'), USDT: await wallet.position(owner, 'USDT') } }, null, 2));
  }
} finally { store.db.close(); await store.pgPool?.end(); }
