import { publisher } from './discovery.js';
import { evidenceSentences, topicTerms, type ResearchFinding } from './research-evidence.js';
import type { ResearchResult } from './research.js';

const safeText = (value: string) => value.replace(/[\[\]|\r\n]/g, ' ').replace(/[*_`<>]/g, '').trim();
const labels: Record<string, string> = {
  benefits: 'Benefits', risks: 'Risks', delivery: 'Delivery', warranty: 'Warranty',
  availability: 'Availability', coverage: 'Coverage', liquidity: 'Liquidity',
};
const facetPatterns: Record<string, RegExp> = {
  benefits: /benefit|advantage|improv|reduc|efficien|affordab|renewable|clean energy/i,
  risks: /risk|challenge|expensive|intermitt|limitation|volatile|depends on|dependent on/i,
  delivery: /ship|deliver|dispatch|lead time|freight/i,
  warranty: /warrant|guarantee/i, availability: /stock|available|backorder/i,
  coverage: /countries|country|corridor|coverage/i, liquidity: /liquidity|reserve|depth|volume/i,
};
const orphan = /^(?:he|she|it|they|this|these|the company)\b/i;
export function researchTitle(subject: string) {
  const title = safeText(subject);
  return title ? title[0].toUpperCase() + title.slice(1) : 'Research';
}

/** Select a complete sentence and remove speech padding, retaining claim qualifiers. */
export function readableFinding(excerpt: string, subject: string, kind = 'finding') {
  const terms = topicTerms(subject);
  const sentences = evidenceSentences(excerpt).filter(sentence => sentence.length >= 45);
  const score = (sentence: string) => terms.filter(term => sentence.toLowerCase().includes(term)).length * 3
    + (facetPatterns[kind]?.test(sentence) ? 10 : 0)
    - Math.max(0, sentence.length - 280) / 60
    - (orphan.test(sentence) ? 6 : 0);
  const selected = /^(?:delivery|warranty|availability)$/.test(kind) ? excerpt : [...sentences].sort((a, b) => score(b) - score(a))[0] || excerpt;
  let text = selected.replace(/^(?:he|she) said:\s*[“"]?/i, '')
    .replace(/^(?:however,\s*|in addition,\s*|but\s+)/i, '').replace(/^[“"]+|[”"]+$/g, '').trim();
  text = text.replace(/\bis set to change the narrative by providing\b/i, 'plans to provide')
    .replace(/,?\s+will complement\b[^.!?]+?\bthrough (?:the )?provision of\b/i, ' aims to provide')
    .replace(/^Incentivise the creation of\s+/i, 'The stated target is to create ')
    .replace(/^In addition to [^,]+,\s+(.+?) is also\s+/i, '$1 is ');
  return text ? text[0].toUpperCase() + text.slice(1) : excerpt;
}

function theme(finding: ResearchFinding, text: string) {
  if (finding.kind !== 'finding') return labels[finding.kind] || 'Key findings';
  if (/investment|credit|financ|funding|central bank|letters of intent/i.test(text)) return 'Funding and policy';
  if (/jobs?|training|entrepreneur|capacity.building|employment/i.test(text)) return 'Jobs and skills';
  if (/risk|challenge|expensive|intermitt|limitation|barrier/i.test(text)) return 'Risks and constraints';
  if (/company|companies|provider|business|launch|expan|market share/i.test(text)) return 'Businesses and expansion';
  if (/grid|blackouts?|electricity access|energy access|unserved|rural communit/i.test(text)) return 'Energy access';
  return 'Key findings';
}

function similar(left: string, right: string) {
  const words = (text: string) => new Set(text.toLowerCase().split(/\W+/).filter(word => word.length > 3));
  const a = words(left), b = words(right);
  const overlap = [...a].filter(word => b.has(word)).length;
  // Distinct numbers, dates or negations can change the meaning of otherwise similar claims.
  const qualifiers = (text: string) => (text.toLowerCase().match(/\b\d[\d.,]*\b|\b(?:not|no|never|may|could|plans?|aims?|target|proposed)\b/g) || []).sort().join(' ');
  return left.toLowerCase() === right.toLowerCase() || qualifiers(left) === qualifiers(right)
    && overlap / Math.max(1, Math.min(a.size, b.size)) > 0.78;
}

export function reportCitations(research: ResearchResult) {
  const cited: string[] = [];
  return {
    cite(url: string) {
      if (!cited.includes(url)) cited.push(url);
      return `[${cited.indexOf(url) + 1}](${url})`;
    },
    sources() {
      if (!cited.length) return '';
      return '### Sources\n\n' + cited.map((url, index) => {
        const source = research.sources.find(source => source.url === url)!;
        return `- [${index + 1}. ${safeText(source.title)}](${url}) · ${publisher(url)}`;
      }).join('\n');
    },
  };
}

export function reportFollowUps(research: ResearchResult) {
  let report = '';
  if (research.gaps.length) report += '### Open questions\n\n' + [...new Set(research.gaps)].map(gap => '- ' + safeText(gap)).join('\n') + '\n\n';
  if (research.followUpQuestions?.length) report += '### To refine this research\n\n' + [...new Set(research.followUpQuestions)].map(question => '- ' + safeText(question)).join('\n') + '\n\n';
  return report;
}

/** Build an extractive brief; exact supporting passages remain in the workflow. */
export function topicResearchReport(research: ResearchResult, findings: ResearchFinding[]) {
  const sources = [...research.sources].sort((a, b) => Number(new URL(a.url).hostname === 'en.wikipedia.org') - Number(new URL(b.url).hostname === 'en.wikipedia.org'));
  const requested = research.requestedFacets || [];
  const priority = (text: string) => (/\d|\b(?:million|billion|thousand)\b/i.test(text) ? 2 : 0)
    - (/^the (?:on-demand .*? )?platform\b/i.test(text) ? 3 : 0) - text.length / 600;
  const candidates = findings.map(finding => {
    const text = readableFinding(finding.excerpt, research.subject, finding.kind);
    // Route overview passages into requested sections so benefits/risks do not appear twice.
    const facet = requested.find(kind => findings.some(entry => entry.source === finding.source && entry.kind === kind && similar(readableFinding(entry.excerpt, research.subject, kind), text)));
    return { finding, text, theme: facet ? labels[facet] : theme(finding, text) };
  }).filter(entry => !orphan.test(entry.text) && !/testament to our|dedication and commitment/i.test(entry.text))
    .sort((a, b) => sources.findIndex(source => source.url === a.finding.source) - sources.findIndex(source => source.url === b.finding.source) || priority(b.text) - priority(a.text));
  const chosen: typeof candidates = [];
  // Round-robin selection keeps one prolific publisher from taking over the answer.
  for (let round = 0; round < 2; round++) {
    const owners = new Set<string>();
    for (const candidate of candidates) {
      const owner = publisher(candidate.finding.source);
      if (candidate.finding.kind !== 'finding' || owners.has(owner) || chosen.some(entry => similar(entry.text, candidate.text))) continue;
      if (chosen.filter(entry => entry.theme === candidate.theme).length >= 2 || chosen.length >= 6) continue;
      chosen.push(candidate); owners.add(owner);
    }
  }
  const citations = reportCitations(research);
  const render = (entry: typeof candidates[number]) => {
    const qualifier = /letters of intent/i.test(entry.text) ? '**Investment intentions:** '
      : /\btarget|aims? to|plans? to|set to\b|\bwill\b/i.test(entry.text) ? '**Plan or target:** ' : '';
    return `${qualifier}${safeText(entry.text)} ${citations.cite(entry.finding.source)}`;
  };
  // Keep requested facets in their sections. A duplicate overview adds no information.
  const lead = chosen.find(entry => !requested.some(facet => labels[facet] === entry.theme)
    && /benefit|provides?|reduces?|access|blackout|grid/i.test(entry.text) && !/letters of intent|aims? to|plans? to/i.test(entry.text))
    || chosen.find(entry => !requested.some(facet => labels[facet] === entry.theme));
  let report = `# ${researchTitle(research.subject)}\n\n`;
  if (lead) report += render(lead) + '\n\n';
  if (!chosen.length && !candidates.length) report += 'The retrieved pages do not yet establish a supported answer to this question.\n\n';
  const groups = new Map<string, typeof candidates>();
  for (const entry of chosen.filter(entry => entry !== lead)) {
    if (!groups.has(entry.theme)) groups.set(entry.theme, []);
    groups.get(entry.theme)!.push(entry);
  }
  for (const facet of requested) {
    const entries: typeof candidates = [];
    for (const candidate of candidates.filter(entry => entry.finding.kind === facet)) {
      if (entries.length >= 2 || entries.some(entry => similar(entry.text, candidate.text))) continue;
      entries.push(candidate);
    }
    groups.set(labels[facet] || facet, entries);
  }
  for (const [label, entries] of groups) {
    report += `### ${label}\n\n` + (entries.length ? entries.map(entry => '- ' + render(entry)).join('\n') : 'The retrieved sources do not establish this yet.') + '\n\n';
  }
  return (report + reportFollowUps(research) + citations.sources()).trim();
}
