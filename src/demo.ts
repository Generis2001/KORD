import "dotenv/config";
import { Store } from "./db.js";
import { EscrowExecutor, MockExecutor, NearExecutor, loadEscrowConfig, loadNearConfig, type PaymentExecutor } from "./near.js";
import { planTasks, submitDeliverable } from "./orchestrator.js";
import { requestPayment } from "./treasury.js";
import { formatCents } from "./policy.js";
import type { Mandate } from "./types.js";

const mode = process.env.DEMO_EXECUTOR ?? "mock"; // mock | near | escrow
const useNear = mode === "near" || mode === "escrow";
const executor: PaymentExecutor =
  mode === "escrow" ? new EscrowExecutor(loadEscrowConfig()) : mode === "near" ? new NearExecutor(loadNearConfig()) : new MockExecutor();

const agents = {
  researcher: process.env.AGENT_RESEARCHER ?? "researcher.testnet",
  analyst: process.env.AGENT_ANALYST ?? "analyst.testnet",
  verifier: process.env.AGENT_VERIFIER ?? "verifier.testnet",
};

console.log(`\nMandate demo | executor: ${executor.label}`);
if (!useNear) console.log("NOTE: mock mode. No blockchain activity. Set DEMO_EXECUTOR=near (plain transfers) or escrow (contract) for a real testnet run.\n");

const store = new Store(process.env.MANDATE_DB ?? ":memory:");
const mandate: Mandate = {
  // In escrow mode this must match the mandate created onchain by scripts/escrow-setup.ts.
  id: process.env.MANDATE_ID ?? (mode === "escrow" ? "demo-1" : `m-${Date.now()}`),
  goal: "Research the top five competitors in the stablecoin payments market.",
  totalBudget: 2000n, // $20.00 logical
  perAgentCap: 500n, // $5.00 per agent
  allowedRecipients: [agents.researcher, agents.analyst, agents.verifier],
  allowedAsset: "NEAR",
  maxRetries: 2,
  status: "active",
};
store.createMandate(mandate);
const tasks = planTasks(mandate, agents);
tasks.forEach((t) => store.createTask(t));

const goodReport =
  "Competitor report. Pricing: Provider A charges 0.5% per transfer, Provider B a flat fee. " +
  "Target customers: cross-border merchants and payroll platforms. " +
  "Competitive advantage: Provider A has the widest corridor coverage; Provider B settles fastest. ".repeat(2);

async function step(title: string, fn: () => Promise<unknown>) {
  console.log(`\n== ${title}`);
  await fn();
}
const show = (o: Awaited<ReturnType<typeof requestPayment>>) => {
  console.log(`   result: ${o.status.toUpperCase()}${o.txHash ? ` tx=${o.txHash}` : ""}${o.onchain ? " (onchain)" : ""}`);
  o.decision.reasons.forEach((r) => console.log(`   reason: ${r.code}: ${r.message}`));
};

await step("Researcher submits a deliverable (rule-based verification)", async () => {
  const r = submitDeliverable(store, tasks[0].id, goodReport, ["https://example.com/a", "https://example.com/b"]);
  console.log(`   verification: ${r.passed ? "PASSED" : "FAILED " + r.problems.join(", ")}`);
});

await step("Pay researcher $4.00 (inside policy)", async () => {
  show(await requestPayment(store, executor, { mandateId: mandate.id, taskId: tasks[0].id, recipient: agents.researcher, amount: 400n, asset: "NEAR", proposedBy: "orchestrator" }));
});

await step("ATTACK: analyst requests $8.00 (above $5 cap, no verified work)", async () => {
  show(await requestPayment(store, executor, { mandateId: mandate.id, taskId: tasks[1].id, recipient: agents.analyst, amount: 800n, asset: "NEAR", proposedBy: "analyst-agent" }));
});

await step("ATTACK: payment to an address not on the allowlist", async () => {
  show(await requestPayment(store, executor, { mandateId: mandate.id, taskId: tasks[1].id, recipient: "attacker.testnet", amount: 100n, asset: "NEAR", proposedBy: "analyst-agent" }));
});

const spend = store.getSpendState(mandate.id);
console.log(`\nBudget: spent ${formatCents(spend.totalSpent)} of ${formatCents(mandate.totalBudget)}; remaining ${formatCents(mandate.totalBudget - spend.totalSpent)}`);
console.log("\nPayments:");
console.table(store.listPayments(mandate.id).map((p) => ({ id: p.id, to: p.recipient, amount: formatCents(p.amount), status: p.status, onchain: p.onchain, tx: p.txHash ?? "-" })));
