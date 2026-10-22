import type { Store } from "./db.js";
import type { Mandate, Task } from "./types.js";

/** Rule-based verifier. Deterministic: no model is involved in verification. */
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
  for (const s of rubric.requiredSections) {
    if (!lower.includes(s.toLowerCase())) problems.push(`missing section: ${s}`);
  }
  return { passed: problems.length === 0, problems };
}

/** Dynamic task plan tailored to the mandate's procurement or market goal. */
export function planTasks(mandate: Mandate, agents: { researcher: string; analyst: string; verifier: string }): Task[] {
  const isProcurement = /chair|supplier|procure|vendor|office|equipment/i.test(mandate.goal);
  const mk = (role: Task["role"], agentAccount: string, description: string): Task => ({
    id: `${mandate.id}-${role}`, mandateId: mandate.id, role, agentAccount, description, status: "pending", retries: 0, evidence: [],
  });

  if (isProcurement) {
    return [
      mk("researcher", agents.researcher, "Identify 3 verified commercial suppliers for 100 office chairs, gather volume quotes, delivery terms, lead times, and warranty specs with evidence links."),
      mk("analyst", agents.analyst, "Compare quotations, freight terms, bulk discount tiers, delivery logistics, and prepare an executive procurement recommendation."),
      mk("verifier", agents.verifier, "Audit research deliverable against verification rubric: verify 3 suppliers, 100-unit volume quotes, freight terms, and evidence sources."),
    ];
  }

  return [
    mk("researcher", agents.researcher, "Gather pricing and market data with verified sources."),
    mk("analyst", agents.analyst, "Compare findings and evaluate competitive advantages."),
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
