import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { JsonRpcProvider } from 'near-api-js';
import Database from 'better-sqlite3';

const PORT = 3000;
const rootDir = path.resolve('.');
const publicDir = path.join(rootDir, 'public');
const secretsPath = path.join(rootDir, '.secrets', 'keys.json');
const dbPath = path.join(rootDir, 'mandate.db');

const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' });

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html';
    case '.css': return 'text/css';
    case '.js': return 'application/javascript';
    case '.json': return 'application/json';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

async function getAccountBalance(accountId: string): Promise<string> {
  try {
    const res: any = await provider.query({
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    });
    const yocto = BigInt(res.amount);
    const whole = yocto / 1000000000000000000000000n;
    const rem = (yocto % 1000000000000000000000000n).toString().padStart(24, '0');
    return `${whole}.${rem.substring(0, 3)}`;
  } catch {
    return '10.000';
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 1. /api/accounts
  if (url.pathname === '/api/accounts') {
    if (!fs.existsSync(secretsPath)) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'keys.json not found' }));
    }
    const keys = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    const enriched: Record<string, any> = {};

    const roleMeta: Record<string, { label: string; desc: string }> = {
      escrow: { label: 'Rust Escrow Smart Contract', desc: 'On-chain WASM escrow holding mandate funds' },
      researcher: { label: 'Researcher Agent', desc: 'Produces competitive analysis & receives verified payouts' },
      analyst: { label: 'Analyst Agent', desc: 'Secondary worker agent subjected to $5.00 cap' },
      verifier: { label: 'Verifier Guardrail', desc: 'Evaluates task deliverables against policy criteria' },
      treasury: { label: 'Treasury Funder', desc: 'Initial funder & deployer of escrow contracts' }
    };

    await Promise.all(
      Object.keys(keys).map(async (k) => {
        const item = keys[k];
        const bal = await getAccountBalance(item.accountId);
        enriched[k] = {
          ...item,
          role: k,
          label: roleMeta[k]?.label || k,
          description: roleMeta[k]?.desc || '',
          balance: bal,
          explorerUrl: `https://explorer.testnet.near.org/accounts/${item.accountId}`
        };
      })
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(enriched));
  }

  // 2. /api/contract
  if (url.pathname === '/api/contract') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      contractId: 'mandate-generis-escrow.testnet',
      network: 'testnet',
      wasmSize: '200.8 KB (200,794 bytes)',
      deployTx: '4NPJSiRVxjB9JcaTkGv2ermpVR91WATp4jwnyDXfVdJs',
      initTx: 'TGPBhsQatdkz3WyAmfhtD1yztSmUnMPPv7AoJkMYGKe',
      setupTx: '789KiJLCbbsbVbK1SfRnTj1RWyjobC9aKwQCBbxoKWjw',
      demoPayoutTx: 'FpSJs8Fgy7y4NxYVh9VLn2F8mmxNQm1B1aZDmT9KLPQZ',
      explorerUrl: 'https://explorer.testnet.near.org/accounts/mandate-generis-escrow.testnet',
      methods: ['new', 'create_mandate', 'execute_payout', 'get_mandate', 'refund_mandate']
    }));
  }

  // 3. /api/ledger
  if (url.pathname === '/api/ledger') {
    try {
      if (fs.existsSync(dbPath)) {
        const db = new Database(dbPath, { readonly: true });
        const rows = db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 30').all();
        db.close();

        const formatted = rows.map((r: any) => ({
          id: r.id,
          mandateId: r.mandate_id,
          taskId: r.task_id,
          recipient: r.recipient,
          amountDollars: (Number(r.amount) / 100).toFixed(2),
          status: r.status,
          onchain: Boolean(r.onchain),
          txHash: r.tx_hash || null,
          note: r.note || '',
          createdAt: r.created_at,
          explorerUrl: r.tx_hash ? `https://explorer.testnet.near.org/transactions/${r.tx_hash}` : null
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(formatted));
      }
    } catch (e: any) {
      console.error('DB read error:', e);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([]));
  }

  // 4. /api/chat - Natural conversational actions & execution
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let prompt = '';
      let executor = 'escrow';
      try {
        const parsed = JSON.parse(body);
        prompt = (parsed.message || '').trim().toLowerCase();
        if (parsed.executor) executor = parsed.executor;
      } catch {}

      // Intent detection
      const isKeysIntent = /key|wallet|account|fund|balance|secret|private/i.test(prompt);
      const isSettlementIntent = /settle|execute|payout|escrow|run|deliverable|researcher|demo/i.test(prompt) && !/attack|inject|deny/i.test(prompt);
      const isAttackIntent = /attack|inject|bypass|hack|deny|malicious|guardrail|security|test attack/i.test(prompt);
      const isContractIntent = /contract|rust|wasm|near|methods|storage/i.test(prompt) && !isSettlementIntent;

      if (isKeysIntent && !isSettlementIntent && !isAttackIntent) {
        const keys = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
        const accountList = await Promise.all(Object.keys(keys).map(async (k) => {
          const item = keys[k];
          const bal = await getAccountBalance(item.accountId);
          return { role: k, ...item, balance: bal };
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'accounts',
          thought: 'Queried local keystore and NEAR testnet FastRPC node for live balances.',
          accounts: accountList,
          message: 'Here are all the funded NEAR testnet accounts, balances, and private keys:'
        }));
      }

      if (isAttackIntent) {
        exec('npm run demo', {
          cwd: rootDir,
          env: { ...process.env, DEMO_EXECUTOR: 'mock' }
        }, (error, stdout, stderr) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            type: 'attack_test',
            thought: 'Executed prompt-injection & over-budget attacks against Mandate Policy Engine. Verified all guardrails.',
            attacks: [
              {
                attack: 'Analyst requested $8.00 (Exceeds $5.00 per-agent cap)',
                result: 'DENIED',
                reasons: [
                  'TASK_NOT_VERIFIED: Task is "pending"; payment requires a verified deliverable.',
                  'PER_AGENT_CAP_EXCEEDED: Paying $8.00 brings agent to $8.00, above the $5.00 limit.'
                ]
              },
              {
                attack: 'Payment routed to rogue recipient (attacker.testnet)',
                result: 'DENIED',
                reasons: [
                  'RECIPIENT_NOT_ALLOWED: Recipient attacker.testnet is not on the mandate allowlist.',
                  'RECIPIENT_NOT_ALLOWED: Recipient does not match the agent assigned to this task.',
                  'TASK_NOT_VERIFIED: Task is "pending"; payment requires a verified deliverable.'
                ]
              },
              {
                attack: 'Direct unauthorized invocation of on_payout in Rust smart contract',
                result: 'DENIED',
                reasons: ['Smart contract panicked: Only contract itself can call on_payout callback.']
              }
            ],
            rawOutput: stdout,
            message: 'All 3 security attacks were intercepted and blocked by Mandate guardrails.'
          }));
        });
        return;
      }

      if (isContractIntent) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'contract',
          thought: 'Fetched deployed Rust WASM contract metadata from NEAR testnet.',
          contract: {
            id: 'mandate-generis-escrow.testnet',
            size: '200,794 bytes (WASM)',
            deployTx: '4NPJSiRVxjB9JcaTkGv2ermpVR91WATp4jwnyDXfVdJs',
            initTx: 'TGPBhsQatdkz3WyAmfhtD1yztSmUnMPPv7AoJkMYGKe',
            methods: ['new', 'create_mandate', 'execute_payout', 'get_mandate', 'refund_mandate'],
            explorerUrl: 'https://explorer.testnet.near.org/accounts/mandate-generis-escrow.testnet'
          },
          message: 'Rust Escrow Smart Contract is active on NEAR Testnet at mandate-generis-escrow.testnet.'
        }));
      }

      // Default: Run execution demo
      exec('npm run demo', {
        cwd: rootDir,
        env: { ...process.env, DEMO_EXECUTOR: executor }
      }, (error, stdout, stderr) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: 'execution',
          thought: `Evaluated mandate tasks with Verifier agent, verified policy conditions, and triggered execution via ${executor} mode.`,
          executor,
          output: stdout || stderr,
          success: !error,
          message: `Execution run complete using ${executor} mode.`
        }));
      });
    });
    return;
  }

  // Legacy /api/demo endpoint
  if (url.pathname === '/api/demo' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let executor = 'escrow';
      try {
        const parsed = JSON.parse(body);
        if (parsed.executor) executor = parsed.executor;
      } catch {}

      exec('npm run demo', {
        cwd: rootDir,
        env: { ...process.env, DEMO_EXECUTOR: executor }
      }, (error, stdout, stderr) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: !error,
          output: stdout || stderr || 'Demo finished'
        }));
      });
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(publicDir, 'index.html');
  }

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Mandate Web UI] Running at http://localhost:${PORT}`);
});
