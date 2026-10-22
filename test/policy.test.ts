import { describe, expect, it } from "vitest";
import { evaluatePayment } from "../src/policy.js";
import type { Mandate, PaymentRequest, SpendState, Task } from "../src/types.js";

const mandate: Mandate = {
  id: "m1", goal: "g", totalBudget: 2000n, perAgentCap: 500n,
  allowedRecipients: ["a.testnet", "b.testnet"], allowedAsset: "NEAR", maxRetries: 2, status: "active",
};
const task = (over: Partial<Task> = {}): Task => ({
  id: "t1", mandateId: "m1", role: "researcher", agentAccount: "a.testnet", description: "d",
  status: "verified", retries: 0, evidence: [], ...over,
});
const req = (over: Partial<PaymentRequest> = {}): PaymentRequest => ({
  mandateId: "m1", taskId: "t1", recipient: "a.testnet", amount: 400n, asset: "NEAR", proposedBy: "x", ...over,
});
const empty: SpendState = { totalSpent: 0n, spentByRecipient: {} };
const codes = (d: ReturnType<typeof evaluatePayment>) => d.reasons.map((r) => r.code);

describe("policy engine", () => {
  it("allows a $4 payment for a verified task", () => {
    expect(evaluatePayment(mandate, empty, task(), req()).allowed).toBe(true);
  });
  it("denies $8 above the $5 per-agent cap", () => {
    const d = evaluatePayment(mandate, empty, task(), req({ amount: 800n }));
    expect(d.allowed).toBe(false);
    expect(codes(d)).toContain("PER_AGENT_CAP_EXCEEDED");
  });
  it("counts earlier spend toward the per-agent cap", () => {
    const d = evaluatePayment(mandate, { totalSpent: 400n, spentByRecipient: { "a.testnet": 400n } }, task(), req({ amount: 200n }));
    expect(codes(d)).toContain("PER_AGENT_CAP_EXCEEDED");
  });
  it("denies when total budget would be exceeded", () => {
    const d = evaluatePayment(mandate, { totalSpent: 1900n, spentByRecipient: {} }, task(), req({ amount: 200n }));
    expect(codes(d)).toContain("TOTAL_BUDGET_EXCEEDED");
  });
  it("denies recipients not on the allowlist", () => {
    const d = evaluatePayment(mandate, empty, task({ agentAccount: "evil.testnet" }), req({ recipient: "evil.testnet" }));
    expect(codes(d)).toContain("RECIPIENT_NOT_ALLOWED");
  });
  it("denies paying a different account than the task's agent", () => {
    const d = evaluatePayment(mandate, empty, task(), req({ recipient: "b.testnet" }));
    expect(codes(d)).toContain("RECIPIENT_NOT_ALLOWED");
  });
  it("denies unverified, rejected, and already-paid tasks", () => {
    expect(codes(evaluatePayment(mandate, empty, task({ status: "submitted" }), req()))).toContain("TASK_NOT_VERIFIED");
    expect(codes(evaluatePayment(mandate, empty, task({ status: "rejected" }), req()))).toContain("TASK_NOT_VERIFIED");
    expect(codes(evaluatePayment(mandate, empty, task({ status: "paid" }), req()))).toContain("TASK_ALREADY_PAID");
  });
  it("denies zero and negative amounts and wrong assets", () => {
    expect(codes(evaluatePayment(mandate, empty, task(), req({ amount: 0n })))).toContain("INVALID_AMOUNT");
    expect(codes(evaluatePayment(mandate, empty, task(), req({ amount: -5n })))).toContain("INVALID_AMOUNT");
    expect(codes(evaluatePayment(mandate, empty, task(), req({ asset: "USDC" })))).toContain("ASSET_NOT_ALLOWED");
  });
  it("denies when retry limit is exceeded and when mandate is closed", () => {
    expect(codes(evaluatePayment(mandate, empty, task({ retries: 3 }), req()))).toContain("RETRY_LIMIT_EXCEEDED");
    expect(codes(evaluatePayment({ ...mandate, status: "closed" }, empty, task(), req()))).toContain("MANDATE_NOT_ACTIVE");
  });
});
