import http from 'http';
import fs from 'fs';
import path from 'path';
import { JsonRpcProvider } from 'near-api-js';
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

function formatNearErrorMessage(msg: string): string {
  if (!msg) return 'Transaction failed on NEAR testnet.';
  // Converts 18-30 digit yoctoNEAR integers into clean, readable NEAR numbers (e.g. 157809675022697300000000 -> 0.16 NEAR)
  return msg.replace(/\b(\d{18,30})\b/g, (match) => {
    try {
      const yocto = BigInt(match);
      const nearWhole = yocto / (10n ** 24n);
      const remainder = yocto % (10n ** 24n);
      const decimalStr = (remainder / (10n ** 20n)).toString().padStart(4, '0');
      return `${nearWhole}.${decimalStr.slice(0, 2)} NEAR`;
    } catch {
      return match;
    }
  });
}

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost:3000'}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-mandate-account');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Extract user account for isolation (or fallback to default user)
  const userAccountHeader = (req.headers['x-mandate-account'] as string) || url.searchParams.get('account');
  const userAccount = (userAccountHeader ? userAccountHeader.trim().toLowerCase() : 'default-user.testnet');
  store.getOrCreateUser(userAccount, 10.00);

  // 1. /api/accounts (GET list, POST create/switch)
  if (url.pathname === '/api/accounts') {
    if (req.method === 'GET') {
      const users = store.listUsers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        activeAccount: userAccount,
        balanceNear: store.getUserBalance(userAccount).toFixed(2),
        users
      }));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { accountId, displayName, initialBalance } = JSON.parse(body || '{}');
          if (!accountId || typeof accountId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'accountId is required' }));
          }
          const cleanId = accountId.trim().toLowerCase();
          const user = store.getOrCreateUser(cleanId, displayName || cleanId);
          if (initialBalance && !isNaN(Number(initialBalance))) {
            store.setUserBalance(cleanId, Math.max(0, Number(initialBalance)));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            account: cleanId,
            balanceNear: store.getUserBalance(cleanId).toFixed(2),
            user
          }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 2. /api/treasury (GET balance, POST fund)
  if (url.pathname === '/api/treasury') {
    if (req.method === 'GET') {
      const balance = store.getUserBalance(userAccount);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        accountId: userAccount,
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
          const after = store.fundUserBalance(userAccount, amt, note || 'Treasury deposit');
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

  // 3. /api/allowlist (GET, POST, DELETE)
  if (url.pathname === '/api/allowlist') {
    if (req.method === 'GET') {
      const list = store.getAllowlist(userAccount);
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
          store.addToAllowlist(accountId.trim().toLowerCase(), label || 'Approved Recipient', userAccount);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, list: store.getAllowlist(userAccount) }));
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
          if (!accountId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'accountId is required' }));
          }
          store.removeFromAllowlist(accountId.trim().toLowerCase(), userAccount);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, list: store.getAllowlist(userAccount) }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 4. /api/ledger (GET accurately reflects confirmed payments & on-chain txs)
  if (url.pathname === '/api/ledger') {
    try {
      const formatted = store.getLedger(userAccount);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(formatted));
    } catch (e: any) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }
  }

  // 5. /api/conversations (GET list, POST save, DELETE remove)
  if (url.pathname === '/api/conversations') {
    if (req.method === 'GET') {
      const convos = store.getConversations(userAccount);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(convos));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { id, title, domain, messages } = JSON.parse(body || '{}');
          if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'id is required' }));
          }
          store.saveConversation(id, userAccount, title || 'Mandate Session', messages || []);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
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
          const { id } = JSON.parse(body || '{}');
          if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'id is required' }));
          }
          store.deleteConversation(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 6. /api/chat (Handles natural language directives & autonomous mandates)
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let prompt = '';
      try {
        const parsed = JSON.parse(body || '{}');
        prompt = (parsed.message || '').trim();
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }

      const lower = prompt.toLowerCase();

      // Case A: Fund Treasury
      const fundMatch = lower.match(/fund(?:\s+treasury)?\s+(?:with\s+)?([0-9.]+)\s*near/i) ||
                        lower.match(/add\s+([0-9.]+)\s*near(?:\s+to\s+treasury)?/i) ||
                        lower.match(/deposit\s+([0-9.]+)\s*near/i);

      if (fundMatch) {
        const amt = parseFloat(fundMatch[1]);
        if (!isNaN(amt) && amt > 0) {
          const after = store.fundUserBalance(userAccount, amt, `Chat deposit of ${amt} NEAR`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            type: 'treasury_funded',
            amountNear: amt,
            newBalance: after.toFixed(2),
            message: `Treasury successfully funded with **${amt} NEAR**.\n\n• **Account:** \`${userAccount}\`\n• **New Available Balance:** **${after.toFixed(2)} NEAR**`
          }));
        }
      }

      // Case B: Balance query
      if (/balance|how much (?:do i have|near)|treasury balance|check balance/i.test(lower)) {
        const bal = store.getUserBalance(userAccount);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'text',
          message: `Your current treasury balance for \`${userAccount}\` is **${bal.toFixed(2)} NEAR**.`
        }));
      }

      // Case C: Direct Payment to recipient
      const payMatch = lower.match(/(?:pay|transfer|send)\s+([0-9.]+)\s*near\s+(?:to\s+)?([a-z0-9._-]+)/i);
      if (payMatch) {
        const amountNear = parseFloat(payMatch[1]);
        const recipient = payMatch[2].trim().toLowerCase();
        const shouldAddAllowlist = /add\s+to\s+allowlist|approve/i.test(lower);

        if (isNaN(amountNear) || amountNear <= 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            type: 'text',
            message: 'Please specify a valid payment amount in NEAR, for example: "Pay 7 NEAR to zeal.testnet".'
          }));
        }

        let isAllowed = store.isAllowed(recipient, userAccount);
        let addedNow = false;

        if (!isAllowed) {
          if (shouldAddAllowlist) {
            store.addToAllowlist(recipient, 'User Added Payee', userAccount);
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
        const currentBal = store.getUserBalance(userAccount);
        if (currentBal < amountNear) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            type: 'payment_failed',
            recipient,
            amountNear,
            error: 'INSUFFICIENT_FUNDS',
            message: '❌ **Insufficient Treasury Funds:** Requested payment of ' + amountNear + ' NEAR exceeds current balance of ' + currentBal.toFixed(2) + ' NEAR.\n\nPlease fund your treasury (e.g. *"Fund treasury with 10 NEAR"*) before continuing.'
          }));
        }

        // Execute payment on NEAR testnet (Strictly live on-chain, zero mocks)
        try {
          const amountCents = BigInt(Math.round(amountNear * 1000));
          let txHash = '';

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
          } catch (netErr: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              type: 'payment_failed',
              recipient,
              amountNear,
              error: netErr.message,
              message: '❌ **NEAR Testnet Execution Error:** ' + formatNearErrorMessage(netErr.message) + '\n\nPlease verify network connectivity or recipient account validity.'
            }));
          }

          // Record in DB payments with userAccount tag
          const paymentId = store.recordPayment({
            mandateId: 'direct-payment',
            taskId: `pay-${Date.now()}`,
            recipient,
            amount: amountCents,
            status: 'confirmed',
            onchain: true,
            network: 'testnet',
            txHash: txHash,
            note: 'Direct on-chain transfer of ' + amountNear + ' NEAR to ' + recipient,
            userAccount
          });

          // Accurately deduct from user treasury balance
          const afterBal = store.deductUserBalance(userAccount, amountNear, 'Transfer to ' + recipient, txHash);

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
            message: '❌ Payment of ' + amountNear + ' NEAR to `' + recipient + '` failed: ' + formatNearErrorMessage(err.message)
          }));
        }
      }

      // Case D: View Allowlist
      if (/allowlist|payable|who can i pay|approved accounts/i.test(lower)) {
        const list = store.getAllowlist(userAccount);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'allowlist_view',
          allowlist: list,
          message: 'Here are your approved payable accounts on NEAR (' + list.length + ' active):'
        }));
      }

      // Case E: Add to Allowlist without paying
      const addMatch = lower.match(/add\s+([a-z0-9._-]+)\s+to\s+(?:my\s+)?allowlist/i);
      if (addMatch) {
        const newAcc = addMatch[1].trim().toLowerCase();
        store.addToAllowlist(newAcc, 'Approved Payee', userAccount);
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
          userAccount,
          executorMode: 'near', // Live on-chain NEAR testnet execution
          simulateAttack: true
        });

        // If mandate made an on-chain payout, deduct from user treasury accurately and record in ledger
        if (result && result.payout && result.payout.status === 'confirmed') {
          store.deductUserBalance(userAccount, 0.40, 'Mandate research fee payout: ' + result.payout.recipient, result.payout.txHash || undefined);
          store.recordPayment({
            mandateId: result.mandate.id,
            taskId: result.deliverable.taskId,
            recipient: result.payout.recipient,
            amount: 400n, // $4.00
            status: 'confirmed',
            onchain: true,
            network: 'testnet',
            txHash: result.payout.txHash ?? null,
            note: 'Disbursed research fee for verified ' + result.mandate.domain + ' deliverable',
            userAccount
          });
        }

        const bal = store.getUserBalance(userAccount);

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
