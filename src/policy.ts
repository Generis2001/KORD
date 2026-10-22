import type { Decision, DenyCode, Mandate, PaymentRequest, SpendState, Task } from "./types.js";

const fmt = (c: bigint) => `$${(c / 100n).toString()}.${(c % 100n).toString().padStart(2, "0")}`;

/**
 * Deterministic payment authorization. Pure function: no I/O, no model calls.
 * Every rule that fails is reported, so the audit log shows all reasons.
 */
export function evaluatePayment(
  mandate: Mandate,
  state: SpendState,
  task: Task,
  req: PaymentRequest,
): Decision {
  const reasons: Decision["reasons"] = [];
  const deny = (code: DenyCode, message: string) => reasons.push({ code, message });

  if (mandate.status !== "active") deny("MANDATE_NOT_ACTIVE", "Mandate is closed.");
  if (req.amount <= 0n) deny("INVALID_AMOUNT", "Amount must be a positive integer number of cents.");
  if (req.asset !== mandate.allowedAsset)
    deny("ASSET_NOT_ALLOWED", `Asset ${req.asset} is not permitted (allowed: ${mandate.allowedAsset}).`);
  if (!mandate.allowedRecipients.includes(req.recipient))
    deny("RECIPIENT_NOT_ALLOWED", `Recipient ${req.recipient} is not on the mandate allowlist.`);
  if (task.mandateId !== mandate.id || task.agentAccount !== req.recipient)
    deny("RECIPIENT_NOT_ALLOWED", "Recipient does not match the agent assigned to this task.");
  if (task.status === "paid") deny("TASK_ALREADY_PAID", "This task has already been paid.");
  else if (task.status !== "verified")
    deny("TASK_NOT_VERIFIED", `Task is "${task.status}"; payment requires a verified deliverable.`);
  if (task.retries > mandate.maxRetries)
    deny("RETRY_LIMIT_EXCEEDED", `Task used ${task.retries} retries (limit ${mandate.maxRetries}).`);

  const remaining = mandate.totalBudget - state.totalSpent;
  if (req.amount > remaining)
    deny("TOTAL_BUDGET_EXCEEDED", `Request ${fmt(req.amount)} exceeds remaining budget ${fmt(remaining < 0n ? 0n : remaining)}.`);

  const agentSpent = state.spentByRecipient[req.recipient] ?? 0n;
  if (agentSpent + req.amount > mandate.perAgentCap)
    deny(
      "PER_AGENT_CAP_EXCEEDED",
      `Paying ${fmt(req.amount)} would bring ${req.recipient} to ${fmt(agentSpent + req.amount)}, above the ${fmt(mandate.perAgentCap)} per-agent cap.`,
    );

  return { allowed: reasons.length === 0, reasons };
}

export { fmt as formatCents };
