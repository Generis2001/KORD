import 'dotenv/config';
import { AgentSwapService, TEST_USDT_DISCLAIMER } from './swap.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { Store } from './db.js';
import { loadNearConfig } from './near.js';
import { runAutonomousMandate } from './runner.js';
import { researchPaymentRequest } from './research-payment.js';
import { AgentWallet, validAccount } from './agent-wallet.js';
import { auditWalletReceipt } from './receipt-audit.js';
import { VerifiedEscrow } from './escrow.js';
import { WalletStore } from './wallet-store.js';
import { verifyWalletRequest } from './wallet-auth.js';
import { parseWalletCommand } from './wallet-command.js';
import { createHash } from 'node:crypto';

const PORT = 3000;
const rootDir = path.resolve('.');
const publicDir = path.join(rootDir, 'public');
const dbPath = process.env.MANDATE_DB ?? (process.env.VERCEL ? path.join('/tmp', 'mandate.db') : path.join(rootDir, 'mandate.db'));

const store = new Store(dbPath);
const nearCfg = loadNearConfig();
const swapService = new AgentSwapService();
const agentWallet = new AgentWallet(nearCfg, new WalletStore(store));
const verifiedEscrow = new VerifiedEscrow(agentWallet);

function readBody(req: http.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let value = '';
    req.on('data', chunk => { value += chunk; });
    req.on('end', () => resolve(value));
    req.on('error', reject);
  });
}

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

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost:3000'}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-mandate-account, x-mandate-timestamp, x-mandate-public-key, x-mandate-signature, x-mandate-auth-type, x-mandate-nonce');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Extract user account for isolation (or fallback to default user)
  const userAccountHeader = (req.headers['x-mandate-account'] as string) || url.searchParams.get('account');
  const userAccount = (userAccountHeader ? userAccountHeader.trim().toLowerCase() : 'default-user.testnet');

  if (url.pathname.startsWith('/api/') && (!validAccount(userAccount) || (nearCfg.network === 'testnet' && userAccount.endsWith('.near')) || (nearCfg.network === 'mainnet' && userAccount.endsWith('.testnet')))) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid linked account for this network.' }));
  }

  try {
    if (url.pathname.startsWith('/api/')) await store.syncFromPostgres();
  } catch {}
  if (url.pathname.startsWith('/api/')) store.getOrCreateUser(userAccount, 0);

  const json = (code: number, data: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === '/api/wallet/config' && req.method === 'GET') {
    return json(200, { network: nearCfg.network, authReceiver: nearCfg.accountId,
      walletUrl: nearCfg.network === 'testnet' ? 'https://testnet.mynearwallet.com' : 'https://app.mynearwallet.com' });
  }
  if ((url.pathname === '/api/wallet' || url.pathname === '/api/treasury') && req.method === 'GET') {
    try {
      const snapshot = await agentWallet.snapshot(userAccount);
      return json(200, { ...snapshot, formatted: Number(snapshot.balanceNear).toFixed(4) + ' NEAR',
        userQuotaNear: snapshot.balanceNear, formattedUsdt: Number(snapshot.userUsdt).toFixed(2) + ' USDT', operations: await agentWallet.receipts.list(userAccount) });
    } catch (e: any) { return json(503, { error: e.message }); }
  }
  if (['/api/wallet/deposit', '/api/wallet/deposit/confirm', '/api/wallet/execute', '/api/wallet/reconcile', '/api/wallet/resume', '/api/treasury', '/api/swap/execute'].includes(url.pathname) && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (url.pathname === '/api/wallet/deposit') {
          if (!['NEAR', 'USDT'].includes(payload.asset)) throw new Error('Choose NEAR or USDT.');
          return json(200, await agentWallet.prepareDeposit(userAccount, payload.asset, payload.amount));
        }
        if (url.pathname === '/api/wallet/deposit/confirm' || url.pathname === '/api/treasury') {
          return json(200, { success: true, operation: await agentWallet.confirmDeposit(userAccount, payload.txHash) });
        }
        await verifyWalletRequest(agentWallet.provider, userAccount, 'POST', url.pathname, body, req.headers);
        if (url.pathname === '/api/wallet/reconcile' || url.pathname === '/api/wallet/resume') {
          const operation = url.pathname.endsWith('/reconcile') ? await agentWallet.reconcile(userAccount, payload.id) : await agentWallet.resumeSwap(userAccount, payload.id);
          return json(200, { operation });
        }
        const request = url.pathname === '/api/swap/execute'
          ? { id: payload.id, action: 'swap', asset: payload.asset || 'NEAR', amount: String(payload.inputNear), minOutput: payload.minOutputUsdt ? String(payload.minOutputUsdt) : undefined }
          : payload;
        if (request.action === 'send' && !(await store.isAllowed(request.recipient || '', userAccount))) throw new Error('Add this recipient to your payable allowlist first.');
        const operation = await agentWallet.execute(userAccount, request);
        return json(operation.status === 'confirmed' ? 200 : 409, { operation, status: operation.status, txHash: operation.txHashes.at(-1), explorerUrl: operation.txHashes.length ? agentWallet.explorer(operation.txHashes.at(-1)!) : null });
      } catch (e: any) { return json(400, { error: e.message }); }
    });
    return;
  }

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
          const { accountId } = JSON.parse(body || '{}');
          if (!accountId || typeof accountId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'accountId is required' }));
          }
          const cleanId = accountId.trim().toLowerCase();
          if (!validAccount(cleanId)) throw new Error('Invalid NEAR account ID.');
          const user = store.getOrCreateUser(cleanId, 0);
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

  // 3. /api/allowlist (GET, POST, DELETE)
  if (url.pathname === '/api/allowlist') {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      try { return json(200, await store.getAllowlist(userAccount)); }
      catch (error: any) { return json(503, { error: error.message }); }
    }

    if (req.method === 'POST' || req.method === 'DELETE') {
      const body = await readBody(req);
      try {
        await verifyWalletRequest(agentWallet.provider, userAccount, req.method, url.pathname, body, req.headers);
        const { accountId, label } = JSON.parse(body || '{}');
        if (typeof accountId !== 'string' || !validAccount(accountId.trim().toLowerCase())) throw new Error('Invalid recipient account ID.');
        if (req.method === 'POST') await store.addToAllowlist(accountId, label || 'Approved Recipient', userAccount);
        else await store.removeFromAllowlist(accountId, userAccount);
        return json(200, { success: true, list: await store.getAllowlist(userAccount) });
      } catch (error: any) { return json(500, { error: error.message }); }
    }
  }

  // 4. /api/ledger (GET accurately reflects confirmed payments & on-chain txs)
  if (url.pathname === '/api/ledger') {
    try {
      const operations = await agentWallet.receipts.list(userAccount);
      const walletRows = operations.map(op => ({ id: op.id, mandateId: 'agent-wallet', taskId: op.action, recipient: op.recipient || agentWallet.identity(userAccount).accountId,
        amountDollars: op.asset === 'USDT' ? op.amount + ' Test USDT' : '—', amountNear: op.asset === 'NEAR' ? op.amount : '—', status: op.status,
        onchain: op.status === 'confirmed', txHash: op.txHashes.at(-1) || null, note: `${op.action} ${op.amount} ${op.asset}${op.error ? ': ' + op.error : ''}`, createdAt: op.createdAt,
        explorerUrl: op.txHashes.length ? agentWallet.explorer(op.txHashes.at(-1)!) : null }));
      const formatted = [...walletRows, ...store.getLedger(userAccount)].sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0,50);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(formatted));
    } catch (e: any) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }
  }

  // Conversation writes finish in durable storage before the client receives success.
  if (url.pathname === '/api/conversations') {
    if (req.method === 'GET') {
      try {
        const id = url.searchParams.get('id');
        if (id) {
          const conversation = await store.getConversationAsync(id, userAccount);
          return json(conversation ? 200 : 404, conversation || { error: 'Conversation not found.' });
        }
        return json(200, await store.getConversationsAsync(userAccount));
      } catch { return json(503, { error: 'Conversation history is temporarily unavailable. Try again shortly.' }); }
    }
    if (req.method === 'POST' || req.method === 'DELETE') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          if (typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(payload.id)) return json(400, { error: 'A valid conversation ID is required.' });
          if (req.method === 'DELETE') {
            const deleted = await store.deleteConversation(payload.id, userAccount);
            return json(deleted ? 200 : 404, deleted ? { success: true } : { error: 'Conversation not found.' });
          }
          if (!Array.isArray(payload.messages) || payload.messages.some((message: any) => !message || !['user','assistant'].includes(message.role))) return json(400, { error: 'A valid message array is required.' });
          await store.saveConversation(payload.id, userAccount, String(payload.title || 'Mandate Session').slice(0,120), payload.messages);
          return json(200, { success: true });
        } catch { return json(503, { error: 'Conversation could not be saved. Your local backup will retry syncing.' }); }
      });
      return;
    }
    return json(405, { error: 'Method not allowed.' });
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
      const swaps = (await agentWallet.receipts.list(userAccount)).filter(op => op.action === 'swap' && op.asset === 'NEAR').map(op => ({
        id: op.id, inputNear: op.amount, outputAmount: Number(op.amount) * 5, exchangeRate: 5, destinationWallet: op.recipient,
        status: op.status === 'confirmed' ? 'payout_confirmed' : op.status, payoutTxHash: op.status === 'confirmed' ? op.txHashes.at(-1) : null, createdAt: op.createdAt }));
      const history = [...swaps, ...store.listSwaps(userAccount)];
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

  // 6. /api/chat (Handles natural language directives & autonomous mandates)
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    res.setHeader('Cache-Control', 'no-store, no-transform');
    const body = await readBody(req);
    let payload: { message?: string; id?: string; stream?: boolean };
    let prompt = '';
    try {
      payload = JSON.parse(body || '{}');
      if (typeof payload.message !== 'string') throw new Error('Missing directive');
      prompt = payload.message.trim();
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
    }

    const lower = prompt.toLowerCase();


    try {
      const refund = prompt.trim().match(/^(?:mandate\s+)?refund escrow (m_[a-f0-9]{40})$/i);
      if (refund) {
        await verifyWalletRequest(agentWallet.provider, userAccount, 'POST', url.pathname, body, req.headers);
        const operation = await verifiedEscrow.refund(userAccount, refund[1].toLowerCase());
        return json(200, { type: 'text', operation, message: operation.status === 'confirmed' && operation.action === 'escrow_refund'
          ? `Escrow refunded **${operation.amount} testnet NEAR** to your agent wallet. [View receipt](${agentWallet.explorer(operation.txHashes.at(-1)!)})`
          : `Escrow refund needs review: ${operation.error || operation.status}. Reconcile operation \`${operation.id}\` before retrying.` });
      }
      const command = parseWalletCommand(prompt);
      if (command) {
        if (command.action === 'deposit') {
          const deposit = await agentWallet.prepareDeposit(userAccount, command.asset, command.amount);
          return json(200, { type: 'wallet_deposit', deposit, message: `Deposit **${command.amount} ${command.asset}** into your Mandate agent wallet. Sign the transfer in your linked wallet to complete it.` });
        }
        await verifyWalletRequest(agentWallet.provider, userAccount, 'POST', url.pathname, body, req.headers);
        if (command.action === 'send' && !(await store.isAllowed(command.recipient!, userAccount))) {
          if (/add\s+to\s+allowlist|approve/i.test(lower)) await store.addToAllowlist(command.recipient!, 'User approved payee', userAccount);
          else return json(200, { type: 'text', message: `Add \`${command.recipient}\` to your payable allowlist before sending funds.` });
        }
        const id = 'chat-' + createHash('sha256').update(userAccount + body + String(req.headers['x-mandate-signature'])).digest('hex');
        const operation = await agentWallet.execute(userAccount, { ...command, id });
        const receipts = operation.txHashes.map(hash => `[View transaction](${agentWallet.explorer(hash)})`).join(' · ');
        return json(200, { type: 'text', operation,
          message: operation.status === 'confirmed'
            ? `**${command.action.toUpperCase()} confirmed:** ${command.amount} ${command.asset}.\n\n${command.action === 'unstake' ? 'Unstaking has started. Funds return to your agent wallet after the provider cooldown; Mandate checks for available withdrawals while this workspace is open.\n\n' : ''}${command.action === 'swap' ? 'The swapped funds remain in your agent wallet. This uses the testnet demonstration rate of 1 NEAR = 5 Test USDT.\n\n' : ''}${receipts}`
            : `**Transaction needs review:** ${operation.error || operation.status}.\n\n${receipts}\n\nOperation: \`${operation.id}\`. Further spending is paused until its on-chain status is reconciled.` });
      }
      if (/^(?:please\s+)?(?:mandate[, :]*)?\s*(?:stake|unstake|withdraw|deposit|swap|exchange|send|transfer|pay|fund)\b/i.test(lower)) {
        return json(200, { type: 'text', message: 'Use a single command such as **Deposit 2 NEAR**, **Withdraw 5 USDT**, **Stake 1 NEAR**, **Unstake 3 USDT**, or **Send 2 USDT to alice.testnet**.' });
      }
    } catch (e: any) { return json(200, { type: 'text', message: e.message }); }

    // Case A.2: Faucet Queries & Directives
    if (/\b(?:received|got|claimed)\s+[0-9.]+\s*(?:near|usdt)\b/i.test(lower)) {
      return json(200, { type: 'text', message: 'Funds received in your linked wallet stay there until you deposit them into your agent wallet. Use **Deposit 2 NEAR** or **Deposit 5 USDT** to sign a transfer.' });
    }
    if (/\b(?:faucet|claim near|get testnet near|free near|near faucet)\b/i.test(lower)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        type: 'text',
        message: `💧 **NEAR Testnet Faucet:**\n\n` +
          `You can request free Testnet NEAR by visiting **[near-faucet.io](https://near-faucet.io/)** (or clicking the **Faucet** button in the top navigation bar).\n\n` +
          `Once claimed into your connected wallet, deposit the funds into your **Mandate Treasury** (Agentic Wallet) to authorize autonomous agent execution, token swaps, and policy transfers.`
      }));
    }

    if (/balance|wallet info|staking position/i.test(lower)) {
      try {
        const wallet = await agentWallet.snapshot(userAccount);
        return json(200, { type: 'text', ...wallet,
          message: `**Mandate agent wallet:** \`${wallet.accountId}\`\n\nAvailable: **${Number(wallet.balanceNear).toFixed(4)} NEAR** · **${Number(wallet.userUsdt).toFixed(2)} Test USDT**.\n\nStaked: **${wallet.staking.NEAR.staked} NEAR** · **${wallet.staking.USDT.staked} Test USDT**.\n\nLinked wallet: \`${userAccount}\` · ${wallet.linked.near} NEAR · ${wallet.linked.usdt} Test USDT.` });
      } catch (e: any) { return json(503, { type: 'text', message: e.message }); }
    }

    // Case D: View Allowlist
    if (/allowlist|payable|who can i pay|approved accounts/i.test(lower) && !/^add\s/i.test(lower)) {
      try {
        const list = await store.getAllowlist(userAccount);
        return json(200, { type: 'allowlist_view', allowlist: list, message: 'Here are your approved payable accounts on NEAR (' + list.length + ' active):' });
      } catch (error: any) { return json(503, { error: error.message }); }
    }

    // Case E: Add to Allowlist without paying
    const addMatch = lower.match(/add\s+([a-z0-9._-]+)\s+to\s+(?:my\s+)?allowlist/i);
    if (addMatch) {
      try {
        await verifyWalletRequest(agentWallet.provider, userAccount, 'POST', url.pathname, body, req.headers);
        const newAcc = addMatch[1].trim().toLowerCase();
        if (!validAccount(newAcc)) return json(400, { error: 'Invalid recipient account ID.' });
        await store.addToAllowlist(newAcc, 'Approved Payee', userAccount);
        return json(200, { type: 'text', message: '✅ Added `' + newAcc + '` to your payable allowlist. You can now disburse payments to this account anytime.' });
      } catch (error: any) { return json(400, { error: error.message, type: 'text', message: error.message }); }
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
      const greetingMsg = "I am **Mandate**, your NEAR wallet and public-source research workspace.\n\n" +
        "- 🧭 **Orchestrator:** Plans the directive and records spending permissions.\n" +
        "- 🔍 **Researcher:** Retrieves public pages or free Ref Finance market feeds with source timestamps.\n" +
        "- 📊 **Analyst:** Compares observed prices, calculates quantity estimates and prepares a recommendation.\n" +
        "- 🛡️ **Verifier:** Checks source integrity, freshness, coverage and calculations; releases explicitly requested testnet escrow after verification.\n\n" +
        "Research uses no paid model or API. You can authorize a testnet NEAR research fee, released through escrow after verification. Private quotations and unpublished fees stay marked as missing.\n\n" +
        "Try **Compare NEAR and USDT market prices and pool liquidity on Ref Finance**, or compare products using their HTTPS links.\n\n" +
        "Use **Deposit 2 NEAR**, **Swap 2 NEAR for USDT**, **Stake 1 NEAR** or **Unstake 1 NEAR** for wallet actions.";

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        type: 'greeting',
        message: greetingMsg
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
    const streaming = payload.stream === true;
    const writeEvent = (event: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n'); };
    try {
      if (researchPaymentRequest(prompt) || /\bescrow\b|past purchase|audit.*ledger|past transaction|previous spend/i.test(prompt)) await verifyWalletRequest(agentWallet.provider, userAccount, 'POST', url.pathname, body, req.headers);
      if (streaming) {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
      }
      const result = await runAutonomousMandate({
        id: payload.id,
        store,
        goal: prompt,
        onProgress: streaming ? step => writeEvent({ type: 'progress', requestId: payload.id, step }) : undefined,
        userAccount,
        ledger: /audit|past purchase|past transaction/i.test(prompt) ? await agentWallet.receipts.list(userAccount) : [],
        checkReceipt: async operation => {
          const hash = operation.txHashes.at(-1)!;
          const signerId = operation.attempt?.signerId || (operation.action === 'deposit' ? userAccount : agentWallet.identity(userAccount).accountId);
          const receipt: any = await agentWallet.provider.viewTransactionStatusWithReceipts({ txHash: hash, accountId: signerId, waitUntil: 'FINAL' });
          return { text: auditWalletReceipt(operation, receipt, agentWallet.identity(userAccount).accountId, signerId, { NEAR: agentWallet.nearPool, USDT: agentWallet.usdtPool }), url: agentWallet.explorer(hash) };
        },
        settleEscrow: async request => {
          if (!(await store.isAllowed(request.recipient, userAccount))) throw new Error('Add the escrow recipient to your payable allowlist first.');
          return verifiedEscrow.settle(userAccount, request);
        },
      });

      const data = {
        type: 'mandate_execution',
        requestId: result.mandate.id,
        mandateResult: result,
        message: result.mandate.status === 'completed' ? 'Research workflow completed.' : 'Research completed with evidence or settlement gaps.'
      };
      if (streaming) { writeEvent({ type: 'result', requestId: result.mandate.id, data }); res.end(); }
      else json(200, data);
    } catch (err: any) {
      const data = { error: err.message || 'Execution error' };
      if (res.headersSent) { writeEvent({ type: 'result', requestId: payload.id, data }); res.end(); }
      else json(500, data);
    }
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
