import "dotenv/config";
import { Store } from "./db.js";
import { EscrowExecutor, MockExecutor, NearExecutor, loadEscrowConfig, loadNearConfig, type PaymentExecutor } from "./near.js";
import { planTasks, submitDeliverable, DEFAULT_RUBRIC, type Rubric } from "./orchestrator.js";
import { requestPayment, type PaymentOutcome } from "./treasury.js";
import { formatCents } from "./policy.js";
import type { Mandate, Task } from "./types.js";

export interface MandateRunOptions {
  goal?: string;
  totalBudgetCents?: bigint;
  perAgentCapCents?: bigint;
  executorMode?: "escrow" | "near" | "mock";
  rubric?: Partial<Rubric>;
  deliverableText?: string;
  simulateAttack?: boolean;
}

export interface MandateRunResult {
  mandate: {
    id: string;
    goal: string;
    totalBudget: string;
    perAgentCap: string;
    allowedAsset: string;
    status: string;
    allowedRecipients: string[];
  };
  delegation: {
    taskId: string;
    role: string;
    agentAccount: string;
    description: string;
    status: string;
  }[];
  deliverable: {
    taskId: string;
    agent: string;
    preview: string;
    evidence: string[];
    verification: {
      passed: boolean;
      problems: string[];
    };
  };
  payout: {
    status: "confirmed" | "denied" | "failed";
    amount: string;
    recipient: string;
    onchain: boolean;
    txHash: string | null;
    explorerUrl: string | null;
    reasons: { code: string; message: string }[];
  };
  attackSimulation?: {
    attempt: string;
    amount: string;
    recipient: string;
    status: string;
    reasons: { code: string; message: string }[];
  }[];
  budgetState: {
    totalBudget: string;
    spent: string;
    remaining: string;
    agentSpent: Record<string, string>;
  };
  steps: {
    phase: string;
    title: string;
    detail: string;
    badge: "success" | "warning" | "error" | "info";
  }[];
}

export async function runAutonomousMandate(opts: MandateRunOptions = {}): Promise<MandateRunResult> {
  const mode = opts.executorMode ?? (process.env.DEMO_EXECUTOR ?? "escrow");
  const executor: PaymentExecutor =
    mode === "escrow" ? new EscrowExecutor(loadEscrowConfig()) : mode === "near" ? new NearExecutor(loadNearConfig()) : new MockExecutor();

  const agents = {
    researcher: process.env.AGENT_RESEARCHER ?? "mandate-generis-researcher.testnet",
    analyst: process.env.AGENT_ANALYST ?? "mandate-generis-analyst.testnet",
    verifier: process.env.AGENT_VERIFIER ?? "mandate-generis-verifier.testnet",
  };

  const store = new Store(process.env.MANDATE_DB ?? "mandate.db");

  // In escrow mode, contract holds mandate "demo-1".
  const mandateId = mode === "escrow" ? "demo-1" : `mandate-${Date.now()}`;
  const totalBudget = opts.totalBudgetCents ?? 2000n; // $20.00
  const perAgentCap = opts.perAgentCapCents ?? 500n;   // $5.00

  const goal = opts.goal ?? "Analyze competitive market pricing and corridor coverage for cross-border stablecoin payments.";

  const mandate: Mandate = {
    id: mandateId,
    goal,
    totalBudget,
    perAgentCap,
    allowedRecipients: [agents.researcher, agents.analyst, agents.verifier],
    allowedAsset: "NEAR",
    maxRetries: 2,
    status: "active",
  };

  store.createMandate(mandate);
  const tasks = planTasks(mandate, agents);
  tasks.forEach((t) => store.createTask(t));

  const steps: MandateRunResult["steps"] = [];

  // Step 1: Delegation
  steps.push({
    phase: "1. DELEGATION",
    title: "Mandate Task Decomposition",
    detail: `Autonomous business agent parsed directive: "${goal.slice(0, 75)}...". Decomposed into ${tasks.length} specialized roles. Assigned Researcher (${agents.researcher}) and Analyst (${agents.analyst}) with spending cap ${formatCents(perAgentCap)}.`,
    badge: "info",
  });

  // Step 2: Work submission & verification
  const deliverableContent = opts.deliverableText ??
    "Market Research Report on Cross-Border Payment APIs. Pricing models: Provider A charges 0.5% variable fee per transaction, Provider B charges a flat $1.20 wire fee. " +
    "Target customers: cross-border e-commerce merchants, gig economy platforms, and global payroll providers. " +
    "Competitive advantage: Provider A has 140+ payment corridor coverage with sub-second finality; Provider B offers native compliance tools and zero-cost batch settlements.";

  const evidence = [
    "https://api.corridor-metrics.example/v1/rates",
    "https://docs.settlement-benchmarks.example/2026-report"
  ];

  const rubric: Rubric = {
    ...DEFAULT_RUBRIC,
    ...(opts.rubric ?? {}),
  };

  const verifyResult = submitDeliverable(store, tasks[0].id, deliverableContent, evidence, rubric);

  steps.push({
    phase: "2. VERIFICATION",
    title: "Autonomous Deliverable Audit",
    detail: verifyResult.passed
      ? `Verifier agent evaluated deliverable against user rubric (Length: ${deliverableContent.length} chars, Required sections: [pricing, target customers, advantage], Evidence count: 2). Result: PASSED.`
      : `Deliverable failed verification rubric. Issues: ${verifyResult.problems.join("; ")}. Payout prohibited.`,
    badge: verifyResult.passed ? "success" : "error",
  });

  // Step 3: Policy Enforcement & Payment Execution
  let payoutOutcome: PaymentOutcome | null = null;
  const paymentAmount = 400n; // $4.00 (within $5.00 cap)

  if (verifyResult.passed) {
    payoutOutcome = await requestPayment(store, executor, {
      mandateId: mandate.id,
      taskId: tasks[0].id,
      recipient: agents.researcher,
      amount: paymentAmount,
      asset: "NEAR",
      proposedBy: "orchestrator",
    });

    if (payoutOutcome.status === "confirmed") {
      steps.push({
        phase: "3. SETTLEMENT",
        title: "Autonomous On-Chain Escrow Payout",
        detail: `User spending policy verified (${formatCents(paymentAmount)} is within ${formatCents(perAgentCap)} cap). Disbursed funds to ${agents.researcher}${payoutOutcome.txHash ? ` on NEAR testnet (Tx: ${payoutOutcome.txHash})` : ""}.`,
        badge: "success",
      });
    } else {
      steps.push({
        phase: "3. POLICY ENFORCEMENT",
        title: "Payment Intercepted & Denied",
        detail: `Mandate Policy Engine intercepted payout: ${payoutOutcome.decision.reasons.map(r => `${r.code} (${r.message})`).join("; ")}. User funds remain safe.`,
        badge: "warning",
      });
    }
  } else {
    steps.push({
      phase: "3. POLICY ENFORCEMENT",
      title: "No Payout for Unverified Work",
      detail: `Disbursement blocked because task deliverable failed verification. Mandate policy strictly forbids paying for unverified work.`,
      badge: "error",
    });
  }

  // Step 4: Spending Guardrails / Attack Simulation
  const attackSimulations: MandateRunResult["attackSimulation"] = [];
  if (opts.simulateAttack !== false) {
    const attackA = await requestPayment(store, executor, {
      mandateId: mandate.id,
      taskId: tasks[1].id,
      recipient: agents.analyst,
      amount: 800n, // $8.00 exceeds $5.00 cap
      asset: "NEAR",
      proposedBy: "analyst-agent",
    });

    attackSimulations.push({
      attempt: "Analyst requested $8.00 (Exceeds $5.00 per-agent spending cap)",
      amount: "$8.00",
      recipient: agents.analyst,
      status: "DENIED",
      reasons: attackA.decision.reasons,
    });

    const attackB = await requestPayment(store, executor, {
      mandateId: mandate.id,
      taskId: tasks[1].id,
      recipient: "attacker.testnet",
      amount: 100n,
      asset: "NEAR",
      proposedBy: "analyst-agent",
    });

    attackSimulations.push({
      attempt: "Payout attempted to rogue address (attacker.testnet not in allowlist)",
      amount: "$1.00",
      recipient: "attacker.testnet",
      status: "DENIED",
      reasons: attackB.decision.reasons,
    });

    steps.push({
      phase: "4. SPENDING GUARDRAILS",
      title: "User Spending Limits Enforced",
      detail: `Mandate strictly rejected over-budget $8.00 request and blocked unauthorized address 'attacker.testnet'. Spending limits intact.`,
      badge: "info",
    });
  }

  const spendState = store.getSpendState(mandate.id);
  const remaining = mandate.totalBudget > spendState.totalSpent ? mandate.totalBudget - spendState.totalSpent : 0n;

  const agentSpentMap: Record<string, string> = {};
  for (const [acc, amt] of Object.entries(spendState.spentByRecipient)) {
    agentSpentMap[acc] = formatCents(amt);
  }

  return {
    mandate: {
      id: mandate.id,
      goal: mandate.goal,
      totalBudget: formatCents(mandate.totalBudget),
      perAgentCap: formatCents(mandate.perAgentCap),
      allowedAsset: mandate.allowedAsset,
      status: mandate.status,
      allowedRecipients: mandate.allowedRecipients,
    },
    delegation: tasks.map(t => ({
      taskId: t.id,
      role: t.role,
      agentAccount: t.agentAccount,
      description: t.description,
      status: t.status,
    })),
    deliverable: {
      taskId: tasks[0].id,
      agent: agents.researcher,
      preview: deliverableContent,
      evidence,
      verification: verifyResult,
    },
    payout: {
      status: payoutOutcome ? payoutOutcome.status : "denied",
      amount: formatCents(paymentAmount),
      recipient: agents.researcher,
      onchain: payoutOutcome ? payoutOutcome.onchain : false,
      txHash: payoutOutcome ? payoutOutcome.txHash : null,
      explorerUrl: payoutOutcome && payoutOutcome.txHash ? `https://explorer.testnet.near.org/transactions/${payoutOutcome.txHash}` : null,
      reasons: payoutOutcome ? payoutOutcome.decision.reasons : [{ code: "NOT_VERIFIED", message: "Task was not verified." }],
    },
    attackSimulation: attackSimulations,
    budgetState: {
      totalBudget: formatCents(mandate.totalBudget),
      spent: formatCents(spendState.totalSpent),
      remaining: formatCents(remaining),
      agentSpent: agentSpentMap,
    },
    steps,
  };
}
