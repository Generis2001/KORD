import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const window: any = {};
runInNewContext(readFileSync(new URL('../public/chat.js', import.meta.url), 'utf8'), { window, TextDecoder });
const chat = window.KordChat;
const request = { requestId: 'mandate_chairs', text: 'Find three suppliers of 100 office chairs' };
const result = { type: 'mandate_execution', requestId: request.requestId, mandateResult: { mandate: { id: request.requestId, requestedGoal: request.text } } };
function stream(text: string, chunks = 11) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += chunks) controller.enqueue(bytes.slice(index, index + chunks));
    controller.close();
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}
describe('correlated chat responses', () => {
  it('decodes partial lines and UTF-8 while exposing real progress before the final report', async () => {
    const step = { phase: 'Researcher', title: 'Retrieved sources ✓' }, progress = vi.fn();
    const response = stream(JSON.stringify({ type: 'progress', requestId: request.requestId, step }) + '\n' + JSON.stringify({ type: 'result', requestId: request.requestId, data: result }) + '\n', 1);
    expect(await chat.read(response, request, progress)).toEqual(result);
    expect(progress).toHaveBeenCalledWith(step);
  });
  it('rejects a stablecoin result belonging to another request', async () => {
    const data = { ...result, requestId: 'mandate_corridor' };
    await expect(chat.read(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }), request, vi.fn())).rejects.toThrow('another directive');
  });
  it('rejects a mismatched goal even when its ID matches', () => {
    expect(() => chat.check({ ...result, mandateResult: { mandate: { id: request.requestId, requestedGoal: 'Research stablecoin corridors' } } }, request)).toThrow('does not match');
  });
  it('checks older report goals while preserving explicitly authorized fee suffixes', () => {
    expect(chat.matchesGoal({ goal: 'Research stablecoin corridors' }, request.text)).toBe(false);
    expect(chat.matchesGoal({ goal: request.text }, request.text)).toBe(true);
    expect(() => chat.check({ mandateResult: { mandate: { id: request.requestId, goal: 'Research stablecoin corridors' } } }, request)).toThrow('does not match');
    expect(chat.check({ mandateResult: { mandate: { id: request.requestId, goal: request.text } } }, { ...request, text: request.text + '; research fee 0.01 NEAR' })).toBeDefined();
  });
  it('rejects progress from a different request and incomplete streams without retrying', async () => {
    await expect(chat.read(stream(JSON.stringify({ type: 'progress', requestId: 'mandate_other', step: {} }) + '\n'), request, vi.fn())).rejects.toThrow('another directive');
    await expect(chat.read(stream(''), request, vi.fn())).rejects.toThrow('interrupted');
  });
  it('retains normal wallet and greeting JSON responses', async () => {
    const data = { type: 'text', message: 'Deposit confirmed' };
    expect(await chat.read(new Response(JSON.stringify(data)), request, vi.fn())).toEqual(data);
  });
});
