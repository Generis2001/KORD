import { randomUUID, createHash } from 'node:crypto';
import { Store } from './db.js';
import { planTasks } from './orchestrator.js';
import { analyzeResearch, researchNearMarket, researchPublicSources, verifyResearch, type ResearchResult, type ResearchSource } from './research.js';
import type { SourceLoader } from './public-sources.js';
import type { WalletOperation } from './wallet-store.js';
import type { EscrowRequest } from './escrow.js';
import type { Mandate } from './types.js';
import { researchPaymentRequest } from './research-payment.js';
import { decimal, units } from './agent-wallet.js';

export type MandateDomain = 'stablecoin_corridor' | 'procurement' | 'past_purchases' | 'general_market';
function nearMarketTopic(goal: string) {
  const near = /\bNEAR\b/.test(goal) || /\bnear\s+(?:protocol|token|prices?|market|network)\b|\bnear\s+(?:and|\/)\s+usdt\b|\busdt\s+(?:and|\/)\s+near\b|ref finance/i.test(goal);
  return near && /prices?|market|liquidity|\bdex\b|\bpools?\b|ref finance/i.test(goal) && !/cross.border|corridor|remittance|fiat/i.test(goal);
}
export function detectDomain(goal: string): MandateDomain {
  if (/past purchase|audit.*ledger|past transaction|previous spend/i.test(goal)) return 'past_purchases';
  if (/stablecoin|corridor|\busdt\b|ref finance|liquidity/i.test(goal) || nearMarketTopic(goal)) return 'stablecoin_corridor';
  if (/chair|laptop|equipment|supplier|vendor|procure|furniture/i.test(goal)) return 'procurement';
  return 'general_market';
}
export interface MandateRunOptions {
  id?: string; goal?: string; userAccount?: string; store?: Store; loadSource?: SourceLoader;
  ledger?: WalletOperation[];
  checkReceipt?: (operation: WalletOperation) => Promise<{ text: string; url: string }>;
  settleEscrow?: (request: EscrowRequest) => Promise<WalletOperation>;
  onProgress?: (step: MandateRunResult['steps'][number]) => void;
}
export interface MandateRunResult {
  mandate: { id: string; goal: string; requestedGoal: string; domain: string; totalBudget: string; perAgentCap: string; allowedAsset: string; status: string; allowedRecipients: string[]; allowedServices: string[]; restrictions: string[] };
  delegation: { taskId: string; role: string; agentAccount: string; description: string; status: string }[];
  deliverable: { taskId: string; agent: string; preview: string; evidence: string[]; verification: { passed: boolean; problems: string[] }; sources: { url: string; title: string; retrievedAt: string; hash: string; excerpt?: string }[]; followUpQuestions?: string[]; searches?: ResearchResult['searches'] };
  payout: { status: string; amount: string; recipient: string; onchain: boolean; txHash: string | null; explorerUrl: string | null; reasons: { code: string; message: string }[] };
  budgetState: { totalBudget: string; spent: string; remaining: string; agentSpent: Record<string, string> };
  steps: { phase: string; title: string; detail: string; badge: 'success' | 'warning' | 'error' | 'info'; activity?: string }[];
  aiModelUsed: string;
}

async function auditLedger(opts: MandateRunOptions): Promise<ResearchResult> {
  const sources: ResearchSource[] = [], gaps: string[] = [];
  const operations = opts.ledger || [];
  const inspect = async (operation: WalletOperation) => {
    if (operation.status !== 'confirmed') { gaps.push(`Operation ${operation.id} is ${operation.status}; it is not a confirmed settlement.`); return; }
    try {
      if (!opts.checkReceipt || !operation.txHashes.length) throw new Error('No receipt checker or transaction hash.');
      const checked = await new Promise<{ text: string; url: string }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Receipt lookup timed out.')), 5000);
        opts.checkReceipt!(operation).then(resolve, reject).finally(() => clearTimeout(timeout));
      });
      const text = `${operation.action} ${operation.amount} ${operation.asset}: ${checked.text}`;
      sources.push({ url: checked.url, title: `Receipt ${operation.txHashes.at(-1)}`, text, retrievedAt: new Date().toISOString(), hash: createHash('sha256').update(text).digest('hex'), prices: [] });
    } catch (error: any) { gaps.push(`Operation ${operation.id}: ${error.message}`); }
  };
  for (let index = 0; index < operations.length; index += 10) await Promise.all(operations.slice(index, index + 10).map(inspect));
  return { sources, gaps, subject: 'Recorded settlement receipts', quantity: 1, minimumSources: operations.filter(op => op.status === 'confirmed').length, negotiated: false };
}

/** Three independently executed local specialists, with optional authorized testnet research fees. */
export async function runAutonomousMandate(opts: MandateRunOptions = {}): Promise<MandateRunResult> {
  const goal = opts.goal?.trim() || 'Compare NEAR and USDT market prices and pool liquidity on Ref Finance.';
  if (goal.length > 6000) throw new Error('Keep mandates under 6,000 characters.');
  const id = opts.id || 'mandate_' + randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error('Invalid mandate ID.');
  const payment = researchPaymentRequest(goal);
  const researchGoal = payment?.researchGoal || goal;
  const topic = researchGoal.replace(/(?:spend(?:\s+up\s+to)?|budget(?:\s+of)?|no more than|up to|per[- ]agent\s+cap(?:\s+of)?)\s*\d+(?:\.\d+)?\s+(?:testnet\s+)?NEAR/gi, '').trim();
  const domain = detectDomain(topic);
  const budgetMatch = researchGoal.match(/(?:spend(?:\s+up\s+to)?|budget(?:\s+of)?|no more than|up to)\s*\$(\d+(?:\.\d{1,2})?)/i);
  const budgetLabel = payment ? (payment.ceiling || payment.amount) + ' testnet NEAR' : budgetMatch ? 'Up to $' + budgetMatch[1] + ' · no research fee requested' : 'No research fee requested';
  const store = opts.store || new Store(':memory:');
  const restrictions = ['Research fees require an explicit testnet NEAR authorization and verified evidence. Purchases and other transfers require an explicit wallet command. Paid API services are not used.'];
  const agents = { researcher: 'local-source-researcher', analyst: 'local-comparison-analyst', verifier: 'local-evidence-verifier' };
  const mandate: Mandate = { id, goal: researchGoal, totalBudget: 0n, perAgentCap: 0n, allowedRecipients: payment ? [payment.recipient] : [], allowedAsset: 'NEAR', allowedServices: ['public_source_research', 'evidence_verification'], restrictedActions: [{ action: 'purchase', requiresApproval: true, reason: restrictions[0] }], maxRetries: 0, status: 'active' };
  const steps: MandateRunResult['steps'] = [];
  const progress = (step: MandateRunResult['steps'][number]) => { steps.push(step); opts.onProgress?.(step); };
  try {
    store.createMandate(mandate);
    if (payment) store.audit(id, 'RESEARCH_FEE_AUTHORIZED', { asset: 'testnet NEAR', amount: payment.amount, budget: payment.ceiling || payment.amount, perAgentCap: payment.perAgentCap || payment.amount, recipient: payment.recipient });
    const tasks = planTasks(mandate, agents);
    tasks.forEach(task => store.createTask(task));
    progress({ phase: 'Orchestrator', title: 'Plan and permissions set', detail: `Goal: ${researchGoal}. ${payment ? 'Authorized research fee: ' + payment.amount + ' testnet NEAR.' : 'No research fee or transaction requested.'} Paid API cost: $0.`, badge: 'info' });

    const research = domain === 'past_purchases' ? await auditLedger(opts)
      : domain === 'stablecoin_corridor' && nearMarketTopic(topic) ? await researchNearMarket(opts.loadSource)
      : await researchPublicSources(topic, opts.loadSource, (title, detail) => progress({ phase: 'Researcher', title, detail, badge: 'info', activity: title + '…' }));
    if (/\bprivate\b.*\bliquidity\b|\bnegotiated\b.*\bpayout fees?\b/i.test(researchGoal)) research.gaps.push('Private liquidity and negotiated payout fees require direct provider evidence.');
    store.updateTask(tasks[0].id, { status: 'completed', evidence: research.sources.map(source => source.url) });
    store.audit(id, 'RESEARCH_COMPLETED', { sources: research.sources.map(({ url, retrievedAt, hash }) => ({ url, retrievedAt, hash })), findings: research.findings, searches: research.searches, gaps: research.gaps });
    progress({ phase: 'Researcher', title: 'Public sources retrieved', detail: `${research.sources.length} source observations; ${research.gaps.length} retrieval or coverage gaps.`, badge: research.sources.length ? 'success' : 'warning' });

    const analysis = analyzeResearch(research);
    if (domain === 'past_purchases' && !research.sources.length && !research.gaps.length) analysis.report = '# Settlement audit\n\nNo recorded wallet transactions are available for this account. No settlements or compliance claims were invented.';
    store.updateTask(tasks[1].id, { status: 'completed', evidence: research.sources.map(source => source.url) });
    store.audit(id, 'ANALYSIS_COMPLETED', { rows: analysis.rows });
    progress({ phase: 'Analyst', title: 'Comparison and recommendation built', detail: `${analysis.findings.length} cited passages and ${analysis.rows.filter(row => row.value).length} price observations. The answer uses retrieved evidence; quantity totals are estimates.`, badge: 'success' });

    const verification = verifyResearch(topic, research, analysis);
    if (/\bescrow\b|research\s+fee|\bpay\b.*for\s+research/i.test(goal) && !payment) { verification.problems.push('Use explicit fee syntax: ; research fee 0.01 NEAR, or ; escrow 0.01 NEAR to researcher.testnet'); verification.passed = false; }
    if (payment?.problem) { verification.problems.push(payment.problem); verification.passed = false; }
    if (payment && !research.sources.length) { verification.problems.push('Research fees require source evidence; an empty ledger or report cannot authorize payment.'); verification.passed = false; }
    store.updateTask(tasks[2].id, { status: 'completed', evidence: research.sources.map(source => source.hash) });
    store.audit(id, 'VERIFICATION_COMPLETED', verification);
    progress({ phase: 'Verifier', title: verification.passed ? 'Evidence checks passed' : 'Missing or unsupported evidence found', detail: verification.passed ? 'Source integrity, retrieval freshness, subject coverage, price provenance and quantity calculations checked.' : verification.problems.join(' '), badge: verification.passed ? 'success' : 'warning' });

    const payout: MandateRunResult['payout'] = { status: 'not_requested', amount: '0 NEAR', recipient: '', onchain: false, txHash: null, explorerUrl: null, reasons: [] };
    if (payment) {
      payout.amount = payment.amount + ' testnet NEAR'; payout.recipient = payment.recipient;
      if (!verification.passed) { payout.status = 'blocked'; payout.reasons = verification.problems.map(message => ({ code: 'EVIDENCE_NOT_VERIFIED', message })); }
      else {
        try {
          if (!opts.settleEscrow) throw new Error('Escrow is not configured. No transaction was sent.');
          const operation = await opts.settleEscrow({ id, amount: payment.amount, recipient: payment.recipient, evidenceHash: verification.evidenceHash });
          payout.status = operation.action === 'escrow_release' && operation.status === 'confirmed' && operation.txHashes.length ? 'confirmed' : 'needs_review';
          payout.onchain = payout.status === 'confirmed'; payout.txHash = operation.txHashes.at(-1) || null;
          payout.explorerUrl = payout.txHash ? 'https://testnet.nearblocks.io/txns/' + payout.txHash : null;
          if (operation.error) payout.reasons.push({ code: 'ESCROW_NEEDS_REVIEW', message: operation.error });
        } catch (error: any) { payout.status = 'blocked'; payout.reasons.push({ code: 'ESCROW_UNAVAILABLE', message: error.message }); }
      }
    }
    const status = verification.passed && !['blocked', 'needs_review'].includes(payout.status) ? 'completed' : 'partial';
    let remaining = 'No funds allocated';
    if (payment && !payment.problem) {
      const ceiling = units(payment.ceiling || payment.amount, 24);
      const released = payout.status === 'confirmed' ? units(payment.amount, 24) : 0n;
      const value = decimal(ceiling - released, 24).replace(/\.?0+$/, '');
      remaining = value + ' testnet NEAR of authorization remains' + (payout.status === 'needs_review' ? ' · reconcile escrow before spending' : '');
    } else if (payment?.problem) remaining = 'Fee authorization invalid; payment blocked';
    return { mandate: { id, goal: researchGoal, requestedGoal: goal, domain, totalBudget: budgetLabel, perAgentCap: payment ? (payment.perAgentCap || payment.amount) + ' testnet NEAR' : 'No fee requested', allowedAsset: 'NEAR', status, allowedRecipients: mandate.allowedRecipients, allowedServices: mandate.allowedServices!, restrictions },
      delegation: tasks.map(task => ({ taskId: task.id, role: task.role, agentAccount: task.agentAccount, description: task.description, status: store.getTask(task.id).status })),
      deliverable: { taskId: tasks[0].id, agent: agents.researcher, preview: analysis.report, evidence: research.sources.map(source => source.url), verification, followUpQuestions: research.followUpQuestions, searches: research.searches, sources: research.sources.map(({ url, title, retrievedAt, hash, text }) => ({ url, title, retrievedAt, hash, excerpt: text.slice(0, 650) })) }, payout,
      budgetState: { totalBudget: budgetLabel, spent: payout.status === 'confirmed' ? payout.amount : '$0', remaining, agentSpent: payout.status === 'confirmed' ? { [payout.recipient]: payout.amount } : {} }, steps, aiModelUsed: 'Local agent pipeline · no paid APIs' };
  } finally { if (!opts.store) { store.db.close(); await store.pgPool?.end(); } }
}
