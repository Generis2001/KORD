import { describe, it, expect, vi } from 'vitest';
import { analyzeResearch, researchPlan, researchPublicSources, researchNearMarket, verifyResearch, quantityTotal, REF_PRICES, REF_POOLS } from '../src/research.js';
import { publicAddress, publicUrl, type SourceLoader } from '../src/public-sources.js';
import { runAutonomousMandate } from '../src/runner.js';

const product = (name: string, price: string, currency = 'USD') => `<title>${name}</title><p>${name} specifications and published commercial product information for this product. Shipping and taxes are quoted separately.</p><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: currency } })}</script>`;
const fixture = (values: Record<string, string>): SourceLoader => vi.fn(async url => {
  if (!values[url]) throw new Error('Unavailable');
  return { url, body: values[url], contentType: 'text/html', retrievedAt: new Date().toISOString() };
});
const urls = ['https://vendor-a.com/laptop', 'https://vendor-b.com/laptop'];
const goal = 'Compare published prices for 10 laptops at ' + urls.join(' ');
const load = () => fixture({ [urls[0]]: product('Laptop A', '100.10'), [urls[1]]: product('Laptop B', '80.25') });

describe('free public-source specialists', () => {
  it('keeps the exact office-chair directive and streams genuine stage completions', async () => {
    const request = 'Find three suppliers of 100 office chairs, compare their prices and delivery terms, and prepare a recommendation. You may spend up to $20 on research, but cannot purchase without approval';
    const progress = vi.fn();
    const source: SourceLoader = vi.fn(async url => {
      if (url.includes('duckduckgo')) throw new Error('Search blocked');
      return { url, body: product('Office Chair', '100'), contentType: 'text/html', retrievedAt: new Date().toISOString() };
    });
    const result = await runAutonomousMandate({ goal: request, loadSource: source, onProgress: progress });
    expect(result.mandate).toMatchObject({ domain: 'procurement', goal: request, requestedGoal: request });
    expect(result.deliverable.sources).toHaveLength(3);
    expect(result.deliverable.preview).toContain('10000 USD for 100');
    expect(result.deliverable.preview).not.toMatch(/stablecoin|LATAM|Africa/);
    expect(result.deliverable.preview).not.toContain('Retrieved');
    expect(result.deliverable.sources.every(source => /ikea|steelcase|hermanmiller/.test(source.url))).toBe(true);
    expect(progress.mock.calls.map(([step]) => step.phase)).toEqual(['Orchestrator', 'Researcher', 'Analyst', 'Verifier']);
  });
  it('retrieves actual publisher observations and computes exact quantity totals', async () => {
    const research = await researchPublicSources(goal, load());
    const analysis = analyzeResearch(research);
    expect(analysis.rows.map(row => row.total)).toEqual(['1001.00', '802.50']);
    expect(analysis.recommendation).toContain('Laptop B');
    expect(verifyResearch(goal, research, analysis).passed).toBe(true);
    expect(quantityTotal('0.29', 100)).toBe('29.00');
  });
  it('does not extract unrelated numbers or fabricate a price', async () => {
    const source = fixture({ [urls[0]]: '<title>Laptop</title><p>There are 100 units, a 20 percent discount and a 12 month warranty. Contact sales for price. More product documentation is available.</p>' });
    const research = await researchPublicSources('Compare laptop prices at ' + urls[0], source);
    expect(research.sources[0].prices).toEqual([]);
    expect(verifyResearch('Compare laptop prices', research, analyzeResearch(research)).passed).toBe(false);
  });
  it('rejects price changes that are not present in the publisher data', async () => {
    const research = await researchPublicSources(goal, load());
    research.sources[0].prices[0].value = '1.00';
    expect(verifyResearch(goal, research, analyzeResearch(research)).problems.join(' ')).toContain('publisher metadata');
  });
  it('rejects fabricated analysis numbers and wrong quantity calculations', async () => {
    const research = await researchPublicSources(goal, load()), analysis = analyzeResearch(research);
    analysis.rows[0].value = '1'; analysis.rows[1].total = '1';
    const check = verifyResearch(goal, research, analysis);
    expect(check.passed).toBe(false);
    expect(check.problems.join(' ')).toContain('unsupported price');
    expect(check.problems.join(' ')).toContain('Quantity calculation');
  });
  it('rejects stale and altered source snapshots', async () => {
    const research = await researchPublicSources(goal, load());
    research.sources[0].raw += 'tampered';
    research.sources[1].retrievedAt = '2020-01-01T00:00:00Z';
    expect(verifyResearch(goal, research, analyzeResearch(research)).problems.join(' ')).toMatch(/integrity.*stale/);
  });
  it('does not substitute chair reports for laptop requests', async () => {
    const research = await researchPublicSources(goal, fixture({ [urls[0]]: product('Office Chair A', '100'), [urls[1]]: product('Office Chair B', '200') }));
    expect(research.sources.every(source => source.prices.length === 0)).toBe(true);
    expect(verifyResearch(goal, research, analyzeResearch(research)).passed).toBe(false);
  });
  it('uses a model-name price when its single-product page identifies the requested product type', async () => {
    const body = product('Steelcase Series 1', '584').replace('<title>Steelcase Series 1</title>', '<title>Steelcase Series 1 Ergonomic Office Chair</title>');
    const research = await researchPublicSources('Compare prices for 100 office chairs at ' + urls[0], fixture({ [urls[0]]: body }));
    expect(analyzeResearch(research).rows[0]).toMatchObject({ value: '584', total: '58400' });
  });
  it('keeps missing supplier prices and requested delivery terms as acceptance gaps', async () => {
    const source = fixture({ [urls[0]]: product('Laptop A', '100'), [urls[1]]: '<title>Laptop B</title><p>Laptop B product specifications. Please contact sales for prices and availability. Shipping is quoted separately.</p>' });
    const research = await researchPublicSources(goal, source);
    expect(verifyResearch(goal, research, analyzeResearch(research)).problems.join(' ')).toContain('only 1');
    const complete = await researchPublicSources(goal, load());
    expect(verifyResearch(goal + ' and delivery terms', complete, analyzeResearch(complete)).passed).toBe(false);
  });
  it('preserves supplier research near a city and reports a larger source requirement', async () => {
    const result = await runAutonomousMandate({ goal: goal + ' near Lagos', loadSource: load() });
    expect(result.mandate.domain).toBe('procurement');
    expect(result.deliverable.sources).toHaveLength(2);
    expect(researchPlan('Find 4 suppliers of 10 laptops')).toMatchObject({ minimumSources: 4 });
  });
  it('keeps negotiated quotes missing and does not call unit-price estimates vendor quotes', async () => {
    const request = 'Find negotiated volume quotes for 100 laptops at ' + urls.join(' ');
    const research = await researchPublicSources(request, load());
    const analysis = analyzeResearch(research);
    expect(verifyResearch(request, research, analysis).problems.join(' ')).toContain('vendor confirmation');
    expect(analysis.report).toContain('not negotiated quotations');
  });
  it('does not rank different currencies as equivalent prices', async () => {
    const research = await researchPublicSources(goal, fixture({ [urls[0]]: product('Laptop A', '100', 'USD'), [urls[1]]: product('Laptop B', '80', 'EUR') }));
    expect(analyzeResearch(research).recommendation).not.toContain('Lowest');
  });
  it('executes every specialist and charges no research fee even when API keys exist', async () => {
    const settle = vi.fn();
    vi.stubEnv('OPENAI_API_KEY', 'must-not-be-used');
    try {
      const result = await runAutonomousMandate({ goal, loadSource: load(), settleEscrow: settle });
      expect(result.delegation.map(task => task.status)).toEqual(['completed', 'completed', 'completed']);
      expect(result.deliverable.verification.passed).toBe(true);
      expect(result.payout).toMatchObject({ status: 'not_requested', onchain: false });
      expect(result.budgetState.spent).toBe('$0');
      expect(settle).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it('never calls escrow for failed or incomplete evidence', async () => {
    const settle = vi.fn();
    const result = await runAutonomousMandate({ goal: goal + '; escrow 0.01 NEAR to researcher.testnet', loadSource: fixture({}), settleEscrow: settle });
    expect(result.mandate.status).toBe('partial');
    expect(result.payout.status).toBe('blocked');
    expect(settle).not.toHaveBeenCalled();
  });
  it('passes a verified proof and explicit amount to escrow only after all specialists run', async () => {
    const settle = vi.fn(async request => ({ id: request.id, userAccount: 'alice.testnet', action: 'escrow_release', asset: 'NEAR' as const, amount: request.amount, status: 'confirmed' as const, txHashes: ['confirmed-hash'], createdAt: new Date().toISOString() }));
    const result = await runAutonomousMandate({ goal: goal + '; escrow 0.01 NEAR to researcher.testnet', loadSource: load(), settleEscrow: settle });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.01', recipient: 'researcher.testnet', evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(result.payout.status).toBe('confirmed');
  });
  it('settles an explicitly authorized research fee through escrow using the default researcher', async () => {
    const settle = vi.fn(async request => ({ id: request.id, userAccount: 'alice.testnet', action: 'escrow_release', asset: 'NEAR' as const, amount: request.amount, status: 'confirmed' as const, txHashes: ['confirmed-hash'], createdAt: new Date().toISOString() }));
    const result = await runAutonomousMandate({ goal: goal + '; research fee 0.01 NEAR', loadSource: load(), settleEscrow: settle });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.01', recipient: 'mandate-generis-researcher.testnet' }));
    expect(result.payout).toMatchObject({ status: 'confirmed', amount: '0.01 testnet NEAR' });
  });
  it('reports exact remaining authorized NEAR after a research fee', async () => {
    const settle = vi.fn(async request => ({ id: request.id, userAccount: 'alice.testnet', action: 'escrow_release', asset: 'NEAR' as const, amount: request.amount, status: 'confirmed' as const, txHashes: ['confirmed-hash'], createdAt: new Date().toISOString() }));
    const result = await runAutonomousMandate({ goal: goal + '. Budget 0.05 NEAR; research fee 0.01 NEAR', loadSource: load(), settleEscrow: settle });
    expect(result.budgetState.remaining).toContain('0.04 testnet NEAR');
  });
  it('blocks fees above the native budget and per-agent cap without misrouting supplier research', async () => {
    const settle = vi.fn();
    const result = await runAutonomousMandate({ goal: goal + '. Spend up to 0.02 NEAR. Per-agent cap 0.005 NEAR; pay 0.01 NEAR for research', loadSource: load(), settleEscrow: settle });
    expect(result.mandate.domain).toBe('procurement');
    expect(result.deliverable.sources).toHaveLength(2);
    expect(result.payout.status).toBe('blocked');
    expect(result.deliverable.verification.problems.join(' ')).toContain('per-agent');
    expect(settle).not.toHaveBeenCalled();
  });
  it('never charges a research fee for an empty ledger', async () => {
    const settle = vi.fn();
    const result = await runAutonomousMandate({ goal: 'Audit past purchases in the settlement ledger; research fee 0.01 NEAR', ledger: [], settleEscrow: settle });
    expect(result.payout.status).toBe('blocked');
    expect(settle).not.toHaveBeenCalled();
  });
  it('shows an empty ledger without inventing settlements or compliance', async () => {
    const result = await runAutonomousMandate({ goal: 'Audit past purchases in the settlement ledger', ledger: [] });
    expect(result.deliverable.preview).toContain('No recorded wallet transactions');
    expect(result.payout.status).toBe('not_requested');
  });
  it('checks each saved confirmed receipt and reports failures', async () => {
    const operation = { id: 'saved-op', userAccount: 'alice.testnet', action: 'send', asset: 'NEAR' as const, amount: '1', status: 'confirmed' as const, txHashes: ['hash'], createdAt: new Date().toISOString() };
    const checker = vi.fn(async () => { throw new Error('Receipt does not match'); });
    const result = await runAutonomousMandate({ goal: 'Audit past purchases in the settlement ledger', ledger: [operation], checkReceipt: checker });
    expect(checker).toHaveBeenCalledWith(operation);
    expect(result.deliverable.verification.passed).toBe(false);
  });
  it('uses free live-feed schemas and distinguishes mainnet prices from testnet tokens', async () => {
    const source = fixture({ [REF_PRICES]: JSON.stringify({ 'wrap.near': { price: '4.46' }, 'usdt.tether-token.near': { price: '0.998927' } }),
      [REF_POOLS]: JSON.stringify([{ id: '1', token_account_ids: ['wrap.near', 'usdt.tether-token.near'], amounts: ['100', '200'], tvl: '20', total_fee: 30, update_time: Math.floor(Date.now() / 1000) }]) });
    const result = await runAutonomousMandate({ goal: 'Compare NEAR and USDT market prices and pool liquidity on Ref Finance', loadSource: source });
    expect(result.deliverable.verification.passed).toBe(true);
    expect(result.deliverable.preview).toContain('mainnet');
    expect(result.deliverable.preview).toContain('separate demonstration token');
  });
  it('retries a transient public feed failure once', async () => {
    const loader = fixture({ [REF_PRICES]: JSON.stringify({ 'wrap.near': { price: '4.46' }, 'usdt.tether-token.near': { price: '0.998927' } }), [REF_POOLS]: JSON.stringify([{ id: '1', token_account_ids: ['wrap.near', 'usdt.tether-token.near'], amounts: ['100', '200'], tvl: '20', total_fee: 30 }]) });
    let attempts = 0;
    const research = await researchNearMarket(async url => {
      if (url === REF_PRICES && attempts++ === 0) throw new Error('Transient timeout');
      return loader(url);
    });
    expect(research.sources).toHaveLength(2);
    expect(research.gaps).toEqual([]);
    expect(attempts).toBe(2);
  });
  it('preserves the requested subject and supplier count', () => {
    expect(researchPlan('Find three suppliers of 100 laptops. Spend up to $20.')).toMatchObject({ quantity: 100, minimumSources: 3 });
  });
});

describe('public source boundary', () => {
  it.each(['https://127.0.0.1/', 'https://10.0.0.1/', 'https://169.254.169.254/', 'https://[::1]/', 'https://localhost/', 'https://fake.example/', 'http://vendor.com/', 'https://user:password@vendor.com/', 'https://vendor.com:8080/'])('rejects unsafe or invented URL %s', url => expect(() => publicUrl(url)).toThrow());
  it('rejects local and mapped private addresses but permits public connections', () => {
    expect(publicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(publicAddress('172.20.0.1')).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
  });
});
