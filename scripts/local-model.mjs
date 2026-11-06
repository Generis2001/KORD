import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const privateDir = path.join(root, '.secrets');
const logDir = path.join(privateDir, 'logs');
const model = process.env.LOCAL_AI_MODEL || 'qwen3:0.6b';
const tokenFile = path.join(privateDir, 'local-model-token');
const endpointFile = path.join(privateDir, 'local-model-endpoint');
mkdirSync(logDir, { recursive: true, mode: 0o700 });
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });

const binary = name => {
  const bundled = path.join(privateDir, 'runtime/bin', name);
  return existsSync(bundled) ? bundled : name;
};
const pidPath = name => path.join(privateDir, 'model-' + name + '.pid');
const isRunning = name => {
  try { const pid = Number(readFileSync(pidPath(name), 'utf8')); if (pid > 1) { process.kill(pid, 0); return true; } } catch {}
  return false;
};
const stopOwned = name => {
  if (!isRunning(name)) return;
  const pid = Number(readFileSync(pidPath(name), 'utf8'));
  const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  if (!command.includes(name === 'proxy' ? 'scripts/local-model-proxy.mjs' : binary(name))) throw new Error('Refusing to stop an unrelated process.');
  process.kill(pid, 'SIGTERM');
  unlinkSync(pidPath(name));
};
const launch = (name, command, args, env = {}) => {
  if (isRunning(name)) return;
  const log = openSync(path.join(logDir, name + '.log'), 'w', 0o600);
  const child = spawn(command, args, { cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...env } });
  child.on('error', error => { process.stderr.write(`${name} could not start: ${error.message}\n`); });
  if (child.pid) writeFileSync(pidPath(name), String(child.pid), { mode: 0o600 });
  child.unref();
  closeSync(log);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = async url => {
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
  try { const response = await fetch(url, { signal: AbortSignal.timeout(loopback ? 2500 : 10000), redirect: 'error' }); return { ok: response.ok, data: await response.json() }; }
  catch { return null; }
};

async function start() {
  if (!await status('http://127.0.0.1:11434/api/tags')) {
    launch('ollama', binary('ollama'), ['serve'], {
      OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: path.join(privateDir, 'models'), OLLAMA_NO_CLOUD: '1', OLLAMA_NUM_PARALLEL: '1',
    });
  }
  const currentProxy = await status('http://127.0.0.1:11435/health');
  if (currentProxy && currentProxy.data.model !== model) {
    if (!isRunning('proxy')) throw new Error('Stop the existing unmanaged proxy before changing the local model.');
    stopOwned('proxy');
    await pause(500);
  }
  if (!currentProxy || currentProxy.data.model !== model) {
    launch('proxy', process.execPath, ['scripts/local-model-proxy.mjs'], { LOCAL_AI_MODEL: model, KORD_MODEL_TOKEN_FILE: tokenFile });
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await status('http://127.0.0.1:11435/health');
    if (response && response.data.model === model) {
      process.stdout.write(`Local inference: http://127.0.0.1:11434/api/chat\nAuthenticated proxy: http://127.0.0.1:11435/api/chat\nModel: ${model} (${response.data.status})\nPrivate bearer token: .secrets/local-model-token\n`);
      return;
    }
    await pause(1000);
  }
  throw new Error('The local services did not start. Check .secrets/logs.');
}

async function expose() {
  await start();
  const health = await status('http://127.0.0.1:11435/health');
  if (!health?.ok) throw new Error(`Download ${model} before exposing inference: ollama pull ${model}`);
  launch('tunnel', binary('cloudflared'), ['--no-autoupdate', 'tunnel', '--url', 'http://127.0.0.1:11435', '--protocol', 'http2']);
  for (let attempt = 0; attempt < 40; attempt++) {
    const log = readFileSync(path.join(logDir, 'tunnel.log'), 'utf8');
    const origin = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
    if (origin) {
      const health = await status(origin + '/health');
      if (health?.ok) {
        const endpoint = origin + '/api/chat';
        writeFileSync(endpointFile, endpoint + '\n', { mode: 0o600 });
        process.stdout.write(`HTTPS model endpoint: ${endpoint}\nKeep this computer on. Restarting the free tunnel changes its URL.\n`);
        return;
      }
    }
    await pause(1000);
  }
  throw new Error('The free tunnel did not become reachable. Check .secrets/logs/tunnel.log.');
}

async function showStatus() {
  const local = await status('http://127.0.0.1:11435/health');
  process.stdout.write(`Local model: ${local?.data.status || 'offline'}\n`);
  if (existsSync(endpointFile)) {
    const endpoint = readFileSync(endpointFile, 'utf8').trim();
    const hosted = await status(endpoint.replace(/\/api\/chat$/, '/health'));
    process.stdout.write(`HTTPS endpoint: ${endpoint}\nTunnel: ${hosted?.ok ? 'ready' : 'offline'}\n`);
  }
}

function stop() {
  for (const name of ['tunnel', 'proxy', 'ollama']) stopOwned(name);
  process.stdout.write('KORD local model services stopped.\n');
}

try {
  const action = process.argv[2] || 'start';
  if (action === 'start') await start();
  else if (action === 'expose') await expose();
  else if (action === 'status') await showStatus();
  else if (action === 'stop') stop();
  else throw new Error('Use start, expose, status or stop.');
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
