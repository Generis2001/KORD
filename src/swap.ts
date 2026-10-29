import "dotenv/config";
import { JsonRpcProvider } from "near-api-js";
import { loadNearConfig } from "./near.js";

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

export interface SwapQuote {
  inputNear: number;
  outputUsdt: number;
  minOutputUsdt: number;
  exchangeRate: number;
  rateType: "demonstration_rate";
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
  async getQuote(inputNear: number, destinationWallet?: string): Promise<SwapQuote> {
    if (!Number.isFinite(inputNear) || inputNear <= 0) throw new Error('Input NEAR amount must be greater than zero.');
    if (inputNear > MAX_SWAP_PER_TRANSACTION_NEAR) throw new Error(`Input NEAR amount exceeds the maximum single-swap limit of ${MAX_SWAP_PER_TRANSACTION_NEAR} NEAR.`);
    if (inputNear < MIN_SWAP_PER_TRANSACTION_NEAR) throw new Error(`Input NEAR amount must be at least ${MIN_SWAP_PER_TRANSACTION_NEAR} NEAR.`);
    const outputUsdt = Number((inputNear * DEMO_EXCHANGE_RATE).toFixed(6));
    return { inputNear, outputUsdt, minOutputUsdt: Number((outputUsdt * 0.98).toFixed(6)), exchangeRate: DEMO_EXCHANGE_RATE,
      rateType: 'demonstration_rate', tokenContract: TEST_USDT_TOKEN_ID, tokenSymbol: TEST_USDT_SYMBOL,
      poolLiquidityUsdt: await this.getTokenBalance(this.cfg.accountId), storageDepositRequired: destinationWallet ? !(await this.isAccountRegistered(destinationWallet)) : false,
      disclaimer: TEST_USDT_DISCLAIMER };
  }
}
