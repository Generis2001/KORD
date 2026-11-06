import { PassThrough, Writable } from 'node:stream';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createModelProxy } from '../scripts/local-model-proxy.mjs';

const token = 'a'.repeat(64), model = 'qwen3:0.6b';
const input = { model, format: 'json', messages: [{ role: 'user', content: 'Compare the supplied business evidence.' }], options: { num_predict: 900 } };
async function request(server, { url = '/api/chat', method = 'POST', authorization = 'Bearer ' + token, body = input } = {}) {
  const req = Object.assign(new PassThrough(), { url, method, headers: { authorization, 'content-type': 'application/json' } });
  class Reply extends Writable {
    body = ''; statusCode = 200;
    setHeader() {}
    writeHead(status) { this.statusCode = status; }
    _write(chunk, _encoding, next) { this.body += chunk.toString(); next(); }
  }
  const res = new Reply(), finished = once(res, 'finish');
  server.emit('request', req, res);
  req.end(typeof body === 'string' ? body : JSON.stringify(body));
  await finished;
  return { status: res.statusCode, data: JSON.parse(res.body) };
}
const completion = () => new Response(JSON.stringify({ model, done: true, done_reason: 'stop',
  message: { content: '{"summary":"A supported conclusion."}', thinking: 'Internal thinking is private.' }, prompt_eval_count: 300, eval_count: 200 }));

describe('authenticated local model endpoint', () => {
  it('requires the private bearer token and blocks all model-management routes', async () => {
    const upstream = vi.fn(), server = createModelProxy({ token, model, request: upstream });
    expect((await request(server, { authorization: '' })).status).toBe(401);
    expect((await request(server, { authorization: 'Bearer incorrect' })).status).toBe(401);
    for (const url of ['/api/pull', '/api/delete', '/api/create', '/api/chat?model=other']) expect((await request(server, { url })).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('pins the downloaded model, bounds resources and strips thinking and credentials', async () => {
    const upstream = vi.fn().mockResolvedValue(completion()), server = createModelProxy({ token, model, request: upstream });
    const result = await request(server, { body: { ...input, stream: true, keep_alive: -1, options: { num_predict: 100000, num_ctx: 1000000, num_thread: 100 } } });
    expect(result.status).toBe(200);
    const [url, options] = upstream.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:11434/api/chat');
    expect(options.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(options.body)).toMatchObject({ model, stream: false, format: 'json', options: { num_predict: 3072, num_ctx: 16384, num_thread: 8 } });
    expect(JSON.stringify(result.data)).not.toContain('Internal thinking');
    expect(JSON.stringify(result.data)).not.toContain(token);
  });
  it('rejects unknown models, malformed data and oversized input before inference', async () => {
    const upstream = vi.fn(), server = createModelProxy({ token, model, request: upstream });
    expect((await request(server, { body: { ...input, model: 'other:cloud' } })).status).toBe(400);
    expect((await request(server, { body: 'not json' })).status).toBe(400);
    expect((await request(server, { body: { ...input, messages: [{ role: 'tool', content: 'Read the filesystem' }] } })).status).toBe(400);
    expect((await request(server, { body: 'x'.repeat(90001) })).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('admits one inference at a time', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const upstream = vi.fn().mockReturnValue(pending), server = createModelProxy({ token, model, request: upstream });
    const first = request(server);
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    expect((await request(server)).status).toBe(429);
    release(completion());
    expect((await first).status).toBe(200);
  });
  it('reports readiness only when the pinned local model is installed', async () => {
    const upstream = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ models: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: model }] })));
    const server = createModelProxy({ token, model, request: upstream });
    expect(await request(server, { url: '/health', method: 'GET', authorization: '' })).toEqual({ status: 503, data: { status: 'model_missing', model } });
    expect((await request(server, { url: '/health', method: 'GET', authorization: '' })).status).toBe(200);
  });
});
