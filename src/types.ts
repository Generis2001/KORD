/** Legacy policy amounts use integer logical cents. Wallet and escrow transfers use atomic token units. */
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
  allowedServices?: string[];
  restrictedActions?: Array<{ action: string; requiresApproval: boolean; reason: string }>;
  maxRetries: number;
  status: "active" | "closed";
}

export type TaskStatus = "pending" | "submitted" | "verified" | "rejected" | "paid" | "completed" | "blocked";

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
  actionType?: "research_service" | "purchase_order" | "disbursement" | "general_service";
  serviceName?: string;
  description?: string;
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
  | "RETRY_LIMIT_EXCEEDED"
  | "RESTRICTED_ACTION_PROHIBITED"
  | "UNAPPROVED_SERVICE";

export interface Decision {
  allowed: boolean;
  reasons: { code: DenyCode; message: string }[];
}
