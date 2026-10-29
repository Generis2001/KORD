import { publicUrl, type SourceLoader } from './public-sources.js';

const decode = (text: string) => text.replace(/&amp;|&#38;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const searchHosts = /(^|\.)(duckduckgo\.com|bing\.com|google\.com|yahoo\.com)$/i;
export const publisher = (value: string) => new URL(value).hostname.replace(/^(?:www|store|shop|help|support|docs|api)\./i, '').toLowerCase();

/** Search results locate evidence. Their snippets are never used as evidence. */
export function searchLinks(body: string, base: string): string[] {
  const links: string[] = [];
  const add = (href: string) => {
    try {
      const link = new URL(decode(href.trim()), base);
      const target = publicUrl(link.searchParams.get('uddg') || (link.pathname === '/url' ? link.searchParams.get('q') : null) || link.href);
      if (!searchHosts.test(target.hostname) && !/\.(?:pdf|jpg|png|svg|zip)(?:$|\?)/i.test(target.pathname)) links.push(target.href);
    } catch { /* A search result never bypasses public URL validation. */ }
  };
  if (body.trim().startsWith('{')) {
    try {
      const data = JSON.parse(body);
      for (const entry of data.query?.search || data.pages || []) if (entry.title || entry.key) add('https://en.wikipedia.org/wiki/' + encodeURIComponent((entry.key || entry.title).replace(/ /g, '_')));
    } catch { /* A malformed search response supplies no evidence links. */ }
  } else if (/<rss\b/i.test(body)) {
    for (const item of body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
      const link = item[1].match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1];
      if (link) add(link.replace(/^<!\[CDATA\[|\]\]>$/g, ''));
    }
  } else {
    for (const tag of body.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
      if (!/class=["'][^"']*(?:result__a|result-link)|<h3\b/i.test(tag[0])) continue;
      const href = tag[0].match(/href=["']([^"']+)/i)?.[1];
      if (href) add(href);
    }
  }
  return [...new Set(links)].slice(0, 8);
}

export interface SearchAttempt { query: string; provider: string; found: number; error?: string }
export async function discoverSources(queries: string[], load: SourceLoader, attempts: SearchAttempt[], fallback = false) {
  const found = await Promise.allSettled(queries.slice(0, 2).flatMap(query => [
    ...(fallback ? [
      { provider: 'Google', url: 'https://www.google.com/search?gbv=1&q=' + encodeURIComponent(query) },
      { provider: 'Wikipedia', url: 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&srlimit=5&format=json' },
    ] : [
      { provider: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query) },
      { provider: 'Bing', url: 'https://www.bing.com/search?format=rss&setlang=en-US&q=' + encodeURIComponent(query) },
    ]),
  ].map(async ({ provider, url }) => {
    try {
      const page = await load(url), links = searchLinks(page.body, page.url);
      attempts.push({ query, provider, found: links.length });
      return links;
    } catch (error: any) {
      attempts.push({ query, provider, found: 0, error: error.message });
      return [];
    }
  })));
  return [...new Set(found.flatMap(result => result.status === 'fulfilled' ? result.value : []))];
}

export function referenceLinks(body: string, base: string, subject = '') {
  if (new URL(base).hostname !== 'en.wikipedia.org') return [];
  const links: { url: string; label: string }[] = [];
  for (const section of body.matchAll(/<ol\b[^>]*class=["'][^"']*references[^"']*["'][^>]*>([\s\S]*?)<\/ol>/gi)) {
    for (const anchor of section[1].matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
      try {
        let target = publicUrl(new URL(decode(anchor[1]), base).href);
        if (target.hostname === 'web.archive.org') {
          const original = target.pathname.match(/^\/web\/[^/]+\/(https:\/\/.*)$/)?.[1];
          if (!original) continue;
          target = publicUrl(original);
        }
        if (!/(^|\.)wikipedia\.org$/.test(target.hostname) && !/\.(pdf|zip)$|licenses?\/|LICENSE[-.]?/i.test(target.pathname)) links.push({ url: target.href, label: anchor[0] });
      } catch { /* Only fetch public, readable reference pages. */ }
    }
  }
  const words = subject.toLowerCase().split(/\W+/).filter(word => word.length > 3 && !['research', 'mechanism'].includes(word));
  const score = (entry: { url: string; label: string }) => words.filter(word => (entry.url + ' ' + entry.label).toLowerCase().includes(word)).length;
  return [...new Set(links.sort((a, b) => score(b) - score(a)).map(entry => entry.url))].slice(0, 8);
}

/** Follow only links actually published by the source, on the same publisher's domain. */
export function supportingLinks(body: string, base: string, terms: RegExp, limit = 4) {
  const links: string[] = [];
  for (const anchor of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const target = publicUrl(new URL(decode(anchor[1]), base).href);
      if (publisher(target.href) === publisher(base) && target.href !== base && terms.test(target.pathname + ' ' + anchor[2].replace(/<[^>]+>/g, ' '))) links.push(target.href);
    } catch { /* Ignore login, downloads and private URLs. */ }
  }
  return [...new Set(links)].slice(0, limit);
}
