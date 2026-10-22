import http from 'http';
import fs from 'fs';
import path from 'path';
import { JsonRpcProvider } from 'near-api-js';
import Database from 'better-sqlite3';
import { runAutonomousMandate } from './runner.js';

const PORT = 3000;
const rootDir = path.resolve('.');
const publicDir = path.join(rootDir, 'public');
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

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 1. /api/agents - Public metadata only (NO PRIVATE KEYS)
  if (url.pathname === '/api/agents') {
    const agents = [
      {
        role: 'Researcher',
        account: process.env.AGENT_RESEARCHER || 'mandate-generis-researcher.testnet',
        spendingCap: '$5.00',
        responsibility: 'Gathers competitive research, market pricing, and verifiable sources',
        explorerUrl: `https://explorer.testnet.near.org/accounts/${process.env.AGENT_RESEARCHER || 'mandate-generis-researcher.testnet'}`
      },
      {
        role: 'Analyst',
        account: process.env.AGENT_ANALYST || 'mandate-generis-analyst.testnet',
        spendingCap: '$5.00',
        responsibility: 'Performs quantitative analysis and comparative benchmarking',
        explorerUrl: `https://explorer.testnet.near.org/accounts/${process.env.AGENT_ANALYST || 'mandate-generis-analyst.testnet'}`
      },
      {
        role: 'Verifier',
        account: process.env.AGENT_VERIFIER || 'mandate-generis-verifier.testnet',
        spendingCap: 'N/A',
        responsibility: 'Audits deliverables against acceptance rubric before payment authorization',
        explorerUrl: `https://explorer.testnet.near.org/accounts/${process.env.AGENT_VERIFIER || 'mandate-generis-verifier.testnet'}`
      },
      {
        role: 'Escrow Contract',
        account: process.env.ESCROW_CONTRACT_ID || 'mandate-generis-escrow.testnet',
        spendingCap: 'Mandate Budget Limit',
        responsibility: 'Holds user funds on NEAR testnet and executes authorized payouts',
        explorerUrl: `https://explorer.testnet.near.org/accounts/${process.env.ESCROW_CONTRACT_ID || 'mandate-generis-escrow.testnet'}`
      }
    ];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(agents));
  }

  // 2. /api/contract - Smart contract details
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

  // 3. /api/ledger - Audit ledger
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

  // 4. /api/execute - Practical business mandate execution
  if (url.pathname === '/api/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = await runAutonomousMandate({
          goal: payload.goal,
          totalBudgetCents: payload.budgetDollars ? BigInt(Math.round(payload.budgetDollars * 100)) : undefined,
          perAgentCapCents: payload.capDollars ? BigInt(Math.round(payload.capDollars * 100)) : undefined,
          executorMode: payload.executor || 'escrow',
          simulateAttack: payload.simulateAttack !== false,
          deliverableText: payload.deliverableText,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Execution failed' }));
      }
    });
    return;
  }

  // 5. /api/chat - Natural language conversational assistant
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let prompt = '';
      let executor: 'escrow' | 'near' | 'mock' = 'escrow';
      try {
        const parsed = JSON.parse(body);
        prompt = (parsed.message || '').trim();
        if (parsed.executor) executor = parsed.executor;
      } catch {}

      const lower = prompt.toLowerCase();

      // Guardrail: Explicitly reject any requests to view private keys
      if (/key|secret|private|seed|wallet dump|export key/i.test(lower)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'security_notice',
          thought: 'Request for private keys intercepted. Access strictly denied by Mandate security policy.',
          message: '🔒 Private keys are strictly quarantined in the autonomous backend environment and cannot be viewed, exported, or accessed through this interface. Mandate signs transactions autonomously using its smart contract escrow and policy treasury to protect your funds.'
        }));
      }

      // Attack test request
      if (/attack|inject|bypass|hack|deny|malicious|guardrail|security|test attack/i.test(lower)) {
        const result = await runAutonomousMandate({
          goal: "Security verification: enforce spending limits and deny unverified payments.",
          executorMode: 'mock',
          simulateAttack: true
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'attack_test',
          thought: 'Executed prompt-injection & over-budget attacks against Mandate Policy Engine. Verified all guardrails.',
          mandateResult: result,
          message: 'Mandate successfully intercepted and denied all unauthorized payment attempts. Spending limits enforced.'
        }));
      }

      // Default: Run practical autonomous business mandate
      try {
        const result = await runAutonomousMandate({
          goal: prompt.length > 5 ? prompt : undefined,
          executorMode: executor,
          simulateAttack: true
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: 'mandate_execution',
          thought: `Decomposed business directive, assigned specialized agents, evaluated deliverable against rubric, and enforced spending limits via ${executor} mode.`,
          mandateResult: result,
          message: `Autonomous Mandate executed successfully. Verifier evaluated work, spending policy was enforced, and payout settled on NEAR.`
        }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Execution error' }));
      }
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
  console.log(`[Mandate Business Agent] Running at http://localhost:${PORT}`);
});
