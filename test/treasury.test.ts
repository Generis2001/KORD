import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/db.js";
import { MockExecutor } from "../src/near.js";
import { planTasks, submitDeliverable } from "../src/orchestrator.js";
import { requestPayment } from "../src/treasury.js";
import type { Mandate, Task } from "../src/types.js";

const agents = { researcher: "r.testnet", analyst: "a.testnet", verifier: "v.testnet" };
const report =
  "Pricing: A charges 0.5%. Target customers: merchants and payroll platforms. Competitive advantage: broad corridor coverage and fast settlement across many regions. ".repeat(2);
let store: Store, exec: MockExecutor, mandate: Mandate, tasks: Task[];

beforeEach(() => {
  store = new Store();
  exec = new MockExecutor();
  mandate = { id: "m1", goal: "g", totalBudget: 2000n, perAgentCap: 500n, allowedRecipients: Object.values(agents), allowedAsset: "NEAR", maxRetries: 2, status: "active" };
  store.createMandate(mandate);
  tasks = planTasks(mandate, agents);
  tasks.forEach((t) => store.createTask(t));
});
const pay = (i: number, who: string, amount: bigint) =>
  requestPayment(store, exec, { mandateId: "m1", taskId: tasks[i].id, recipient: who, amount, asset: "NEAR", proposedBy: "test" });

describe("treasury flow", () => {
  it("pays a verified task and marks it paid, flagged not-onchain for the mock", async () => {
    submitDeliverable(store, tasks[0].id, report, ["e1", "e2"]);
    const o = await pay(0, agents.researcher, 400n);
    expect(o.status).toBe("confirmed");
    expect(o.onchain).toBe(false);
    expect(o.txHash).toBeNull();
    expect(store.getTask(tasks[0].id).status).toBe("paid");
    expect(store.getSpendState("m1").totalSpent).toBe(400n);
  });
  it("rejects unauthorized payments without calling the executor", async () => {
    const o = await pay(1, agents.analyst, 800n);
    expect(o.status).toBe("denied");
    expect(exec.calls).toHaveLength(0);
    expect(store.getSpendState("m1").totalSpent).toBe(0n);
    expect(store.auditLog("m1").some((e) => e.event === "PAYMENT_DENIED")).toBe(true);
  });
  it("rejects weak deliverables and increments retries", () => {
    const r = submitDeliverable(store, tasks[0].id, "too short", []);
    expect(r.passed).toBe(false);
    expect(store.getTask(tasks[0].id).status).toBe("rejected");
    expect(store.getTask(tasks[0].id).retries).toBe(1);
  });
  it("cannot pay the same task twice", async () => {
    submitDeliverable(store, tasks[0].id, report, ["e1", "e2"]);
    await pay(0, agents.researcher, 400n);
    const again = await pay(0, agents.researcher, 100n);
    expect(again.status).toBe("denied");
    expect(again.decision.reasons.map((r) => r.code)).toContain("TASK_ALREADY_PAID");
  });
  it("a failed execution releases the reserved budget and leaves the task payable", async () => {
    submitDeliverable(store, tasks[0].id, report, ["e1", "e2"]);
    exec.failNext = true;
    const o = await pay(0, agents.researcher, 400n);
    expect(o.status).toBe("failed");
    expect(store.getSpendState("m1").totalSpent).toBe(0n);
    expect(store.getTask(tasks[0].id).status).toBe("verified");
    expect((await pay(0, agents.researcher, 400n)).status).toBe("confirmed");
  });
  it("concurrent requests cannot overspend the per-agent cap", async () => {
    submitDeliverable(store, tasks[0].id, report, ["e1", "e2"]);
    const results = await Promise.all([pay(0, agents.researcher, 400n), pay(0, agents.researcher, 400n)]);
    expect(results.filter((r) => r.status === "confirmed")).toHaveLength(1);
    expect(store.getSpendState("m1").totalSpent).toBeLessThanOrEqual(500n);
  });
  it("budget never goes negative across many requests", async () => {
    const m2: Mandate = { ...mandate, id: "m2", totalBudget: 700n, perAgentCap: 700n };
    store.createMandate(m2);
    const ts = planTasks(m2, agents);
    ts.forEach((t) => store.createTask(t));
    for (const t of ts) submitDeliverable(store, t.id, report, ["e1", "e2"]);
    for (const t of ts) await requestPayment(store, exec, { mandateId: "m2", taskId: t.id, recipient: t.agentAccount, amount: 300n, asset: "NEAR", proposedBy: "test" });
    expect(store.getSpendState("m2").totalSpent).toBeLessThanOrEqual(700n);
  });
});
