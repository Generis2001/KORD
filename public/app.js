// DOM Elements
const sidebar = document.getElementById('sidebar');
const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
const newChatBtn = document.getElementById('newChatBtn');
const heroScreen = document.getElementById('heroScreen');
const messagesStream = document.getElementById('messagesStream');
const chatContainer = document.getElementById('chatContainer');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const footerTreasuryBalance = document.getElementById('footerTreasuryBalance');

// Allowlist Modal & Elements
const allowlistModal = document.getElementById('allowlistModal');
const closeAllowlistModal = document.getElementById('closeAllowlistModal');
const navAllowlist = document.getElementById('navAllowlist');
const headerAllowlistBtn = document.getElementById('headerAllowlistBtn');
const allowlistBadge = document.getElementById('allowlistBadge');
const allowlistItemsContainer = document.getElementById('allowlistItemsContainer');
const newAccountInput = document.getElementById('newAccountInput');
const newAccountLabel = document.getElementById('newAccountLabel');
const addAccountBtn = document.getElementById('addAccountBtn');

// Fund Modal & Elements
const fundModal = document.getElementById('fundModal');
const closeFundModal = document.getElementById('closeFundModal');
const openFundModalBtn = document.getElementById('openFundModalBtn');
const customFundInput = document.getElementById('customFundInput');
const confirmFundBtn = document.getElementById('confirmFundBtn');
const modalTreasuryBal = document.getElementById('modalTreasuryBal');

// Ledger Modal & Elements
const ledgerModal = document.getElementById('ledgerModal');
const closeLedgerModal = document.getElementById('closeLedgerModal');
const navLedger = document.getElementById('navLedger');
const headerLedgerBtn = document.getElementById('headerLedgerBtn');
const ledgerTableBody = document.getElementById('ledgerTableBody');
const toastNotify = document.getElementById('toastNotify');

// Sidebar toggle
sidebarOpenBtn.addEventListener('click', () => sidebar.classList.remove('collapsed'));
sidebarCloseBtn.addEventListener('click', () => sidebar.classList.add('collapsed'));

function showToast(msg) {
  toastNotify.textContent = msg;
  toastNotify.classList.add('show');
  setTimeout(() => toastNotify.classList.remove('show'), 2200);
}

function updateTreasuryUI(balStr) {
  if (!balStr) return;
  const formatted = balStr.includes('NEAR') ? balStr : balStr + ' NEAR';
  if (footerTreasuryBalance) footerTreasuryBalance.textContent = formatted;
  if (modalTreasuryBal) modalTreasuryBal.textContent = formatted;
}

// Fetch Treasury Balance
async function loadTreasuryBalance() {
  try {
    const res = await fetch('/api/treasury');
    const data = await res.json();
    if (data && data.formatted) {
      updateTreasuryUI(data.formatted);
    }
  } catch (err) {
    console.error('Failed to load treasury balance', err);
  }
}

// Fund Treasury Actions
window.fundDirectly = async function(amount) {
  try {
    const res = await fetch('/api/treasury', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountNear: amount, note: 'Quick deposit' })
    });
    const data = await res.json();
    if (data.success) {
      updateTreasuryUI(data.formatted);
      showToast(`Deposited ${amount} NEAR to treasury`);
      fundModal.classList.remove('open');
    }
  } catch {
    showToast('Failed to fund treasury');
  }
};

confirmFundBtn.addEventListener('click', () => {
  const amt = parseFloat(customFundInput.value);
  if (!isNaN(amt) && amt > 0) {
    customFundInput.value = '';
    fundDirectly(amt);
  }
});

openFundModalBtn.addEventListener('click', () => {
  fundModal.classList.add('open');
  loadTreasuryBalance();
});
closeFundModal.addEventListener('click', () => fundModal.classList.remove('open'));

// Auto-expand textarea
promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
  sendBtn.disabled = promptInput.value.trim().length === 0;
});

// Submit on Enter
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});
sendBtn.addEventListener('click', () => handleSend());

// Modals Open/Close
[navAllowlist, headerAllowlistBtn].forEach(btn => {
  if (btn) btn.addEventListener('click', () => {
    allowlistModal.classList.add('open');
    loadAllowlist();
  });
});
closeAllowlistModal.addEventListener('click', () => allowlistModal.classList.remove('open'));

[navLedger, headerLedgerBtn].forEach(btn => {
  if (btn) btn.addEventListener('click', () => {
    ledgerModal.classList.add('open');
    loadLedger();
  });
});
closeLedgerModal.addEventListener('click', () => ledgerModal.classList.remove('open'));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    allowlistModal.classList.remove('open');
    fundModal.classList.remove('open');
    ledgerModal.classList.remove('open');
  }
});

// Add Account to Allowlist
addAccountBtn.addEventListener('click', async () => {
  const accountId = newAccountInput.value.trim().toLowerCase();
  const label = newAccountLabel.value.trim() || 'Approved Recipient';
  if (!accountId) return;

  try {
    const res = await fetch('/api/allowlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, label })
    });
    const data = await res.json();
    newAccountInput.value = '';
    newAccountLabel.value = '';
    renderAllowlist(data.list);
    showToast(`Added ${accountId} to allowlist`);
  } catch (err) {
    showToast('Failed to add account');
  }
});

// Fetch & Render Allowlist
async function loadAllowlist() {
  try {
    const res = await fetch('/api/allowlist');
    const list = await res.json();
    renderAllowlist(list);
  } catch (err) {
    console.error('Allowlist load error', err);
  }
}

function renderAllowlist(list) {
  if (!Array.isArray(list)) return;
  allowlistBadge.textContent = list.length;

  if (list.length === 0) {
    allowlistItemsContainer.innerHTML = '<div style="color:#8e8e8e; font-size:13px;">No accounts on allowlist yet.</div>';
    return;
  }

  allowlistItemsContainer.innerHTML = list.map(item => `
    <div class="allowlist-row">
      <div>
        <div class="allowlist-acc">${escapeHtml(item.accountId)}</div>
        <div class="allowlist-lbl">${escapeHtml(item.label || 'Approved Payee')}</div>
      </div>
      <div class="allowlist-actions">
        <button class="btn-mini-pay" onclick="prefillPayment('${escapeHtml(item.accountId)}')">Pay NEAR</button>
        <button class="btn-mini-del" onclick="removeAllowlistAccount('${escapeHtml(item.accountId)}')">Remove</button>
      </div>
    </div>
  `).join('');
}

window.prefillPayment = function(accountId) {
  allowlistModal.classList.remove('open');
  promptInput.value = `Pay 5 NEAR to ${accountId}`;
  promptInput.focus();
  promptInput.dispatchEvent(new Event('input'));
};

window.removeAllowlistAccount = async function(accountId) {
  try {
    const res = await fetch('/api/allowlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId })
    });
    const data = await res.json();
    renderAllowlist(data.list);
    showToast(`Removed ${accountId} from allowlist`);
  } catch (err) {
    showToast('Failed to remove account');
  }
};

// Fetch & Render Ledger
async function loadLedger() {
  try {
    const res = await fetch('/api/ledger');
    const rows = await res.json();
    if (!rows.length) {
      ledgerTableBody.innerHTML = '<tr><td colspan="7">No payment events recorded yet.</td></tr>';
      return;
    }
    ledgerTableBody.innerHTML = rows.map(r => `
      <tr>
        <td>#${r.id}</td>
        <td><strong>${escapeHtml(r.mandateId)}</strong><br><small style="color:#8e8e8e">${escapeHtml(r.taskId)}</small></td>
        <td style="font-family:var(--font-mono); font-size:12px;">${escapeHtml(r.recipient)}</td>
        <td><strong>$${r.amountDollars}</strong></td>
        <td>
          <span style="color:${r.status === 'confirmed' ? '#10a37f' : '#ef4444'}; font-weight:600; text-transform:uppercase;">
            ${r.status}
          </span>
        </td>
        <td>
          ${r.txHash ? `<a href="${r.explorerUrl}" target="_blank" style="color:#10a37f; text-decoration:none;">${r.txHash.slice(0, 10)}... ↗</a>` : '-'}
        </td>
        <td style="max-width:240px; font-size:12px; color:#b4b4b4;">${escapeHtml(r.note)}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Ledger error', err);
  }
}

// Suggestion card clicks
document.querySelectorAll('.suggestion-card').forEach(card => {
  card.addEventListener('click', () => {
    const prompt = card.getAttribute('data-prompt');
    if (prompt) {
      promptInput.value = prompt;
      handleSend();
    }
  });
});

// Quick action items in sidebar
document.querySelectorAll('.history-item').forEach(item => {
  item.addEventListener('click', () => {
    const act = item.getAttribute('data-action');
    if (act) {
      promptInput.value = act;
      handleSend();
    }
  });
});

newChatBtn.addEventListener('click', () => {
  messagesStream.innerHTML = '';
  heroScreen.style.display = 'flex';
  promptInput.value = '';
  promptInput.style.height = 'auto';
});

// Handle User Sending Message
async function handleSend() {
  const query = promptInput.value.trim();
  if (!query) return;

  heroScreen.style.display = 'none';
  promptInput.value = '';
  promptInput.style.height = 'auto';
  sendBtn.disabled = true;

  appendUserMessage(query);

  const placeholderId = 'assist_' + Date.now();
  appendAssistantLoading(placeholderId);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: query })
    });
    const data = await res.json();
    renderAssistantResponse(placeholderId, data);
  } catch (err) {
    updateAssistantError(placeholderId, err.message || 'Execution error');
  } finally {
    sendBtn.disabled = false;
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

function appendUserMessage(text) {
  const row = document.createElement('div');
  row.className = 'message-row user';
  row.innerHTML = `<div class="message-bubble user">${escapeHtml(text)}</div>`;
  messagesStream.appendChild(row);
}

function appendAssistantLoading(id) {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.id = id;
  row.innerHTML = `
    <div class="assistant-avatar">M</div>
    <div class="message-content">
      <div style="font-size:13px; color:#8e8e8e;">Processing directive...</div>
    </div>
  `;
  messagesStream.appendChild(row);
}

function renderAssistantResponse(id, data) {
  const el = document.getElementById(id);
  if (!el) return;

  // 1. Payment Confirmed (Deduction)
  if (data.type === 'payment_confirmed') {
    el.innerHTML = `
      <div class="assistant-avatar">M</div>
      <div class="message-content">
        <p>${escapeHtml(data.message)}</p>
        <div class="receipt-card">
          <div class="receipt-top">
            <span class="receipt-badge-confirmed">CONFIRMED ON-CHAIN</span>
            <span style="font-size:12px; color:#8e8e8e;">NEAR Testnet</span>
          </div>
          <div class="receipt-amount-row">
            -${data.amountNear} <span class="receipt-unit">NEAR</span>
          </div>
          <div class="receipt-meta">
            <div class="receipt-meta-row">
              <span>Recipient:</span>
              <strong>${escapeHtml(data.recipient)}</strong>
            </div>
            ${data.addedToAllowlist ? `
              <div class="receipt-meta-row">
                <span>Allowlist:</span>
                <span style="color:#10a37f; font-weight:600;">Added to Mandate Allowlist</span>
              </div>
            ` : ''}
            <div class="receipt-meta-row">
              <span>Transaction:</span>
              <a href="${data.explorerUrl}" target="_blank" style="color:#10a37f; text-decoration:none;">
                ${data.txHash ? data.txHash.slice(0, 16) + '...' : 'View Explorer'} ↗
              </a>
            </div>
            <div class="receipt-meta-row">
              <span>New Treasury Balance:</span>
              <strong style="color:#10a37f;">${data.remainingBalance} NEAR</strong>
            </div>
          </div>
        </div>
      </div>
    `;
    updateTreasuryUI(data.remainingBalance);
    loadAllowlist();
    return;
  }

  // 2. Treasury Funded (Increment)
  if (data.type === 'treasury_funded') {
    el.innerHTML = `
      <div class="assistant-avatar">M</div>
      <div class="message-content">
        <div style="font-size:14.5px; line-height:1.6; white-space:pre-wrap;">${formatMarkdown(data.message)}</div>
        <div class="receipt-card" style="border-left: 3px solid #10a37f;">
          <div class="receipt-top">
            <span class="receipt-badge-confirmed">TREASURY DEPOSIT</span>
            <span style="font-size:12px; color:#10a37f; font-weight:700;">+${data.amountNear} NEAR</span>
          </div>
          <div class="receipt-meta" style="margin-top:6px;">
            <div class="receipt-meta-row">
              <span>Updated Balance:</span>
              <strong style="color:#10a37f;">${data.newBalance} NEAR</strong>
            </div>
          </div>
        </div>
      </div>
    `;
    updateTreasuryUI(data.newBalance);
    return;
  }

  // 3. Allowlist View
  if (data.type === 'allowlist_view' && data.allowlist) {
    const rows = data.allowlist.map(a => `
      <tr>
        <td><strong>${escapeHtml(a.accountId)}</strong></td>
        <td style="color:#8e8e8e;">${escapeHtml(a.label || 'Approved')}</td>
        <td>
          <button class="btn-mini-pay" onclick="prefillPayment('${escapeHtml(a.accountId)}')">Pay</button>
        </td>
      </tr>
    `).join('');

    el.innerHTML = `
      <div class="assistant-avatar">M</div>
      <div class="message-content">
        <p>${escapeHtml(data.message)}</p>
        <div class="receipt-card">
          <table class="allowlist-table-chat">
            <thead>
              <tr><th>Account</th><th>Label</th><th>Action</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
    return;
  }

  // 4. Greeting or Standard Text
  if (data.type === 'greeting' || data.type === 'text' || data.type === 'allowlist_warning' || data.type === 'security_notice' || data.type === 'payment_failed') {
    if (data.treasuryBalance) updateTreasuryUI(data.treasuryBalance);
    el.innerHTML = `
      <div class="assistant-avatar">M</div>
      <div class="message-content">
        <div style="font-size:14.5px; line-height:1.6; white-space:pre-wrap;">${formatMarkdown(data.message)}</div>
      </div>
    `;
    return;
  }

  // 5. Mandate Execution Result (Strictly Aligned Executive Experience)
  if (data.mandateResult) {
    if (data.treasuryBalance) updateTreasuryUI(data.treasuryBalance);
    const res = data.mandateResult;
    const txLink = res.payout && res.payout.txHash
      ? `<a href="https://testnet.nearblocks.io/txns/${res.payout.txHash}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:underline; font-family:var(--font-mono);">${res.payout.txHash.slice(0, 16)}...</a>`
      : null;

    el.innerHTML = `
      <div class="assistant-avatar">M</div>
      <div class="message-content" style="max-width:100%;">
        <div style="font-size:15px; font-weight:600; color:#fff; margin-bottom:8px;">
          Autonomous Mandate Executed · Spending Guardrails Enforced
        </div>

        <!-- 1. Mandate Policy Card -->
        <div class="receipt-card" style="margin-bottom:12px; background:#111622; border-color:#1e293b;">
          <div class="receipt-top">
            <span style="font-weight:600; color:#f8fafc; font-size:13.5px;">${escapeHtml(res.mandate.goal)}</span>
            <span class="receipt-badge-confirmed" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3);">ACTIVE</span>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:16px; margin: 10px 0 8px 0; font-size:13px; color:#94a3b8;">
            <div>Mandate Budget: <strong style="color:#fff;">${res.budgetState.totalBudget}</strong></div>
            <div>Per-Agent Cap: <strong style="color:#fff;">${res.mandate.perAgentCap}</strong></div>
            <div>Disbursed: <strong style="color:#10b981;">${res.budgetState.spent}</strong></div>
            <div>Remaining: <strong style="color:#38bdf8;">${res.budgetState.remaining}</strong></div>
          </div>
          <div style="font-size:12px; padding:6px 10px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); border-radius:6px; color:#fca5a5;">
            🛑 <strong>Active Restriction:</strong> ${escapeHtml(res.mandate.restrictions ? res.mandate.restrictions[0] : 'Purchases prohibited without explicit user authorization.')}
          </div>
        </div>

        <!-- 2. Specialized Multi-Agent Roles -->
        <div style="margin-bottom:12px; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:10px 12px;">
          <div style="font-size:12px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">Specialized Agent Delegation</div>
          <div style="display:flex; flex-direction:column; gap:6px; font-size:12.5px;">
            ${res.delegation.map(d => `
              <div style="display:flex; align-items:flex-start; gap:8px;">
                <span style="color:#38bdf8; font-weight:600; min-width:85px; text-transform:capitalize;">${escapeHtml(d.role)}:</span>
                <span style="color:#cbd5e1; flex:1;">${escapeHtml(d.description)}</span>
                <code style="font-size:11px; color:#64748b; font-family:var(--font-mono);">${escapeHtml(d.agentAccount)}</code>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 3. Executive Verified Deliverable -->
        <div style="margin-bottom:12px; background:#0b0f19; border:1px solid #1e293b; border-radius:8px; padding:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #1e293b; padding-bottom:8px;">
            <div style="font-size:13px; font-weight:600; color:#38bdf8; text-transform:uppercase; letter-spacing:0.5px;">Verified Executive Deliverable</div>
            <span style="font-size:11.5px; background:rgba(16,185,129,0.15); color:#10b981; padding:3px 8px; border-radius:12px; font-weight:600;">✓ AUDIT PASSED</span>
          </div>
          <div class="deliverable-body" style="font-size:13.5px; line-height:1.65; color:#cbd5e1;">
            ${renderMarkdownRich(res.deliverable.preview)}
          </div>
        </div>

        <!-- 4. On-Chain Settlement Receipt -->
        <div style="margin-bottom:12px; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:12px;">
          <div style="font-size:12px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">On-Chain Testnet Settlement</div>
          <div style="font-size:13px; color:#cbd5e1; line-height:1.5;">
            • <strong>Disbursement:</strong> Paid ${res.payout.amount} to <code style="color:#38bdf8;">${res.payout.recipient}</code> for verified research services.<br>
            • <strong>Testnet Transaction:</strong> ${txLink ? txLink + ' (Live on NearBlocks)' : '<em>Pending block inclusion</em>'}<br>
            • <strong>Policy Audit:</strong> Validated allowlist, verified rubric, under ${res.mandate.perAgentCap} cap.
          </div>
        </div>

        <!-- 5. Restriction Guardrails Enforced (The Blocked Actions) -->
        ${res.attackSimulation && res.attackSimulation.length > 0 ? `
          <div style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.25); border-radius:8px; padding:12px;">
            <div style="font-size:12px; font-weight:600; color:#ef4444; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">
              Enforced Restrictions & Guardrails (Intercepted Actions)
            </div>
            <div style="display:flex; flex-direction:column; gap:8px; font-size:12.5px;">
              ${res.attackSimulation.map(att => `
                <div style="background:rgba(0,0,0,0.3); padding:8px 10px; border-radius:6px; border-left:3px solid #ef4444;">
                  <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
                    <strong style="color:#f87171;">${escapeHtml(att.attempt)}</strong>
                    <span style="color:#ef4444; font-weight:700; font-size:11px;">🛑 ${att.status}</span>
                  </div>
                  <div style="color:#94a3b8; font-size:11.5px;">
                    ${att.reasons.map(r => `• ${escapeHtml(r.message)}`).join('<br>')}
                  </div>
                </div>
              `).join('')}
            </div>
            <div style="font-size:12px; color:#94a3b8; margin-top:8px;">
              <em>The agents performed the research autonomously within their permissions, while restricted purchase actions remained strictly under your control.</em>
            </div>
          </div>
        ` : ''}

      </div>
    `;
    return;
  }

  // Fallback
  el.innerHTML = `
    <div class="assistant-avatar">M</div>
    <div class="message-content">
      <p>${escapeHtml(data.message || 'Done.')}</p>
    </div>
  `;
}

function updateAssistantError(id, errMsg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `
    <div class="assistant-avatar" style="background:#ef4444;">!</div>
    <div class="message-content">
      <div style="color:#ef4444; font-weight:600;">Encountered an issue:</div>
      <div style="color:#fca5a5; font-size:13px;">${escapeHtml(errMsg)}</div>
    </div>
  `;
}

function formatMarkdown(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08); padding:2px 5px; border-radius:4px; font-family:var(--font-mono); font-size:12.5px;">$1</code>');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial load
loadTreasuryBalance();
loadAllowlist();

function renderMarkdownRich(md) {
  if (!md) return '';
  let html = md;
  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre style="background:#090d16; padding:10px; border-radius:6px; overflow-x:auto; font-family:var(--font-mono); font-size:12px; margin:10px 0;"><code>$1</code></pre>');
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h4 style="margin:14px 0 6px 0; color:#e2e8f0; font-size:13.5px; font-weight:600;">$1</h4>');
  html = html.replace(/^## (.*$)/gim, '<h3 style="margin:18px 0 8px 0; color:#f8fafc; font-size:15px; font-weight:600; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:4px;">$1</h3>');
  html = html.replace(/^# (.*$)/gim, '<h2 style="margin:20px 0 10px 0; color:#fff; font-size:17px; font-weight:700;">$1</h2>');
  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff;">$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08); padding:2px 5px; border-radius:4px; font-family:var(--font-mono); font-size:12px; color:#38bdf8;">$1</code>');
  // Lists
  html = html.replace(/^\s*-\s+(.*$)/gim, '<li style="margin-left:18px; margin-bottom:4px; color:#cbd5e1;">$1</li>');
  html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li style="margin-left:18px; margin-bottom:4px; color:#cbd5e1;">$1</li>');
  // Links
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:underline;">$1</a>');
  // Tables
  html = html.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (tableText) => {
    const lines = tableText.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return tableText;
    let tableHtml = '<div style="overflow-x:auto; margin:14px 0;"><table style="width:100%; border-collapse:collapse; font-size:12px; border:1px solid #334155;">';
    lines.forEach((line, idx) => {
      if (line.includes('---')) return;
      const cells = line.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());
      tableHtml += '<tr>';
      cells.forEach(c => {
        const tag = idx === 0 ? 'th' : 'td';
        const bg = idx === 0 ? 'background:#1e293b; font-weight:600; color:#f8fafc;' : 'background:rgba(15,23,42,0.65); color:#cbd5e1;';
        tableHtml += `<${tag} style="${bg} padding:8px 10px; border:1px solid #334155; text-align:left;">${c}</${tag}>`;
      });
      tableHtml += '</tr>';
    });
    tableHtml += '</table></div>';
    return tableHtml;
  });
  return html.replace(/\n\n/g, '<br><br>');
}
