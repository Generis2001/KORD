import { PassThrough, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { KeyPair } from 'near-api-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const sourceLoader = vi.hoisted(() => vi.fn());
vi.mock('../src/public-sources.js', async original => ({ ...await original<typeof import('../src/public-sources.js')>(), loadPublicPage: sourceLoader }));
let handleRequest: typeof import('../src/server.js')['handleRequest'];
class Reply extends Writable {
  body = '';
  headersSent = false;
  statusCode = 200;
  headers: Record<string, string> = {};
  setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
  writeHead(status: number, headers: Record<string, string>) { this.statusCode = status; this.headersSent = true; for (const [name, value] of Object.entries(headers)) this.setHeader(name, value); }
  flushHeaders() { this.headersSent = true; }
  _write(chunk: Buffer, _encoding: string, next: () => void) { this.body += chunk.toString(); next(); }
}
beforeAll(async () => {
  vi.stubEnv('VERCEL', '1'); vi.stubEnv('MANDATE_DB', ':memory:');
  vi.stubEnv('POSTGRES_URL', ''); vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('NEAR_NETWORK', 'testnet'); vi.stubEnv('NEAR_RPC_URL', 'https://test.rpc.fastnear.com');
  vi.stubEnv('NEAR_ACCOUNT_ID', 'treasury.testnet'); vi.stubEnv('NEAR_PRIVATE_KEY', KeyPair.fromRandom('ed25519').toString());
  ({ handleRequest } = await import('../src/server.js'));
});
afterAll(() => vi.unstubAllEnvs());
function page(url: string) {
  return { url, body: '<title>Office Chair</title><p>Office chair product specifications and commercial information. Shipping and delivery details require confirmation from the supplier.</p><script type="application/ld+json">{"@type":"Product","name":"Office Chair","offers":{"@type":"Offer","price":"100","priceCurrency":"USD"}}</script>', contentType: 'text/html', retrievedAt: new Date().toISOString() };
}
function request(message: string, id: string, stream = false) {
  const req = Object.assign(new PassThrough(), { url: '/api/chat', method: 'POST', headers: { host: 'localhost', 'x-mandate-account': 'alice.testnet' } });
  const response = new Reply();
  const done = handleRequest(req as unknown as IncomingMessage, response as unknown as ServerResponse);
  req.end(JSON.stringify({ message, id, stream }));
  return { response, done };
}
const goal = 'Find three suppliers of 100 office chairs, compare their prices and delivery terms, and prepare a recommendation. You may spend up to $20 on research, but cannot purchase without approval';
describe('directive routing and streamed agent API', () => {
  it('emits genuine progress before research completes, followed by the exact chair result', async () => {
    let release = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    sourceLoader.mockImplementation(async url => { if (url.includes('duckduckgo')) throw new Error('Search unavailable'); await pending; return page(url); });
    const { response, done } = request(goal, 'mandate_chair_api', true);
    await vi.waitFor(() => expect(response.body).toContain('Orchestrator'));
    expect(response.body).not.toContain('"type":"result"');
    release(); await done;
    const events = response.body.trim().split('\n').map(line => JSON.parse(line));
    expect(events.slice(0, -1).every(event => event.type === 'progress')).toBe(true);
    expect(events.at(-1).type).toBe('result');
    expect([...new Set(events.slice(0, -1).map(event => event.step.phase))]).toEqual(['Orchestrator', 'Researcher', 'Analyst', 'Verifier']);
    expect(events.every(event => event.requestId === 'mandate_chair_api')).toBe(true);
    expect(events.at(-1).data.mandateResult.mandate).toMatchObject({ goal, requestedGoal: goal, domain: 'procurement' });
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    expect(response.headers['cache-control']).toContain('no-store');
  });
  it('keeps simultaneous chair and stablecoin requests separate in normal JSON mode', async () => {
    sourceLoader.mockImplementation(async url => { if (url.includes('duckduckgo')) throw new Error('Search unavailable'); return page(url); });
    const chairs = request(goal, 'mandate_chairs_parallel');
    const corridorGoal = 'Research competitor pricing and corridor coverage for cross-border stablecoin payments in LATAM and Africa';
    const corridor = request(corridorGoal, 'mandate_corridor_parallel');
    await Promise.all([chairs.done, corridor.done]);
    expect(JSON.parse(chairs.response.body).mandateResult.mandate).toMatchObject({ id: 'mandate_chairs_parallel', goal, domain: 'procurement' });
    expect(JSON.parse(corridor.response.body).mandateResult.mandate).toMatchObject({ id: 'mandate_corridor_parallel', goal: corridorGoal, domain: 'stablecoin_corridor' });
  });
  it('finishes public research before gating an unauthenticated research fee', async () => {
    sourceLoader.mockImplementation(async url => { if (url.includes('duckduckgo')) throw new Error('Search unavailable'); return page(url); });
    const paid = request('Find three suppliers of 100 office chairs and compare prices; research fee 0.01 NEAR', 'mandate_paid_readonly', true);
    await paid.done;
    const events = paid.response.body.trim().split('\n').map(line => JSON.parse(line));
    const result = events.at(-1).data.mandateResult;
    expect(result.deliverable.verification.passed).toBe(true);
    expect(result.deliverable.sources.length).toBeGreaterThanOrEqual(3);
    expect(result.payout.status).toBe('blocked');
    expect(result.payout.onchain).toBe(false);
    expect(result.payout.reasons[0].message).toContain('authorize your wallet');
  });
  it('routes a research directive preceded by small talk into the research pipeline', async () => {
    sourceLoader.mockImplementation(async url => page(url));
    const goal = 'Okay, research the NEAR consensus mechanism';
    const requested = request(goal, 'mandate_greeting_research');
    await requested.done;
    const response = JSON.parse(requested.response.body);
    expect(response.type).toBe('mandate_execution');
    expect(response.mandateResult.mandate.requestedGoal).toBe(goal);
  });
});
