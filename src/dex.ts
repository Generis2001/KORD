import { JsonRpcProvider } from 'near-api-js';
import { units, decimal } from './amounts.js';
import type { NearConfig } from './near.js';

export interface DexQuote {
  contractId: string; poolId: number; wrapId: string; tokenIn: string; tokenOut: string;
  amountIn: string; expectedOutput: string; minOutput: string; outputDecimals: number;
  reserveOut: string; feeBps: number; quotedAt: string;
}
export class TestnetDex {
  readonly contractId = process.env.TESTNET_DEX_CONTRACT_ID || 'ref-finance-101.testnet';
  readonly poolId = Number(process.env.TESTNET_DEX_POOL_ID || '57');
  readonly wrapId = 'wrap.testnet';
  constructor(private cfg: NearConfig, private tokenId: string,
    private read?: (contract: string, method: string, args: object) => Promise<any>) {}
  private async view(contract: string, method: string, args: object) {
    if (this.read) return this.read(contract, method, args);
    const result: any = await new JsonRpcProvider({ url: this.cfg.rpcUrl }).query({ request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
    return JSON.parse(Buffer.from(result.result).toString());
  }
  async quote(asset: 'NEAR' | 'USDT', value: unknown, minimum?: string): Promise<DexQuote> {
    if (this.cfg.network !== 'testnet' || !this.contractId.endsWith('.testnet') || !this.tokenId.endsWith('.testnet')) throw new Error('This DEX adapter supports NEAR testnet only.');
    if (!Number.isSafeInteger(this.poolId) || this.poolId < 0) throw new Error('Configure a valid testnet DEX pool ID.');
    const amount = units(value, asset === 'NEAR' ? 24 : 6);
    if (asset === 'NEAR' && (amount < units('0.1', 24) || amount > units('20', 24))) throw new Error('Swap size must be between 0.1 and 20 NEAR.');
    if (asset === 'USDT' && amount > units('100', 6)) throw new Error('Swap exceeds the 100 Test USDT limit.');
    const [pool, metadata] = await Promise.all([this.view(this.contractId, 'get_pool', { pool_id: this.poolId }), this.view(this.tokenId, 'ft_metadata', {})]);
    if (metadata.decimals !== 6) throw new Error('The configured Test USDT must use 6 decimals.');
    if (pool.pool_kind !== 'SIMPLE_POOL' || pool.token_account_ids.length !== 2 || ![this.wrapId, this.tokenId].every(id => pool.token_account_ids.includes(id))) throw new Error('DEX pool must contain wrapped NEAR and the configured Test USDT.');
    const tokenIn = asset === 'NEAR' ? this.wrapId : this.tokenId, tokenOut = asset === 'NEAR' ? this.tokenId : this.wrapId;
    const index = pool.token_account_ids.indexOf(tokenOut);
    if (pool.amounts.some((v: string) => BigInt(v) <= 0n)) throw new Error('The testnet DEX pool has no liquidity.');
    // The contract computes its current reserve-based return, including the pool fee.
    const output = BigInt(await this.view(this.contractId, 'get_return', { pool_id: this.poolId, token_in: tokenIn, token_out: tokenOut, amount_in: amount.toString() }));
    if (output <= 0n) throw new Error('Swap is too small for the available testnet liquidity.');
    const outputDecimals = asset === 'NEAR' ? 6 : 24;
    const floor = minimum ? units(minimum, outputDecimals) : output * 98n / 100n;
    if (floor <= 0n || output < floor) throw new Error('Swap output is below your minimum.');
    return { contractId: this.contractId, poolId: this.poolId, wrapId: this.wrapId, tokenIn, tokenOut, amountIn: amount.toString(), expectedOutput: output.toString(), minOutput: floor.toString(), outputDecimals, reserveOut: pool.amounts[index], feeBps: pool.total_fee, quotedAt: new Date().toISOString() };
  }
}

/** Only final token-contract receipts prove the output delivered to this agent. */
export function deliveredOutput(result: any, quote: DexQuote, agent: string): bigint {
  let total = 0n;
  for (const receipt of result.receipts_outcome || []) {
    if (receipt.outcome?.executor_id !== quote.tokenOut || receipt.outcome?.status?.Failure) continue;
    for (const log of receipt.outcome.logs || []) {
      if (log.startsWith('EVENT_JSON:')) {
        try {
          const event = JSON.parse(log.slice(11));
          if (event.standard === 'nep141' && event.event === 'ft_transfer') for (const transfer of event.data || []) {
            if (transfer.old_owner_id === quote.contractId && transfer.new_owner_id === agent) total += BigInt(transfer.amount);
          }
        } catch { /* Unrecognized logs do not establish a payment. */ }
      } else {
        const transfer = /^Transfer (\d+) from (\S+) to (\S+)$/.exec(log);
        if (transfer && transfer[2] === quote.contractId && transfer[3] === agent) total += BigInt(transfer[1]);
      }
    }
  }
  if (total < BigInt(quote.minOutput)) throw new Error('DEX output receipt is missing or below the saved minimum; reconcile before retrying.');
  return total;
}
export function quoteOutput(quote: DexQuote) { return decimal(BigInt(quote.expectedOutput), quote.outputDecimals); }
