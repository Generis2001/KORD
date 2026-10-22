/** All money is stored as integer "logical cents" (bigint). No floats anywhere. */
export type Cents = bigint;

export type NearNetwork = "testnet" | "mainnet";

export interface MainnetSafetyConfig {
  allowMainnet: boolean;
  confirmationPhrase?: string;
  maxSinglePaymentCents?: Cents;
  maxTotalBudgetCents?: Cents;
}

export interface Mandate {
  id: string;
  goal: string;
  totalBudget: Cents;
  perAgentCap: Cents;
  allowedRecipients: string[]; // NEAR account ids
  allowedAsset: "NEAR";
  maxRetries: number;
  status: "active" | "closed";
}

export type TaskStatus = "pending" | "submitted" | "verified" | "rejected" | "paid";

export interface Task {
  id: string;
  mandateId: string;
  role: "researcher" | "analyst" | "verifier";
  agentAccount: string;
  description: string;
  status: TaskStatus;
  retries: number;
  evidence: string[];
}

export interface PaymentRequest {
  mandateId: string;
  taskId: string;
  recipient: string;
  amount: Cents;
  asset: string;
  proposedBy: string; // agent or model that proposed it (never self-approving)
}

export interface SpendState {
  totalSpent: Cents;
  spentByRecipient: Record<string, Cents>;
}

export type DenyCode =
  | "MANDATE_NOT_ACTIVE"
  | "INVALID_AMOUNT"
  | "ASSET_NOT_ALLOWED"
  | "RECIPIENT_NOT_ALLOWED"
  | "TASK_NOT_VERIFIED"
  | "TASK_ALREADY_PAID"
  | "TOTAL_BUDGET_EXCEEDED"
  | "PER_AGENT_CAP_EXCEEDED"
  | "RETRY_LIMIT_EXCEEDED";

export interface Decision {
  allowed: boolean;
  reasons: { code: DenyCode; message: string }[];
}
