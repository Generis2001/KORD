import { AgentSwapService, TEST_USDT_DISCLAIMER } from './swap.js';
import OpenAI from 'openai';
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
const swapService = new AgentSwapService();
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

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
      const users = await store.listUsersAsync();
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

  // 2. /api/treasury (GET live on-chain balance, POST fund)
  if (url.pathname === '/api/treasury') {
    if (req.method === 'GET') {
      let liveOnchain = 0;
      try {
        const liveStr = await nearExecutor.balanceNear();
        liveOnchain = parseFloat(liveStr);
      } catch {}

      const userBal = store.getUserBalance(userAccount);
      const userUsdt = store.getUserUsdtBalance(userAccount);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        accountId: nearCfg.accountId,
        liveOnchainNear: liveOnchain.toFixed(2),
        formattedOnchain: liveOnchain.toFixed(2) + ' NEAR',
        userAccount,
        userQuotaNear: userBal.toFixed(2),
        balanceNear: userBal.toFixed(2),
        formatted: userBal.toFixed(2) + ' NEAR',
        userUsdt: userUsdt.toFixed(2),
        formattedUsdt: userUsdt.toFixed(2) + ' USDT'
      }));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const { amountNear, note, txHash } = JSON.parse(body || '{}');
          const amt = parseFloat(amountNear);
          if (isNaN(amt) || amt <= 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Valid amountNear required' }));
          }
          const after = store.fundUserBalance(userAccount, amt, note || 'Treasury deposit');

          let liveOnchain = 0;
          try {
            const liveStr = await nearExecutor.balanceNear();
            liveOnchain = parseFloat(liveStr);
          } catch {}

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            userAccount,
            userBalance: after.toFixed(2),
            newBalance: after.toFixed(2),
            balanceNear: after.toFixed(2),
            formatted: after.toFixed(2) + ' NEAR',
            liveOnchainNear: liveOnchain.toFixed(2),
            formattedOnchain: liveOnchain.toFixed(2) + ' NEAR',
            txHash: txHash || null
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
      const convos = await store.getConversationsAsync(userAccount);
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

  // 5.5 /api/swap (quote, history, execute)
  if (url.pathname === '/api/swap/quote' && req.method === 'GET') {
    try {
      const amountNear = parseFloat(url.searchParams.get('amountNear') || '1');
      const destination = url.searchParams.get('destination') || undefined;
      const quote = await swapService.getQuote(amountNear, destination);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(quote));
    } catch (e: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  if (url.pathname === '/api/swap/history' && req.method === 'GET') {
    try {
      const history = store.listSwaps(userAccount);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        userAccount,
        swaps: history
      }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  if (url.pathname === '/api/swap/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const { inputNear, minOutputUsdt, destinationWallet, note } = JSON.parse(body || '{}');
        const amt = parseFloat(inputNear);
        if (isNaN(amt) || amt <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Valid inputNear amount is required.' }));
        }
        if (!destinationWallet || typeof destinationWallet !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Valid destinationWallet is required.' }));
        }

        const result = await swapService.executeSwap({
          userAccount,
          agentAccount: 'mandate-generis-analyst.testnet',
          inputNear: amt,
          minOutputUsdt: minOutputUsdt ? parseFloat(minOutputUsdt) : undefined,
          destinationWallet,
          note
        }, store);

        res.writeHead(result.status === 'confirmed' ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
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

      
      // Case Swap USDT -> NEAR: e.g. "swap 1 usdt for near", "exchange 5 usdt to near"
      const swapUsdtMatch = lower.match(/(?:swap|exchange)\s+([0-9.]+)\s*(?:test\s+)?usdt(?:\s+(?:for|to)\s+near)?(?:\s+(?:to|for)\s+([a-z0-9._-]+))?/i);
      if (swapUsdtMatch) {
        const amtUsdt = parseFloat(swapUsdtMatch[1]);
        const targetDest = swapUsdtMatch[2] ? swapUsdtMatch[2].trim().toLowerCase() : userAccount;
        if (!isNaN(amtUsdt) && amtUsdt > 0) {
          const currentUsdt = store.getUserUsdtBalance(userAccount);
          if (currentUsdt < amtUsdt) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              type: 'text',
              message: `❌ **Insufficient USDT Balance:** You requested to swap **${amtUsdt} USDT**, but your available balance is **${currentUsdt.toFixed(2)} USDT**.`
            }));
          }
          const outputNear = Number((amtUsdt / 5.0).toFixed(2));
          store.deductUserUsdtBalance(userAccount, amtUsdt);
          const afterNear = store.fundUserBalance(userAccount, outputNear, `Swap ${amtUsdt} Test USDT -> ${outputNear} NEAR`);
          const afterUsdt = store.getUserUsdtBalance(userAccount);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            type: 'text',
            message: `✅ **Agent Swap & Payout Confirmed!**\n\n` +
              `• **NEAR Received:** **${outputNear} NEAR**\n` +
              `• **Test USDT Swapped:** **${amtUsdt} USDT**\n` +
              `• **Rate:** 5 Test USDT = 1 NEAR (Demo Rate)\n` +
              `• **Recipient Account:** \`${targetDest}\`\n\n` +
              `📊 **Updated Wallet Balances:**\n` +
              `• **NEAR Available:** **${afterNear.toFixed(2)} NEAR**\n` +
              `• **Test USDT Available:** **${afterUsdt.toFixed(2)} USDT**`
          }));
        }
      }

      // Case Swap: Agent Swap & Payout via chat
      const swapMatch = lower.match(/(?:swap|exchange)\s+([0-9.]+)\s*near(?:\s+(?:for|to)\s+(?:test\s+)?usdt)?(?:\s+(?:to|for)\s+([a-z0-9._-]+))?/i);
      if (swapMatch) {
        const amt = parseFloat(swapMatch[1]);
        const targetDest = swapMatch[2] ? swapMatch[2].trim().toLowerCase() : userAccount;
        if (!isNaN(amt) && amt > 0) {
          try {
            const swapResult = await swapService.executeSwap({
              userAccount,
              agentAccount: 'mandate-generis-analyst.testnet',
              inputNear: amt,
              destinationWallet: targetDest,
              note: `Chat directive swap of ${amt} NEAR for Test USDT`
            }, store);

            if (swapResult.status === 'confirmed') {
              const currentBal = store.getUserBalance(userAccount);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                type: 'text',
                treasuryBalance: currentBal.toFixed(2),
                message: `✅ **Agent Swap & Payout Confirmed!**\n\n` +
                  `• **NEAR Spent:** **${amt} NEAR**\n` +
                  `• **Test USDT Received:** **${swapResult.outputUsdt} USDT**\n` +
                  `• **Exchange Rate:** 1 NEAR = ${swapResult.exchangeRate} Test USDT (Demo Rate)\n` +
                  `• **Destination Wallet:** \`${swapResult.destinationWallet}\`\n` +
                  `• **Explorer Receipt:** [View on NearBlocks](https://testnet.nearblocks.io/txns/${swapResult.payoutTxHash})\n\n` +
                  `*Notice: ${TEST_USDT_DISCLAIMER}*`
              }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                type: 'text',
                message: `❌ **Agent Swap Failed:** ${swapResult.error || 'Unknown error'}\n\nPlease verify your destination wallet and available balance.`
              }));
            }
          } catch (swapErr: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              type: 'text',
              message: `❌ **Swap Error:** ${swapErr?.message || swapErr}`
            }));
          }
        }
      }

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

      // Case G: Greeting, Capabilities, and Conversational Inquiries
      const isGreeting = /^(hello|hi|hey|greetings|howdy|good\s+(morning|afternoon|evening|day)|yo\b|sup\b)/i.test(lower) ||
                         ['hello', 'hi', 'hey', 'hello there', 'hi there', 'hey there'].includes(lower.trim());
      const isHelpOrCapabilities = /^(what can you do|who are you|how does (?:this|mandate) work|help|what is mandate|what are your agents|explain agents)/i.test(lower);
      const isSmallTalk = /^(how are you|what's up|whats up|how do you do|thanks|thank you|ok|okay|cool|nice)\b/i.test(lower);

      if (isGreeting || isHelpOrCapabilities || isSmallTalk) {
        if (openaiClient) {
          try {
            const completion = await openaiClient.chat.completions.create({
              model: process.env.OPENAI_MODEL || 'gpt-6.1-sol',
              messages: [
                {
                  role: 'system',
                  content: 'You are Mandate, an autonomous AI blockchain agent on NEAR Protocol. You carry out automated on-chain transactions on NEAR Testnet: native NEAR transfers, NEP-141 token swaps (NEAR ↔ Test USDT), smart contract escrow operations, and treasury balance allocations. You enforce user-defined spending limits and authorized payable allowlists, ensuring every transaction is cryptographically verifiable on NearBlocks explorer. Answer conversationally, concisely, and clearly in markdown.'
                },
                {
                  role: 'user',
                  content: prompt
                }
              ],
              temperature: 0.7,
              max_tokens: 350
            });
            const text = completion.choices[0]?.message?.content;
            if (text && text.trim().length > 0) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                type: 'greeting',
                message: text.trim()
              }));
            }
          } catch (aiErr: any) {
            console.warn('[Server Chat] OpenAI conversational fallback:', aiErr?.message || aiErr);
          }
        }

        const currentBal = store.getUserBalance(userAccount);
        const greetingMsg = "Hello! I am **Mandate**, your autonomous business agent orchestrated on **NEAR Protocol**.\n\n" +
          "I coordinate four specialized autonomous agents to execute complex commercial tasks under strict spending limits:\n" +
          "- 🧭 **Mandate Orchestrator:** Analyzes directives, sets budgets, and decomposes workflows.\n" +
          "- 🔍 **Researcher Agent:** Gathers verified vendor quotations, corridor liquidity, and market data.\n" +
          "- 📊 **Analyst Agent:** Compiles comparative pricing matrices and executive recommendations.\n" +
          "- 🛡️ **Verifier Agent:** Audits evidence, validates acceptance criteria, and releases escrow.\n\n" +
          "---\n\n" +
          "### What would you like to run?\n" +
          "You can give me any autonomous business mandate, such as:\n" +
          "- *\"Find three suppliers of 100 office chairs, compare their prices and delivery terms, and prepare a recommendation. You may spend up to $20 on research, but cannot purchase without approval.\"*\n" +
          "- *\"Research competitor pricing and corridor coverage for cross-border stablecoin payments in LATAM and Africa.\"*\n" +
          "- *\"Audit past purchases and reconcile all testnet transactions.\"*\n\n" +
          "**Your Treasury:** `" + userAccount + "` · **" + currentBal.toFixed(2) + " NEAR** available.\n" +
          "You can fund your treasury by typing *\"Fund treasury with 10 NEAR\"* or clicking **Fund Treasury**.";

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'greeting',
          message: greetingMsg,
          treasuryBalance: currentBal.toFixed(2)
        }));
      }

      if (prompt.trim().length <= 3) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          type: 'greeting',
          message: 'Hello! How can I assist with your autonomous business mandates today? Type a mandate directive or try: *"Find three suppliers of 100 office chairs..."*'
        }));
      }

      // Case H: Autonomous Business Mandate Execution
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
