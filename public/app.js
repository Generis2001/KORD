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

  // 5. Mandate Execution Result
  if (data.mandateResult) {
    if (data.treasuryBalance) updateTreasuryUI(data.treasuryBalance);
    const res = data.mandateResult;
    el.innerHTML = `
      <div class="assistant-avatar">M</div>
      <div class="message-content">
        <p>${escapeHtml(data.message)}</p>
        <div class="receipt-card">
          <div class="receipt-top">
            <strong>${escapeHtml(res.mandate.goal)}</strong>
            <span class="receipt-badge-confirmed">ACTIVE</span>
          </div>
          <div style="display:flex; gap:12px; margin: 6px 0; font-size:13px;">
            <div>Budget: <strong>${res.budgetState.totalBudget}</strong></div>
            <div>Spent: <strong style="color:#f59e0b;">${res.budgetState.spent}</strong></div>
            <div>Cap: <strong>${res.mandate.perAgentCap}</strong></div>
          </div>
          <div style="font-size:12.5px; color:#b4b4b4; line-height:1.45; background:#222; padding:8px 10px; border-radius:6px;">
            ${res.steps.map(s => `• <strong>${escapeHtml(s.title)}:</strong> ${escapeHtml(s.detail)}`).join('<br>')}
          </div>
        </div>
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
