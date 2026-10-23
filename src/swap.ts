import "dotenv/config";
import { Account, JsonRpcProvider, teraToGas, nearToYocto, yoctoToNear } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { loadNearConfig } from "./near.js";
import type { Store } from "./db.js";

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
  private treasuryAccount: Account;
  private cfg: ReturnType<typeof loadNearConfig>;

  constructor() {
    this.cfg = loadNearConfig();
    this.provider = new JsonRpcProvider({ url: this.cfg.rpcUrl });
    this.treasuryAccount = new Account(
      this.cfg.accountId,
      this.provider,
      this.cfg.privateKey as KeyPairString
    );
  }

  /**
   * Check if an account is registered on the NEP-141 token contract
   */
  async isAccountRegistered(accountId: string): Promise<boolean> {
    try {
      const res = await this.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: TEST_USDT_TOKEN_ID,
        method_name: "storage_balance_of",
        args_base64: Buffer.from(JSON.stringify({ account_id: accountId })).toString("base64")
      });
      const parsed = JSON.parse(Buffer.from((res as any).result).toString());
      return parsed !== null && parsed.total !== "0";
    } catch {
      return false;
    }
  }

  /**
   * Query the live token balance of an account in decimal USDT
   */
  async getTokenBalance(accountId: string): Promise<number> {
    try {
      const res = await this.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: TEST_USDT_TOKEN_ID,
        method_name: "ft_balance_of",
        args_base64: Buffer.from(JSON.stringify({ account_id: accountId })).toString("base64")
      });
      const rawUnits = JSON.parse(Buffer.from((res as any).result).toString());
      return Number(BigInt(rawUnits)) / Math.pow(10, TEST_USDT_DECIMALS);
    } catch {
      return 0;
    }
  }

  /**
   * Ensure target account has NEP-145 storage registered on the token contract
   */
  async ensureStorageRegistered(targetAccountId: string): Promise<string | null> {
    const isRegistered = await this.isAccountRegistered(targetAccountId);
    if (isRegistered) {
      return null;
    }

    // Call storage_deposit with 0.00125 NEAR attached
    const res: any = await this.treasuryAccount.callFunctionRaw({
      contractId: TEST_USDT_TOKEN_ID,
      methodName: "storage_deposit",
      args: {
        account_id: targetAccountId,
        registration_only: false
      },
      gas: teraToGas("30"),
      deposit: STORAGE_DEPOSIT_YOCTO
    });

    const txHash = res?.transaction?.hash ?? res?.transaction_outcome?.id;
    return txHash || null;
  }

  /**
   * Calculate a swap quote with live pool liquidity check and slippage threshold
   */
  async getQuote(inputNear: number, destinationWallet?: string): Promise<SwapQuote> {
    if (isNaN(inputNear) || inputNear <= 0) {
      throw new Error("Input NEAR amount must be greater than zero.");
    }
    if (inputNear > MAX_SWAP_PER_TRANSACTION_NEAR) {
      throw new Error(`Input NEAR amount exceeds the maximum single-swap limit of ${MAX_SWAP_PER_TRANSACTION_NEAR} NEAR.`);
    }
    if (inputNear < MIN_SWAP_PER_TRANSACTION_NEAR) {
      throw new Error(`Input NEAR amount must be at least ${MIN_SWAP_PER_TRANSACTION_NEAR} NEAR.`);
    }

    const outputUsdt = Number((inputNear * DEMO_EXCHANGE_RATE).toFixed(2));
    const minOutputUsdt = Number((outputUsdt * 0.98).toFixed(2)); // 2% slippage default
    const poolLiquidityUsdt = await this.getTokenBalance(this.cfg.accountId);

    let storageRequired = false;
    if (destinationWallet) {
      storageRequired = !(await this.isAccountRegistered(destinationWallet));
    }

    return {
      inputNear,
      outputUsdt,
      minOutputUsdt,
      exchangeRate: DEMO_EXCHANGE_RATE,
      rateType: "demonstration_rate",
      tokenContract: TEST_USDT_TOKEN_ID,
      tokenSymbol: TEST_USDT_SYMBOL,
      poolLiquidityUsdt,
      storageDepositRequired: storageRequired,
      disclaimer: TEST_USDT_DISCLAIMER
    };
  }

  /**
   * Validate, execute, and settle the Agent Swap & Payout workflow
   */
  async executeSwap(req: SwapExecutionRequest, store: Store): Promise<SwapExecutionResult> {
    const swapId = req.id || `swap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const agentAccount = req.agentAccount || "mandate-generis-analyst.testnet";
    const dest = req.destinationWallet.trim().toLowerCase();

    // 1. Validation Safeguards
    if (!dest || (!dest.endsWith(".testnet") && !dest.endsWith(".near") && dest.length !== 64)) {
      throw new Error("Invalid destination wallet account ID.");
    }

    if (isNaN(req.inputNear) || req.inputNear <= 0) {
      throw new Error("Invalid swap amount in NEAR.");
    }

    if (req.inputNear > MAX_SWAP_PER_TRANSACTION_NEAR) {
      throw new Error(`Swap amount of ${req.inputNear} NEAR exceeds agent single-transaction cap (${MAX_SWAP_PER_TRANSACTION_NEAR} NEAR).`);
    }

    // Check user balance in store
    const userBal = store.getUserBalance(req.userAccount);
    if (userBal < req.inputNear) {
      throw new Error(`Insufficient treasury balance: requested ${req.inputNear} NEAR, but ${req.userAccount} has ${userBal.toFixed(2)} NEAR.`);
    }

    // Calculate outputs
    const outputUsdt = Number((req.inputNear * DEMO_EXCHANGE_RATE).toFixed(2));
    const minAcceptable = req.minOutputUsdt !== undefined ? req.minOutputUsdt : outputUsdt * 0.98;

    if (outputUsdt < minAcceptable) {
      throw new Error(`Slippage breach: output of ${outputUsdt} USDT is less than minimum acceptable ${minAcceptable} USDT.`);
    }

    // Check on-chain pool liquidity
    const poolLiquidity = await this.getTokenBalance(this.cfg.accountId);
    if (poolLiquidity < outputUsdt) {
      throw new Error(`Insufficient liquidity: pool has ${poolLiquidity.toFixed(2)} test USDT, but requested swap requires ${outputUsdt.toFixed(2)} test USDT.`);
    }

    // 2. State Machine: Initialize Swap in DB
    store.createSwapRecord({
      id: swapId,
      userAccount: req.userAccount,
      agentAccount,
      inputNear: req.inputNear,
      outputToken: TEST_USDT_TOKEN_ID,
      outputAmount: outputUsdt,
      minOutputAmount: minAcceptable,
      exchangeRate: DEMO_EXCHANGE_RATE,
      destinationWallet: dest,
      status: "funding_confirmed",
      note: req.note || `Agent swap of ${req.inputNear} NEAR for ${outputUsdt} Test USDT`
    });

    let storageTxHash: string | null = null;
    let payoutTxHash: string | null = null;

    try {
      // 3. Ensure destination storage registration
      storageTxHash = await this.ensureStorageRegistered(dest);
      if (storageTxHash) {
        store.updateSwapRecord(swapId, { storageTxHash });
      }

      // 4. Execute on-chain NEP-141 ft_transfer to destination wallet
      const microUnits = BigInt(Math.round(outputUsdt * Math.pow(10, TEST_USDT_DECIMALS)));
      const transferRes: any = await this.treasuryAccount.callFunctionRaw({
        contractId: TEST_USDT_TOKEN_ID,
        methodName: "ft_transfer",
        args: {
          receiver_id: dest,
          amount: microUnits.toString(),
          memo: `Mandate Agent Swap Payout for ${req.userAccount}`
        },
        gas: teraToGas("40"),
        deposit: 1n // 1 yoctoNEAR strictly required by NEP-141 standard
      });

      const failure = transferRes?.status?.Failure;
      if (failure) {
        throw new Error(`Token transfer rejected onchain: ${JSON.stringify(failure)}`);
      }

      payoutTxHash = transferRes?.transaction?.hash ?? transferRes?.transaction_outcome?.id;
      if (!payoutTxHash) {
        throw new Error("NEAR network did not return a valid transaction hash for token transfer.");
      }

      // 5. Update DB and deduct user balance
      store.deductUserBalance(
        req.userAccount,
        req.inputNear,
        `Agent Swap & Payout: ${req.inputNear} NEAR -> ${outputUsdt} Test USDT to ${dest}`,
        payoutTxHash
      );

      store.updateSwapRecord(swapId, {
        status: "payout_confirmed",
        payoutTxHash
      });

      const explorerUrl = `https://testnet.nearblocks.io/txns/${payoutTxHash}`;

      return {
        id: swapId,
        status: "confirmed",
        userAccount: req.userAccount,
        agentAccount,
        inputNear: req.inputNear,
        outputUsdt,
        exchangeRate: DEMO_EXCHANGE_RATE,
        destinationWallet: dest,
        storageTxHash,
        payoutTxHash,
        explorerUrl,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      store.updateSwapRecord(swapId, {
        status: "failed",
        errorReason: errMsg
      });

      return {
        id: swapId,
        status: "failed",
        userAccount: req.userAccount,
        agentAccount,
        inputNear: req.inputNear,
        outputUsdt,
        exchangeRate: DEMO_EXCHANGE_RATE,
        destinationWallet: dest,
        storageTxHash,
        error: errMsg,
        timestamp: new Date().toISOString()
      };
    }
  }
}

