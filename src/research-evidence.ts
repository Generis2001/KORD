import { publisher } from './discovery.js';
import type { ResearchSource } from './research.js';

export type FindingKind = 'finding' | 'delivery' | 'warranty' | 'availability' | 'coverage' | 'liquidity' | 'benefits' | 'risks';
export interface ResearchFinding { source: string; kind: FindingKind; excerpt: string }
const ignored = new Set('find compare research analyze analyse analysis verify verification explain summarize summarise investigate assess describe recommend recommendation recommendations prepare identify gather published public price prices pricing supplier suppliers vendor vendors provider providers competitor competitors source sources office delivery terms information benefits risks advantages disadvantages coverage corridor cross border what which how does works work please kord mandate online evidence verified quotations quotes the and for with from about into that this something can could would should you your me use using protocol mechanism near hello hey okay thanks help kindly detailed comprehensive brief answer report overview give'.split(' '));
const aliases: Record<string, RegExp> = { consensus: /\bconsensus\b|proof[- ]of[- ]stake|\bdoomslug\b|block finality/i, solar: /\bsolar\b|photovoltaic|\bPV\b/i };
const contains = (text: string, term: string) => aliases[term] ? aliases[term].test(text) : term.length <= 3 ? new RegExp('\\b' + term + '\\b', 'i').test(text) : text.toLowerCase().includes(term);
export function topicTerms(subject: string) {
  const core = subject.replace(/\bnear\s+[A-Z][a-z][\w -]*(?:$|[.,;])/g, '');
  return [...new Set(core.toLowerCase().split(/\W+/).filter(word => (word.length > 2 || /^(?:ai|ml|us|uk|eu)$/.test(word)) && !ignored.has(word) && !/^\d+$/.test(word)).map(word => /(?:ss|us|is)$/.test(word) ? word : word.replace(/s$/, '')))];
}
export function relevant(source: Pick<ResearchSource, 'title' | 'text'> & { url?: string }, subject: string) {
  const branded = /\bNEAR\b/.test(source.title + ' ' + source.text) || /\bnear (?:protocol|blockchain)\b/i.test(source.title + ' ' + source.text) || /(?:^|\.)near\.(?:org|network)$/.test(source.url ? new URL(source.url).hostname : '');
  if ((/\bNEAR\b/.test(subject) || /\bnear protocol\b/i.test(subject)) && !branded) return false;
  const terms = topicTerms(subject), text = (source.title + ' ' + source.text).toLowerCase();
  return !terms.length || terms.filter(term => contains(text, term)).length >= Math.min(2, terms.length);
}

export function evidenceRequirements(goal: string) {
  const facets: FindingKind[] = [];
  if (/\b(?:delivery terms|delivery times?|lead times?|freight|shipping(?: costs?| terms)?)\b/i.test(goal)) facets.push('delivery');
  if (/warranty/i.test(goal)) facets.push('warranty');
  if (/in stock|stock availability|availability/i.test(goal)) facets.push('availability');
  if (/corridor|coverage|countries supported|supported countries/i.test(goal)) facets.push('coverage');
  if (/liquidity/i.test(goal)) facets.push('liquidity');
  if (/benefits?|advantages?|pros\b/i.test(goal)) facets.push('benefits');
  if (/risks?|disadvantages?|drawbacks?|cons\b/i.test(goal)) facets.push('risks');
  return { prices: /price|pricing|quotations?|quotes?|fees?\b/i.test(goal), facets };
}

export function requestedLocation(goal: string) {
  const delivery = goal.match(/\b(?:deliver(?:y)?|ship(?:ping)?)\s+to\s+([^.;\n]+)/i)?.[1];
  const local = goal.match(/\bnear\s+([A-Z][a-z][\w -]*)/)?.[1];
  const place = (delivery || local || '').split(/,|\s+(?:and|by|before|within|for|with|at|compare|prepare)\b/i)[0].trim();
  return place ? { place, delivery: Boolean(delivery) } : null;
}

const facetMatch: Record<Exclude<FindingKind, 'finding'>, RegExp> = {
  delivery: /\b(?:ship(?:ping|s)?|deliver(?:y|ies|ed)?|dispatch|lead time|freight)\b/i,
  warranty: /warrant(?:y|ies)|guarantee/i,
  availability: /in stock|out of stock|available|availability|backorder/i,
  coverage: /countries|country|corridor|coverage|latin america|latam|africa|brazil|mexico|nigeria|kenya|ghana|colombia/i,
  liquidity: /liquidity|reserves?|market depth|trading volume/i,
  benefits: /benefit|advantage|improv|reduc|efficien|affordab|clean energy|renewable|lower cost|cost sav|secure|fast|scalab/i,
  risks: /risk|disadvantage|challenge|limitation|drawback|costly|expensive|intermitt|volatile|fraud|delay|depends on|dependent on/i,
};
export function evidenceSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?][”"']?(?=\s+[A-Z0-9“"])/g)) {
    const end = match.index! + match[0].length;
    if (/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|No)|\b[A-Z])\.$/.test(text.slice(start, end))) continue;
    sentences.push(text.slice(start, end).trim()); start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}
function concrete(kind: FindingKind, text: string) {
  if (kind === 'delivery') return /\b\d+(?:\s*[-–]\s*\d+)?\s*(?:(?:business|working|calendar)\s+)?(?:days?|weeks?|months?)\b|free shipping|free delivery|(?:shipping|delivery).{0,65}(?:[$£€]\s*\d|calculated at checkout)/i.test(text);
  if (kind === 'warranty') return /\d+.{0,20}(?:year|month)|lifetime|limited warranty/i.test(text);
  return true;
}

/** Extract exact, short passages. A citation never turns a generated sentence into evidence. */
export function extractFindings(source: ResearchSource, subject: string, goal: string): ResearchFinding[] {
  const terms = topicTerms(subject), candidates = new Set<string>();
  const normalize = (text: string) => text.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
  for (const block of (source.raw || '').matchAll(/<(?:p|li|h[1-6])\b[^>]*>([\s\S]*?)<\/(?:p|li|h[1-6])>/gi)) {
    const text = normalize(block[1]);
    candidates.add(text);
    evidenceSentences(text).forEach(sentence => candidates.add(sentence));
  }
  if (!candidates.size) evidenceSentences(source.text).forEach(sentence => candidates.add(sentence));
  const passages = [...candidates].filter(text => text.length >= 45 && text.length <= 700 && source.text.includes(text) &&
    (/[.!?]$/.test(text) || /\b(?:is|are|was|were|has|have|can|could|will|would|provide|use|support|reduce|face|remain|account|increase|decrease|operate|ship|deliver)\w*\b/i.test(text)) &&
    !/cookie|sign up|subscribe|privacy policy|all rights reserved|browse the docs|skip to|↑|\bRetrieved\b|\bISBN\b|\bdoi\b/i.test(text));
  const score = (text: string) => terms.filter(term => contains(text, term)).length;
  const quality = (text: string) => score(text) * 3 - Math.max(0, text.length - 320) / 160
    - Math.max(0, evidenceSentences(text).length - 1) * 3
    - (/^(?:he|she|it|they|this|these)\b|testament to our|dedication and commitment/i.test(text) ? 3 : 0);
  const sorted = passages.sort((a, b) => quality(b) - quality(a) || a.length - b.length);
  const findings: ResearchFinding[] = [];
  for (const kind of evidenceRequirements(goal).facets) {
    const match = sorted.find(text => facetMatch[kind as Exclude<FindingKind, 'finding'>].test(text) && concrete(kind, text));
    // Keep the policy paragraph so the next sentence's exclusions and conditions survive.
    const excerpt = match && /delivery|warranty|availability/.test(kind)
      ? passages.filter(text => text.includes(match)).sort((a, b) => b.length - a.length)[0] : match;
    if (excerpt) findings.push({ source: source.url, kind, excerpt });
  }
  const selected: string[] = [];
  const requiredTerms = terms.filter(term => contains(source.title, term)).length >= Math.min(2, terms.length) ? 1 : Math.min(2, terms.length);
  for (const excerpt of sorted.filter(text => !terms.length || (score(text) >= requiredTerms && (contains(text, terms[0]) || contains(source.title, terms[0]))))) {
    // A paragraph and its individual sentences must not occupy multiple finding slots.
    if (selected.some(text => text.includes(excerpt) || excerpt.includes(text))) continue;
    selected.push(excerpt);
    findings.push({ source: source.url, kind: 'finding', excerpt });
    if (selected.length === 4) break;
  }
  return findings;
}

export function evidenceGaps(goal: string, sources: ResearchSource[], findings: ResearchFinding[], minimum: number) {
  const requirements = evidenceRequirements(goal), problems: string[] = [];
  const primary = sources.filter(source => !source.supportingFor);
  const owners = new Set(primary.filter(source => requirements.prices || findings.some(finding => finding.source === source.url && finding.kind === 'finding')).map(source => publisher(source.url)));
  if (owners.size < minimum) problems.push(`Need ${minimum} independent sources; retrieved evidence from ${owners.size} publishers.`);
  if (requirements.prices) {
    const priced = new Set(primary.filter(source => source.prices.length).map(source => publisher(source.url)));
    if (priced.size < minimum) problems.push(`Need published prices from ${minimum} sources; only ${priced.size} sources publish usable prices.`);
  }
  for (const facet of requirements.facets) {
    const supported = new Set(findings.filter(finding => finding.kind === facet).map(finding => publisher(finding.source)));
    const required = /delivery|warranty|availability/.test(facet) && /supplier|vendor|chair|laptop|procure/i.test(goal) ? [...owners] : [];
    if (!supported.size || required.some(owner => !supported.has(owner))) problems.push(`Published ${facet} evidence is still needed${required.length ? ' for each compared supplier' : ''}.`);
  }
  const location = requestedLocation(goal);
  if (location && /suppliers?|vendors?|chairs?|laptops?|delivery|shipping/i.test(goal)) {
    const words = location.place.toLowerCase().split(/\W+/).filter(Boolean);
    for (const owner of owners) {
      const supported = findings.some(finding => publisher(finding.source) === owner && (!location.delivery || finding.kind === 'delivery') && words.every(word => new RegExp('\\b' + word + '\\b', 'i').test(finding.excerpt)));
      if (!supported) problems.push(`Published ${location.delivery ? 'delivery coverage' : 'local supplier'} evidence for ${location.place} is needed from ${owner}.`);
    }
  }
  if (requirements.facets.includes('coverage')) {
    const coverage = findings.filter(finding => finding.kind === 'coverage').map(finding => finding.excerpt).join(' ');
    if (/latam|latin america/i.test(goal) && !/latam|latin america|brazil|mexico|colombia|argentina|chile|peru/i.test(coverage)) problems.push('LATAM country or corridor coverage needs published evidence.');
    if (/africa/i.test(goal) && !/africa|nigeria|kenya|ghana|uganda|tanzania|south africa/i.test(coverage)) problems.push('Africa country or corridor coverage needs published evidence.');
  }
  if (!requirements.prices && primary.length && !findings.some(finding => finding.kind === 'finding')) problems.push('The retrieved pages do not yet contain usable passages answering this topic.');
  return problems;
}

export function clarificationQuestions(goal: string, problems: string[]) {
  if (!problems.length) return [];
  const questions: string[] = [];
  if (/delivery|shipping|freight/i.test(goal) && !/\b(?:deliver|ship|shipping|delivery)\s+to\s+\S+/i.test(goal)) questions.push('Which country and city should the suppliers deliver to?');
  if (/corridor|cross.border/i.test(goal) && /coverage|price|liquidity/i.test(problems.join(' '))) questions.push('Which sending and receiving countries, payment amount and currency should I compare?');
  if (!questions.length && /independent sources/i.test(problems.join(' '))) questions.push('Should I broaden the search to additional publications, or focus on a particular part of this question?');
  if (!questions.length) questions.push('Which specific product, organisation or geographic scope should I focus the next research pass on?');
  return questions;
}
