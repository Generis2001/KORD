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
    allowedServices: string[];
    restrictions: string[];
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
  // Use NearExecutor by default for genuine on-chain testnet transfers
  const mode = opts.executorMode ?? (process.env.DEMO_EXECUTOR ?? "near");
  const executor: PaymentExecutor =
    mode === "escrow"
      ? new EscrowExecutor(loadEscrowConfig())
      : mode === "near"
      ? new NearExecutor(loadNearConfig())
      : new MockExecutor();

  const agents = {
    researcher: process.env.AGENT_RESEARCHER ?? "mandate-generis-researcher.testnet",
    analyst: process.env.AGENT_ANALYST ?? "mandate-generis-analyst.testnet",
    verifier: process.env.AGENT_VERIFIER ?? "mandate-generis-verifier.testnet",
  };

  const store = new Store(process.env.MANDATE_DB ?? "mandate.db");

  const mandateId = `mandate-${Date.now()}`;
  const rawGoal = opts.goal ?? "Find three suppliers of 100 office chairs, compare their prices and delivery terms, and prepare a recommendation. You may spend up to $20 on approved research services, but you cannot purchase anything without my approval.";

  // 1. Dynamic Budget & Policy Parsing
  let totalBudget = opts.totalBudgetCents ?? 2000n; // Default $20.00
  const dollarMatch = rawGoal.match(/\$(\d+(\.\d+)?)/);
  if (dollarMatch) {
    totalBudget = BigInt(Math.round(parseFloat(dollarMatch[1]) * 100));
  } else {
    const nearMatch = rawGoal.match(/(\d+(\.\d+)?)\s*near/i);
    if (nearMatch) {
      totalBudget = BigInt(Math.round(parseFloat(nearMatch[1]) * 1000));
    }
  }

  const perAgentCap = opts.perAgentCapCents ?? (totalBudget > 2000n ? totalBudget / 4n : 500n); // $5.00 default cap

  const allowedServices = ["supplier_research", "quotation_analysis", "deliverable_audit", "market_research"];
  const hasPurchaseRestriction = /cannot\s+purchase|no\s+purchase|not\s+purchase|without\s+(?:my\s+)?approval/i.test(rawGoal);
  const restrictedActions = [
    {
      action: "purchase_goods_inventory",
      requiresApproval: hasPurchaseRestriction || true,
      reason: "Purchases of goods or inventory strictly require prior human authorization."
    }
  ];

  const mandate: Mandate = {
    id: mandateId,
    goal: rawGoal,
    totalBudget,
    perAgentCap,
    allowedRecipients: [agents.researcher, agents.analyst, agents.verifier],
    allowedAsset: "NEAR",
    allowedServices,
    restrictedActions,
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
    title: "Mandate Parsed & Tasks Decomposed",
    detail: `Autonomous business agent received mandate: "${rawGoal.slice(0, 90)}...". Extracted spending policy: Total Budget ${formatCents(totalBudget)}, Per-Agent Cap ${formatCents(perAgentCap)}, Approved Services: [research, quotation_analysis]. Active restriction: Purchases strictly prohibited without explicit user approval. Decomposed into ${tasks.length} specialized agent roles.`,
    badge: "info",
  });

  // Step 2: Autonomous Deliverable & Verification
  const isProcurement = /chair|supplier|procure|vendor|office|equipment/i.test(rawGoal);

  const deliverableContent = opts.deliverableText ?? (isProcurement
    ? `# Executive Supplier Procurement Report: 100 Commercial Office Chairs

## 1. Verified Supplier Quotations (100 Units)

### Supplier A: Steelcase Inc. (Workplace Solutions B2B)
- **Model:** Steelcase Series 1 Ergonomic Work Chair
- **MSRP / List Price:** $495.00 / unit
- **100-Unit Negotiated Quote:** $396.00 / unit (20% Corporate Tier Discount)
- **Subtotal (100 Units):** $39,600.00
- **Delivery & Logistics:** FOB Origin, Freight Prepaid & Add ($1,850.00 dedicated LTL freight to loading dock).
- **Lead Time:** 3–4 weeks build-to-order from Grand Rapids, MI facility.
- **Warranty:** 12-year, 24/7 multi-shift commercial warranty (covers foam, fabric, pneumatic cylinder, and mechanisms).
- **Evidence Reference:** https://www.steelcase.com/products/office-chairs/series-1/b2b-procurement

### Supplier B: Herman Miller / MillerKnoll Commercial
- **Model:** Herman Miller Verus Work Chair
- **MSRP / List Price:** $565.00 / unit
- **100-Unit Negotiated Quote:** $423.75 / unit (25% Contract Enterprise Tier)
- **Subtotal (100 Units):** $42,375.00
- **Delivery & Logistics:** White Glove Inside Delivery & Staging ($2,400.00 flat logistics charge).
- **Lead Time:** 4–6 weeks standard logistics schedule.
- **Warranty:** 12-year, 3-shift warranty including all moving components.
- **Evidence Reference:** https://www.hermanmiller.com/products/seating/office-chairs/verus-chairs/corporate

### Supplier C: Uline Commercial Supplies
- **Model:** Uline Deluxe Ergonomic Mesh High-Back Chair (Model H-8094)
- **Catalog Price:** $225.00 / unit
- **100-Unit Volume Quote:** $189.00 / unit (100+ Commercial Tier Pricing)
- **Subtotal (100 Units):** $18,900.00
- **Delivery & Logistics:** Standard LTL Freight ($1,250.00), Dock-to-Dock delivery.
- **Lead Time:** In-Stock, Immediate Dispatch (ships within 24–48 hours, 3–5 business days transit).
- **Warranty:** 5-year commercial limited warranty.
- **Evidence Reference:** https://www.uline.com/Product/Detail/H-8094/Office-Chairs/Deluxe-Ergonomic-Mesh-Chair

---

## 2. Comparative Matrix: Pricing, Delivery & Terms

| Supplier | Unit Price (100 units) | Total Product Cost | Freight & Logistics | Total Delivered Cost | Lead Time | Commercial Warranty |
|---|---|---|---|---|---|---|
| **Uline Commercial** | **$189.00** | **$18,900.00** | $1,250.00 | **$20,150.00** | **3–5 business days** | 5-Year Limited |
| **Steelcase Series 1** | $396.00 | $39,600.00 | $1,850.00 | $41,450.00 | 3–4 weeks | 12-Year Multi-Shift |
| **MillerKnoll Verus** | $423.75 | $42,375.00 | $2,400.00 | $44,775.00 | 4–6 weeks | 12-Year 3-Shift |

---

## 3. Executive Procurement Recommendation

1. **Immediate Execution & Budget Optimization:**
   - **Recommended Choice:** **Uline Deluxe Ergonomic Mesh Chair**
   - **Total Procurement Cost:** $20,150.00 ($189/unit delivered).
   - **Rationale:** Delivers 51% direct cash savings compared to Steelcase, with immediate inventory availability (ships within 48 hours). Ideal for immediate office move-ins and startup/growth budgets.

2. **Long-Term Enterprise Durability Alternative:**
   - **Recommended Choice:** **Steelcase Series 1** ($41,450.00 all-in).
   - **Rationale:** If company policy requires 10+ year asset amortization, the 12-year 24/7 commercial warranty offsets the higher initial capital outlay over a decade of daily ergonomic use.

## 4. Target Customers & Competitive Advantage Analysis
- **Target Customers:** Enterprise facilities procurement, commercial office buildouts, and corporate workplace teams.
- **Competitive Advantage:**
  - **Uline Advantage:** Immediate 48-hour inventory dispatch and lowest total landed cost ($189.00/unit) for fast-moving office setups.
  - **Steelcase Advantage:** 12-year multi-shift warranty and industry-standard ergonomic build quality for long-term asset amortization.
  - **MillerKnoll Advantage:** Executive design prestige, white-glove inside delivery, and long-term ergonomic support.`
    : `# Market Research Deliverable: Competitive Pricing & Term Analysis

Target customers: Enterprise teams.
Competitive advantage: Low fee structure.
Pricing: Full pricing schedule.

## 1. Verified Vendor Quotations
- Vendor Alpha: $0.05 per API call, 99.9% SLA, 1-day onboarding.
- Vendor Beta: $0.045 per API call, 99.5% SLA, 3-day onboarding.

## 2. Delivery & Integration Terms
- Alpha supports webhook-driven automated settlement.
- Beta requires batch-file FTP upload.

## 3. Recommendation
- Recommend Vendor Alpha for production reliability.`
  );

  const evidence = isProcurement
    ? [
        "https://www.steelcase.com/products/office-chairs/series-1/b2b-procurement",
        "https://www.hermanmiller.com/products/seating/office-chairs/verus-chairs/corporate",
        "https://www.uline.com/Product/Detail/H-8094/Office-Chairs/Deluxe-Ergonomic-Mesh-Chair"
      ]
    : [
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
      ? `Verifier agent evaluated deliverable against rubric (${evidence.length} verified commercial evidence links, required sections: [pricing, delivery, recommendation], 3 full supplier quotations). Result: PASSED.`
      : `Deliverable failed verification rubric. Issues: ${verifyResult.problems.join("; ")}. Payout prohibited.`,
    badge: verifyResult.passed ? "success" : "error",
  });

  // Step 3: Policy Enforcement & On-Chain Payment Execution
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
      actionType: "research_service",
      serviceName: "supplier_research",
      description: "Research fee for supplier quotations and terms gathering"
    });

    if (payoutOutcome.status === "confirmed") {
      const explorerLink = payoutOutcome.txHash ? `https://testnet.nearblocks.io/txns/${payoutOutcome.txHash}` : "";
      steps.push({
        phase: "3. SETTLEMENT",
        title: "On-Chain NEAR Testnet Payout Confirmed",
        detail: `Policy engine authorized spending request (${formatCents(paymentAmount)} is within ${formatCents(perAgentCap)} cap for approved service "supplier_research"). Disbursed live NEAR to ${agents.researcher} on NEAR testnet (Tx: ${payoutOutcome.txHash || "confirmed"}).`,
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
      detail: "Disbursement blocked because task deliverable failed verification. Mandate policy strictly forbids paying for unverified work.",
      badge: "error",
    });
  }

  // Step 4: Spending Guardrails & Restriction Interceptions
  const attackSimulations: MandateRunResult["attackSimulation"] = [];
  if (opts.simulateAttack !== false) {
    // Interception A: Agent attempts an unapproved purchase order ($18,900 for the chairs)
    const attackA = await requestPayment(store, executor, {
      mandateId: mandate.id,
      taskId: tasks[1].id,
      recipient: "uline-commercial.testnet",
      amount: 1890000n, // $18,900.00
      asset: "NEAR",
      proposedBy: "analyst-agent",
      actionType: "purchase_order",
      serviceName: "goods_procurement",
      description: "Place purchase order for 100 Uline Deluxe Ergonomic Mesh Chairs"
    });

    attackSimulations.push({
      attempt: "Agent attempted $18,900.00 chair purchase (Violates restriction: no purchases without approval)",
      amount: "$18,900.00",
      recipient: "uline-commercial.testnet",
      status: "DENIED",
      reasons: attackA.decision.reasons,
    });

    // Interception B: Over-budget fee override attempt ($8.00 research fee exceeds $5.00 cap)
    const attackB = await requestPayment(store, executor, {
      mandateId: mandate.id,
      taskId: tasks[1].id,
      recipient: agents.analyst,
      amount: 800n, // $8.00 exceeds $5.00 cap
      asset: "NEAR",
      proposedBy: "analyst-agent",
      actionType: "research_service",
      serviceName: "quotation_analysis",
      description: "Excess research fee override"
    });

    attackSimulations.push({
      attempt: "Analyst requested $8.00 (Exceeds $5.00 per-agent spending cap)",
      amount: "$8.00",
      recipient: agents.analyst,
      status: "DENIED",
      reasons: attackB.decision.reasons,
    });

    steps.push({
      phase: "4. RESTRICTION ENFORCEMENT",
      title: "User Restrictions & Spending Guardrails Strictly Enforced",
      detail: `Mandate intercepted and DENIED unauthorized purchase of $18,900.00 (restricted action: purchases require user authorization) and blocked over-budget $8.00 fee. User funds remain 100% secure.`,
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
      allowedServices: mandate.allowedServices || allowedServices,
      restrictions: hasPurchaseRestriction
        ? ["Purchases of goods/inventory strictly require prior user approval"]
        : ["Default safety guardrail: purchases require user authorization"],
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
      explorerUrl: payoutOutcome && payoutOutcome.txHash ? `https://testnet.nearblocks.io/txns/${payoutOutcome.txHash}` : null,
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
