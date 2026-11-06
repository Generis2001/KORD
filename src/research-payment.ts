import { units } from './agent-wallet.js';

/** Fees are explicit testnet NEAR authorizations, never inferred from a dollar budget. */
export function researchPaymentRequest(goal: string) {
  const match = goal.match(/(?:^|[;,\n]|\.(?=\s)|\band\s+)\s*(?:escrow\s+((?:0|[1-9]\d*)(?:\.\d{1,24})?)\s+(?:testnet\s+)?NEAR\s+to\s+([a-z0-9._-]+)|(?:research\s+fee|(?:charge|authorize)\s+(?:a\s+|the\s+)?research\s+fee(?:\s+of)?)\s+((?:0|[1-9]\d*)(?:\.\d{1,24})?)\s+(?:testnet\s+)?NEAR(?:\s+to\s+([a-z0-9._-]+))?|pay\s+((?:0|[1-9]\d*)(?:\.\d{1,24})?)\s+(?:testnet\s+)?NEAR\s+for\s+research(?:\s+to\s+([a-z0-9._-]+))?)\s*[.!]?\s*$/i);
  if (!match) return null;
  const amount = match[1] || match[3] || match[5];
  const recipient = (match[2] || match[4] || match[6] || process.env.AGENT_RESEARCHER || 'mandate-generis-researcher.testnet').replace(/\.$/, '');
  const researchGoal = goal.slice(0, match.index).trim();
  const ceiling = researchGoal.match(/(?:spend(?:\s+up\s+to)?|budget(?:\s+of)?|no more than|up to)\s*((?:0|[1-9]\d*)(?:\.\d{1,24})?)\s+(?:testnet\s+)?NEAR/i)?.[1];
  const perAgentCap = researchGoal.match(/per[- ]agent\s+cap(?:\s+of)?\s*((?:0|[1-9]\d*)(?:\.\d{1,24})?)\s+(?:testnet\s+)?NEAR/i)?.[1];
  let problem = '';
  try {
    const payment = units(amount, 24);
    if (researchGoal.length < 4) problem = 'State the research question before authorizing its fee.';
    if (/research\s+fee\s+(?:of\s+)?\d|pay\s+\d+(?:\.\d+)?\s+(?:testnet\s+)?NEAR\s+for\s+research/i.test(researchGoal)) problem = 'Use one explicit research fee per mandate.';
    if (ceiling && payment > units(ceiling, 24)) problem = 'Research fee exceeds the authorized NEAR budget.';
    if (perAgentCap && payment > units(perAgentCap, 24)) problem = 'Research fee exceeds the per-agent NEAR cap.';
  } catch (error: any) { problem = error.message; }
  return { amount, recipient, researchGoal, ceiling, perAgentCap, problem };
}
