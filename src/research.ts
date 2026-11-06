import { createHash } from 'node:crypto';
import { loadPublicPage, publicUrl, type PublicPage, type SourceLoader } from './public-sources.js';
import { discoverSources, publisher, referenceLinks, supportingLinks, type SearchAttempt } from './discovery.js';
import { clarificationQuestions, evidenceGaps, evidenceRequirements, extractFindings, relevant, requestedLocation, topicTerms, type ResearchFinding } from './research-evidence.js';
import { reportCitations, reportFollowUps, readableFinding, researchTitle, topicResearchReport } from './research-report.js';

export interface PublishedPrice { value: string; currency: string; label: string; kind: 'published price' | 'market price' }
export interface ResearchSource {
  url: string; title: string; retrievedAt: string; hash: string; text: string; prices: PublishedPrice[]; raw?: string; supportingFor?: string; discoveredUrl?: string;
}
export interface ResearchResult {
  sources: ResearchSource[]; gaps: string[]; quantity: number; subject: string; minimumSources: number; negotiated: boolean;
  findings?: ResearchFinding[]; searches?: SearchAttempt[]; followUpQuestions?: string[];
  pricesRequested?: boolean; requestedFacets?: string[];
}
export const REF_PRICES = 'https://api.ref.finance/list-token-price';
export const REF_POOLS = 'https://api.ref.finance/list-top-pools';
const clean = (value: string) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
export const plainText = (html: string) => clean(html.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function sourceFromPage(page: PublicPage): ResearchSource {
  const title = plainText(page.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || new URL(page.url).hostname);
  const text = plainText(page.body).slice(0, 80_000);
  const prices: PublishedPrice[] = [];
  // Only structured Product/Offer data is treated as a product quote. Arbitrary numbers in prose are not prices.
  const visit = (value: any, product = '') => {
    if (Array.isArray(value)) { value.forEach(entry => visit(entry, product)); return; }
    if (!value || typeof value !== 'object') return;
    const types: string[] = Array.isArray(value['@type']) ? value['@type'] : [value['@type'] || ''];
    const label = types.includes('Product') ? String(value.name || title) : product;
    if (types.includes('Offer') && /^\d+(?:\.\d+)?$/.test(String(value.price)) && /^[A-Z]{3}$/.test(String(value.priceCurrency))) {
      prices.push({ value: String(value.price), currency: value.priceCurrency, label: product || title, kind: 'published price' });
    }
    if (types.includes('Product') && value.offers) visit(value.offers, label);
    for (const [key, entry] of Object.entries(value)) if (key !== 'offers') visit(entry, label);
  };
  for (const match of page.body.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* Invalid publisher metadata is not evidence. */ }
  }
  const metadata = new Map<string, string>();
  for (const tag of page.body.matchAll(/<meta\b[^>]+>/gi)) {
    const key = tag[0].match(/(?:property|itemprop)=["']([^"']+)/i)?.[1];
    const value = tag[0].match(/content=["']([^"']+)/i)?.[1];
    if (key && value) metadata.set(key.toLowerCase(), clean(value));
  }
  const amount = metadata.get('product:price:amount') || metadata.get('price');
  const currency = metadata.get('product:price:currency') || metadata.get('pricecurrency');
  if (amount && /^\d+(?:\.\d+)?$/.test(amount) && currency && /^[A-Z]{3}$/.test(currency)) prices.push({ value: amount, currency, label: title, kind: 'published price' });
  return { url: page.url, title, retrievedAt: page.retrievedAt, hash: digest(page.body), text, raw: page.body, prices: [...new Map(prices.map(price => [JSON.stringify(price), price])).values()].filter(price => Number.isFinite(Number(price.value)) && Number(price.value) > 0 && price.value.length < 40).slice(0, 12) };
}

export function researchPlan(goal: string) {
  const urls = [...new Set((goal.match(/https:\/\/[^\s<>"')]+/g) || []).map(url => url.replace(/[.,;]+$/, '')))];
  const withoutUrls = goal.replace(/https:\/\/\S+/g, '').replace(/;?\s*escrow\s+\d+(?:\.\d+)?\s+NEAR\s+to\s+\S+/gi, '').replace(/(?:you may|spend|budget|up to|no more than)[^.]*[$£€]\s*\d+(?:\.\d+)?[^.]*/gi, '');
  const subjectInput = withoutUrls.replace(/^(?:compare|research|analy[sz]e)\s+(?:the\s+)?(?:published\s+)?(?:prices?|pricing|benefits?|risks?|advantages?|disadvantages?)[\s\S]*?\b(?:for|of)\s+/i, '');
  const subject = subjectInput.replace(/,\s*(?:compare|prepare|and prepare)\b[\s\S]*$/i, '').replace(/\b(find|compare|research|analy[sz]e|verify|explain|summari[sz]e|investigate|identify|gather|published|public|online|prices?|pricing|suppliers?|vendors?|of|for|at|the|and|three|two|please|kord|mandate|quotations?|quotes?|what is|how does|tell me about|benefits?|risks?|advantages?|disadvantages?|pros|cons)\b/gi, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.,;:]+\s*|[.,;]+$/g, '');
  const quantity = Number(withoutUrls.match(/\b(\d+)\s+(?:office\s+)?(?:chairs?|laptops?|units?|items?)/i)?.[1] || 1);
  const requestedCount = withoutUrls.match(/\b(three|two|one|\d+)\s+(?:suppliers?|vendors?|providers?|sources?)/i)?.[1]?.toLowerCase();
  const count = requestedCount ? ({ three: 3, two: 2, one: 1 } as Record<string, number>)[requestedCount] || Number(requestedCount) : Math.max(urls.length, 2);
  return { urls, subject, quantity, minimumSources: count, negotiated: /negotiated|bulk quotes?|volume quotes?|100[- ]unit.*quote/i.test(goal) };
}

export async function researchPublicSources(goal: string, load: SourceLoader = loadPublicPage, onActivity?: (title: string, detail: string) => void, options: { queries?: string[]; deadline?: number } = {}): Promise<ResearchResult> {
  const plan = researchPlan(goal), requirements = evidenceRequirements(goal), sources: ResearchSource[] = [], searches: SearchAttempt[] = [];
  const seen = new Set<string>(), frontier = new Map<string, { url: string }>(), deadline = Math.min(Date.now() + 38_000, options.deadline ?? Infinity);
  const namedNear = /\bNEAR\b/.test(plan.subject) || /\bnear protocol\b/i.test(plan.subject);
  if (!topicTerms(plan.subject).length && !namedNear) return { ...plan, sources, searches, findings: [], gaps: ['A specific research topic or question is needed.'], followUpQuestions: ['What subject or question should I research?'], pricesRequested: requirements.prices, requestedFacets: requirements.facets };
  const linkTerms = new RegExp([...topicTerms(plan.subject).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'documentation', 'docs', 'protocol'].join('|'), 'i');
  let requests = 0;
  const bounded: SourceLoader = async url => {
    const remaining = Math.min(7000, deadline - Date.now());
    if (remaining <= 0 || ++requests > 32) throw new Error('Research reached its bounded retrieval limit.');
    let timer: ReturnType<typeof setTimeout>;
    try { return await Promise.race([load(url), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Research source timed out.')), remaining); })]); }
    finally { clearTimeout(timer!); }
  };
  const collect = async (candidates: { url: string; parent?: string }[]) => {
    const selected: typeof candidates = [];
    for (const candidate of candidates) {
      if (selected.length >= 8 || seen.size >= 18) break;
      if (!seen.has(candidate.url)) { seen.add(candidate.url); selected.push(candidate); }
    }
    if (!selected.length) return;
    onActivity?.('Reading source pages', `Retrieving ${selected.length} candidate pages and checking their relevance to ${plan.subject}.`);
    const results = await Promise.allSettled(selected.map(async ({ url, parent }) => {
      const source = sourceFromPage(await bounded(publicUrl(url).href));
      if (source.text.length < 80 || /captcha|verify (?:that )?you are human|access denied|enable javascript to continue/i.test(source.text.slice(0, 700))) return;
      if (source.raw && new URL(source.url).hostname !== 'en.wikipedia.org' && (relevant(source, plan.subject) || (namedNear && publisher(source.url) === 'near.org'))) {
        const keywords = topicTerms(plan.subject);
        const score = (link: string) => keywords.filter(keyword => link.toLowerCase().includes(keyword)).length;
        const links = supportingLinks(source.raw, source.url, linkTerms, 1000).sort((a, b) => score(b) - score(a)).slice(0, 3);
        for (const link of links) if (!seen.has(link)) frontier.set(link, { url: link });
      }
      if (!parent && !relevant(source, plan.subject)) return;
      if (parent) { source.supportingFor = parent; source.discoveredUrl = url; }
      const terms = topicTerms(plan.subject), singleProduct = new Set(source.prices.map(price => price.label)).size === 1;
      const productMatches = singleProduct && terms.some(term => source.title.toLowerCase().includes(term));
      if (terms.length) source.prices = source.prices.filter(price => productMatches || terms.some(term => price.label.toLowerCase().includes(term)));
      return source;
    }));
    for (const result of results) if (result.status === 'fulfilled' && result.value && !sources.some(source => source.url === result.value!.url)) sources.push(result.value);
  };
  const bootstrap = /chair/i.test(plan.subject) ? ['https://www.ikea.com/us/en/p/markus-office-chair-vissle-dark-gray-90289172/', 'https://store.steelcase.com/seating/office-chairs/steelcase-series-1', 'https://www.hermanmiller.com/products/seating/office-chairs/verus-chairs/']
    : /laptop/i.test(plan.subject) ? ['https://frame.work/products/laptop-13-gen-intel', 'https://www.dell.com/en-us/shop/laptops/scr/laptops', 'https://www.lenovo.com/us/en/c/laptops/']
    : /corridor|cross.border|stablecoin/i.test(goal) ? ['https://www.bridge.xyz/', 'https://bvnk.com/', 'https://yellowcard.io/']
    : namedNear ? ['https://docs.near.org/'] : [];
  let initial = plan.urls;
  if (!initial.length) {
    onActivity?.('Searching the web', 'Searching independent public indexes; links are optional and search snippets are not evidence.');
    const queries = [plan.subject + (requirements.prices ? ' published prices' : ''), ...(options.queries || []), plan.subject + ' ' + (requirements.facets[0] || 'official sources')].slice(0, 4);
    initial = [...bootstrap, ...await discoverSources([...new Set(queries)], bounded, searches)];
  }
  await collect(initial.map(url => ({ url })));
  const findings = () => sources.flatMap(source => extractFindings(source, plan.subject, goal));
  const gaps = () => evidenceGaps(goal, sources, findings(), plan.minimumSources);
  const followReferences = async () => {
    const links = [...frontier.values(), ...sources.flatMap(source => {
      const policies = source.raw && requirements.facets.length ? supportingLinks(source.raw, source.url, /ship|deliver|freight|warrant|stock|countr|coverage|supported|pricing|fees/i).slice(0, 2).map(url => ({ url, parent: source.url })) : [];
      return [...policies, ...referenceLinks(source.raw || '', source.url, plan.subject).slice(0, 5).map(url => ({ url }))];
    })].filter(({ url }) => !seen.has(url));
    if (links.length && gaps().length) {
      onActivity?.('Following publisher evidence', 'Opening published policy pages and primary references to resolve outstanding acceptance criteria.');
      await collect(links);
    }
  };
  await followReferences();
  if (gaps().length && Date.now() < deadline && requests < 24) {
    onActivity?.('Researching unresolved evidence', gaps().join(' '));
    const namedTopic = /\bNEAR\b/.test(plan.subject) || /\bnear protocol\b/i.test(plan.subject) ? 'NEAR Protocol' : '';
    const focus = (namedTopic ? namedTopic + ' ' : '') + (topicTerms(plan.subject).join(' ') || plan.subject) + (requestedLocation(goal) ? ' ' + requestedLocation(goal)!.place : '');
    const queries = [focus.trim(), namedTopic || (focus + ' ' + (requirements.prices ? 'price delivery' : requirements.facets.join(' '))).trim()].filter(Boolean);
    const discovered = await discoverSources([...new Set(queries)], bounded, searches, true);
    await collect(discovered.map(url => ({ url })));
    await followReferences();
  }
  const problems = gaps();
  if (plan.negotiated) problems.push('Negotiated or volume quotations require vendor confirmation; public unit prices do not establish those terms.');
  return { ...plan, sources, findings: findings(), searches, gaps: problems, followUpQuestions: clarificationQuestions(goal, problems), pricesRequested: requirements.prices, requestedFacets: requirements.facets };
}

/** Public mainnet observations are labelled separately from the testnet demonstration token. */
export async function researchNearMarket(load: SourceLoader = loadPublicPage): Promise<ResearchResult> {
  // These large public feeds can take longer than a general source page. Topic discovery
  // retains its original page timeout and overall serverless deadline.
  const read: SourceLoader = load === loadPublicPage ? url => loadPublicPage(url, 0, 10_000) : load;
  const retrieve = async (url: string) => {
    try { return await read(url); }
    catch { return read(url); } // One bounded retry for transient public-feed failures.
  };
  const results = await Promise.allSettled([retrieve(REF_PRICES), retrieve(REF_POOLS)]);
  const sources: ResearchSource[] = [], gaps: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') { gaps.push('Ref Finance feed unavailable: ' + result.reason.message); continue; }
    try {
      const page = result.value, data = JSON.parse(page.body);
      if (index === 0) {
        const prices = ['wrap.near', 'usdt.tether-token.near'].flatMap(token => {
          const entry = data[token];
          return entry && /^\d+(?:\.\d+)?$/.test(String(entry.price)) ? [{ value: String(entry.price), currency: 'USD', label: token, kind: 'market price' as const }] : [];
        });
        const text = JSON.stringify({ network: 'NEAR mainnet', prices });
        if (prices.length !== 2) throw new Error('NEAR or USDT price is missing.');
        sources.push({ url: page.url, title: 'Ref Finance · NEAR mainnet token prices', retrievedAt: page.retrievedAt, hash: digest(text), text, prices });
      } else {
        if (!Array.isArray(data)) throw new Error('Invalid liquidity feed.');
        const pools = data.filter(pool => pool.token_account_ids?.includes('wrap.near') && pool.token_account_ids?.includes('usdt.tether-token.near'))
          .filter(pool => Number.isFinite(Number(pool.tvl)) && Number(pool.tvl) >= 0)
          .sort((a,b) => Number(b.tvl) - Number(a.tvl)).slice(0, 3)
          .map(pool => ({ id: String(pool.id), tokens: pool.token_account_ids, reserves: pool.amounts, tvlUsd: String(pool.tvl), swapFeeBasisPoints: pool.total_fee, updatedAt: pool.update_time }));
        if (!pools.length) throw new Error('No NEAR/USDT pool was published.');
        const text = JSON.stringify({ network: 'NEAR mainnet', pools });
        sources.push({ url: page.url, title: 'Ref Finance · NEAR/USDT pool reserves and TVL', retrievedAt: page.retrievedAt, hash: digest(text), text, prices: [] });
      }
    } catch (error: any) { gaps.push(error.message); }
  }
  return { sources, gaps, subject: 'NEAR / USDT public market data', quantity: 1, minimumSources: 2, negotiated: false };
}

const markdown = (value: string) => value.replace(/[|\[\]\n\r]/g, ' ').trim();
function priceUnits(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return { amount: BigInt(whole + fraction), decimals: fraction.length };
}
export function quantityTotal(value: string, quantity: number) {
  const { amount, decimals } = priceUnits(value);
  const total = amount * BigInt(quantity), scale = 10n ** BigInt(decimals);
  return decimals ? `${total / scale}.${String(total % scale).padStart(decimals, '0')}` : String(total);
}
function comparePrices(a: string, b: string) {
  const left = priceUnits(a), right = priceUnits(b);
  const difference = left.amount * 10n ** BigInt(right.decimals) - right.amount * 10n ** BigInt(left.decimals);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
export function analyzeResearch(research: ResearchResult) {
  const findings = (research.findings || []).map(finding => ({ ...finding }));
  const rows = research.sources.filter(source => !source.supportingFor).flatMap(source => source.prices.length
    ? source.prices.map(price => ({ source: source.url, label: price.label, value: price.value, currency: price.currency, total: price.kind === 'published price' ? quantityTotal(price.value, research.quantity) : '', kind: price.kind }))
    : [{ source: source.url, label: source.title, value: '', currency: '', total: '', kind: 'public information' }]);
  const citations = reportCitations(research);
  const table = '| Source / product | Observed price | Quantity estimate |\n|---|---|---|\n' + rows.map(row =>
    `| ${markdown(row.label)} ${citations.cite(row.source)} | ${row.value ? markdown(row.value + ' ' + row.currency) : 'Not published'} | ${row.total ? markdown(row.total + ' ' + row.currency + ' for ' + research.quantity) : 'Not applicable'} |`
  ).join('\n');
  const comparable = rows.filter(row => row.kind === 'published price' && row.value && row.currency);
  const currencies = new Set(comparable.map(row => row.currency));
  const lowest = currencies.size === 1 && comparable.length >= 2 ? [...comparable].sort((a,b) => comparePrices(a.value, b.value))[0] : undefined;
  const recommendation = rows.some(row => row.kind === 'market price') ? 'These are public NEAR mainnet market observations. Pool reserves and TVL are not private fiat corridor liquidity. KORD Test USDT is a separate demonstration token; this research does not trade or move funds.'
    : lowest ? `Lowest observed published price: **${markdown(lowest.label)}**, ${lowest.value} ${lowest.currency}. Confirm the exact specification, shipping, tax, stock and any quantity discount with the vendor before purchasing.`
    : 'The sources do not establish a comparable lowest supplier price. Compare specifications and obtain any missing commercial terms before committing funds.';
  const liquidity = research.sources.filter(source => source.url === REF_POOLS).flatMap(source => {
    try { return JSON.parse(source.text).pools.map((pool: any) => ({ ...pool, source: source.url })); } catch { return []; }
  });
  const formatReserve = (value: string, decimals: number) => {
    const amount = BigInt(value), scale = 10n ** BigInt(decimals);
    return `${amount / scale}.${String(amount % scale).padStart(decimals, '0').slice(0, 4)}`;
  };
  const liquidityTable = liquidity.length ? '\n## Public pool liquidity\n\n| Pool | NEAR reserve | USDT reserve | Published TVL (USD) | Swap fee |\n|---|---|---|---|---|\n' + liquidity.map((pool: any) =>
    `| ${pool.id} | ${formatReserve(pool.reserves[pool.tokens.indexOf('wrap.near')], 24)} | ${formatReserve(pool.reserves[pool.tokens.indexOf('usdt.tether-token.near')], 6)} | ${Number(pool.tvlUsd).toFixed(2)} | ${(Number(pool.swapFeeBasisPoints) / 100).toFixed(2)}% |`).join('\n') + '\n\nReserves and TVL describe the public DEX pool. They do not guarantee an executable quote or fiat payout capacity.\n\n' : '';
  const topicReport = topicResearchReport(research, findings);
  const commercialTerms = (research.requestedFacets || []).map(facet => {
    const entries = findings.filter(finding => finding.kind === facet);
    const heading = facet === 'delivery' ? 'Published delivery terms' : 'Published ' + facet + ' terms';
    const unique = [...new Set(research.sources.filter(source => !source.supportingFor).map(source => publisher(source.url)))];
    return `### ${heading}\n\n` + unique.map(owner => {
      const terms = entries.find(finding => publisher(finding.source) === owner);
      return `- **${owner}:** ${terms ? markdown(readableFinding(terms.excerpt, research.subject, facet)) + ' ' + citations.cite(terms.source) : 'Not established by the retrieved sources.'}`;
    }).join('\n') + '\n\n';
  }).join('');
  const report = research.pricesRequested === false ? topicReport : `# ${researchTitle(research.subject)}\n\n${recommendation}\n\n## Published observations\n\n${table}\n${liquidityTable}\n\n` +
    (research.quantity > 1 ? 'Quantity estimates multiply the published unit price; they are not negotiated quotations and exclude unpublished shipping and tax.\n\n' : '') +
    commercialTerms + reportFollowUps(research) + citations.sources();
  return { rows, report, recommendation: research.pricesRequested === false ? 'Review the cited findings and the requested topic evidence.' : recommendation, liquidity, findings };
}

export function verifyResearch(goal: string, research: ResearchResult, analysis: ReturnType<typeof analyzeResearch>) {
  const problems = [...research.gaps];
  if (research.sources.length < research.minimumSources) problems.push(`Need ${research.minimumSources} readable sources; retrieved ${research.sources.length}.`);
  if (research.negotiated) problems.push('Negotiated or volume quotations require vendor confirmation; public unit prices do not establish those terms.');
  const terms = topicTerms(research.subject).filter(term => !['market', 'data', 'recorded', 'settlement', 'receipt'].includes(term));
  for (const source of research.sources) {
    try { publicUrl(source.url); } catch { problems.push('Invalid evidence URL: ' + source.url); }
    if (source.hash !== digest(source.raw || source.text)) problems.push('Source integrity changed: ' + source.url);
    if (source.raw) {
      const original = sourceFromPage({ url: source.url, body: source.raw, contentType: 'text/html', retrievedAt: source.retrievedAt });
      if (source.text !== original.text || source.title !== original.title) problems.push('Source excerpt does not match the retrieved page: ' + source.url);
      if (source.prices.some(price => !original.prices.some(observed => JSON.stringify(observed) === JSON.stringify(price)))) problems.push('Price is not backed by publisher metadata: ' + source.url);
    } else if (source.prices.length) {
      try {
        const observed = JSON.parse(source.text).prices;
        if (!Array.isArray(observed) || source.prices.some(price => !observed.some(entry => JSON.stringify(entry) === JSON.stringify(price)))) throw new Error();
      } catch { problems.push('Market price is not backed by the feed snapshot: ' + source.url); }
    }
    if (!Number.isFinite(Date.parse(source.retrievedAt)) || Math.abs(Date.now() - Date.parse(source.retrievedAt)) > 15 * 60_000) problems.push('Source observation is stale: ' + source.url);
    if (source.supportingFor) {
      const parent = research.sources.find(entry => entry.url === source.supportingFor);
      if (!parent?.raw || publisher(parent.url) !== publisher(source.url) || !supportingLinks(parent.raw, parent.url, /./, 1000).some(url => url === source.url || url === source.discoveredUrl)) problems.push('Supporting evidence was not linked by the compared publisher: ' + source.url);
    } else if (terms.length && ![REF_PRICES, REF_POOLS].includes(source.url) && !relevant(source, research.subject)) problems.push('Source does not match the requested subject: ' + source.url);
  }
  if (research.findings) {
    for (const finding of analysis.findings) {
      const source = research.sources.find(source => source.url === finding.source);
      if (!source || !source.text.includes(finding.excerpt) || !extractFindings(source, research.subject, goal).some(entry => entry.kind === finding.kind && entry.excerpt === finding.excerpt)) problems.push('A finding is not backed by its cited source passage.');
    }
    problems.push(...evidenceGaps(goal, research.sources, analysis.findings, research.minimumSources));
  }
  if (/\b(?:three|two|one|\d+)\s+(?:suppliers?|vendors?|providers?)/i.test(goal)) {
    const publishers = new Set(research.sources.filter(source => !source.supportingFor).map(source => publisher(source.url)));
    if (publishers.size < research.minimumSources) problems.push('The requested number of independent suppliers or providers was not established.');
  }
  if (/price|pricing|quotations?|quotes?/i.test(goal) && !analysis.rows.some(row => row.value)) problems.push('No publisher-backed prices were found.');
  if (/price|pricing|quotations?|quotes?/i.test(goal) && !analysis.rows.some(row => row.kind === 'market price')) {
    const pricedSources = new Set(analysis.rows.filter(row => row.value).map(row => row.source));
    if (pricedSources.size < research.minimumSources) problems.push(`Need published prices from ${research.minimumSources} sources; only ${pricedSources.size} sources publish usable prices.`);
  }
  if (!research.findings && /\b(?:delivery terms|delivery times?|lead times?|freight|shipping costs?|warranty terms?|in stock|stock availability)\b/i.test(goal)) problems.push('The requested delivery, freight, warranty or stock terms require vendor evidence; structured unit prices do not establish those commercial terms.');
  for (const row of analysis.rows) {
    const source = research.sources.find(source => source.url === row.source);
    if (!source || (row.value && !source.prices.some(price => price.value === row.value && price.currency === row.currency && price.label === row.label))) problems.push('Analysis contains an unsupported price.');
    if (row.total && row.total !== quantityTotal(row.value, research.quantity)) problems.push('Quantity calculation does not match the observed unit price.');
  }
  for (const pool of analysis.liquidity) {
    const source = research.sources.find(source => source.url === pool.source);
    try {
      if (!source || !JSON.parse(source.text).pools.some((observed: any) => JSON.stringify({ ...observed, source: source.url }) === JSON.stringify(pool))) throw new Error();
    } catch { problems.push('Liquidity analysis is not backed by the feed snapshot.'); }
  }
  return { passed: problems.length === 0, problems: [...new Set(problems)], evidenceHash: digest(JSON.stringify(research.sources.map(source => ({ url: source.url, hash: source.hash, retrievedAt: source.retrievedAt })))) };
}
