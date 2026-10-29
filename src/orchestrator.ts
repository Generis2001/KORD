import type { Mandate, Task } from "./types.js";

/** Dynamic task plan tailored to the mandate's procurement or market goal. */
export function planTasks(mandate: Mandate, agents: { researcher: string; analyst: string; verifier: string }): Task[] {
  const mk = (role: Task["role"], agentAccount: string, description: string): Task => ({
    id: `${mandate.id}-${role}`, mandateId: mandate.id, role, agentAccount, description, status: "pending", retries: 0, evidence: [],
  });

  return [
    mk("researcher", agents.researcher, `Retrieve public source evidence for: ${mandate.goal}`),
    mk("analyst", agents.analyst, "Build comparisons from retrieved observations, calculate quantity estimates and identify missing commercial terms."),
    mk("verifier", agents.verifier, "Check source integrity, timestamps, subject coverage and calculation provenance; gate explicitly requested testnet escrow."),
  ];
}
