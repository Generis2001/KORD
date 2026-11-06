import { Account, JsonRpcProvider, teraToGas, yoctoToNear } from "near-api-js";
import type { KeyPairString } from "near-api-js";

export const DEFAULT_TESTNET_RPC = "https://test.rpc.fastnear.com";
export const DEFAULT_MAINNET_RPC = "https://free.rpc.fastnear.com";
export const DEFAULT_MAINNET_CONFIRMATION = "I_CONFIRM_SPENDING_REAL_FUNDS";
export const DEFAULT_MAINNET_MAX_PAYMENT_CENTS = 5000n; // $50.00 max single payment safety limit
export const DEFAULT_MAINNET_MAX_TOTAL_BUDGET_CENTS = 20000n; // $200.00 max total budget safety limit

export interface ExecutionResult {
  network: string;
  txHash: string | null;
  /** True only when a real network transaction was confirmed. */
  onchain: boolean;
}

export interface PaymentExecutor {
  readonly label: string;
  execute(args: ExecuteArgs): Promise<ExecutionResult>;
}

export interface ExecuteArgs {
  recipient: string;
  amountCents: bigint;
  mandateId: string;
  taskId: string;
  /** Hash of the deliverable evidence, recorded in the onchain event log. */
  evidenceHash: string;
}

/** Test double. Never produces a transaction hash and is always flagged onchain=false. */
export class MockExecutor implements PaymentExecutor {
  readonly label = "mock (no network, not an onchain transaction)";
  calls: ExecuteArgs[] = [];
  failNext = false;
  async execute(args: ExecuteArgs): Promise<ExecutionResult> {
    this.calls.push(args);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("mock executor failure");
    }
    return { network: "mock", txHash: null, onchain: false };
  }
}

export interface NearConfig {
  network: string;
  rpcUrl: string;
  accountId: string;
  privateKey: string;
  yoctoPerCent: bigint;
  allowMainnet?: boolean;
  mainnetConfirmation?: string;
  maxSinglePaymentCents?: bigint;
  maxTotalBudgetCents?: bigint;
}

export function loadNearConfig(env: NodeJS.ProcessEnv = process.env): NearConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing ${k}. Copy .env.example to .env and fill it in.`);
    return v;
  };
  const network = env.NEAR_NETWORK ?? "testnet";
  const defaultRpc = network === "mainnet" ? DEFAULT_MAINNET_RPC : DEFAULT_TESTNET_RPC;

  return {
    network,
    rpcUrl: env.NEAR_RPC_URL ?? defaultRpc,
    accountId: need("NEAR_ACCOUNT_ID"),
    privateKey: need("NEAR_PRIVATE_KEY"),
    yoctoPerCent: BigInt(env.YOCTO_PER_CENT ?? "1000000000000000000000"), // 0.001 NEAR per logical cent
    allowMainnet: env.ALLOW_MAINNET === "true",
    mainnetConfirmation: env.MAINNET_CONFIRMATION,
    maxSinglePaymentCents: env.MAINNET_MAX_PAYMENT_CENTS ? BigInt(env.MAINNET_MAX_PAYMENT_CENTS) : DEFAULT_MAINNET_MAX_PAYMENT_CENTS,
    maxTotalBudgetCents: env.MAINNET_MAX_TOTAL_BUDGET_CENTS ? BigInt(env.MAINNET_MAX_TOTAL_BUDGET_CENTS) : DEFAULT_MAINNET_MAX_TOTAL_BUDGET_CENTS,
  };
}

/** Returns block explorer transaction URL based on network. */
export function getExplorerTxUrl(network: string, txHash: string): string {
  if (network === "mainnet") {
    return `https://nearblocks.io/txns/${txHash}`;
  }
  return `https://explorer.testnet.near.org/transactions/${txHash}`;
}

/**
 * Validates network configuration and enforces mainnet safety checks.
 * Requires explicit double-opt-in (ALLOW_MAINNET=true and confirmation phrase)
 * before any mainnet operations can proceed.
 */
export function assertNetworkSafety(cfg: {
  network: string;
  rpcUrl: string;
  accountId: string;
  allowMainnet?: boolean;
  mainnetConfirmation?: string;
}) {
  if (cfg.network === "mainnet") {
    if (!cfg.allowMainnet) {
      throw new Error(
        `MAINNET SAFETY LOCK: NEAR_NETWORK is "mainnet", but ALLOW_MAINNET is not true. Set ALLOW_MAINNET=true to permit real-fund execution.`
      );
    }
    if (cfg.mainnetConfirmation !== DEFAULT_MAINNET_CONFIRMATION) {
      throw new Error(
        `MAINNET SAFETY LOCK: Missing or invalid MAINNET_CONFIRMATION phrase. Set MAINNET_CONFIRMATION="${DEFAULT_MAINNET_CONFIRMATION}" to confirm real fund expenditure.`
      );
    }
    if (cfg.accountId.endsWith(".testnet")) {
      throw new Error(`Account "${cfg.accountId}" is a .testnet account, but network is mainnet.`);
    }
    if (/testnet|(^|\/\/)test\.rpc\.fastnear\.com|(^|\/\/)rpc\.testnet\.near\.org/.test(cfg.rpcUrl)) {
      throw new Error(`RPC URL "${cfg.rpcUrl}" looks like testnet, but network is mainnet.`);
    }
  } else if (cfg.network === "testnet") {
    if (cfg.accountId.endsWith(".near")) {
      throw new Error(`Account "${cfg.accountId}" is a .near account (mainnet), but network is testnet.`);
    }
    if (/mainnet|(^|\/\/)rpc\.near\.org|(^|\/\/)free\.rpc\.fastnear\.com/.test(cfg.rpcUrl)) {
      throw new Error(`RPC URL "${cfg.rpcUrl}" looks like mainnet. Use a testnet RPC.`);
    }
  } else {
    throw new Error(`Unsupported network "${cfg.network}". Expected "testnet" or "mainnet".`);
  }
}

/** Testnet-only guard maintained for backward compatibility. */
export function assertTestnet(cfg: { network: string; rpcUrl: string; accountId: string }) {
  if (cfg.network !== "testnet") throw new Error(`Mandate is testnet-only. Refusing NEAR_NETWORK="${cfg.network}".`);
  if (!cfg.accountId.endsWith(".testnet")) throw new Error(`Account "${cfg.accountId}" is not a .testnet account.`);
  if (/mainnet|(^|\/\/)rpc\.near\.org|(^|\/\/)free\.rpc\.fastnear\.com/.test(cfg.rpcUrl))
    throw new Error(`RPC URL "${cfg.rpcUrl}" looks like mainnet. Use a testnet RPC.`);
}

/** Sends native NEAR from the treasury account with network safety checks. */
export class NearExecutor implements PaymentExecutor {
  readonly label: string;
  private account: Account;
  private provider: JsonRpcProvider;

  constructor(private cfg: NearConfig) {
    assertNetworkSafety(cfg);
    this.label = `near ${cfg.network}`;
    if (cfg.network === "mainnet") {
      console.warn(
        `\n⚠️  [MAINNET WARNING] Real funds active! Transactions will spend real NEAR from account: ${cfg.accountId}\n`
      );
    }
    this.provider = new JsonRpcProvider({ url: cfg.rpcUrl });
    this.account = new Account(cfg.accountId, this.provider, cfg.privateKey as KeyPairString);
  }

  async balanceNear(): Promise<string> {
    return yoctoToNear(await this.account.getBalance());
  }

  async execute({ recipient, amountCents }: ExecuteArgs): Promise<ExecutionResult> {
    if (this.cfg.network === "mainnet") {
      const maxPayment = this.cfg.maxSinglePaymentCents ?? DEFAULT_MAINNET_MAX_PAYMENT_CENTS;
      if (amountCents > maxPayment) {
        throw new Error(
          `MAINNET SAFETY CAP EXCEEDED: Payout ${amountCents} cents exceeds the max single payment limit of ${maxPayment} cents.`
        );
      }
    }

    const amount = amountCents * this.cfg.yoctoPerCent;
    const res: any = await this.account.transfer({ receiverId: recipient, amount });
    const hash: string | undefined = res?.transaction?.hash ?? res?.transaction_outcome?.id;
    const status = res?.status;
    const failed = status && typeof status === "object" && "Failure" in status;
    if (failed) throw new Error(`Transaction failed onchain: ${JSON.stringify(status.Failure)}`);
    if (!hash) throw new Error("Transaction response had no hash; refusing to record it as confirmed.");
    return { network: this.cfg.network, txHash: hash, onchain: true };
  }
}

/** Pure parser: finds the escrow contract's event logs in a transaction response. */
export function parseEscrowEvents(res: any): { confirmed: boolean; failed: boolean } {
  const events: string[] = [];
  for (const r of res?.receipts_outcome ?? []) {
    for (const log of r?.outcome?.logs ?? []) {
      if (typeof log === "string" && log.startsWith("EVENT_JSON:")) {
        try {
          const j = JSON.parse(log.slice("EVENT_JSON:".length));
          if (j.standard === "mandate_escrow") events.push(j.event);
        } catch {
          /* ignore malformed logs */
        }
      }
    }
  }
  return { confirmed: events.includes("payment_confirmed"), failed: events.includes("payment_failed") };
}

export interface EscrowConfig extends NearConfig {
  contractId: string;
}

export function loadEscrowConfig(env: NodeJS.ProcessEnv = process.env): EscrowConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing ${k}. See .env.example.`);
    return v;
  };
  const network = env.NEAR_NETWORK ?? "testnet";
  const defaultRpc = network === "mainnet" ? DEFAULT_MAINNET_RPC : DEFAULT_TESTNET_RPC;

  return {
    network,
    rpcUrl: env.NEAR_RPC_URL ?? defaultRpc,
    accountId: need("VERIFIER_ACCOUNT_ID"),
    privateKey: need("VERIFIER_PRIVATE_KEY"),
    yoctoPerCent: BigInt(env.YOCTO_PER_CENT ?? "1000000000000000000000"),
    contractId: need("ESCROW_CONTRACT_ID"),
    allowMainnet: env.ALLOW_MAINNET === "true",
    mainnetConfirmation: env.MAINNET_CONFIRMATION,
    maxSinglePaymentCents: env.MAINNET_MAX_PAYMENT_CENTS ? BigInt(env.MAINNET_MAX_PAYMENT_CENTS) : DEFAULT_MAINNET_MAX_PAYMENT_CENTS,
    maxTotalBudgetCents: env.MAINNET_MAX_TOTAL_BUDGET_CENTS ? BigInt(env.MAINNET_MAX_TOTAL_BUDGET_CENTS) : DEFAULT_MAINNET_MAX_TOTAL_BUDGET_CENTS,
  };
}

/**
 * Pays through the Rust escrow contract with network safety validation.
 */
export class EscrowExecutor implements PaymentExecutor {
  readonly label: string;
  private account: Account;

  constructor(private cfg: EscrowConfig) {
    assertNetworkSafety(cfg);
    if (cfg.network === "mainnet") {
      if (cfg.contractId.endsWith(".testnet")) {
        throw new Error(`Contract "${cfg.contractId}" is a .testnet account, but running on mainnet.`);
      }
      console.warn(
        `\n⚠️  [MAINNET ESCROW WARNING] Running on NEAR mainnet with real funds (Contract: ${cfg.contractId}, Verifier: ${cfg.accountId})\n`
      );
    } else {
      if (!cfg.contractId.endsWith(".testnet")) {
        throw new Error(`Contract "${cfg.contractId}" is not a .testnet account.`);
      }
    }
    this.label = `escrow contract ${cfg.contractId} (${cfg.network})`;
    this.account = new Account(cfg.accountId, new JsonRpcProvider({ url: cfg.rpcUrl }), cfg.privateKey as KeyPairString);
  }

  async execute(a: ExecuteArgs): Promise<ExecutionResult> {
    if (this.cfg.network === "mainnet") {
      const maxPayment = this.cfg.maxSinglePaymentCents ?? DEFAULT_MAINNET_MAX_PAYMENT_CENTS;
      if (a.amountCents > maxPayment) {
        throw new Error(
          `MAINNET SAFETY CAP EXCEEDED: Escrow payout ${a.amountCents} cents exceeds the max single payment limit of ${maxPayment} cents.`
        );
      }
    }

    const amount = a.amountCents * this.cfg.yoctoPerCent;
    const res: any = await this.account.callFunctionRaw({
      contractId: this.cfg.contractId,
      methodName: "approve_payment",
      args: { mandate_id: a.mandateId, task_id: a.taskId, agent: a.recipient, amount: amount.toString(), evidence_hash: a.evidenceHash },
      gas: teraToGas("60"),
      deposit: 0n,
    });
    const hash: string | undefined = res?.transaction?.hash;
    const status = res?.status;
    if (status && typeof status === "object" && "Failure" in status)
      throw new Error(`approve_payment rejected by the contract: ${JSON.stringify(status.Failure)}`);
    const ev = parseEscrowEvents(res);
    if (ev.failed) throw new Error("Contract reported payment_failed; funds stay in escrow.");
    if (!ev.confirmed) throw new Error("No payment_confirmed event found; refusing to record as confirmed.");
    if (!hash) throw new Error("Response had no transaction hash.");
    return { network: this.cfg.network, txHash: hash, onchain: true };
  }
}
