import { createHash } from "node:crypto";
import type { Store } from "./db.js";
import type { PaymentExecutor } from "./near.js";
import { evaluatePayment } from "./policy.js";
import type { Decision, PaymentRequest } from "./types.js";

export interface PaymentOutcome {
  decision: Decision;
  status: "denied" | "confirmed" | "failed";
  paymentId: number;
  txHash: string | null;
  onchain: boolean;
}

/**
 * The only path to spending. A model or agent can only submit a PaymentRequest;
 * this function authorizes it deterministically, reserves the budget atomically,
 * then executes. The agent never touches the signing key.
 */
export async function requestPayment(store: Store, executor: PaymentExecutor, req: PaymentRequest): Promise<PaymentOutcome> {
  // 1. Authorize and reserve in one atomic step so concurrent requests cannot overspend.
  const reserved = store.atomic(() => {
    const mandate = store.getMandate(req.mandateId);
    const task = store.getTask(req.taskId);
    const state = store.getSpendState(req.mandateId);
    const decision = evaluatePayment(mandate, state, task, req);

    if (!decision.allowed) {
      const id = store.recordPayment({
        mandateId: req.mandateId, taskId: req.taskId, recipient: req.recipient, amount: req.amount,
        status: "denied", onchain: false, network: null, txHash: null,
        note: decision.reasons.map((r) => `${r.code}: ${r.message}`).join(" | "),
      });
      store.audit(req.mandateId, "PAYMENT_DENIED", { paymentId: id, proposedBy: req.proposedBy, amount: req.amount.toString(), reasons: decision.reasons });
      return { decision, id };
    }
    const id = store.recordPayment({
      mandateId: req.mandateId, taskId: req.taskId, recipient: req.recipient, amount: req.amount,
      status: "pending", onchain: false, network: null, txHash: null, note: "authorized; awaiting execution",
    });
    store.audit(req.mandateId, "PAYMENT_AUTHORIZED", { paymentId: id, proposedBy: req.proposedBy, amount: req.amount.toString(), recipient: req.recipient });
    return { decision, id };
  });

  if (!reserved.decision.allowed) {
    return { decision: reserved.decision, status: "denied", paymentId: reserved.id, txHash: null, onchain: false };
  }

  // 2. Execute outside the DB transaction (network call).
  try {
    const task = store.getTask(req.taskId);
    const evidenceHash = createHash("sha256").update(JSON.stringify(task.evidence)).digest("hex");
    const result = await executor.execute({
      recipient: req.recipient, amountCents: req.amount, mandateId: req.mandateId, taskId: req.taskId, evidenceHash,
    });
    store.updatePayment(reserved.id, {
      status: "confirmed", onchain: result.onchain, network: result.network, txHash: result.txHash,
      note: result.onchain ? "confirmed onchain" : `executed via ${executor.label}`,
    });
    store.updateTask(req.taskId, { status: "paid" });
    store.audit(req.mandateId, "PAYMENT_CONFIRMED", { paymentId: reserved.id, network: result.network, txHash: result.txHash, onchain: result.onchain });
    return { decision: reserved.decision, status: "confirmed", paymentId: reserved.id, txHash: result.txHash, onchain: result.onchain };
  } catch (e) {
    // Failed payments release the reserved budget (failed rows are not counted as spend).
    store.updatePayment(reserved.id, { status: "failed", onchain: false, network: null, txHash: null, note: String((e as Error).message) });
    store.audit(req.mandateId, "PAYMENT_FAILED", { paymentId: reserved.id, error: String((e as Error).message) });
    return { decision: reserved.decision, status: "failed", paymentId: reserved.id, txHash: null, onchain: false };
  }
}
