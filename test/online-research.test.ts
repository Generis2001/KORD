import { describe, expect, it, vi } from 'vitest';
import { referenceLinks, searchLinks } from '../src/discovery.js';
import { analyzeResearch, researchPublicSources, verifyResearch } from '../src/research.js';
import { researchPaymentRequest } from '../src/research-payment.js';
import { runAutonomousMandate } from '../src/runner.js';
import type { SourceLoader } from '../src/public-sources.js';

const a = 'https://energy-a.org/solar-nigeria', b = 'https://energy-b.org/solar-nigeria';
const article = (name: string) => `<title>${name}: Solar energy in Nigeria</title><p>Solar energy in Nigeria provides renewable electricity and reduces dependence on fuel generators.</p><p>Solar energy in Nigeria faces challenges from intermittent generation and expensive battery storage.</p>`;
const links = (urls: string[]) => urls.map(url => `<a href="${url}" class="result__a">Publisher evidence</a>`).join('');
const rss = (urls: string[]) => '<rss><channel>' + urls.map(url => `<item><link>${url}</link></item>`).join('') + '</channel></rss>';
const page = (url: string, body: string) => ({ url, body, contentType: 'text/html', retrievedAt: new Date().toISOString() });
const question = 'Research and analyze the benefits and risks of solar energy in Nigeria';
function loader(pages: Record<string, string>, discovered = [a, b]): SourceLoader {
  return vi.fn(async url => {
    if (url.includes('duckduckgo.com')) return page(url, links(discovered));
    if (url.includes('bing.com')) return page(url, rss(discovered));
    if (!pages[url]) throw new Error('Unavailable publisher');
    return page(url, pages[url]);
  });
}

describe('online research without supplied links', () => {
  it('discovers sources and returns a cited topical answer with benefits and risks, without a pricing table', async () => {
    const result = await runAutonomousMandate({ goal: question, loadSource: loader({ [a]: article('Energy A'), [b]: article('Energy B') }) });
    expect(result.mandate.status).toBe('completed');
    expect(result.deliverable.verification.passed).toBe(true);
    expect(result.deliverable.preview).toMatch(/^# Solar energy in Nigeria/);
    expect(result.deliverable.preview).toContain('### Benefits');
    expect(result.deliverable.preview).toContain('### Risks');
    expect(result.deliverable.preview).toContain(`[1](${a})`);
    expect(result.deliverable.preview).not.toMatch(/See the overview|## Answer|attributed passages/);
    expect(result.deliverable.preview.match(/reduces dependence on fuel generators/g)).toHaveLength(1);
    expect(result.deliverable.preview.match(/expensive battery storage/g)).toHaveLength(1);
    expect(result.deliverable.preview).not.toMatch(/Not published|lowest supplier|Missing evidence|HTTPS.*links/);
    expect(result.deliverable.searches?.some(search => search.found === 2)).toBe(true);
    expect(result.payout.status).toBe('not_requested');
  });

  it('replaces unavailable evidence through another search provider without retaining resolved gaps', async () => {
    const c = 'https://energy-c.org/solar-nigeria';
    const load: SourceLoader = vi.fn(async url => {
      if (url.includes('duckduckgo.com')) return page(url, links([a, b]));
      if (url.includes('bing.com')) throw new Error('Search blocked');
      if (url.includes('google.com')) return page(url, `<a href="${c}"><h3>Solar energy in Nigeria</h3></a>`);
      if (url === a || url === c) return page(url, article(url === a ? 'Energy A' : 'Energy C'));
      throw new Error('Unavailable');
    });
    const research = await researchPublicSources(question, load), check = verifyResearch(question, research, analyzeResearch(research));
    expect(research.sources.map(source => source.url)).toEqual([a, c]);
    expect(research.gaps).toEqual([]);
    expect(check.passed).toBe(true);
    expect(research.searches?.some(search => search.provider === 'Google')).toBe(true);
  });

  it('reads actual linked delivery policies and checks them instead of always rejecting delivery evidence', async () => {
    const x = 'https://vendor-a.com/chair', y = 'https://vendor-b.com/chair';
    const product = (name: string, price: string) => `<title>${name} Office chair</title><p>This office chair is intended for use in commercial offices, with published specifications and adjustable armrests.</p><a href="/shipping">Shipping policy</a><script type="application/ld+json">{"@type":"Product","name":"Office chair","offers":{"@type":"Offer","price":"${price}","priceCurrency":"USD"}}</script>`;
    const load: SourceLoader = vi.fn(async url => {
      if (url === x || url === y) return page(url, product(url === x ? 'A' : 'B', url === x ? '100' : '120'));
      if (url.endsWith('/shipping')) return page(url, '<title>Shipping policy</title><p>Orders ship within 5 business days after confirmation, with free shipping for qualifying domestic orders.</p>');
      throw new Error('Unavailable');
    });
    const goal = `Compare prices and delivery terms for 10 office chairs at ${x} ${y}`;
    const research = await researchPublicSources(goal, load), analysis = analyzeResearch(research);
    expect(verifyResearch(goal, research, analysis).passed).toBe(true);
    expect(research.sources.filter(source => source.supportingFor)).toHaveLength(2);
    expect(analysis.report).toContain('5 business days');
    expect(analysis.report).toContain('Published delivery terms');
  });

  it('does not verify global offers as local suppliers or destination-specific delivery', async () => {
    const body = '<title>Office chair</title><p>Office chair orders ship within 5 business days with free shipping for qualifying domestic orders.</p><script type="application/ld+json">{"@type":"Product","name":"Office chair","offers":{"@type":"Offer","price":"100","priceCurrency":"USD"}}</script>';
    for (const scope of ['near Lagos', 'with delivery terms, ship to Lagos']) {
      const goal = `Compare office chair prices ${scope} at ${a} ${b}`;
      const research = await researchPublicSources(goal, loader({ [a]: body, [b]: body }));
      expect(verifyResearch(goal, research, analyzeResearch(research)).problems.join(' ')).toContain('evidence for Lagos');
    }
  });

  it('does not treat unrelated pages mentioning near as NEAR Protocol evidence', async () => {
    const unrelated = '<title>Consensus in politics</title><p>Near the city, citizens use consensus as a mechanism for making decisions about local services.</p>';
    const goal = 'Research the NEAR consensus mechanism';
    const research = await researchPublicSources(goal, loader({ [a]: unrelated, [b]: unrelated }));
    expect(research.sources).toEqual([]);
    expect(verifyResearch(goal, research, analyzeResearch(research)).passed).toBe(false);
  });

  it('follows relevant documentation links to establish a second source for a NEAR topic', async () => {
    const independent = 'https://blockchain-research.org/near-consensus';
    const load: SourceLoader = vi.fn(async url => {
      if (url.includes('duckduckgo.com')) return page(url, links([independent]));
      if (url.includes('bing.com')) return page(url, rss([independent]));
      if (url === 'https://docs.near.org/') return page(url, '<title>NEAR Documentation</title><p>Documentation for developers building applications and deploying contracts on the NEAR network.</p><a href="/protocol/consensus">Consensus documentation</a>');
      if (url === 'https://docs.near.org/protocol/consensus' || url === independent) return page(url, '<title>NEAR consensus</title><p>NEAR uses a proof-of-stake consensus mechanism to coordinate validators and secure its blockchain.</p>');
      throw new Error('Unavailable');
    });
    const result = await runAutonomousMandate({ goal: 'Research the NEAR consensus mechanism', loadSource: load });
    expect(result.deliverable.verification.passed).toBe(true);
    expect(result.deliverable.preview).toContain('proof-of-stake');
    expect(result.deliverable.preview).not.toContain('mainnet token prices');
    expect(result.deliverable.sources.some(source => source.url.endsWith('/protocol/consensus'))).toBe(true);
  });

  it('uses factual passages rather than chart labels and reference-list entries', async () => {
    const body = '<title>Solar energy in Nigeria</title><h3>Nigeria energy demand by scenario, 2018-2040</h3><li>Retrieved 2025. Solar energy in Nigeria, journal references.</li><p>Solar energy in Nigeria can reduce reliance on diesel generators while requiring investment in storage.</p>';
    const research = await researchPublicSources('Research solar energy in Nigeria', loader({ [a]: body, [b]: body }));
    const report = analyzeResearch(research).report;
    expect(report).toContain('reliance on diesel');
    expect(report).not.toMatch(/Retrieved 2025|demand by scenario/);
  });

  it('does not count a documentation menu as a supported answer', async () => {
    const body = '<title>NEAR Documentation</title><p>Build applications using documentation and development tools for the NEAR blockchain network.</p><div>Browse the docs. Protocol Accounts, access keys, gas, transactions, consensus, and more.</div>';
    const goal = 'Research the NEAR consensus mechanism';
    const research = await researchPublicSources(goal, loader({ [a]: body, [b]: body }));
    expect(verifyResearch(goal, research, analyzeResearch(research)).passed).toBe(false);
    expect(analyzeResearch(research).report).not.toContain('Browse the docs');
  });

  it('recognizes factual consensus passages using the protocol’s published terminology', async () => {
    const body = '<title>NEAR finality</title><p>NEAR achieves block finality through Doomslug, with validators approving each new block of the blockchain.</p>';
    const goal = 'Research the NEAR consensus mechanism';
    const research = await researchPublicSources(goal, loader({ [a]: body, [b]: body }));
    expect(verifyResearch(goal, research, analyzeResearch(research)).passed).toBe(true);
    expect(analyzeResearch(research).report).toContain('Doomslug');
  });

  it('rejects invented passages and forged supporting-source relationships', async () => {
    const research = await researchPublicSources(question, loader({ [a]: article('A'), [b]: article('B') }));
    const analysis = analyzeResearch(research);
    analysis.findings[0].excerpt = 'Solar energy in Nigeria is always free and has no risks.';
    expect(verifyResearch(question, research, analysis).problems).toContain('A finding is not backed by its cited source passage.');
    research.sources[1].supportingFor = a;
    expect(verifyResearch(question, research, analyzeResearch(research)).problems.join(' ')).toContain('not linked');
  });

  it('does not count multiple pages or subdomains of one publisher as independent verification', async () => {
    const same = 'https://www.energy-a.org/other-solar-nigeria';
    const research = await researchPublicSources(question, loader({ [a]: article('A'), [same]: article('A') }, [a, same]));
    expect(verifyResearch(question, research, analyzeResearch(research)).passed).toBe(false);
  });

  it('never uses a search snippet as evidence and asks for useful context when research remains incomplete', async () => {
    const result = await runAutonomousMandate({ goal: question, loadSource: loader({}, [a, b]) });
    expect(result.deliverable.sources).toEqual([]);
    expect(result.deliverable.verification.passed).toBe(false);
    expect(result.deliverable.followUpQuestions?.length).toBeGreaterThan(0);
    expect(result.deliverable.preview).not.toContain('Add HTTPS');
  });
  it('asks for a concrete topic instead of retrieving unrelated evidence or charging for an ambiguous request', async () => {
    const load = vi.fn(), settle = vi.fn();
    const result = await runAutonomousMandate({ goal: 'Research something; research fee 0.01 NEAR', loadSource: load, settleEscrow: settle });
    expect(result.deliverable.followUpQuestions).toEqual(['What subject or question should I research?']);
    expect(result.payout.status).toBe('blocked');
    expect(load).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it('releases an explicit natural-language testnet fee only after link-free research and verification', async () => {
    const settle = vi.fn(async request => ({ id: request.id, userAccount: 'alice.testnet', action: 'escrow_release', asset: 'NEAR' as const, amount: request.amount, recipient: request.recipient, evidenceHash: request.evidenceHash, status: 'confirmed' as const, txHashes: ['confirmed-fee-hash'], createdAt: new Date().toISOString() }));
    const result = await runAutonomousMandate({ goal: question + ', charge a research fee of 0.01 testnet NEAR.', loadSource: loader({ [a]: article('A'), [b]: article('B') }), settleEscrow: settle });
    expect(result.deliverable.verification.passed).toBe(true);
    expect(result.mandate.goal).toBe(question);
    expect(result.payout).toMatchObject({ status: 'confirmed', amount: '0.01 testnet NEAR', onchain: true });
    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.01', evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });

  it('blocks the research fee when the requested evidence is incomplete', async () => {
    const settle = vi.fn();
    const result = await runAutonomousMandate({ goal: question + ' and pay 0.01 NEAR for research', loadSource: loader({ [a]: article('A') }), settleEscrow: settle });
    expect(result.payout.status).toBe('blocked');
    expect(settle).not.toHaveBeenCalled();
  });
});

describe('discovery links and explicit fee authorization', () => {
  it('parses RSS, reference search and reordered HTML attributes, rejecting unsafe search links', () => {
    expect(searchLinks(rss([a, 'https://localhost/private']), 'https://www.bing.com/')).toEqual([a]);
    expect(searchLinks(links([a]), 'https://html.duckduckgo.com/')).toEqual([a]);
    expect(searchLinks(JSON.stringify({ query: { search: [{ title: 'Solar power' }] } }), 'https://en.wikipedia.org/w/api.php')).toEqual(['https://en.wikipedia.org/wiki/Solar_power']);
  });
  it('deduplicates archive references with their original publisher and ignores licensing links and Wikipedia self-links', () => {
    const body = `<ol class="references"><li><a href="https://en.wikipedia.org/wiki/Solar">Self</a><a href="https://github.com/near/nearcore/licenses/LICENSE-MIT">License</a><a href="${a}">Research</a><a href="https://web.archive.org/web/20200101/${a}">Archive</a></li></ol>`;
    expect(referenceLinks(body, 'https://en.wikipedia.org/wiki/Solar_energy')).toEqual([a]);
  });
  it.each(['; research fee 0.01 NEAR', ', charge a research fee of 0.01 testnet NEAR.', '. Pay 0.01 NEAR for research.', ' and pay 0.01 NEAR for research'])('parses the authorized fee suffix %s', suffix => {
    expect(researchPaymentRequest(question + suffix)).toMatchObject({ amount: '0.01', researchGoal: question, problem: '' });
  });
  it('never infers a fee from a dollar budget or a native spending ceiling', () => {
    expect(researchPaymentRequest(question + '. Spend up to $20 on research.')).toBeNull();
    expect(researchPaymentRequest(question + '. Budget 0.05 NEAR')).toBeNull();
    expect(researchPaymentRequest(question + '; research fee 0.01 NEAR; research fee 0.02 NEAR')?.problem).toContain('one explicit');
    expect(researchPaymentRequest('research fee 0.01 NEAR')?.problem).toContain('research question');
  });
});
