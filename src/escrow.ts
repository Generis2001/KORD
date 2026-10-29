import { createHash } from 'node:crypto';
import { Account, KeyPair } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import { AgentWallet, confirmedHash, GAS_RESERVE, units, decimal, validAccount } from './agent-wallet.js';
import { parseEscrowEvents } from './near.js';
import type { WalletOperation } from './wallet-store.js';

export interface EscrowRequest { id: string; amount: string; recipient: string; evidenceHash: string }
function defaultConfig(wallet: AgentWallet) {
  const override = Boolean(process.env.VERIFIER_ACCOUNT_ID || process.env.VERIFIER_PRIVATE_KEY);
  return { contractId: process.env.ESCROW_CONTRACT_ID || 'mandate-generis-escrow.testnet', verifier: override ? process.env.VERIFIER_ACCOUNT_ID || '' : wallet.cfg.accountId, key: override ? process.env.VERIFIER_PRIVATE_KEY || '' : wallet.cfg.privateKey };
}
export class VerifiedEscrow {
  constructor(private wallet: AgentWallet, private config = defaultConfig(wallet)) {}
  get configured() { return Boolean(this.config.contractId && this.config.verifier && this.config.key); }

  async refund(user: string, mandateId: string) {
    if (!/^m_[a-f0-9]{40}$/.test(mandateId) || !this.configured || this.wallet.cfg.network !== 'testnet') throw new Error('A configured testnet escrow mandate is required.');
    const accountId = this.wallet.identity(user).accountId, contractId = this.config.contractId;
    return this.wallet.receipts.lock([accountId, contractId], async () => {
      const funded = await this.wallet.receipts.get(mandateId + '_fund');
      if (!funded || funded.userAccount !== user || funded.contractId !== contractId) throw new Error('Escrow does not belong to this wallet.');
      const previous = await this.wallet.receipts.get(mandateId + '_refund');
      if (previous) return previous;
      if (await this.wallet.receipts.unresolved(user)) throw new Error('Reconcile the pending wallet transaction before refunding escrow.');
      const state = await this.wallet.view(contractId, 'get_mandate', { mandate_id: mandateId });
      if (!state || state.owner !== accountId || BigInt(state.remaining) <= 0n) throw new Error('No unspent escrow funds are available for this owner.');
      const perform = async (action: string, method: string, amount: string) => {
        const id = mandateId + (action === 'escrow_close' ? '_close' : '_refund');
        const existing = await this.wallet.receipts.get(id);
        if (existing) return existing;
        const op: WalletOperation = { ...funded, id, action, amount, recipient: accountId, status: 'pending', txHashes: [], createdAt: new Date().toISOString() };
        delete op.attempt;
        await this.wallet.receipts.save(op);
        try {
          const result: any = await this.wallet.call(this.wallet.account(user), contractId, method, { mandate_id: mandateId }, 0n, '100', op);
          const hash = confirmedHash(result);
          if (action === 'escrow_refund' && Buffer.from(result.status.SuccessValue || '', 'base64').toString() !== 'true') throw new Error('Refund was not confirmed by the contract.');
          op.txHashes.push(hash); op.status = 'confirmed';
        } catch (error: any) { op.status = 'needs_review'; op.error = error.message; }
        await this.wallet.receipts.save(op);
        return op;
      };
      if (state.status === 'Active') {
        const closed = await perform('escrow_close', 'close_mandate', '0');
        if (closed.status !== 'confirmed') return closed;
      }
      return perform('escrow_refund', 'refund_remaining', decimal(BigInt(state.remaining), 24));
    });
  }

  async settle(user: string, request: EscrowRequest) {
    if (this.wallet.cfg.network !== 'testnet') throw new Error('The free research escrow workflow supports testnet funds only.');
    if (!this.configured) throw new Error('Escrow requires ESCROW_CONTRACT_ID, VERIFIER_ACCOUNT_ID and VERIFIER_PRIVATE_KEY. No funds were sent.');
    const { contractId, verifier, key } = this.config;
    if (!contractId.endsWith('.testnet') || ![contractId, verifier, request.recipient].every(id => validAccount(id) && (id.endsWith('.testnet') || /^[a-f0-9]{64}$/.test(id))) || request.recipient === verifier) throw new Error('Use distinct testnet escrow, verifier and recipient accounts.');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(request.id) || !/^[a-f0-9]{64}$/.test(request.evidenceHash)) throw new Error('Invalid escrow request or evidence proof.');
    let verifierPublicKey: string;
    try { verifierPublicKey = KeyPair.fromString(key as KeyPairString).getPublicKey().toString(); }
    catch { throw new Error('Configure a valid testnet verifier signing key before funding escrow. No funds were sent.'); }
    const amount = units(request.amount, 24);
    if (amount > units('20', 24)) throw new Error('Escrow amount exceeds the 20 NEAR testnet limit.');
    const accountId = this.wallet.identity(user).accountId;
    const mandateId = 'm_' + createHash('sha256').update(user + request.id).digest('hex').slice(0, 40);
    const taskId = mandateId + '_research';
    return this.wallet.receipts.lock([accountId, verifier, contractId], async () => {
      const fundId = mandateId + '_fund', releaseId = mandateId + '_release';
      const previous = await this.wallet.receipts.get(releaseId);
      if (previous) {
        if (previous.userAccount !== user || previous.amount !== request.amount || previous.recipient !== request.recipient || previous.evidenceHash !== request.evidenceHash) throw new Error('Escrow request ID is already used.');
        return previous;
      }
      if (await this.wallet.receipts.unresolved(user)) throw new Error('Reconcile the pending wallet transaction before escrow.');
      let funded = await this.wallet.receipts.get(fundId);
      if (funded && (funded.amount !== request.amount || funded.recipient !== request.recipient || funded.evidenceHash !== request.evidenceHash)) throw new Error('Escrow request ID is already funded with different terms.');
      if (!funded) {
        // Check signing authority before locking the user's funds in a new mandate.
        const access: any = await this.wallet.provider.query({ request_type: 'view_access_key', finality: 'final', account_id: verifier, public_key: verifierPublicKey });
        const permission = access.permission;
        if (permission !== 'FullAccess' && (!permission?.FunctionCall || permission.FunctionCall.receiver_id !== contractId || (permission.FunctionCall.method_names.length && !permission.FunctionCall.method_names.includes('approve_payment')))) throw new Error('The configured verifier key cannot approve this escrow contract. No funds were sent.');
        if (await this.wallet.nativeBalance(accountId) < amount + GAS_RESERVE) throw new Error('Deposit enough testnet NEAR into the agent wallet for escrow and gas.');
        if (await this.wallet.nativeBalance(verifier) < GAS_RESERVE) throw new Error('The verifier needs free testnet NEAR for transaction gas.');
        funded = { id: fundId, userAccount: user, action: 'escrow_fund', asset: 'NEAR', amount: request.amount, recipient: request.recipient, status: 'pending', txHashes: [], createdAt: new Date().toISOString(), evidenceHash: request.evidenceHash, contractId, mandateId, taskId };
        await this.wallet.receipts.save(funded);
        try {
          const receipt = await this.wallet.call(this.wallet.account(user), contractId, 'create_mandate', { mandate_id: mandateId, verifier, per_agent_cap: amount.toString(), allowed_agents: [request.recipient] }, amount, '60', funded);
          funded.txHashes.push(confirmedHash(receipt)); funded.status = 'confirmed';
        } catch (error: any) { funded.status = 'needs_review'; funded.error = error.message; }
        await this.wallet.receipts.save(funded);
      }
      if (funded.status !== 'confirmed') return funded;
      const state = await this.wallet.view(contractId, 'get_mandate', { mandate_id: mandateId });
      if (!state || state.owner !== accountId || state.verifier !== verifier || state.budget !== amount.toString() || state.per_agent_cap !== amount.toString() || state.status !== 'Active' || !state.allowed_agents.includes(request.recipient)) throw new Error('On-chain escrow terms do not match the mandate.');
      const released: WalletOperation = { ...funded, id: releaseId, action: 'escrow_release', status: 'pending', txHashes: [], createdAt: new Date().toISOString() };
      delete released.attempt;
      await this.wallet.receipts.save(released);
      try {
        const signer = new Account(verifier, this.wallet.provider, key as KeyPairString);
        const receipt = await this.wallet.call(signer, contractId, 'approve_payment', { mandate_id: mandateId, task_id: taskId, agent: request.recipient, amount: amount.toString(), evidence_hash: request.evidenceHash }, 0n, '100', released);
        const hash = confirmedHash(receipt), events = parseEscrowEvents(receipt);
        if (!events.confirmed || events.failed) throw new Error('Escrow did not confirm its payout. Reconcile before retrying.');
        released.txHashes.push(hash); released.status = 'confirmed';
      } catch (error: any) { released.status = 'needs_review'; released.error = error.message; }
      await this.wallet.receipts.save(released);
      return released;
    });
  }
}
