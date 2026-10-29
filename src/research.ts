import { createHash } from 'node:crypto';
import { loadPublicPage, publicUrl, type PublicPage, type SourceLoader } from './public-sources.js';

export interface PublishedPrice { value: string; currency: string; label: string; kind: 'published price' | 'market price' }
export interface ResearchSource {
  url: string; title: string; retrievedAt: string; hash: string; text: string; prices: PublishedPrice[]; raw?: string;
}
export interface ResearchResult { sources: ResearchSource[]; gaps: string[]; quantity: number; subject: string; minimumSources: number; negotiated: boolean }
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
  const subject = withoutUrls.replace(/\b(find|compare|research|identify|gather|published|public|prices?|pricing|suppliers?|vendors?|of|for|the|and|three|two|please|mandate|quotations?|quotes?)\b/gi, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  const quantity = Number(withoutUrls.match(/\b(\d+)\s+(?:office\s+)?(?:chairs?|laptops?|units?|items?)/i)?.[1] || 1);
  const requestedCount = withoutUrls.match(/\b(three|two|one|\d+)\s+(?:suppliers?|vendors?|providers?|sources?)/i)?.[1]?.toLowerCase();
  const count = requestedCount ? ({ three: 3, two: 2, one: 1 } as Record<string, number>)[requestedCount] || Number(requestedCount) : Math.max(urls.length, 2);
  return { urls, subject, quantity, minimumSources: count, negotiated: /negotiated|bulk quotes?|volume quotes?|100[- ]unit.*quote/i.test(goal) };
}

async function discover(subject: string, load: SourceLoader) {
  const page = await load('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(subject + ' published pricing'));
  const links: string[] = [];
  for (const match of page.body.matchAll(/<a\b(?=[^>]*class=["'][^"']*result__a)[^>]*href=["']([^"']+)/gi)) {
    try {
      const href = new URL(clean(match[1]), page.url);
      const target = href.searchParams.get('uddg') || href.href;
      links.push(publicUrl(target).href);
    } catch { /* Search results never bypass the source URL checks. */ }
  }
  return [...new Set(links)].slice(0, 5);
}

export async function researchPublicSources(goal: string, load: SourceLoader = loadPublicPage): Promise<ResearchResult> {
  const plan = researchPlan(goal), gaps: string[] = [];
  let urls = plan.urls;
  if (!urls.length) {
    try { urls = await discover(plan.subject || goal, load); }
    catch { /* Fall back to public publisher pages; never to fabricated content. */ }
    if (!urls.length && /chair/i.test(plan.subject)) urls = ['https://www.ikea.com/us/en/cat/office-chairs-20654/', 'https://www.steelcase.com/products/office-chairs/series-1/', 'https://www.hermanmiller.com/products/seating/office-chairs/verus-chairs/'];
    if (!urls.length && /laptop/i.test(plan.subject)) urls = ['https://frame.work/products/laptop-13-gen-intel', 'https://www.dell.com/en-us/shop/laptops/scr/laptops', 'https://www.lenovo.com/us/en/c/laptops/'];
    if (!urls.length && /corridor|cross.border|stablecoin/i.test(goal)) urls = ['https://www.bridge.xyz/', 'https://bvnk.com/', 'https://yellowcard.io/'];
    if (!urls.length) gaps.push('No public sources were discovered. Add HTTPS product or pricing links to the mandate.');
  }
  const results = await Promise.allSettled(urls.slice(0, 6).map(async url => sourceFromPage(await load(publicUrl(url).href))));
  const sources: ResearchSource[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.text.length > 80) {
      const terms = plan.subject.toLowerCase().split(/\W+/).filter(term => term.length > 3 && !['office', 'delivery', 'terms'].includes(term));
      if (terms.length) result.value.prices = result.value.prices.filter(price => terms.some(term => price.label.toLowerCase().includes(term.replace(/s$/, ''))));
      sources.push(result.value);
    }
    else gaps.push(urls[index] + ': ' + (result.status === 'rejected' ? result.reason.message : 'No readable source content.'));
  });
  return { ...plan, sources, gaps };
}

/** Public mainnet observations are labelled separately from the testnet demonstration token. */
export async function researchNearMarket(load: SourceLoader = loadPublicPage): Promise<ResearchResult> {
  const retrieve = async (url: string) => {
    try { return await load(url); }
    catch { return load(url); } // One bounded retry for transient public-feed failures.
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
  const rows = research.sources.flatMap(source => source.prices.length
    ? source.prices.map(price => ({ source: source.url, label: price.label, value: price.value, currency: price.currency, total: price.kind === 'published price' ? quantityTotal(price.value, research.quantity) : '', kind: price.kind }))
    : [{ source: source.url, label: source.title, value: '', currency: '', total: '', kind: 'public information' }]);
  const table = '| Source / product | Observed price | Quantity estimate | Evidence |\n|---|---|---|---|\n' + rows.map(row =>
    `| ${markdown(row.label)} | ${row.value ? markdown(row.value + ' ' + row.currency + ' · ' + row.kind) : 'Not published'} | ${row.total ? markdown(row.total + ' ' + row.currency + ' for ' + research.quantity) : 'Not applicable'} | [Source](${row.source}) |`).join('\n');
  const comparable = rows.filter(row => row.kind === 'published price' && row.value && row.currency);
  const currencies = new Set(comparable.map(row => row.currency));
  const lowest = currencies.size === 1 && comparable.length >= 2 ? [...comparable].sort((a,b) => comparePrices(a.value, b.value))[0] : undefined;
  const recommendation = rows.some(row => row.kind === 'market price') ? 'These are public NEAR mainnet market observations. Pool reserves and TVL are not private fiat corridor liquidity. Testnet Mandate USDT is a separate demonstration token; this research does not trade or move funds.'
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
  const report = `# Research for: ${markdown(research.subject)}\n\n## Published observations\n\n${table}\n${liquidityTable}\n## Executive recommendation\n\n${recommendation}\n\n` +
    (research.quantity > 1 ? 'Quantity estimates multiply the published unit price; they are not negotiated quotations and exclude unpublished shipping and tax.\n\n' : '') +
    research.sources.map(source => `### ${markdown(source.title)}\n\n[Evidence](${source.url}) · Retrieved ${source.retrievedAt}\n\n${source.url === REF_PRICES || source.url === REF_POOLS ? 'The published observations from this feed appear in the tables above.' : markdown(source.text.slice(0, 650))}\n`).join('\n') +
    (research.gaps.length ? '\n## Missing evidence\n\n' + research.gaps.map(gap => '- ' + markdown(gap)).join('\n') : '');
  return { rows, report, recommendation, liquidity };
}

export function verifyResearch(goal: string, research: ResearchResult, analysis: ReturnType<typeof analyzeResearch>) {
  const problems = [...research.gaps];
  if (research.sources.length < research.minimumSources) problems.push(`Need ${research.minimumSources} readable sources; retrieved ${research.sources.length}.`);
  if (research.negotiated) problems.push('Negotiated or volume quotations require vendor confirmation; public unit prices do not establish those terms.');
  const terms = research.subject.toLowerCase().split(/\W+/).filter(term => term.length > 3 && !['office', 'source', 'sources', 'compare', 'published', 'prices', 'data', 'market', 'information', 'terms', 'delivery', 'research'].includes(term));
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
    if (terms.length && !terms.some(term => (source.title + ' ' + source.text).toLowerCase().includes(term.replace(/s$/, '')))) problems.push('Source does not match the requested subject: ' + source.url);
  }
  if (/\b(?:three|two|one|\d+)\s+(?:suppliers?|vendors?|providers?)/i.test(goal)) {
    const publishers = new Set(research.sources.map(source => new URL(source.url).hostname.replace(/^www\./, '')));
    if (publishers.size < research.minimumSources) problems.push('The requested number of independent suppliers or providers was not established.');
  }
  if (/price|pricing|quotations?|quotes?/i.test(goal) && !analysis.rows.some(row => row.value)) problems.push('No publisher-backed prices were found.');
  if (/price|pricing|quotations?|quotes?/i.test(goal) && !analysis.rows.some(row => row.kind === 'market price')) {
    const pricedSources = new Set(analysis.rows.filter(row => row.value).map(row => row.source));
    if (pricedSources.size < research.minimumSources) problems.push(`Need published prices from ${research.minimumSources} sources; only ${pricedSources.size} sources publish usable prices.`);
  }
  if (/\b(?:delivery terms|delivery times?|lead times?|freight|shipping costs?|warranty terms?|in stock|stock availability)\b/i.test(goal)) problems.push('The requested delivery, freight, warranty or stock terms require vendor evidence; structured unit prices do not establish those commercial terms.');
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
