import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) blocked.addSubnet(address, prefix, 'ipv4');

export function publicAddress(address: string) {
  const normalized = address.replace(/^::ffff:/i, '');
  if (isIP(normalized) === 4) return !blocked.check(normalized, 'ipv4');
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
}
export function publicUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      /(^localhost$|\.(local|localhost|internal|example|invalid|test)$)/i.test(host) ||
      (isIP(host) && !publicAddress(host)) || (!isIP(host) && !host.includes('.'))) throw new Error('Use a public HTTPS source URL.');
  url.hash = '';
  return url;
}

export interface PublicPage { url: string; body: string; contentType: string; retrievedAt: string }
export type SourceLoader = (url: string) => Promise<PublicPage>;

/** Resolves and checks the address used by the HTTPS connection, including every redirect. */
export async function loadPublicPage(value: string, redirects = 0, timeoutMs = 6500): Promise<PublicPage> {
  const url = publicUrl(value);
  if (redirects > 3) throw new Error('Source redirected too many times.');
  const response = await new Promise<{ status: number; headers: IncomingHttpHeaders; bytes: Buffer }>((resolve, reject) => {
    const request = https.get(url, {
      autoSelectFamily: false,
      headers: { 'User-Agent': 'KORD/1.0 public-source-research', Accept: 'text/html,application/json,text/plain', 'Accept-Encoding': 'identity' },
      lookup: ((host: string, _options: unknown, callback: any) => {
        lookup(host, { all: true }).then(addresses => {
          const target = addresses.find(entry => publicAddress(entry.address));
          if (!target) throw new Error('Source resolves to a private address.');
          callback(null, target.address, target.family);
        }).catch(error => callback(error));
      }) as any,
    } as https.RequestOptions & { autoSelectFamily: boolean }, incoming => {
      const chunks: Buffer[] = []; let size = 0;
      incoming.on('data', chunk => {
        size += chunk.length;
        if (size > 2_000_000) { incoming.destroy(new Error('Source exceeds the download limit.')); return; }
        chunks.push(chunk);
      });
      incoming.on('error', reject);
      incoming.on('end', () => resolve({ status: incoming.statusCode || 0, headers: incoming.headers, bytes: Buffer.concat(chunks) }));
    });
    const timeout = setTimeout(() => request.destroy(new Error('Source timed out.')), timeoutMs);
    request.on('close', () => clearTimeout(timeout));
    request.on('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) return loadPublicPage(new URL(response.headers.location, url).href, redirects + 1, timeoutMs);
  if (response.status !== 200) throw new Error('Source returned HTTP ' + response.status + '.');
  const contentType = String(response.headers['content-type'] || 'text/plain');
  if (!/text\/|json|xml/i.test(contentType)) throw new Error('Source is not a readable page or data feed.');
  const decompress = ({ gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync } as Record<string, typeof gunzipSync>)[String(response.headers['content-encoding'])];
  const bytes = decompress ? decompress(response.bytes, { maxOutputLength: 2_000_000 }) : response.bytes;
  return { url: url.href, body: bytes.toString('utf8'), contentType, retrievedAt: new Date().toISOString() };
}
