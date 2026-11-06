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
import { LocalAI, renderReasonedAnalysis, type ReasoningCompletion, type ResearchPlan, type ReasonedAnalysis, type ReasonedVerification, type ReasoningStage, type ReasoningReceipt } from './local-ai.js';

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
  reasoner?: LocalAI | null;
}
export interface MandateRunResult {
  mandate: { id: string; goal: string; requestedGoal: string; domain: string; totalBudget: string; perAgentCap: string; allowedAsset: string; status: string; allowedRecipients: string[]; allowedServices: string[]; restrictions: string[] };
  delegation: { taskId: string; role: string; agentAccount: string; description: string; status: string }[];
  deliverable: { taskId: string; agent: string; preview: string; evidence: string[]; verification: { passed: boolean; problems: string[]; evidenceHash?: string }; sources: { url: string; title: string; retrievedAt: string; hash: string; excerpt?: string; findings?: { kind: string; excerpt: string }[] }[]; followUpQuestions?: string[]; searches?: ResearchResult['searches'] };
  payout: { status: string; amount: string; recipient: string; onchain: boolean; txHash: string | null; explorerUrl: string | null; reasons: { code: string; message: string }[];
    receipt?: { network: 'testnet'; operationId: string; action: string; status: string; amount: string; asset: string; recipient?: string; walletOwner: string; recordedAt: string; contractId?: string; mandateId?: string; evidenceHash?: string; transactions: { stage: 'funding' | 'release'; hash: string; explorerUrl: string; confirmed: boolean; status: string }[] } };
  budgetState: { totalBudget: string; spent: string; remaining: string; agentSpent: Record<string, string> };
  steps: { phase: string; title: string; detail: string; badge: 'success' | 'warning' | 'error' | 'info'; activity?: string }[];
  aiModelUsed: string;
  reasoning?: { provider: 'Ollama'; model: string; status: 'completed' | 'partial'; stages: (Partial<ReasoningReceipt> & { stage: ReasoningStage; status: 'completed' | 'failed' | 'skipped'; error?: string })[]; criteria?: string[]; verificationSummary?: string };
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
  if (goal.length > 6000) throw new Error('Keep directives under 6,000 characters.');
  const id = opts.id || 'mandate_' + randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error('Invalid Mandate directive ID.');
  const payment = researchPaymentRequest(goal);
  const researchGoal = payment?.researchGoal || goal;
  const topic = researchGoal.replace(/(?:spend(?:\s+up\s+to)?|budget(?:\s+of)?|no more than|up to|per[- ]agent\s+cap(?:\s+of)?)\s*\d+(?:\.\d+)?\s+(?:testnet\s+)?NEAR/gi, '').trim();
  const domain = detectDomain(topic);
  const reasoner = domain === 'past_purchases' ? null : opts.reasoner === undefined ? LocalAI.fromEnv() : opts.reasoner;
  const reasoning: MandateRunResult['reasoning'] = reasoner ? { provider: 'Ollama', model: reasoner.model, status: 'partial', stages: [] } : undefined;
  const reasoningErrors: string[] = [];
  const reasoningDeadline = Date.now() + 260_000;
  const timeFor = (limit: number) => Math.max(0, Math.min(limit, reasoningDeadline - Date.now()));
  const budgetMatch = researchGoal.match(/(?:spend(?:\s+up\s+to)?|budget(?:\s+of)?|no more than|up to)\s*\$(\d+(?:\.\d{1,2})?)/i);
  const budgetLabel = payment ? (payment.ceiling || payment.amount) + ' testnet NEAR' : budgetMatch ? 'Up to $' + budgetMatch[1] + ' · no research fee requested' : 'No research fee requested';
  const store = opts.store || new Store(':memory:');
  const restrictions = ['Research fees require an explicit testnet NEAR authorization and verified evidence. Purchases and other transfers require an explicit wallet command. Local model inference has no cloud API charge and cannot change the authorized research fee.'];
  const agents = { researcher: 'local-source-researcher', analyst: 'local-comparison-analyst', verifier: 'local-evidence-verifier' };
  const mandate: Mandate = { id, goal: researchGoal, totalBudget: 0n, perAgentCap: 0n, allowedRecipients: payment ? [payment.recipient] : [], allowedAsset: 'NEAR', allowedServices: ['public_source_research', 'evidence_verification'], restrictedActions: [{ action: 'purchase', requiresApproval: true, reason: restrictions[0] }], maxRetries: 0, status: 'active' };
  const steps: MandateRunResult['steps'] = [];
  const progress = (step: MandateRunResult['steps'][number]) => { steps.push(step); opts.onProgress?.(step); };
  const reason = async <T>(stage: ReasoningStage, operation: () => Promise<ReasoningCompletion<T>>) => {
    try {
      const result = await operation();
      const { value, ...receipt } = result;
      reasoning!.stages.push({ stage, status: 'completed', ...receipt });
      return value;
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith('Local model') ? error.message : 'Local model could not complete this stage.';
      reasoning!.stages.push({ stage, status: 'failed', error: message });
      reasoningErrors.push(`${stage[0].toUpperCase() + stage.slice(1)} reasoning: ${message}`);
      progress({ phase: stage === 'research' ? 'Researcher' : stage === 'analysis' ? 'Analyst' : 'Verifier', title: 'Local reasoning could not complete', detail: message, badge: 'warning' });
      return undefined;
    }
  };
  try {
    store.createMandate(mandate);
    if (payment) store.audit(id, 'RESEARCH_FEE_AUTHORIZED', { asset: 'testnet NEAR', amount: payment.amount, budget: payment.ceiling || payment.amount, perAgentCap: payment.perAgentCap || payment.amount, recipient: payment.recipient });
    const tasks = planTasks(mandate, agents);
    tasks.forEach(task => store.createTask(task));
    progress({ phase: 'Orchestrator', title: 'Plan and permissions set', detail: `Goal: ${researchGoal}. ${payment ? 'Authorized research fee: ' + payment.amount + ' testnet NEAR.' : 'No research fee or transaction requested.'} Paid API cost: $0.`, badge: 'info' });

    let plan: ResearchPlan | undefined;
    if (reasoner) {
      progress({ phase: 'Researcher', title: 'Reasoning about the research question', detail: 'The local model identifies evidence requirements and focused search queries. Spending permissions stay in the explicit directive.', badge: 'info', activity: 'Planning business research…' });
      plan = await reason('research', () => reasoner.plan(topic, timeFor(80_000)));
      if (plan) reasoning!.criteria = plan.criteria;
    }

    const research = domain === 'past_purchases' ? await auditLedger(opts)
      : domain === 'stablecoin_corridor' && nearMarketTopic(topic) ? await researchNearMarket(opts.loadSource)
      : await researchPublicSources(topic, opts.loadSource, (title, detail) => progress({ phase: 'Researcher', title, detail, badge: 'info', activity: title + '…' }), { queries: plan?.queries, deadline: reasoner ? Math.min(Date.now() + 30_000, reasoningDeadline - 90_000) : undefined });
    if (/\bprivate\b.*\bliquidity\b|\bnegotiated\b.*\bpayout fees?\b/i.test(researchGoal)) research.gaps.push('Private liquidity and negotiated payout fees require direct provider evidence.');
    store.updateTask(tasks[0].id, { status: 'completed', evidence: research.sources.map(source => source.url) });
    store.audit(id, 'RESEARCH_COMPLETED', { sources: research.sources.map(({ url, retrievedAt, hash }) => ({ url, retrievedAt, hash })), findings: research.findings, searches: research.searches, gaps: research.gaps });
    progress({ phase: 'Researcher', title: 'Public sources retrieved', detail: `${research.sources.length} source observations; ${research.gaps.length} retrieval or coverage gaps.`, badge: research.sources.length ? 'success' : 'warning' });

    const analysis = analyzeResearch(research);
    if (domain === 'past_purchases' && !research.sources.length && !research.gaps.length) analysis.report = '# Settlement audit\n\nNo recorded wallet transactions are available for this account. No settlements or compliance claims were invented.';
    store.updateTask(tasks[1].id, { status: 'completed', evidence: research.sources.map(source => source.url) });
    store.audit(id, 'ANALYSIS_COMPLETED', { rows: analysis.rows });
    progress({ phase: 'Analyst', title: research.pricesRequested === false ? 'Research brief built' : 'Comparison and recommendation built', detail: `${analysis.findings.length} supporting passages${research.pricesRequested === false ? '; findings grouped with numbered source citations.' : ' and ' + analysis.rows.filter(row => row.value).length + ' price observations; quantity totals are estimates.'}`, badge: 'success' });

    const verification = verifyResearch(topic, research, analysis);
    let reasoned: ReasonedAnalysis | undefined;
    let modelVerification: ReasonedVerification | undefined;
    if (reasoner && research.sources.length) {
      progress({ phase: 'Analyst', title: 'Analyzing the business evidence', detail: 'The local model compares tradeoffs and proposes conclusions with exact supporting source passages.', badge: 'info', activity: 'Reasoning from the evidence…' });
      reasoned = await reason('analysis', () => reasoner.analyze(topic, research, analysis, plan, timeFor(160_000)));
      if (reasoned) {
        progress({ phase: 'Verifier', title: 'Challenging the analysis', detail: 'A separate model pass checks whether conclusions follow from the evidence and preserves publisher qualifications. It cannot override the source checks.', badge: 'info', activity: 'Reviewing conclusions…' });
        modelVerification = await reason('verification', () => reasoner.verify(topic, research, analysis, reasoned!, plan, verification, timeFor(90_000)));
        if (modelVerification) {
          reasoning!.verificationSummary = modelVerification.summary;
          if (!modelVerification.passed) reasoningErrors.push(...modelVerification.problems);
        }
      } else {
        reasoning!.stages.push({ stage: 'verification', status: 'skipped', error: 'Analysis did not produce a validated answer.' });
      }
    } else if (reasoner) {
      reasoningErrors.push('Local analysis and verification need retrieved evidence.');
      reasoning!.stages.push({ stage: 'analysis', status: 'skipped' }, { stage: 'verification', status: 'skipped' });
    }
    if (reasoning) {
      verification.problems.push(...reasoningErrors);
      verification.passed = verification.passed && !!plan && !!reasoned && !!modelVerification?.passed && !reasoningErrors.length;
      reasoning.status = plan && reasoned && modelVerification && !reasoning.stages.some(stage => stage.status !== 'completed') ? 'completed' : 'partial';
      verification.evidenceHash = createHash('sha256').update(JSON.stringify({ sourceEvidenceHash: verification.evidenceHash, model: reasoning.model, plan, conclusions: reasoned, review: modelVerification })).digest('hex');
    }
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
          const termsMatch = operation.asset === 'NEAR' && units(operation.amount, 24) === units(payment.amount, 24)
            && operation.recipient === payment.recipient && operation.evidenceHash === verification.evidenceHash;
          payout.status = termsMatch && operation.action === 'escrow_release' && operation.status === 'confirmed' && operation.txHashes.length ? 'confirmed' : operation.status === 'failed' ? 'failed' : 'needs_review';
          payout.onchain = payout.status === 'confirmed'; payout.txHash = operation.txHashes.at(-1) || null;
          payout.explorerUrl = payout.txHash ? 'https://testnet.nearblocks.io/txns/' + payout.txHash : null;
          const transaction = (hash: string, stage: 'funding' | 'release', status: string) => ({ hash, stage, status, confirmed: status === 'confirmed', explorerUrl: 'https://testnet.nearblocks.io/txns/' + hash });
          const stage = operation.action === 'escrow_fund' ? 'funding' : 'release';
          payout.receipt = { network: 'testnet', operationId: operation.id, action: operation.action, status: operation.status,
            amount: operation.amount, asset: operation.asset, recipient: operation.recipient, walletOwner: operation.userAccount, recordedAt: operation.createdAt,
            contractId: operation.contractId, mandateId: operation.mandateId, evidenceHash: operation.evidenceHash,
            transactions: [...(operation.fundingTxHashes || []).map(hash => transaction(hash, 'funding', 'confirmed')),
              ...operation.txHashes.map(hash => transaction(hash, stage, operation.status)),
              ...(operation.attempt && !operation.txHashes.includes(operation.attempt.txHash) ? [transaction(operation.attempt.txHash, stage, operation.status === 'confirmed' ? 'needs_review' : operation.status)] : [])] };
          if (!termsMatch) payout.reasons.push({ code: 'ESCROW_RECEIPT_MISMATCH', message: 'The recorded escrow operation does not match the authorized research fee. Check settlement before spending again.' });
          if (operation.error) payout.reasons.push({ code: 'ESCROW_NEEDS_REVIEW', message: operation.error });
        } catch (error: any) { payout.status = 'blocked'; payout.reasons.push({ code: 'ESCROW_UNAVAILABLE', message: error.message }); }
      }
    }
    if (payment) progress({ phase: 'Settlement', title: payout.status === 'confirmed' ? 'Research fee confirmed on NEAR testnet' : 'Research fee ' + payout.status.replace(/_/g, ' '), detail: payout.status === 'confirmed' ? `${payout.amount} released to ${payout.recipient}. Transaction: ${payout.txHash}.` : payout.reasons.map(reason => reason.message).join(' ') || 'Payment is not confirmed. Check the recorded transaction before retrying.', badge: payout.status === 'confirmed' ? 'success' : 'warning' });
    const status = verification.passed && !['blocked', 'needs_review', 'failed'].includes(payout.status) ? 'completed' : 'partial';
    let remaining = 'No funds allocated';
    if (payment && !payment.problem) {
      const ceiling = units(payment.ceiling || payment.amount, 24);
      const released = payout.status === 'confirmed' ? units(payment.amount, 24) : 0n;
      const value = decimal(ceiling - released, 24).replace(/\.?0+$/, '');
      remaining = value + ' testnet NEAR of authorization remains' + (payout.receipt && payout.status !== 'confirmed' ? ' · reconcile escrow before spending' : '');
    } else if (payment?.problem) remaining = 'Fee authorization invalid; payment blocked';
    return { mandate: { id, goal: researchGoal, requestedGoal: goal, domain, totalBudget: budgetLabel, perAgentCap: payment ? (payment.perAgentCap || payment.amount) + ' testnet NEAR' : 'No fee requested', allowedAsset: 'NEAR', status, allowedRecipients: mandate.allowedRecipients, allowedServices: mandate.allowedServices!, restrictions },
      delegation: tasks.map(task => ({ taskId: task.id, role: task.role, agentAccount: task.agentAccount, description: task.description, status: store.getTask(task.id).status })),
      deliverable: { taskId: tasks[0].id, agent: agents.researcher, preview: reasoned && modelVerification?.passed && !reasoningErrors.length ? renderReasonedAnalysis({ ...reasoned, limitations: [...new Set([...reasoned.limitations, ...verification.problems])] }, research, analysis) : analysis.report, evidence: research.sources.map(source => source.url), verification, followUpQuestions: [...new Set([...(research.followUpQuestions || []), ...(reasoned?.followUpQuestions || [])])], searches: research.searches, sources: research.sources.map(({ url, title, retrievedAt, hash, text }) => ({ url, title, retrievedAt, hash, excerpt: text.slice(0, 650), findings: analysis.findings.filter(finding => finding.source === url).map(({ kind, excerpt }) => ({ kind, excerpt })) })) }, payout,
      budgetState: { totalBudget: budgetLabel, spent: payout.status === 'confirmed' ? payout.amount : '$0', remaining, agentSpent: payout.status === 'confirmed' ? { [payout.recipient]: payout.amount } : {} }, steps,
      aiModelUsed: reasoning ? `Local Ollama · ${reasoning.model}${reasoning.status === 'partial' ? ' · incomplete reasoning' : ''}` : 'Local agent pipeline · no paid APIs', reasoning };
  } finally { if (!opts.store) { store.db.close(); await store.pgPool?.end(); } }
}
