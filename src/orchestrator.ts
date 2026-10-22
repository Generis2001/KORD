import type { Store } from "./db.js";
import type { Mandate, Task } from "./types.js";

/** Rule-based verifier. Labeled as deterministic: no model is involved in verification. */
export interface Rubric {
  minLength: number;
  minEvidence: number;
  requiredSections: string[];
}

export const DEFAULT_RUBRIC: Rubric = {
  minLength: 200,
  minEvidence: 2,
  requiredSections: ["pricing", "target customers", "advantage"],
};

export function verifyDeliverable(content: string, evidence: string[], rubric: Rubric = DEFAULT_RUBRIC) {
  const problems: string[] = [];
  const lower = content.toLowerCase();
  if (content.length < rubric.minLength) problems.push(`content shorter than ${rubric.minLength} characters`);
  if (evidence.filter((e) => e.trim().length > 0).length < rubric.minEvidence) problems.push(`needs at least ${rubric.minEvidence} evidence items`);
  for (const s of rubric.requiredSections) if (!lower.includes(s)) problems.push(`missing section: ${s}`);
  return { passed: problems.length === 0, problems };
}

/** Deterministic task plan: one task per role. A model may later enrich descriptions, never budgets. */
export function planTasks(mandate: Mandate, agents: { researcher: string; analyst: string; verifier: string }): Task[] {
  const mk = (role: Task["role"], agentAccount: string, description: string): Task => ({
    id: `${mandate.id}-${role}`, mandateId: mandate.id, role, agentAccount, description, status: "pending", retries: 0, evidence: [],
  });
  return [
    mk("researcher", agents.researcher, "Gather pricing and target-customer data with sources."),
    mk("analyst", agents.analyst, "Compare findings and identify each competitor's advantage."),
    mk("verifier", agents.verifier, "Check the final report against the acceptance rubric."),
  ];
}

export function submitDeliverable(store: Store, taskId: string, content: string, evidence: string[], rubric: Rubric = DEFAULT_RUBRIC) {
  const task = store.getTask(taskId);
  store.updateTask(taskId, { status: "submitted", evidence });
  const result = verifyDeliverable(content, evidence, rubric);
  if (result.passed) {
    store.updateTask(taskId, { status: "verified" });
    store.audit(task.mandateId, "TASK_VERIFIED", { taskId, verifier: "rule-based" });
  } else {
    store.updateTask(taskId, { status: "rejected", retries: task.retries + 1 });
    store.audit(task.mandateId, "TASK_REJECTED", { taskId, problems: result.problems, verifier: "rule-based" });
  }
  return result;
}
