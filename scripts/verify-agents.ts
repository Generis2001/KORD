import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { actions, KeyPair } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import { runAutonomousMandate } from '../src/runner.js';
import { Store } from '../src/db.js';
import { AgentWallet, units, confirmedHash, decimal } from '../src/agent-wallet.js';
import { WalletStore, type WalletOperation } from '../src/wallet-store.js';
import { VerifiedEscrow } from '../src/escrow.js';
import { assertTestnet, loadNearConfig } from '../src/near.js';

const paid = process.argv.includes('--escrow-test');
const goal = process.argv.includes('--goal') ? process.argv[process.argv.indexOf('--goal') + 1] : 'Compare NEAR and USDT market prices and pool liquidity on Ref Finance';
if (!goal) throw new Error('Provide a research directive after --goal.');
const id = 'check_' + randomUUID();
const store = new Store(process.env.MANDATE_DB || 'mandate.db');
try {
  let settleEscrow;
  if (paid) {
    const cfg = loadNearConfig(); assertTestnet(cfg);
    try { KeyPair.fromString(cfg.privateKey as KeyPairString); }
    catch { throw new Error('agents:check --escrow-test requires a valid NEAR_PRIVATE_KEY; replace local placeholder credentials. No transaction was sent.'); }
    const wallet = new AgentWallet(cfg, new WalletStore(store));
    const escrow = new VerifiedEscrow(wallet);
    settleEscrow = async (request: Parameters<VerifiedEscrow['settle']>[1]) => {
      const recipientBefore = await wallet.nativeBalance(request.recipient);
      const owner = cfg.accountId, agentId = wallet.identity(owner).accountId;
      if (await wallet.receipts.unresolved(owner)) throw new Error('Reconcile the previous wallet operation before running the test again.');
      // Include prepaid contract gas at the live testnet gas price, not only the fee.
      if (await wallet.nativeBalance(agentId) < units('0.15', 24)) {
        const op: WalletOperation = { id: id + '_deposit', userAccount: owner, action: 'deposit', asset: 'NEAR', amount: '0.2', recipient: agentId, status: 'pending', txHashes: [], createdAt: new Date().toISOString() };
        await wallet.receipts.save(op);
        try {
          const receipt = await wallet.transact(wallet.poolAccount(), agentId, [actions.transfer(units('0.2', 24))], op);
          op.txHashes.push(confirmedHash(receipt)); op.status = 'confirmed';
        } catch (error: any) { op.status = 'needs_review'; op.error = error.message; }
        await wallet.receipts.save(op);
        if (op.status !== 'confirmed') throw new Error('Test deposit needs reconciliation: ' + op.id);
        console.log('Agent funding receipt:', wallet.explorer(op.txHashes[0]));
      }
      const payout = await escrow.settle(owner, request);
      const recipientAfter = await wallet.nativeBalance(request.recipient);
      console.log('Research recipient balance:', JSON.stringify({ account: request.recipient, beforeNear: decimal(recipientBefore, 24), afterNear: decimal(recipientAfter, 24), incrementNear: decimal(recipientAfter - recipientBefore, 24) }));
      if (payout.status === 'confirmed' && recipientAfter - recipientBefore < units(request.amount, 24)) throw new Error('Research fee receipt did not produce the expected recipient balance increment.');
      return payout;
    };
  }
  const result = await runAutonomousMandate({ id, goal: goal + (paid ? '; research fee 0.001 NEAR' : ''), store, settleEscrow });
  console.log(JSON.stringify({ roles: result.delegation.map(task => ({ role: task.role, status: task.status })), verification: result.deliverable.verification, sources: result.deliverable.sources, payout: result.payout }, null, 2));
  if (!result.deliverable.verification.passed || (paid && result.payout.status !== 'confirmed')) process.exitCode = 1;
} finally { store.db.close(); await store.pgPool?.end(); }
