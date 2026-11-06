import { describe, expect, it, vi } from 'vitest';
import { LocalAI, LOCAL_AI_ENDPOINT, reasoningEvidence, renderReasonedAnalysis } from '../src/local-ai.js';
import { analyzeResearch, researchPublicSources } from '../src/research.js';
import { runAutonomousMandate } from '../src/runner.js';
import type { WalletOperation } from '../src/wallet-store.js';

const goal = 'Compare prices and delivery terms for 10 office chairs at https://supplier-a.org/chairs https://supplier-b.org/chairs';
const quote = 'Office chair orders ship within 5 business days after confirmation. Delivery is limited to domestic addresses.';
const loadSource = async (url: string) => ({ url, contentType: 'text/html', retrievedAt: new Date().toISOString(),
  body: '<title>Office chairs</title><p>' + quote + '</p><script type="application/ld+json">' + JSON.stringify({ '@type': 'Product', name: 'Office chair', offers: { '@type': 'Offer', price: url.includes('supplier-a') ? '100' : '80', priceCurrency: 'USD' } }) + '</script>' });
const cited = () => ({ text: 'Delivery is limited to domestic addresses.', citations: [{ passageId: 's1p1' }] });
const answer = () => ({ summary: cited(), findings: [{ heading: 'Delivery conditions', claim: cited() }], recommendation: null,
  limitations: ['The destination must be confirmed with the supplier.'], followUpQuestions: ['Where should the chairs be delivered?'] });
function model(overrides: Record<string, unknown> = {}) {
  const packets: any[] = [];
  const request = vi.fn(async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    const packet = JSON.parse(body.messages[1].content);
    packets.push(packet);
    const responses: Record<string, unknown> = {
      research: { queries: ['office chair published delivery terms https://supplier-a.org/chairs'], criteria: ['Compare published prices and stated delivery conditions'] },
      analysis: answer(), verification: { passed: true, summary: 'The conclusions retain the stated delivery limits.', problems: [] }, ...overrides,
    };
    const value = typeof responses[packet.stage] === 'function' ? (responses[packet.stage] as Function)(packet) : responses[packet.stage];
    return new Response(JSON.stringify({ model: 'qwen3:0.6b', done: true, done_reason: 'stop',
      message: { content: JSON.stringify(value), thinking: 'Internal reasoning must not enter the report or receipt.' },
      prompt_eval_count: 400, eval_count: 300 }));
  });
  return { reasoner: new LocalAI('qwen3:0.6b', LOCAL_AI_ENDPOINT, '', request), request, packets };
}
const release = (request: any): WalletOperation => ({ id: request.id + '_release', userAccount: 'alice.testnet', action: 'escrow_release',
  asset: 'NEAR', amount: request.amount, recipient: request.recipient, evidenceHash: request.evidenceHash,
  status: 'confirmed', txHashes: ['test-release-receipt'], createdAt: new Date().toISOString() });

describe('local business reasoning with explicit fees', () => {
  it('reasons in three stages, preserves the exact chosen fee and excludes financial authorization from model input', async () => {
    const local = model(), settleEscrow = vi.fn(async request => release(request));
    const result = await runAutonomousMandate({ goal: goal + '; research fee 0.037 NEAR', loadSource, reasoner: local.reasoner, settleEscrow });
    expect(local.packets.map(packet => packet.stage)).toEqual(['research', 'analysis', 'verification']);
    expect(local.packets.every(packet => !JSON.stringify(packet.task).includes('0.037'))).toBe(true);
    expect(result.payout).toMatchObject({ amount: '0.037 testnet NEAR', status: 'confirmed', onchain: true });
    expect(settleEscrow).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.037', evidenceHash: result.deliverable.verification.evidenceHash }));
    expect(result.reasoning).toMatchObject({ provider: 'Ollama', status: 'completed', model: 'qwen3:0.6b' });
    expect(result.deliverable.preview).toContain('800 USD for 10');
    expect(result.deliverable.preview).toContain('### Sources');
    expect(JSON.stringify(result)).not.toContain('Internal reasoning must not');
    expect(result.reasoning?.stages.every(stage => stage.completionId && stage.usage?.promptTokens === 400)).toBe(true);
  });
  it('never invents a fee when the user requests research without one', async () => {
    const local = model(), settleEscrow = vi.fn();
    const result = await runAutonomousMandate({ goal, loadSource, reasoner: local.reasoner, settleEscrow });
    expect(result.payout).toMatchObject({ amount: '0 NEAR', status: 'not_requested', onchain: false });
    expect(settleEscrow).not.toHaveBeenCalled();
  });
  it('accepts cited delivery terms that explicitly describe shipping and leave arrival unresolved', async () => {
    const local = model({ analysis: { ...answer(), summary: { ...cited(), text: 'Published delivery terms specify shipping within 5 business days after confirmation to domestic addresses. Arrival time is unpublished.' } } });
    const result = await runAutonomousMandate({ goal, loadSource, reasoner: local.reasoner });
    expect(result.deliverable.verification.passed).toBe(true);
    expect(local.packets.map(packet => packet.stage)).toEqual(['research', 'analysis', 'verification']);
    expect(result.deliverable.preview).toContain('Arrival time is unpublished.');
  });
  it('allows one evidence-checked correction before independent review and exact fee settlement', async () => {
    let attempt = 0;
    const local = model({ analysis: () => ++attempt === 1 ? { ...answer(), summary: { ...cited(), text: 'Both suppliers offer 5-day delivery.' } } : answer() });
    const settleEscrow = vi.fn(async request => release(request));
    const result = await runAutonomousMandate({ goal: goal + '; research fee 0.037 NEAR', loadSource, reasoner: local.reasoner, settleEscrow });
    expect(local.packets.map(packet => packet.stage)).toEqual(['research', 'analysis', 'analysis', 'verification']);
    expect(local.packets[2].task.correction).toContain('unsupported delivery promise');
    expect(local.packets.every(packet => !JSON.stringify(packet.task).includes('0.037'))).toBe(true);
    expect(result.reasoning?.stages[1]).toMatchObject({ status: 'completed', attempts: 2, usage: { promptTokens: 800, completionTokens: 600 } });
    expect(result.deliverable.preview).not.toContain('5-day delivery');
    expect(result.payout).toMatchObject({ status: 'confirmed', amount: '0.037 testnet NEAR' });
    expect(settleEscrow).toHaveBeenCalledTimes(1);
  });
  it('corrects numerical citations with a source-specific guide without repeating the rejected answer', async () => {
    let attempt = 0;
    const local = model({ analysis: () => ++attempt === 1 ? { ...answer(), summary: { ...cited(), text: 'Supplier A charges 80 USD.' } } : answer() });
    const result = await runAutonomousMandate({ goal, loadSource, reasoner: local.reasoner });
    expect(result.deliverable.verification.passed).toBe(true);
    expect(local.packets[2].task).not.toHaveProperty('rejectedAnswer');
    expect(local.packets[2].task.numericSupport[0]).toMatchObject({ number: '80' });
    expect(local.packets[2].task.numericSupport[0].supportingPassageIds.length).toBeGreaterThan(0);
    expect(local.packets[2].task.numericSupport[0].supportingPassageIds.every((id: string) => id.startsWith('s2p'))).toBe(true);
    expect(result.payout.status).toBe('not_requested');
  });
  it.each([
    ['uncited conclusion', { ...answer(), summary: { text: 'Delivery is available.', citations: [] } }, 'uncited'],
    ['invented quote', { ...answer(), summary: { text: 'Delivery is available.', citations: [{ passageId: 's1p1', quote: 'A made-up promise of free global delivery.' }] } }, 'passage'],
    ['unknown source', { ...answer(), summary: { text: 'Delivery is available.', citations: [{ passageId: 's8p1' }] } }, 'passage'],
    ['unknown passage', { ...answer(), summary: { text: 'Delivery is available.', citations: [{ passageId: 's1p99' }] } }, 'passage'],
    ['invented amount', { ...answer(), summary: { ...cited(), text: 'Delivery costs 9999 USD.' } }, 'number'],
    ['amount from an uncited supplier', { ...answer(), summary: { ...cited(), text: 'Supplier A charges 80 USD.' } }, 'number'],
    ['count turned into a dollar budget', { ...answer(), summary: { ...cited(), text: 'The project has a $5 million budget.' } }, 'unit or currency'],
    ['day count turned into a population', { ...answer(), summary: { ...cited(), text: 'The project serves 5 million people.' } }, 'unit or currency'],
    ['price multiplied by an unsupported magnitude', { ...answer(), summary: { ...cited(), text: 'The chair costs 100 million USD.' } }, 'unit or currency'],
    ['price multiplied by an abbreviated magnitude', { ...answer(), summary: { ...cited(), text: 'The chair costs $100m.' } }, 'unit or currency'],
    ['price assigned to another currency', { ...answer(), summary: { ...cited(), text: 'The chair costs 100 EUR.' } }, 'unit or currency'],
    ['shipping time presented as arrival', { ...answer(), summary: { ...cited(), text: 'Delivery within 5 business days.' } }, 'delivery promise'],
    ['shipping time presented as a delivery deadline', { ...answer(), summary: { ...cited(), text: 'Both offer 5-day delivery.' } }, 'delivery promise'],
    ['shipping mentioned alongside an invented arrival promise', { ...answer(), summary: { ...cited(), text: 'Orders ship after confirmation and offer 5-day delivery.' } }, 'delivery promise'],
  ])('blocks settlement after an %s', async (_label, invalid, problem) => {
    const local = model({ analysis: invalid }), settleEscrow = vi.fn();
    const result = await runAutonomousMandate({ goal: goal + '; research fee 0.037 NEAR', loadSource, reasoner: local.reasoner, settleEscrow });
    expect(result.payout).toMatchObject({ amount: '0.037 testnet NEAR', status: 'blocked', onchain: false });
    expect(settleEscrow).not.toHaveBeenCalled();
    expect(result.deliverable.verification.passed).toBe(false);
    expect(result.deliverable.verification.problems.join(' ')).toContain(problem);
    expect(result.reasoning?.stages.at(-1)).toMatchObject({ stage: 'verification', status: 'skipped' });
  });
  it('preserves the sourced report and blocks the fee when the model reviewer finds unsupported conclusions', async () => {
    const local = model({ analysis: { ...answer(), summary: { ...cited(), text: 'Both suppliers offer unrestricted worldwide delivery.' } },
      verification: { passed: false, summary: 'Destination coverage is unresolved.', problems: ['Destination coverage is unresolved.'] } });
    const settleEscrow = vi.fn();
    const result = await runAutonomousMandate({ goal: goal + '; research fee 0.037 NEAR', loadSource, reasoner: local.reasoner, settleEscrow });
    expect(result.deliverable.verification).toMatchObject({ passed: false, problems: ['Destination coverage is unresolved.'] });
    expect(result.payout.status).toBe('blocked');
    expect(result.deliverable.preview).not.toContain('unrestricted worldwide delivery');
    expect(result.deliverable.preview).toContain('5 business days');
    expect(settleEscrow).not.toHaveBeenCalled();
  });
  it('does not let a model approval override failed source checks', async () => {
    const research = await researchPublicSources(goal, loadSource), analysis = analyzeResearch(research), local = model();
    const reasoned = await local.reasoner.analyze(goal, research, analysis, undefined);
    await expect(local.reasoner.verify(goal, research, analysis, reasoned.value, undefined, { passed: false, problems: ['Source integrity failed.'] })).rejects.toThrow('contradicted');
  });
  it('accepts source-specific monetary totals in their original currency', async () => {
    const local = model({ analysis: { ...answer(), summary: { ...cited(), text: 'The quantity estimate for 10 chairs is 1000 USD before tax and delivery.' } } });
    const result = await runAutonomousMandate({ goal, loadSource, reasoner: local.reasoner });
    expect(result.deliverable.verification.passed).toBe(true);
    expect(result.deliverable.preview).toContain('1000 USD');
  });
  it('rejects a model reviewer that adds numerical research claims to its approval summary', async () => {
    const local = model({ verification: { passed: true, summary: 'The project has a $5 million budget.', problems: [] } });
    const settleEscrow = vi.fn();
    const result = await runAutonomousMandate({ goal: goal + '; research fee 0.037 NEAR', loadSource, reasoner: local.reasoner, settleEscrow });
    expect(result.deliverable.verification.passed).toBe(false);
    expect(result.deliverable.verification.problems.join(' ')).toContain('summary introduced');
    expect(settleEscrow).not.toHaveBeenCalled();
  });
  it('resolves passage IDs to the exact original source text before the independent review', async () => {
    const research = await researchPublicSources(goal, loadSource), analysis = analyzeResearch(research), local = model();
    const result = await local.reasoner.analyze(goal, research, analysis, undefined);
    const passage = local.packets[0].task.evidence.sources[0].passages.find((entry: { id: string }) => entry.id === 's1p1');
    expect(result.value.summary.citations).toEqual([{ sourceId: 's1', quote: passage.text }]);
    expect(research.sources[0].text).toContain(passage.text);
    await local.reasoner.verify(goal, research, analysis, result.value, undefined, { passed: true, problems: [] });
    expect(local.packets[1].task.conclusions.summary.citations[0].quote).toBe(passage.text);
  });
  it('preserves complete original passages and their trailing commercial conditions', async () => {
    const research = await researchPublicSources(goal, loadSource);
    const passage = 'Office chair orders ship after confirmation. ' + 'Confirm the exact specification with the supplier. '.repeat(10) + quote;
    research.sources[0].text = 'Office chairs ' + passage;
    research.findings = [{ source: research.sources[0].url, kind: 'delivery', excerpt: passage }];
    const analysis = analyzeResearch(research), local = model();
    const result = await local.reasoner.analyze(goal, research, analysis, undefined);
    expect(result.value.summary.citations[0].quote).toBe(passage);
    expect(result.value.summary.citations[0].quote).toContain('Delivery is limited to domestic addresses.');
  });
  it('supplies source-specific permitted numbers without granting amounts from other suppliers or URL metadata', async () => {
    const research = await researchPublicSources(goal, loadSource);
    research.sources[0].url = 'https://supplier-a.org/2023/chairs';
    research.findings!.forEach(finding => { if (finding.source.includes('supplier-a')) finding.source = research.sources[0].url; });
    const evidence = reasoningEvidence(research, analyzeResearch(research));
    const passage = evidence.sources.find(source => source.id === 's1')!.passages[0];
    expect(passage.permittedNumbers).toEqual(expect.arrayContaining(['5', '10', '100', '1000']));
    expect(passage.permittedNumbers).not.toContain('80');
    expect(passage.permittedNumbers).not.toContain('2023');
    expect(JSON.stringify(evidence)).not.toContain('/2023/chairs');
  });
  it('selects independent late sources with their original IDs and rejects real passages excluded from the packet', async () => {
    const research = await researchPublicSources(goal, loadSource);
    const first = research.sources[0], second = research.sources[1];
    research.sources = [...Array.from({ length: 8 }, (_, index) => ({ ...first, url: `https://en.wikipedia.org/wiki/Office_chair_${index + 1}` })), first, second];
    research.findings = research.sources.map(source => ({ source: source.url, kind: 'delivery' as const, excerpt: quote }));
    const analysis = analyzeResearch(research), evidence = reasoningEvidence(research, analysis);
    expect(evidence.sources).toHaveLength(8);
    expect(evidence.sources.map(source => source.id)).toEqual(expect.arrayContaining(['s9', 's10']));
    expect(evidence.sources.some(source => source.id === 's8')).toBe(false);
    const lateClaim = { text: 'Delivery is limited to domestic addresses.', citations: [{ passageId: 's10p1' }] };
    const local = model({ analysis: { ...answer(), summary: lateClaim, findings: [{ heading: 'Delivery conditions', claim: lateClaim }] } });
    const result = await local.reasoner.analyze(goal, research, analysis, undefined);
    expect(result.value.summary.citations[0]).toEqual({ sourceId: 's10', quote });
    expect(renderReasonedAnalysis(result.value, research)).toContain(second.url);
    const excluded = model({ analysis: { ...answer(), summary: { ...lateClaim, citations: [{ passageId: 's8p1' }] } } });
    await expect(excluded.reasoner.analyze(goal, research, analysis, undefined)).rejects.toThrow('not in the supplied source evidence');
  });
  it('prevents planning facts from URL slugs while retaining the requested publisher', async () => {
    const local = model({ research: { queries: ['Nigeria solar electricity access'], criteria: ['Investigate energy access for 17.5 million people'] } });
    await expect(local.reasoner.plan('Research solar energy in Nigeria at https://www.worldbank.org/en/news/2023/12/14/energy-for-17-5-million-people')).rejects.toThrow('before retrieving');
    expect(local.packets[0].task.question).toBe('Research solar energy in Nigeria at');
    expect(local.packets[0].task.requestedSources).toEqual([{ publisher: 'worldbank.org' }]);
    expect(JSON.stringify(local.packets[0].task)).not.toContain('17-5-million');
  });
  it('rejects truncated or unreachable local inference without releasing a payment', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ done: true, done_reason: 'length', message: { content: '{}' } })));
    const reasoner = new LocalAI('qwen3:0.6b', LOCAL_AI_ENDPOINT, '', request);
    await expect(reasoner.plan(goal)).rejects.toThrow('complete answer');
    request.mockRejectedValue(new Error('Connection refused with sensitive server details'));
    await expect(reasoner.plan(goal)).rejects.toThrow('Local model could not be reached.');
  });
  it('requires authentication and HTTPS for remote inference and rejects cloud model tags', () => {
    expect(() => new LocalAI('qwen3:0.6b', 'https://local-model.example/api/chat')).toThrow('authentication');
    expect(() => new LocalAI('qwen3:0.6b', 'http://local-model.example/api/chat', 'private-token')).toThrow('HTTPS');
    for (const name of ['qwen3:cloud', 'qwen3-cloud', 'qwen3-cloud:latest']) expect(() => new LocalAI(name)).toThrow('local Ollama model');
    expect(LocalAI.fromEnv({ LOCAL_AI_ENABLED: 'false' })).toBeNull();
  });
});
