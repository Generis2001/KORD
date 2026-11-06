import { describe, expect, it, vi } from 'vitest';
import { LocalAI, LOCAL_AI_ENDPOINT } from '../src/local-ai.js';
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
  it.each([
    ['uncited conclusion', { ...answer(), summary: { text: 'Delivery is available.', citations: [] } }, 'uncited'],
    ['invented quote', { ...answer(), summary: { text: 'Delivery is available.', citations: [{ passageId: 's1p1', quote: 'A made-up promise of free global delivery.' }] } }, 'passage'],
    ['unknown source', { ...answer(), summary: { text: 'Delivery is available.', citations: [{ passageId: 's8p1' }] } }, 'passage'],
    ['unknown passage', { ...answer(), summary: { text: 'Delivery is available.', citations: [{ passageId: 's1p99' }] } }, 'passage'],
    ['invented amount', { ...answer(), summary: { ...cited(), text: 'Delivery costs 9999 USD.' } }, 'number'],
    ['amount from an uncited supplier', { ...answer(), summary: { ...cited(), text: 'Supplier A charges 80 USD.' } }, 'number'],
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
  it('resolves passage IDs to the exact original source text before the independent review', async () => {
    const research = await researchPublicSources(goal, loadSource), analysis = analyzeResearch(research), local = model();
    const result = await local.reasoner.analyze(goal, research, analysis, undefined);
    const passage = local.packets[0].task.evidence.sources[0].passages.find((entry: { id: string }) => entry.id === 's1p1');
    expect(result.value.summary.citations).toEqual([{ sourceId: 's1', quote: passage.text }]);
    expect(research.sources[0].text).toContain(passage.text);
    await local.reasoner.verify(goal, research, analysis, result.value, undefined, { passed: true, problems: [] });
    expect(local.packets[1].task.conclusions.summary.citations[0].quote).toBe(passage.text);
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
