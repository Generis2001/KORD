import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function createModelProxy({ token, model, endpoint = 'http://127.0.0.1:11434', request = fetch }) {
  if (!token || token.length < 32) throw new Error('Use a private model endpoint token of at least 32 characters.');
  if (!model || /(?:-|:)cloud(?:$|:)/i.test(model)) throw new Error('Use a downloaded local model.');
  const upstream = new URL(endpoint);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname) || upstream.protocol !== 'http:' || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('The inference upstream must be a loopback Ollama server.');
  }
  const secretHash = createHash('sha256').update('Bearer ' + token).digest();
  let busy = false;
  return http.createServer(async (req, res) => {
    const json = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/health' && req.method === 'GET') {
      try {
        const response = await request(new URL('/api/tags', upstream), { signal: AbortSignal.timeout(2500), redirect: 'error' });
        const data = await response.json();
        const ready = response.ok && data.models?.some(item => item.name === model);
        return json(ready ? 200 : 503, { status: ready ? 'ready' : 'model_missing', model });
      } catch { return json(503, { status: 'offline' }); }
    }
    if (req.url !== '/api/chat' || req.method !== 'POST') return json(404, { error: 'Endpoint not found.' });
    const suppliedHash = createHash('sha256').update(String(req.headers.authorization || '')).digest();
    if (!timingSafeEqual(suppliedHash, secretHash)) return json(401, { error: 'Authentication required.' });
    if (busy) { res.setHeader('Retry-After', '30'); return json(429, { error: 'Local model is busy. Try again shortly.' }); }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(415, { error: 'Send an application/json request.' });
    busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    req.on('aborted', () => controller.abort());
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 90_000) return json(413, { error: 'Request too large.' });
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return json(400, { error: 'Invalid JSON request.' }); }
      const structuredFormat = input?.format && typeof input.format === 'object' && !Array.isArray(input.format)
        && input.format.type === 'object' && JSON.stringify(input.format).length <= 12000 && !JSON.stringify(input.format).includes('"$ref"');
      if (!input || input.model !== model || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 8
        || input.messages.some(message => !message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')
        || !(input.format === 'json' || structuredFormat)) return json(400, { error: 'Use the configured local model, text messages and JSON output.' });
      const limit = Number(input.options?.num_predict);
      const body = {
        model, messages: input.messages.map(({ role, content }) => ({ role, content })),
        stream: false, think: false, format: input.format, keep_alive: '10m',
        options: { num_ctx: 16384, num_thread: 8, temperature: 0.2, num_predict: Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 3072) : 1536 },
      };
      const response = await request(new URL('/api/chat', upstream), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) return json(503, { error: 'Local inference is unavailable.' });
      let size = 0;
      const output = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 256_000) { controller.abort(); return json(502, { error: 'Local inference response too large.' }); }
        output.push(Buffer.from(chunk));
      }
      let data;
      try { data = JSON.parse(Buffer.concat(output).toString('utf8')); }
      catch { return json(502, { error: 'Local inference returned invalid JSON.' }); }
      // Do not expose internal thinking, model-management routes, credentials or filesystem access.
      return json(200, {
        model: data.model, message: { role: 'assistant', content: data.message?.content },
        done: data.done, done_reason: data.done_reason, prompt_eval_count: data.prompt_eval_count, eval_count: data.eval_count,
      });
    } catch { return json(controller.signal.aborted ? 504 : 503, { error: controller.signal.aborted ? 'Local inference timed out.' : 'Local inference is unavailable.' }); }
    finally { clearTimeout(timeout); busy = false; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = readFileSync(process.env.MANDATE_MODEL_TOKEN_FILE || '.secrets/local-model-token', 'utf8').trim();
  const model = process.env.LOCAL_AI_MODEL || 'qwen3.5:0.8b';
  const server = createModelProxy({ token, model });
  server.requestTimeout = 125_000;
  server.listen(11435, '127.0.0.1', () => process.stdout.write('Mandate authenticated model proxy listening on 127.0.0.1:11435\n'));
}
