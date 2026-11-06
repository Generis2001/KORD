import { createHash, createHmac, createPrivateKey, createPublicKey } from 'node:crypto';
import { Account, JsonRpcProvider, baseEncode, teraToGas, actions, PublicKey, createTransaction, encodeTransaction, baseDecode } from 'near-api-js';
import type { Action } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import { assertNetworkSafety, parseEscrowEvents, type NearConfig } from './near.js';
import { WalletStore, type WalletOperation } from './wallet-store.js';
import { TEST_USDT_TOKEN_ID, TEST_USDT_DECIMALS, DEMO_EXCHANGE_RATE, STORAGE_DEPOSIT_YOCTO } from './swap.js';
import { units, decimal } from './amounts.js';
import { TestnetDex, deliveredOutput, type DexQuote } from './dex.js';
export { units, decimal } from './amounts.js';

export type Asset = 'NEAR' | 'USDT';
export const GAS_RESERVE = 20_000_000_000_000_000_000_000n; // 0.02 NEAR, retained for subsequent calls
export function validAccount(account: string) {
  return /^[a-f0-9]{64}$/.test(account) || /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(account);
}
export function confirmedHash(result: any) {
  const outcomes = [result?.transaction_outcome, ...(result?.receipts_outcome ?? [])];
  if (result?.status?.Failure || outcomes.some(r => r?.outcome?.status?.Failure)) {
    throw new Error(`Transaction failed on-chain: ${JSON.stringify(result.status?.Failure || outcomes.find(r => r?.outcome?.status?.Failure)?.outcome.status.Failure)}`);
  }
  if (!result?.status || !('SuccessValue' in result.status || 'SuccessReceiptId' in result.status)) throw new Error('Transaction confirmation is pending; reconcile before retrying.');
  const hash = result?.transaction?.hash ?? result?.transaction_outcome?.id;
  if (!hash) throw new Error('Transaction response has no hash; reconcile before retrying.');
  return hash as string;
}
function missingAccount(error: any) {
  return /UNKNOWN_ACCOUNT|does not exist|has never been observed/i.test(error?.message || String(error));
}

export class AgentWallet {
  readonly provider: JsonRpcProvider;
  readonly nearPool: string;
  readonly usdtPool: string;
  constructor(readonly cfg: NearConfig, readonly receipts: WalletStore,
    private accountFactory = (id: string, key: KeyPairString) => new Account(id, this.provider, key)) {
    assertNetworkSafety(cfg);
    this.nearPool = process.env.NEAR_STAKING_POOL_ID ?? (cfg.network === 'testnet' ? 'kiln.pool.f863973.m0' : '');
    this.usdtPool = process.env.USDT_STAKING_CONTRACT_ID ?? (cfg.network === 'testnet' && TEST_USDT_TOKEN_ID === 'usdt.fakes.testnet' ? 'usdt.mandate-live-20261029.testnet' : '');
    this.provider = new JsonRpcProvider({ url: cfg.rpcUrl });
    for (const pool of [this.nearPool, this.usdtPool]) {
      if (pool && (!validAccount(pool) || (cfg.network === 'testnet' && pool.endsWith('.near')) || (cfg.network === 'mainnet' && pool.endsWith('.testnet')))) throw new Error('Staking contract does not match the configured network.');
    }
  }

  identity(user: string) {
    if (!validAccount(user)) throw new Error('Invalid linked NEAR account ID.');
    // A domain-separated seed gives every owner a stable, isolated NEAR implicit account.
    const seed = createHmac('sha256', process.env.AGENT_WALLET_MASTER_KEY || this.cfg.privateKey).update(`mandate-agent-wallet:v1:${this.cfg.network}:${user}`).digest();
    const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
    const publicBytes = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
    const key = `ed25519:${baseEncode(Buffer.concat([seed, publicBytes]))}` as KeyPairString;
    return { accountId: publicBytes.toString('hex'), key };
  }
  account(user: string) { const id = this.identity(user); return this.accountFactory(id.accountId, id.key); }
  poolAccount() { return this.accountFactory(this.cfg.accountId, this.cfg.privateKey as KeyPairString); }
  explorer(hash: string) { return `https://${this.cfg.network === 'testnet' ? 'testnet.' : ''}nearblocks.io/txns/${hash}`; }

  async view(contract: string, method: string, args: object): Promise<any> {
    const result: any = await this.provider.query({ request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
    return JSON.parse(Buffer.from(result.result).toString());
  }
  async tokenBalance(account: string) { return BigInt(await this.view(TEST_USDT_TOKEN_ID, 'ft_balance_of', { account_id: account })); }
  async nativeBalance(account: string) {
    try {
      const result: any = await this.provider.query({ request_type: 'view_account', finality: 'final', account_id: account });
      const amount = BigInt(result.amount);
      const storage = BigInt(result.storage_usage) * 10n ** 19n;
      return amount > storage ? amount - storage : 0n;
    } catch (error) { if (missingAccount(error)) return 0n; throw error; }
  }
  async position(user: string, asset: Asset) {
    const pool = asset === 'NEAR' ? this.nearPool : this.usdtPool;
    if (!pool) return { configured: false, staked: '0', unstaked: '0', withdrawable: '0', available: false };
    const args = { account_id: this.identity(user).accountId };
    if (asset === 'USDT') {
      const pos = await this.view(pool, 'get_position', args);
      return { configured: true, contractId: pool, staked: decimal(BigInt(pos?.staked || 0), 6), unstaked: decimal(BigInt(pos?.unstaked || 0), 6), withdrawable: decimal(BigInt(pos?.withdrawable || 0), 6), available: BigInt(pos?.withdrawable || 0) > 0n };
    }
    const [staked, unstaked, available] = await Promise.all([
      this.view(pool, 'get_account_staked_balance', args), this.view(pool, 'get_account_unstaked_balance', args), this.view(pool, 'is_account_unstaked_balance_available', args)
    ]);
    return { configured: true, contractId: pool, staked: decimal(BigInt(staked), 24), unstaked: decimal(BigInt(unstaked), 24), withdrawable: decimal(available ? BigInt(unstaked) : 0n, 24), available: Boolean(available) };
  }
  async snapshot(user: string) {
    const { accountId } = this.identity(user);
    const [near, usdt, linkedNear, linkedUsdt, nearStake, usdtStake] = await Promise.all([
      this.nativeBalance(accountId), this.tokenBalance(accountId), this.nativeBalance(user), this.tokenBalance(user), this.position(user, 'NEAR'), this.position(user, 'USDT')
    ]);
    return { accountId, userAccount: user, network: this.cfg.network, balanceNear: decimal(near, 24), userUsdt: decimal(usdt, TEST_USDT_DECIMALS),
      spendableNear: decimal(near > GAS_RESERVE ? near - GAS_RESERVE : 0n, 24), gasReserveNear: decimal(GAS_RESERVE, 24),
      linked: { accountId: user, near: decimal(linkedNear, 24), usdt: decimal(linkedUsdt, 6) }, staking: { NEAR: nearStake, USDT: usdtStake }, tokenContract: TEST_USDT_TOKEN_ID };
  }
  async transact(account: Account, receiverId: string, txActions: Action[], op?: WalletOperation, kind?: 'storage') {
    const signed = await account.createSignedTransaction({ receiverId, actions: txActions });
    // Persist the exact hash before broadcasting, so a timeout can be reconciled without guessing.
    if (op) {
      op.attempt = { txHash: baseEncode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest()), signerId: account.accountId, kind: kind || op.phase || 'execution' };
      await this.receipts.save(op);
    }
    let result;
    try { result = await this.provider.sendTransactionUntil(signed, 'FINAL'); }
    catch (error: any) {
      // A typed invalid-transaction balance rejection cannot later settle on-chain.
      // Other failures, especially timeouts, still retain the hash for reconciliation.
      if (op && [error.name, error.constructor?.name].includes('NotEnoughBalanceError')) {
        op.broadcastRejected = true;
        await this.receipts.save(op);
      }
      throw error;
    }
    if (op && confirmedHash(result) !== op.attempt!.txHash) throw new Error('Transaction response hash does not match the signed transaction.');
    return result;
  }
  async call(account: Account, contract: string, method: string, args: object, deposit = 0n, gas = '100', op?: WalletOperation, kind?: 'storage') {
    return this.transact(account, contract, [actions.functionCall(method, args, teraToGas(gas as `${number}`), deposit)], op, kind);
  }
  async register(account: Account, target: string, op?: WalletOperation, token = TEST_USDT_TOKEN_ID) {
    if (await this.view(token, 'storage_balance_of', { account_id: target })) return;
    const hash = confirmedHash(await this.call(account, token, 'storage_deposit', { account_id: target, registration_only: true }, STORAGE_DEPOSIT_YOCTO, '30', op, 'storage'));
    if (op) { op.txHashes.push(hash); delete op.attempt; await this.receipts.save(op); }
  }
  async transferToken(account: Account, recipient: string, amount: bigint, memo: string, op?: WalletOperation) {
    await this.register(account, recipient, op);
    return this.call(account, TEST_USDT_TOKEN_ID, 'ft_transfer', { receiver_id: recipient, amount: amount.toString(), memo }, 1n, '40', op);
  }

  /** Wallet signs the deposit; KORD never signs on behalf of the linked account. */
  async prepareDeposit(user: string, asset: Asset, value: unknown) {
    const amount = units(value, asset === 'NEAR' ? 24 : 6);
    const recipient = this.identity(user).accountId;
    if (asset === 'USDT' && await this.nativeBalance(recipient) === 0n) throw new Error('Deposit NEAR first to activate your agent wallet and cover gas.');
    const list: any = await this.provider.query({ request_type: 'view_access_key_list', finality: 'final', account_id: user });
    const fullKey = list.keys.find((key: any) => key.access_key.permission === 'FullAccess');
    if (!fullKey) throw new Error('Your linked wallet needs a full-access key to sign deposits.');
    const block: any = await this.provider.viewBlock({ finality: 'final' });
    let receiver = recipient;
    let txActions = [actions.transfer(amount)];
    if (asset === 'USDT') {
      receiver = TEST_USDT_TOKEN_ID;
      txActions = [];
      if (!(await this.view(TEST_USDT_TOKEN_ID, 'storage_balance_of', { account_id: recipient }))) txActions.push(actions.functionCall('storage_deposit', { account_id: recipient, registration_only: true }, teraToGas('30'), STORAGE_DEPOSIT_YOCTO));
      txActions.push(actions.functionCall('ft_transfer', { receiver_id: recipient, amount: amount.toString(), memo: 'KORD agent wallet deposit' }, teraToGas('40'), 1n));
    }
    const transaction = createTransaction(user, PublicKey.fromString(fullKey.public_key), receiver, BigInt(fullKey.access_key.nonce) + 1n, txActions, baseDecode(block.header.hash));
    return { accountId: recipient, asset, amount: String(value), transaction: Buffer.from(encodeTransaction(transaction)).toString('base64'),
      walletTransaction: { signerId: user, receiverId: receiver, actions: txActions.map(a => a.enum === 'transfer' ? { type: 'Transfer', params: { deposit: amount.toString() } } : { type: 'FunctionCall', params: { methodName: a.functionCall!.methodName, args: JSON.parse(Buffer.from(a.functionCall!.args).toString()), gas: a.functionCall!.gas.toString(), deposit: a.functionCall!.deposit.toString() } }) } };
  }
  async confirmDeposit(user: string, txHash: string) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{40,64}$/.test(txHash)) throw new Error('Invalid transaction hash.');
    const result: any = await this.provider.viewTransactionStatusWithReceipts({ txHash, accountId: user, waitUntil: 'FINAL' });
    confirmedHash(result);
    const transaction = result.transaction;
    const target = this.identity(user).accountId;
    if (transaction.signer_id !== user) throw new Error('Deposit was not signed by the linked wallet.');
    let amount = 0n;
    let asset: Asset = 'NEAR';
    if (transaction.receiver_id === target) {
      for (const action of transaction.actions) if (action.Transfer) amount += BigInt(action.Transfer.deposit);
    } else if (transaction.receiver_id === TEST_USDT_TOKEN_ID) {
      asset = 'USDT';
      for (const action of transaction.actions) {
        const call = action.FunctionCall;
        if (call?.method_name === 'ft_transfer') {
          const args = JSON.parse(Buffer.from(call.args, 'base64').toString());
          if (args.receiver_id === target) amount += BigInt(args.amount);
        }
      }
    }
    if (amount <= 0n) throw new Error('Transaction did not deposit NEAR or USDT into your agent wallet.');
    const op: WalletOperation = { id: `deposit-${txHash}`, userAccount: user, action: 'deposit', asset, amount: decimal(amount, asset === 'NEAR' ? 24 : 6), recipient: target, status: 'confirmed', txHashes: [txHash], createdAt: new Date().toISOString() };
    await this.receipts.save(op);
    return op;
  }

  async execute(user: string, request: { id: string; action: string; asset: Asset; amount: string; recipient?: string; minOutput?: string }) {
    const { action, asset } = request;
    if (!['NEAR', 'USDT'].includes(asset) || !['withdraw', 'send', 'stake', 'unstake', 'claim', 'swap'].includes(action)) throw new Error('Unsupported wallet action or asset.');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(request.id)) throw new Error('A unique operation ID is required.');
    const amount = units(request.amount, asset === 'NEAR' ? 24 : 6);
    if (action !== 'claim') {
      const cap = asset === 'NEAR' ? 20n * 10n ** 24n : 100n * 10n ** 6n;
      const networkCap = this.cfg.network === 'mainnet' ? (this.cfg.maxSinglePaymentCents || 5000n) * this.cfg.yoctoPerCent : cap;
      const limit = asset === 'NEAR' ? (networkCap < cap ? networkCap : cap) : (this.cfg.network === 'mainnet' ? networkCap * 5n / 10n ** 18n : cap);
      if (amount > limit) throw new Error(`Amount exceeds the single-transaction ${asset} spending limit.`);
    }
    const recipient = action === 'withdraw' ? user : action === 'send' ? request.recipient : this.identity(user).accountId;
    if (!recipient || !validAccount(recipient)) throw new Error('Invalid recipient wallet.');
    if (action === 'send' && recipient === this.identity(user).accountId) throw new Error('Choose a recipient outside your agent wallet.');
    const locks = [this.identity(user).accountId, ...(action === 'swap' ? [this.cfg.accountId] : [])];
    return this.receipts.lock(locks, async () => {
      const existing = await this.receipts.get(request.id);
      if (existing) {
        if (existing.userAccount !== user || existing.action !== action || existing.asset !== asset || existing.amount !== request.amount || existing.recipient !== recipient) throw new Error('Operation ID already used for another transaction.');
        return existing; // Never sign twice, including ambiguous network failures.
      }
      const unresolved = await this.receipts.unresolved(user);
      if (unresolved) throw new Error(`Transaction ${unresolved.id} needs reconciliation before further spending.`);
      const account = this.account(user);
      const balance = await this.nativeBalance(account.accountId);
      if (balance < GAS_RESERVE) throw new Error('Deposit NEAR into your agent wallet to cover network gas (0.02 NEAR reserve).');
      if (['withdraw', 'send', 'stake', 'swap'].includes(action)) {
        const available = asset === 'NEAR' ? balance - GAS_RESERVE : await this.tokenBalance(account.accountId);
        if (amount > available) throw new Error(`Insufficient agent wallet ${asset} balance.`);
      }
      const pool = asset === 'NEAR' ? this.nearPool : this.usdtPool;
      let unstakeAll = false;
      if (['stake', 'unstake', 'claim'].includes(action)) {
        if (!pool) throw new Error(`${asset} staking is unavailable until KORD's staking provider is configured.`);
        if (action !== 'stake') {
          const position = await this.position(user, asset);
          const available = action === 'unstake' ? position.staked : position.withdrawable;
          const total = Number(available) === 0 ? 0n : units(available, asset === 'NEAR' ? 24 : 6);
          if (action === 'unstake' && asset === 'NEAR' && total > 0n && amount > total) {
            const dust = Number(position.unstaked) === 0 ? 0n : units(position.unstaked, 24);
            // Validator share rounding can leave a few yoctoNEAR unstaked on deposit.
            // Redeem the existing shares only when that tiny owned remainder covers it.
            unstakeAll = amount - total <= 1000n && amount - total <= dust;
          }
          if (amount > total && !unstakeAll) throw new Error(action === 'claim' ? 'Unstaked funds are still in the provider cooldown or the amount exceeds available funds.' : 'Amount exceeds your staked balance.');
        }
      }
      let dex: DexQuote | undefined;
      if (action === 'swap' && process.env.SWAP_MODE !== 'legacy_demo') {
        dex = await new TestnetDex(this.cfg, TEST_USDT_TOKEN_ID, this.view.bind(this)).quote(asset, request.amount, request.minOutput);
      } else if (action === 'swap') {
        const nearAmount = asset === 'NEAR' ? amount : amount * 10n ** 18n / BigInt(DEMO_EXCHANGE_RATE);
        if (nearAmount < 10n ** 23n || nearAmount > 20n * 10n ** 24n) throw new Error('Swap size must be between 0.1 and 20 NEAR equivalent.');
        const output = asset === 'NEAR' ? amount * BigInt(DEMO_EXCHANGE_RATE) / 10n ** 18n : nearAmount;
        if (request.minOutput && output < units(request.minOutput, asset === 'NEAR' ? 6 : 24)) throw new Error('Swap output is below your minimum.');
        const liquidity = asset === 'NEAR' ? await this.tokenBalance(this.cfg.accountId) : await this.nativeBalance(this.cfg.accountId) - GAS_RESERVE;
        if (output > liquidity) throw new Error('Insufficient demonstration swap pool liquidity.');
      }
      const op: WalletOperation = { id: request.id, userAccount: user, action, asset, amount: request.amount, recipient, status: 'pending', phase: action === 'swap' ? 'funding' : 'execution', txHashes: [], createdAt: new Date().toISOString() };
      if (dex) { op.dex = dex; op.phase = asset === 'NEAR' ? 'funding' : 'execution'; }
      if (['stake', 'unstake', 'claim'].includes(action)) op.contractId = pool;
      await this.receipts.save(op);
      try {
        let result: any;
        if (action === 'send' || action === 'withdraw') {
          result = asset === 'NEAR' ? await this.transact(account, recipient, [actions.transfer(amount)], op) : await this.transferToken(account, recipient, amount, `KORD ${action} ${op.id}`, op);
        } else if (action === 'stake') {
          if (asset === 'NEAR') result = await this.call(account, pool, 'deposit_and_stake', {}, amount, '100', op);
          else {
            await this.register(account, pool, op);
            result = await this.call(account, TEST_USDT_TOKEN_ID, 'ft_transfer_call', { receiver_id: pool, amount: amount.toString(), msg: JSON.stringify({ action: 'stake' }) }, 1n, '200', op);
            // NEP-141 resolver returns the actual amount used. Refunded transfers are not stakes.
            const used = JSON.parse(Buffer.from(result.status?.SuccessValue || '', 'base64').toString() || '"0"');
            if (BigInt(used) !== amount) throw new Error('Staking provider refunded all or part of the token deposit. Reconcile the on-chain position.');
          }
        } else if (action === 'unstake' || action === 'claim') {
          result = await this.call(account, pool, action === 'claim' ? 'withdraw' : unstakeAll ? 'unstake_all' : 'unstake', unstakeAll ? {} : { amount: amount.toString() }, asset === 'USDT' ? 1n : 0n, '100', op);
          if (action === 'claim' && asset === 'USDT' && Buffer.from(result.status?.SuccessValue || '', 'base64').toString() === 'false') throw new Error('The staking withdrawal failed; tokens remain withdrawable in the provider.');
        } else if (op.dex) {
          result = await this.executeDex(user, op);
        } else {
          const poolAccount = this.poolAccount();
          result = asset === 'NEAR' ? await this.transact(account, this.cfg.accountId, [actions.transfer(amount)], op) : await this.transferToken(account, this.cfg.accountId, amount, `KORD swap ${op.id}`, op);
          op.txHashes.push(confirmedHash(result));
          op.status = 'funding_confirmed';
          await this.receipts.save(op);
          // Persist before payout: a timeout must never cause the input to be sent twice.
          op.status = 'pending';
          op.phase = 'payout';
          delete op.attempt;
          await this.receipts.save(op);
          result = asset === 'NEAR'
            ? await this.transferToken(poolAccount, recipient, amount * BigInt(DEMO_EXCHANGE_RATE) / 10n ** 18n, `KORD swap ${op.id}`, op)
            : await this.transact(poolAccount, recipient, [actions.transfer(amount * 10n ** 18n / BigInt(DEMO_EXCHANGE_RATE))], op);
        }
        op.txHashes.push(confirmedHash(result));
        op.status = 'confirmed';
      } catch (error: any) {
        op.status = op.broadcastRejected ? (op.dex?.wrappedInput || op.dex?.swapConfirmed ? 'funding_confirmed' : 'failed') : 'needs_review'; // Unknown RPC errors can hide a mined transaction.
        op.error = error.message;
      }
      await this.receipts.save(op);
      return op;
    });
  }

  private async executeDex(user: string, op: WalletOperation) {
    const quote = op.dex!, account = this.account(user), amount = BigInt(quote.amountIn);
    if (!quote.swapConfirmed) {
      await this.register(account, account.accountId, op, quote.tokenOut);
      await this.register(account, quote.contractId, op, quote.tokenIn);
      if (op.asset === 'NEAR' && !quote.wrappedInput) {
        await this.register(account, account.accountId, op, quote.wrapId);
        op.phase = 'funding';
        const wrapped = await this.call(account, quote.wrapId, 'near_deposit', {}, amount, '40', op);
        op.txHashes.push(confirmedHash(wrapped)); quote.wrappedInput = true;
        delete op.attempt;
        await this.receipts.save(op);
      }
      op.phase = 'execution';
      await this.receipts.save(op);
      const swapped = await this.call(account, quote.tokenIn, 'ft_transfer_call', { receiver_id: quote.contractId, amount: quote.amountIn, msg: JSON.stringify({ force: 0, skip_unwrap_near: true, actions: [{ pool_id: quote.poolId, token_in: quote.tokenIn, token_out: quote.tokenOut, amount_in: quote.amountIn, min_amount_out: quote.minOutput }] }) }, 1n, '250', op);
      confirmedHash(swapped);
      this.verifyDexOutput(op, swapped);
      if (op.asset === 'NEAR') return swapped;
      op.txHashes.push(confirmedHash(swapped));
      op.phase = 'payout'; delete op.attempt;
      await this.receipts.save(op);
    }
    if (op.asset !== 'USDT' || !quote.actualOutput) throw new Error('DEX swap has no confirmed wrapped NEAR output.');
    op.phase = 'payout';
    return this.call(account, quote.wrapId, 'near_withdraw', { amount: quote.actualOutput }, 1n, '60', op);
  }

  private verifyDexOutput(op: WalletOperation, result: any) {
    const quote = op.dex!;
    const used = BigInt(JSON.parse(Buffer.from(result.status?.SuccessValue || '', 'base64').toString() || '"0"'));
    if (used !== BigInt(quote.amountIn)) throw new Error('The DEX refunded the swap input; no swap was confirmed.');
    quote.actualOutput = deliveredOutput(result, quote, this.identity(op.userAccount).accountId).toString();
    quote.swapConfirmed = true;
  }

  async reconcile(user: string, id: string) {
    return this.receipts.lock([this.identity(user).accountId, this.cfg.accountId], async () => {
      const op = await this.receipts.get(id);
      if (!op || op.userAccount !== user) throw new Error('Wallet operation not found.');
      if (['confirmed', 'failed'].includes(op.status)) return op;
      // Recover older saved SDK balance rejections as well as newly typed rejections.
      const rejected = /^Not enough balance for ([a-f0-9]{64}) \(balance: \d+, cost: \d+\)$/.exec(op.error || '');
      if (op.broadcastRejected || (rejected && rejected[1] === op.attempt?.signerId)) {
        op.status = op.dex?.wrappedInput || op.dex?.swapConfirmed ? 'funding_confirmed' : 'failed';
        op.broadcastRejected = true;
      } else if (!op.attempt) {
        op.status = op.dex && (op.dex.wrappedInput || op.dex.swapConfirmed) || op.action === 'swap' && op.phase === 'payout' ? 'funding_confirmed' : 'failed';
        op.error = 'No transaction was broadcast for this step.';
      } else {
        const result: any = await this.provider.viewTransactionStatusWithReceipts({ txHash: op.attempt.txHash, accountId: op.attempt.signerId, waitUntil: 'FINAL' });
        if (result.transaction?.hash !== op.attempt.txHash || result.transaction?.signer_id !== op.attempt.signerId) throw new Error('Receipt does not match the saved transaction.');
        try {
          const hash = confirmedHash(result);
          if (!op.txHashes.includes(hash)) op.txHashes.push(hash);
          if (op.dex && op.attempt.kind === 'funding') {
            op.dex.wrappedInput = true; op.phase = 'execution'; op.status = 'funding_confirmed';
          } else if (op.dex && op.attempt.kind === 'execution') {
            this.verifyDexOutput(op, result);
            op.phase = op.asset === 'USDT' ? 'payout' : 'execution';
            op.status = op.asset === 'USDT' ? 'funding_confirmed' : 'confirmed';
          } else if (op.attempt.kind === 'funding') {
            op.phase = 'payout';
            op.status = 'funding_confirmed';
          } else if (op.attempt.kind === 'storage') {
            op.status = op.dex && (op.dex.wrappedInput || op.dex.swapConfirmed) || op.action === 'swap' && op.phase === 'payout' ? 'funding_confirmed' : 'failed';
            op.error = 'Token storage was registered. The transfer was not submitted; retry the command.';
          } else if (op.action === 'stake' && op.asset === 'USDT' && BigInt(JSON.parse(Buffer.from(result.status.SuccessValue, 'base64').toString() || '"0"')) !== units(op.amount, 6)) {
            op.status = 'failed';
            op.error = 'The provider refunded some or all tokens. Check the on-chain staking position.';
          } else if (op.action === 'claim' && op.asset === 'USDT' && Buffer.from(result.status.SuccessValue || '', 'base64').toString() === 'false') {
            op.status = 'failed'; op.error = 'The provider restored the failed token withdrawal; funds remain withdrawable.';
          } else if (op.action === 'escrow_release' && (!parseEscrowEvents(result).confirmed || parseEscrowEvents(result).failed)) {
            if (!parseEscrowEvents(result).failed) throw new Error('Escrow payout has no confirmed payment event.');
            op.status = 'failed'; op.error = 'Escrow reported payment_failed; funds remain in the contract.';
          } else if (op.action === 'escrow_refund' && Buffer.from(result.status.SuccessValue || '', 'base64').toString() !== 'true') {
            op.status = 'failed'; op.error = 'Escrow refund failed; funds remain in the contract.';
          } else { op.status = 'confirmed'; delete op.error; }
        } catch (error: any) {
          const failures = [result.status?.Failure, ...(result.receipts_outcome || []).map((r: any) => r.outcome?.status?.Failure)];
          if (!failures.some(Boolean)) throw error; // Still ambiguous; keep the spending pause.
          if (op.dex && op.phase === 'execution') {
            const used = Buffer.from(result.status?.SuccessValue || '', 'base64').toString();
            if (used !== '"0"') throw new Error('DEX receipts require settlement review; do not resubmit the swap.');
            op.status = op.dex.wrappedInput ? 'funding_confirmed' : 'failed';
          } else op.status = op.action === 'swap' && op.phase === 'payout' ? 'funding_confirmed' : 'failed';
          op.error = error.message;
        }
      }
      delete op.attempt;
      await this.receipts.save(op);
      return op;
    });
  }

  /** Resumes only a funded swap whose last attempt has been conclusively reconciled. */
  async resumeSwap(user: string, id: string) {
    return this.receipts.lock([this.identity(user).accountId, this.cfg.accountId], async () => {
      const op = await this.receipts.get(id);
      if (!op || op.userAccount !== user || op.action !== 'swap' || op.status !== 'funding_confirmed' || op.attempt) throw new Error('Reconcile the funded swap before resuming its payout.');
      const amount = units(op.amount, op.asset === 'NEAR' ? 24 : 6);
      if (op.dex) {
        if (!op.dex.swapConfirmed) {
          const quote = await new TestnetDex(this.cfg, TEST_USDT_TOKEN_ID, this.view.bind(this)).quote(op.asset, op.amount, decimal(BigInt(op.dex.minOutput), op.dex.outputDecimals));
          op.dex = { ...quote, wrappedInput: op.dex.wrappedInput };
        }
        op.status = 'pending';
        delete op.broadcastRejected;
        await this.receipts.save(op);
        try { const result = await this.executeDex(user, op); op.txHashes.push(confirmedHash(result)); op.status = 'confirmed'; delete op.error; }
        catch (error: any) { op.status = 'needs_review'; op.error = error.message; }
        await this.receipts.save(op);
        return op;
      }
      op.status = 'pending'; op.phase = 'payout';
      await this.receipts.save(op);
      try {
        const pool = this.poolAccount();
        const result = op.asset === 'NEAR'
          ? await this.transferToken(pool, this.identity(user).accountId, amount * 5n / 10n ** 18n, `KORD swap ${op.id}`, op)
          : await this.transact(pool, this.identity(user).accountId, [actions.transfer(amount * 10n ** 18n / 5n)], op);
        op.txHashes.push(confirmedHash(result));
        op.status = 'confirmed'; delete op.error;
      } catch (error: any) { op.status = 'needs_review'; op.error = error.message; }
      await this.receipts.save(op);
      return op;
    });
  }
}
