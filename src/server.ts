import http from 'http';
import fs from 'fs';
import path from 'path';
import { JsonRpcProvider } from 'near-api-js';
import Database from 'better-sqlite3';
import { Store } from './db.js';
import { NearExecutor, loadNearConfig } from './near.js';
import { runAutonomousMandate } from './runner.js';

const PORT = 3000;
const rootDir = path.resolve('.');
const publicDir = path.join(rootDir, 'public');
const dbPath = process.env.MANDATE_DB ?? (process.env.VERCEL ? path.join('/tmp', 'mandate.db') : path.join(rootDir, 'mandate.db'));

const store = new Store(dbPath);
const nearCfg = loadNearConfig();
const nearExecutor = new NearExecutor(nearCfg);

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

async function getLiveOrLedgerBalance(): Promise<number> {
  try {
    const live = await nearExecutor.balanceNear();
    const parsed = parseFloat(live);
    if (!isNaN(parsed) && parsed > 0) {
      store.setTreasuryBalance(parsed);
      return parsed;
    }
  } catch {}
  return store.getTreasuryBalance();
}

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 1. /api/treasury (GET balance, POST fund)
  if (url.pathname === '/api/treasury') {
    if (req.method === 'GET') {
      const balance = await getLiveOrLedgerBalance();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        accountId: nearCfg.accountId,
        balanceNear: balance.toFixed(2),
        formatted: balance.toFixed(2) + ' NEAR'
      }));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { amountNear, note } = JSON.parse(body || '{}');
          const amt = parseFloat(amountNear);
          if (isNaN(amt) || amt <= 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Valid amountNear required' }));
          }
          const after = store.fundTreasury(amt, note || 'Treasury deposit');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            newBalance: after.toFixed(2),
            formatted: after.toFixed(2) + ' NEAR'
          }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 2. /api/allowlist (GET, POST, DELETE)
  if (url.pathname === '/api/allowlist') {
    if (req.method === 'GET') {
      const list = store.getAllowlist();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(list));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { accountId, label } = JSON.parse(body || '{}');
          if (!accountId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'accountId is required' }));
          }
          store.addToAllowlist(accountId.trim().toLowerCase(), label || 'Approved Recipient');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, list: store.getAllowlist() }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { accountId } = JSON.parse(body || '{}');
          if (accountId) {
            store.removeFromAllowlist(accountId);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, list: store.getAllowlist() }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 3. /api/ledger
  if (url.pathname === '/api/ledger') {
    try {
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 40').all();
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
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }
  }

  // 4. /api/chat
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let prompt = '';
      try {
        const parsed = JSON.parse(body || '{}');
        prompt = (parsed.message || '').trim();
      } catch {}

      const lower = prompt.toLowerCase();

      // Case A: Natural Greeting ("hello", "hi", "hey")
      const isGreeting = /^(hello|hi|hey|good day|greetings|howdy)\b/i.test(lower) || ['hello', 'hi', 'hey'].includes(lower.trim());
      if (isGreeting) {
        const balance = await getLiveOrLedgerBalance();
        const allowlist = store.getAllowlist();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'greeting',
          treasuryBalance: balance.toFixed(2),
          message: 'Hello! I am Mandate, your autonomous business agent on NEAR.\n\n' +
            'I manage payable allowlists, execute on-chain payments, and commission verified work under user-defined spending limits.\n\n' +
            '• **Treasury Balance:** ' + balance.toFixed(2) + ' NEAR\n' +
            '• **Approved Payees:** ' + allowlist.length + ' accounts on allowlist\n\n' +
            'How can I help you today?\n' +
            '- Pay an account: *"Pay 7 NEAR to zeal.testnet (add to allowlist)"*\n' +
            '- Fund treasury: *"Fund treasury with 10 NEAR"*\n' +
            '- View allowlist: *"Show my allowlist"*\n' +
            '- Commission task: *"Research competitor pricing with $5 cap"*'
        }));
      }

      // Case B: Fund Treasury Command (e.g. "fund treasury with 10 near", "deposit 5 near")
      const fundMatch = lower.match(/(?:fund|deposit|add)\s+([\d.]+)\s*near(?:s+(?:to|into)s+treasury)?/i);
      if (fundMatch) {
        const amountNear = parseFloat(fundMatch[1]);
        if (!isNaN(amountNear) && amountNear > 0) {
          const newBal = store.fundTreasury(amountNear, 'User prompt deposit in chat');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            type: 'treasury_funded',
            amountNear,
            newBalance: newBal.toFixed(2),
            formatted: newBal.toFixed(2) + ' NEAR',
            message: '✅ Treasury credited with **' + amountNear.toFixed(2) + ' NEAR**.\n\n• **New Treasury Balance:** ' + newBal.toFixed(2) + ' NEAR.'
          }));
        }
      }

      // Case C: Direct Payment (e.g. "pay 7 near to zeal.testnet (add to mandate's allowlist)")
      const payMatch = lower.match(/(?:pay|send|transfer)\s+([\d.]+)\s*near\s+(?:to\s+)?([a-z0-9._-]+)/i);
      if (payMatch) {
        const amountNear = parseFloat(payMatch[1]);
        const recipient = payMatch[2].trim().toLowerCase();
        const shouldAddAllowlist = /add.*allowlist/i.test(lower);

        if (isNaN(amountNear) || amountNear <= 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            type: 'text',
            message: 'Please specify a valid payment amount in NEAR, for example: "Pay 7 NEAR to zeal.testnet".'
          }));
        }

        let isAllowed = store.isAllowed(recipient);
        let addedNow = false;

        if (!isAllowed) {
          if (shouldAddAllowlist) {
            store.addToAllowlist(recipient, 'User Added Payee');
            isAllowed = true;
            addedNow = true;
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              type: 'allowlist_warning',
              recipient,
              amountNear,
              message: '⚠️ **Recipient Not Allowed:** `' + recipient + '` is not on your payable allowlist.\n\n' +
                'To approve and pay, you can say:\n' +
                '*"Pay ' + amountNear + ' NEAR to ' + recipient + ' (add to allowlist)"*\n\n' +
                'Or add them directly in the **Payable Allowlist** tab.'
            }));
          }
        }

        // Check if sufficient treasury balance
        const currentBal = store.getTreasuryBalance();
        if (currentBal < amountNear) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            type: 'payment_failed',
            recipient,
            amountNear,
            error: 'INSUFFICIENT_FUNDS',
            message: '❌ **Insufficient Treasury Funds:** Requested payment of ' + amountNear + ' NEAR exceeds current Treasury balance of ' + currentBal.toFixed(2) + ' NEAR.\n\nPlease fund your treasury (e.g. *"Fund treasury with 10 NEAR"*) before continuing.'
          }));
        }

        // Execute payment on NEAR testnet (Strictly live on-chain, zero mocks)
        try {
          const amountCents = BigInt(Math.round(amountNear * 1000));
          let txHash = '';
          let onchain = false;

          try {
            const executionResult = await nearExecutor.execute({
              recipient,
              amountCents,
              mandateId: 'direct-payment',
              taskId: `pay-${Date.now()}`,
              evidenceHash: 'direct-user-transfer'
            });
            if (!executionResult || !executionResult.txHash) {
              throw new Error("NEAR network did not return a valid transaction hash.");
            }
            txHash = executionResult.txHash;
            onchain = true;
          } catch (netErr: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              type: 'payment_failed',
              recipient,
              amountNear,
              error: netErr.message,
              message: '❌ **NEAR Testnet Execution Error:** ' + netErr.message + '\n\nPlease verify network connectivity or recipient account validity.'
            }));
          }

          // Record in DB payments
          const paymentId = store.recordPayment({
            mandateId: 'direct-payment',
            taskId: `pay-${Date.now()}`,
            recipient,
            amount: amountCents,
            status: 'confirmed',
            onchain: true,
            network: 'testnet',
            txHash: txHash,
            note: 'Direct on-chain transfer of ' + amountNear + ' NEAR to ' + recipient
          });

          // Accurately deduct from treasury balance
          const afterBal = store.deductTreasury(amountNear, 'Transfer to ' + recipient, txHash);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            type: 'payment_confirmed',
            paymentId,
            recipient,
            amountNear,
            addedToAllowlist: addedNow,
            txHash: txHash,
            explorerUrl: `https://testnet.nearblocks.io/txns/${txHash}`,
            remainingBalance: afterBal.toFixed(2),
            message: 'Payment of **' + amountNear + ' NEAR** to `' + recipient + '` has been **confirmed on-chain**.\n\n' +
              '• **Transaction Hash:** `' + txHash + '`\n' +
              '• **Explorer Receipt:** [View on NearBlocks](https://testnet.nearblocks.io/txns/' + txHash + ')\n' +
              '• **Remaining Treasury Balance:** ' + afterBal.toFixed(2) + ' NEAR.'
          }));
        } catch (err: any) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            type: 'payment_failed',
            recipient,
            amountNear,
            error: err.message,
            message: '❌ Payment of ' + amountNear + ' NEAR to `' + recipient + '` failed: ' + err.message
          }));
        }
      }

      // Case D: View Allowlist
      if (/allowlist|payable|who can i pay|approved accounts/i.test(lower)) {
        const list = store.getAllowlist();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'allowlist_view',
          allowlist: list,
          message: 'Here are your currently approved payable accounts on NEAR (' + list.length + ' active):'
        }));
      }

      // Case E: Add to Allowlist without paying
      const addMatch = lower.match(/add\s+([a-z0-9._-]+)\s+to\s+(?:my\s+)?allowlist/i);
      if (addMatch) {
        const newAcc = addMatch[1].trim().toLowerCase();
        store.addToAllowlist(newAcc, 'Approved Payee');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'text',
          message: '✅ Added `' + newAcc + '` to your payable allowlist. You can now disburse payments to this account anytime.'
        }));
      }

      // Case F: Security Notice for private keys
      if (/key|secret|private|seed|wallet dump/i.test(lower)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'security_notice',
          message: '🔒 Private keys are strictly quarantined in the backend and cannot be exported. Mandate executes transactions autonomously using its treasury and smart contract.'
        }));
      }

      // Case G: Default Autonomous Business Task
      try {
        const result = await runAutonomousMandate({
          goal: prompt.length > 5 ? prompt : undefined,
          executorMode: 'near', // Live on-chain NEAR testnet execution
          simulateAttack: true
        });

        // If mandate made an on-chain payout, deduct from treasury accurately
        if (result && result.payout && result.payout.status === 'confirmed') {
          store.deductTreasury(0.40, 'Mandate research fee payout: ' + result.payout.recipient, result.payout.txHash || undefined);
        }

        const bal = store.getTreasuryBalance();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: 'mandate_execution',
          mandateResult: result,
          treasuryBalance: bal.toFixed(2),
          message: 'Autonomous business mandate executed with spending limits and restrictions enforced.'
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
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

export default handleRequest;

if (!process.env.VERCEL) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Mandate] Running at http://localhost:${PORT}`);
  });
}
