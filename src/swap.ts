import "dotenv/config";
import { JsonRpcProvider } from "near-api-js";
import { loadNearConfig } from "./near.js";
import { TestnetDex } from './dex.js';
import { decimal, units } from './amounts.js';
import { TestnetMarketSwap } from './market-swap.js';
import type { WalletOperation } from './wallet-store.js';

export const TEST_USDT_TOKEN_ID = process.env.TEST_USDT_TOKEN_ID || "usdt.fakes.testnet";
export const TEST_USDT_NAME = "Mandate Test USDT";
export const TEST_USDT_SYMBOL = "USDT (Testnet)";
export const TEST_USDT_DECIMALS = 6;
export const TEST_USDT_DISCLAIMER = "Mandate Test USDT is a testnet development asset and is not issued by Tether. It has no real monetary value and is not redeemable for US dollars.";

/** Demonstration exchange rate: 1 NEAR = 5.00 Test USDT */
export const DEMO_EXCHANGE_RATE = 5.0;
export const MAX_SWAP_PER_TRANSACTION_NEAR = 20.0;
export const MIN_SWAP_PER_TRANSACTION_NEAR = 0.1;
export const STORAGE_DEPOSIT_YOCTO = 1250000000000000000000n; // 0.00125 NEAR

export function swapMode(): 'market' | 'ref' | 'legacy_demo' {
  const mode = process.env.SWAP_MODE || 'market';
  if (mode === 'market' || mode === 'ref' || mode === 'legacy_demo') return mode;
  throw new Error('SWAP_MODE must be market, ref, or legacy_demo.');
}

/** Only show a received amount after the payout (or DEX and unwrap) is confirmed. */
export function receivedSwapAmount(operation: WalletOperation): string | null {
  if (operation.action !== 'swap' || operation.status !== 'confirmed') return null;
  const quote = operation.market || operation.dex;
  if (quote) return quote.actualOutput ? decimal(BigInt(quote.actualOutput), quote.outputDecimals) : null;
  // Historical fixed-rate treasury operations did not save a quote.
  const input = units(operation.amount, operation.asset === 'NEAR' ? 24 : 6);
  return operation.asset === 'NEAR'
    ? decimal(input * BigInt(DEMO_EXCHANGE_RATE) / 10n ** 18n, 6)
    : decimal(input * 10n ** 18n / BigInt(DEMO_EXCHANGE_RATE), 24);
}

export interface SwapQuote {
  inputNear: number;
  inputNearExact: string;
  outputUsdt: number;
  outputUsdtExact: string;
  minOutputUsdt: number;
  minOutputUsdtExact: string;
  exchangeRate: number;
  rateType: "market_reference_testnet" | "demonstration_rate" | "testnet_dex";
  quotedAt: string;
  expiresAt: string;
  priceSource?: string;
  nearPriceUsd?: string;
  usdtPriceUsd?: string;
  poolId?: number;
  dexContract?: string;
  feeBps?: number;
  tokenContract: string;
  tokenSymbol: string;
  poolLiquidityUsdt: number;
  storageDepositRequired: boolean;
  disclaimer: string;
}

export interface SwapExecutionRequest {
  id?: string;
  userAccount: string;
  agentAccount?: string;
  inputNear: number;
  minOutputUsdt?: number;
  destinationWallet: string;
  note?: string;
}

export interface SwapExecutionResult {
  id: string;
  status: "confirmed" | "failed";
  userAccount: string;
  agentAccount: string;
  inputNear: number;
  outputUsdt: number;
  exchangeRate: number;
  destinationWallet: string;
  storageTxHash?: string | null;
  payoutTxHash?: string | null;
  explorerUrl?: string | null;
  error?: string | null;
  timestamp: string;
}

export class AgentSwapService {
  private provider: JsonRpcProvider;
  private cfg: ReturnType<typeof loadNearConfig>;
  constructor() {
    this.cfg = loadNearConfig();
    this.provider = new JsonRpcProvider({ url: this.cfg.rpcUrl });
  }
  private async view(method: string, args: object) {
    const response: any = await this.provider.query({ request_type: 'call_function', finality: 'final', account_id: TEST_USDT_TOKEN_ID,
      method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
    return JSON.parse(Buffer.from(response.result).toString());
  }
  async getTokenBalance(accountId: string): Promise<number> {
    return Number(BigInt(await this.view('ft_balance_of', { account_id: accountId }))) / 10 ** TEST_USDT_DECIMALS;
  }
  async isAccountRegistered(accountId: string) {
    return !!(await this.view('storage_balance_of', { account_id: accountId }));
  }
  async getQuote(value: number | string, destinationWallet?: string): Promise<SwapQuote> {
    const inputNear = Number(value);
    if (!Number.isFinite(inputNear) || inputNear <= 0) throw new Error('Input NEAR amount must be greater than zero.');
    if (inputNear > MAX_SWAP_PER_TRANSACTION_NEAR) throw new Error(`Input NEAR amount exceeds the maximum single-swap limit of ${MAX_SWAP_PER_TRANSACTION_NEAR} NEAR.`);
    if (inputNear < MIN_SWAP_PER_TRANSACTION_NEAR) throw new Error(`Input NEAR amount must be at least ${MIN_SWAP_PER_TRANSACTION_NEAR} NEAR.`);
    const amount = units(value, 24), inputNearExact = decimal(amount, 24);
    const mode = swapMode();
    if (mode === 'market') {
      const tokenState = Promise.all([
        this.view('ft_metadata', {}), this.getTokenBalance(this.cfg.accountId),
        destinationWallet ? this.isAccountRegistered(destinationWallet) : true,
      ]).catch(() => { throw new Error('Testnet token balances are unavailable. Refresh the quote to try again.'); });
      const [quote, [metadata, liquidity, registered]] = await Promise.all([new TestnetMarketSwap(this.cfg).quote('NEAR', value), tokenState]);
      if (metadata.decimals !== TEST_USDT_DECIMALS) throw new Error('The configured Test USDT must use 6 decimals.');
      const outputUsdtExact = decimal(BigInt(quote.expectedOutput), 6), minOutputUsdtExact = decimal(BigInt(quote.minOutput), 6);
      const outputUsdt = Number(outputUsdtExact);
      return {
        inputNear, inputNearExact, outputUsdt, outputUsdtExact, minOutputUsdt: Number(minOutputUsdtExact), minOutputUsdtExact,
        exchangeRate: outputUsdt / inputNear, rateType: 'market_reference_testnet', feeBps: 0,
        quotedAt: quote.quotedAt, expiresAt: quote.expiresAt, priceSource: quote.priceSource, nearPriceUsd: quote.nearPriceUsd, usdtPriceUsd: quote.usdtPriceUsd,
        tokenContract: TEST_USDT_TOKEN_ID, tokenSymbol: TEST_USDT_SYMBOL, poolLiquidityUsdt: liquidity,
        storageDepositRequired: !registered, disclaimer: TEST_USDT_DISCLAIMER,
      };
    }
    if (mode === 'ref') {
      const quote = await new TestnetDex(this.cfg, TEST_USDT_TOKEN_ID).quote('NEAR', value);
      const outputUsdt = Number(decimal(BigInt(quote.expectedOutput), 6));
      return { inputNear, inputNearExact, outputUsdt, outputUsdtExact: decimal(BigInt(quote.expectedOutput), 6), minOutputUsdt: Number(decimal(BigInt(quote.minOutput), 6)), minOutputUsdtExact: decimal(BigInt(quote.minOutput), 6), exchangeRate: outputUsdt / inputNear, rateType: 'testnet_dex', poolId: quote.poolId, dexContract: quote.contractId, feeBps: quote.feeBps,
        quotedAt: quote.quotedAt, expiresAt: new Date(Date.parse(quote.quotedAt) + 60_000).toISOString(),
        tokenContract: TEST_USDT_TOKEN_ID, tokenSymbol: TEST_USDT_SYMBOL, poolLiquidityUsdt: Number(decimal(BigInt(quote.reserveOut), 6)), storageDepositRequired: destinationWallet ? !(await this.isAccountRegistered(destinationWallet)) : false, disclaimer: TEST_USDT_DISCLAIMER };
    }
    const output = amount * BigInt(DEMO_EXCHANGE_RATE) / 10n ** 18n;
    const outputUsdtExact = decimal(output, 6), minOutputUsdtExact = decimal(output * 98n / 100n, 6), quotedAt = new Date().toISOString();
    return { inputNear, inputNearExact, outputUsdt: Number(outputUsdtExact), outputUsdtExact, minOutputUsdt: Number(minOutputUsdtExact), minOutputUsdtExact, exchangeRate: DEMO_EXCHANGE_RATE,
      quotedAt, expiresAt: new Date(Date.parse(quotedAt) + 60_000).toISOString(),
      rateType: 'demonstration_rate', tokenContract: TEST_USDT_TOKEN_ID, tokenSymbol: TEST_USDT_SYMBOL,
      poolLiquidityUsdt: await this.getTokenBalance(this.cfg.accountId), storageDepositRequired: destinationWallet ? !(await this.isAccountRegistered(destinationWallet)) : false,
      disclaimer: TEST_USDT_DISCLAIMER };
  }
}
