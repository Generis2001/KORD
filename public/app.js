// --- Multi-User Account State ---
let currentAccount = localStorage.getItem('mandate_current_account');
if (!currentAccount) {
  // Generate a distinct sandbox account ID for new users so accounts don't collide
  const rand = Math.random().toString(36).substring(2, 6);
  currentAccount = 'client-' + rand + '.testnet';
  localStorage.setItem('mandate_current_account', currentAccount);
}

let activeConversationId = 'conv_' + Date.now();
let conversationMessages = [];

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
const headerAccountName = document.getElementById('headerAccountName');
const headerBalancePill = document.getElementById('headerBalancePill');
const accountSelectorBtn = document.getElementById('accountSelectorBtn');
const conversationsListContainer = document.getElementById('conversationsListContainer');

// Account Modal Elements
const accountModal = document.getElementById('accountModal');
const closeAccountModal = document.getElementById('closeAccountModal');
const modalActiveAccountName = document.getElementById('modalActiveAccountName');
const modalActiveAccountBal = document.getElementById('modalActiveAccountBal');
const newAccountIdInput = document.getElementById('newAccountIdInput');
const createAccountBtn = document.getElementById('createAccountBtn');
const generateRandomAccountBtn = document.getElementById('generateRandomAccountBtn');
const accountsListContainer = document.getElementById('accountsListContainer');

// Allowlist Modal Elements
const allowlistModal = document.getElementById('allowlistModal');
const closeAllowlistModal = document.getElementById('closeAllowlistModal');
const navAllowlist = document.getElementById('navAllowlist');
const headerAllowlistBtn = document.getElementById('headerAllowlistBtn');
const allowlistBadge = document.getElementById('allowlistBadge');
const allowlistItemsContainer = document.getElementById('allowlistItemsContainer');
const newAccountInput = document.getElementById('newAccountInput');
const newAccountLabel = document.getElementById('newAccountLabel');
const addAccountBtn = document.getElementById('addAccountBtn');

// Fund Modal Elements
const fundModal = document.getElementById('fundModal');
const closeFundModal = document.getElementById('closeFundModal');
const openFundModalBtn = document.getElementById('openFundModalBtn');
const customFundInput = document.getElementById('customFundInput');
const confirmFundBtn = document.getElementById('confirmFundBtn');
const modalTreasuryBal = document.getElementById('modalTreasuryBal');

// Ledger Modal Elements
const ledgerModal = document.getElementById('ledgerModal');
const closeLedgerModal = document.getElementById('closeLedgerModal');
const navLedger = document.getElementById('navLedger');
const headerLedgerBtn = document.getElementById('headerLedgerBtn');
const ledgerTableBody = document.getElementById('ledgerTableBody');
const toastNotify = document.getElementById('toastNotify');

// Helper for authenticated/isolated headers
function getApiHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-mandate-account': currentAccount
  };
}

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
  if (headerBalancePill) headerBalancePill.textContent = formatted;
  if (modalActiveAccountBal) modalActiveAccountBal.textContent = formatted;
}

function updateAccountBadgeUI() {
  if (headerAccountName) headerAccountName.textContent = currentAccount;
  if (modalActiveAccountName) modalActiveAccountName.textContent = currentAccount;
}

// Fetch Treasury Balance for current account
async function loadTreasuryBalance() {
  try {
    const res = await fetch('/api/treasury', { headers: getApiHeaders() });
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
      headers: getApiHeaders(),
      body: JSON.stringify({ amountNear: amount, note: 'Quick deposit' })
    });
    const data = await res.json();
    if (data.success) {
      updateTreasuryUI(data.formatted);
      showToast('Funded +' + amount + ' NEAR to ' + currentAccount);
      fundModal.classList.remove('open');
      loadLedger();
    }
  } catch (err) {
    alert('Deposit failed: ' + err.message);
  }
};

confirmFundBtn.addEventListener('click', async () => {
  const val = parseFloat(customFundInput.value);
  if (isNaN(val) || val <= 0) {
    alert('Please enter a valid NEAR amount');
    return;
  }
  confirmFundBtn.disabled = true;
  confirmFundBtn.textContent = 'Depositing...';
  await window.fundDirectly(val);
  customFundInput.value = '';
  confirmFundBtn.disabled = false;
  confirmFundBtn.textContent = 'Deposit Funds';
});

// Modal Toggles
openFundModalBtn.addEventListener('click', () => fundModal.classList.add('open'));
closeFundModal.addEventListener('click', () => fundModal.classList.remove('open'));

function openAllowlist() {
  allowlistModal.classList.add('open');
  loadAllowlist();
}
navAllowlist.addEventListener('click', openAllowlist);
headerAllowlistBtn.addEventListener('click', openAllowlist);
closeAllowlistModal.addEventListener('click', () => allowlistModal.classList.remove('open'));

function openLedger() {
  ledgerModal.classList.add('open');
  loadLedger();
}
navLedger.addEventListener('click', openLedger);
headerLedgerBtn.addEventListener('click', openLedger);
closeLedgerModal.addEventListener('click', () => ledgerModal.classList.remove('open'));

// Account Modal Listeners
accountSelectorBtn.addEventListener('click', () => {
  accountModal.classList.add('open');
  loadAccountsList();
});
closeAccountModal.addEventListener('click', () => accountModal.classList.remove('open'));

// Load Accounts List
async function loadAccountsList() {
  try {
    const res = await fetch('/api/accounts', { headers: getApiHeaders() });
    const data = await res.json();
    if (data && data.users) {
      accountsListContainer.innerHTML = data.users.map(u => {
        const isActive = u.accountId.toLowerCase() === currentAccount.toLowerCase();
        return `
          <div class="account-card-item ${isActive ? 'active' : ''}" onclick="switchAccount('${escapeHtml(u.accountId)}')">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:14px;">${isActive ? '🟢' : '⚪'}</span>
              <span style="font-family:var(--font-mono); font-size:13px; font-weight:600; color:${isActive ? '#10a37f' : '#fff'};">${escapeHtml(u.accountId)}</span>
            </div>
            <span style="font-size:12px; color:#94a3b8; font-weight:500;">${Number(u.balanceNear).toFixed(2)} NEAR</span>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    accountsListContainer.innerHTML = '<div style="font-size:12px; color:#ef4444;">Failed to load accounts.</div>';
  }
}

window.switchAccount = function(newAccId) {
  if (!newAccId || newAccId === currentAccount) {
    accountModal.classList.remove('open');
    return;
  }
  currentAccount = newAccId.trim().toLowerCase();
  localStorage.setItem('mandate_current_account', currentAccount);
  updateAccountBadgeUI();
  accountModal.classList.remove('open');
  showToast('Switched account to ' + currentAccount);
  resetChatToNew();
  loadTreasuryBalance();
  loadAllowlist();
  loadLedger();
  loadConversationsList();
};

createAccountBtn.addEventListener('click', async () => {
  const newId = (newAccountIdInput.value || '').trim().toLowerCase();
  if (!newId) {
    alert('Please enter an account name or ID (e.g. acme-ops.testnet)');
    return;
  }
  const formattedId = newId.endsWith('.testnet') ? newId : newId + '.testnet';
  try {
    createAccountBtn.disabled = true;
    createAccountBtn.textContent = 'Creating...';
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({ accountId: formattedId, initialBalance: 15.00 })
    });
    const data = await res.json();
    if (data.success) {
      newAccountIdInput.value = '';
      window.switchAccount(formattedId);
    } else {
      alert(data.error || 'Failed to create account');
    }
  } catch (err) {
    alert('Error creating account: ' + err.message);
  } finally {
    createAccountBtn.disabled = false;
    createAccountBtn.textContent = 'Create Account';
  }
});

generateRandomAccountBtn.addEventListener('click', () => {
  const rand = Math.random().toString(36).substring(2, 6);
  newAccountIdInput.value = 'agent-' + rand + '.testnet';
});

// Load Payable Allowlist
async function loadAllowlist() {
  allowlistItemsContainer.innerHTML = '<div class="loading-spinner">Loading approved accounts...</div>';
  try {
    const res = await fetch('/api/allowlist', { headers: getApiHeaders() });
    const list = await res.json();
    if (allowlistBadge) allowlistBadge.textContent = list.length;
    if (list.length === 0) {
      allowlistItemsContainer.innerHTML = '<div class="empty-state">No approved recipients. Add one above.</div>';
      return;
    }
    allowlistItemsContainer.innerHTML = list.map(item => `
      <div class="allowlist-row">
        <div class="allowlist-acc-info">
          <span class="allowlist-acc-name">${escapeHtml(item.accountId)}</span>
          <span class="allowlist-acc-label">${escapeHtml(item.label || 'Approved Payee')}</span>
        </div>
        <button class="btn-subtle btn-remove" onclick="removeAllowlist('${escapeHtml(item.accountId)}')">Remove</button>
      </div>
    `).join('');
  } catch (err) {
    allowlistItemsContainer.innerHTML = '<div class="empty-state error">Failed to load allowlist.</div>';
  }
}

// Add Account to Allowlist
addAccountBtn.addEventListener('click', async () => {
  const acc = newAccountInput.value.trim().toLowerCase();
  const label = newAccountLabel.value.trim() || 'Approved Recipient';
  if (!acc) return;
  addAccountBtn.disabled = true;
  addAccountBtn.textContent = 'Adding...';
  try {
    const res = await fetch('/api/allowlist', {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({ accountId: acc, label })
    });
    const data = await res.json();
    if (data.success) {
      newAccountInput.value = '';
      newAccountLabel.value = '';
      showToast('Added ' + acc + ' to allowlist');
      loadAllowlist();
    }
  } catch (err) {
    alert('Failed to add: ' + err.message);
  } finally {
    addAccountBtn.disabled = false;
    addAccountBtn.textContent = 'Add to Allowlist';
  }
});

window.removeAllowlist = async function(accountId) {
  if (!confirm('Remove ' + accountId + ' from approved allowlist?')) return;
  try {
    await fetch('/api/allowlist', {
      method: 'DELETE',
      headers: getApiHeaders(),
      body: JSON.stringify({ accountId })
    });
    showToast('Removed ' + accountId);
    loadAllowlist();
  } catch (err) {
    alert('Failed to remove: ' + err.message);
  }
};

// Load Settlement Ledger (Direct from live database & NearBlocks)
async function loadLedger() {
  ledgerTableBody.innerHTML = '<tr><td colspan="7" class="loading-td">Querying settlement records...</td></tr>';
  try {
    const res = await fetch('/api/ledger', { headers: getApiHeaders() });
    const records = await res.json();
    if (!records || records.length === 0) {
      ledgerTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-td" style="padding:24px; text-align:center; color:#94a3b8;">
            No settlement disbursements recorded for <code>${escapeHtml(currentAccount)}</code> yet.<br>
            <span style="font-size:12px; color:#64748b; margin-top:4px; display:inline-block;">
              Run an autonomous mandate or send NEAR to see live verified settlements.
            </span>
          </td>
        </tr>
      `;
      return;
    }
    ledgerTableBody.innerHTML = records.map(r => {
      const isConfirmed = r.status === 'confirmed';
      const statusBadge = isConfirmed
        ? '<span class="pill pill-success">CONFIRMED</span>'
        : '<span class="pill pill-danger">DENIED</span>';
      
      const explorerLink = r.txHash
        ? `<a href="https://testnet.nearblocks.io/txns/${r.txHash}" target="_blank" rel="noopener noreferrer" class="link-mono">${r.txHash.slice(0, 10)}...</a>`
        : '<span style="color:#64748b;">-</span>';

      const amountDisplay = r.amountNear
        ? r.amountDollars + ' (' + r.amountNear + ' NEAR)'
        : r.amountDollars;

      return `
        <tr>
          <td><code class="tx-id">#${r.id}</code></td>
          <td style="font-size:12.5px; color:#cbd5e1; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(r.mandateId || r.taskId || '')}">
            ${escapeHtml(r.mandateId || r.taskId || 'Direct Transfer')}
          </td>
          <td><code class="link-mono">${escapeHtml(r.recipient)}</code></td>
          <td style="font-weight:600; color:#fff;">${escapeHtml(amountDisplay)}</td>
          <td>${statusBadge}</td>
          <td>${explorerLink}</td>
          <td style="font-size:12px; color:#94a3b8;">${escapeHtml(r.note || '-')}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    ledgerTableBody.innerHTML = '<tr><td colspan="7" class="empty-td error">Failed to load ledger records.</td></tr>';
  }
}

// --- Chat History & Conversations ---
async function loadConversationsList() {
  if (!conversationsListContainer) return;
  try {
    const res = await fetch('/api/conversations', { headers: getApiHeaders() });
    const convos = await res.json();
    if (!convos || convos.length === 0) {
      conversationsListContainer.innerHTML = '<div style="font-size:12px; color:#64748b; padding:6px 10px;">No saved conversations.</div>';
      return;
    }
    conversationsListContainer.innerHTML = convos.map(c => {
      const isActive = c.id === activeConversationId;
      return `
        <div class="history-item ${isActive ? 'active' : ''}" onclick="switchConversation('${escapeHtml(c.id)}')">
          <div class="history-title-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12.5px;">${escapeHtml(c.title || 'Mandate Session')}</span>
          </div>
          <button class="history-delete-btn" onclick="deleteConversation(event, '${escapeHtml(c.id)}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load conversations', err);
  }
}

async function persistCurrentConversation() {
  if (conversationMessages.length === 0) return;
  const firstUserMsg = conversationMessages.find(m => m.role === 'user');
  const title = firstUserMsg ? firstUserMsg.text.slice(0, 36) + (firstUserMsg.text.length > 36 ? '...' : '') : 'Mandate Session';
  try {
    await fetch('/api/conversations', {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({
        id: activeConversationId,
        title,
        domain: 'mandate',
        messages: conversationMessages
      })
    });
    loadConversationsList();
  } catch (err) {
    console.error('Failed to save conversation', err);
  }
}

window.switchConversation = async function(convId) {
  try {
    const res = await fetch('/api/conversations', { headers: getApiHeaders() });
    const convos = await res.json();
    const target = convos.find(c => c.id === convId);
    if (!target) return;
    activeConversationId = target.id;
    conversationMessages = JSON.parse(target.messagesJson || '[]');
    renderConversationMessages();
    loadConversationsList();
  } catch (err) {
    console.error('Error switching conversation', err);
  }
};

window.deleteConversation = async function(e, convId) {
  e.stopPropagation();
  try {
    await fetch('/api/conversations', {
      method: 'DELETE',
      headers: getApiHeaders(),
      body: JSON.stringify({ id: convId })
    });
    if (activeConversationId === convId) {
      resetChatToNew();
    }
    loadConversationsList();
  } catch (err) {
    console.error('Error deleting conversation', err);
  }
};

function resetChatToNew() {
  activeConversationId = 'conv_' + Date.now();
  conversationMessages = [];
  messagesStream.innerHTML = '';
  heroScreen.style.display = 'flex';
  promptInput.value = '';
  loadConversationsList();
}

function renderConversationMessages() {
  messagesStream.innerHTML = '';
  if (conversationMessages.length === 0) {
    heroScreen.style.display = 'flex';
    return;
  }
  heroScreen.style.display = 'none';
  conversationMessages.forEach(msg => {
    if (msg.role === 'user') {
      appendUserMessage(msg.text, false);
    } else if (msg.data) {
      const rowId = 'msg-' + Math.random().toString(36).substring(2, 9);
      appendAssistantLoading(rowId);
      renderAssistantResponse(rowId, msg.data, false);
    }
  });
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

newChatBtn.addEventListener('click', resetChatToNew);

// --- Chat Messaging & Interactions ---
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSubmit();
  }
});
sendBtn.addEventListener('click', handleSubmit);

document.querySelectorAll('.suggestion-card').forEach(card => {
  card.addEventListener('click', () => {
    const p = card.getAttribute('data-prompt');
    if (p) {
      promptInput.value = p;
      handleSubmit();
    }
  });
});

document.querySelectorAll('.history-item[data-action]').forEach(item => {
  item.addEventListener('click', () => {
    const act = item.getAttribute('data-action');
    if (act) {
      promptInput.value = act;
      handleSubmit();
    }
  });
});

async function handleSubmit() {
  const text = promptInput.value.trim();
  if (!text) return;

  heroScreen.style.display = 'none';
  appendUserMessage(text, true);
  promptInput.value = '';
  promptInput.style.height = 'auto';

  const placeholderId = 'loading-' + Date.now();
  appendAssistantLoading(placeholderId);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    renderAssistantResponse(placeholderId, data, true);
    loadTreasuryBalance();
    loadLedger();
  } catch (err) {
    renderAssistantResponse(placeholderId, {
      type: 'text',
      message: '❌ Error communicating with Mandate: ' + err.message
    }, true);
  }
}

function appendUserMessage(text, record = true) {
  if (record) {
    conversationMessages.push({ role: 'user', text });
  }
  const row = document.createElement('div');
  row.className = 'message-row user';
  row.innerHTML = '<div class="message-bubble user">' + escapeHtml(text) + '</div>';
  messagesStream.appendChild(row);
}

// Glowing Minimalist Gem Loading Indicator
function appendAssistantLoading(id) {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.id = id;
  row.innerHTML = `
    <div class="assistant-avatar">
      <svg class="brand-gem" viewBox="0 0 48 48" fill="none" style="width:18px; height:18px;">
        <polygon class="gem-facet f-table" points="16,8 32,8 38,18 10,18" />
        <polygon class="gem-facet f-left" points="8,18 16,8 10,18" />
        <polygon class="gem-facet f-right" points="32,8 40,18 38,18" />
        <polygon class="gem-facet f-center-tri" points="10,18 38,18 24,40" />
        <polygon class="gem-facet f-left-pav" points="8,18 10,18 24,40" />
        <polygon class="gem-facet f-right-pav" points="38,18 40,18 24,40" />
        <polygon class="gem-outline" points="16,8 32,8 40,18 24,40 8,18" />
      </svg>
    </div>
    <div class="message-content">
      <div class="gem-loader-wrap">
        <svg class="mandate-gem-anim" viewBox="0 0 48 48" fill="none">
          <polygon class="gem-facet f-table" points="16,8 32,8 38,18 10,18" />
          <polygon class="gem-facet f-left" points="8,18 16,8 10,18" />
          <polygon class="gem-facet f-right" points="32,8 40,18 38,18" />
          <polygon class="gem-facet f-center-tri" points="10,18 38,18 24,40" />
          <polygon class="gem-facet f-left-pav" points="8,18 10,18 24,40" />
          <polygon class="gem-facet f-right-pav" points="38,18 40,18 24,40" />
          <polygon class="gem-outline" points="16,8 32,8 40,18 24,40 8,18" />
        </svg>
        <span class="gem-pulse-status">Processing mandate with specialized agents...</span>
      </div>
    </div>
  `;
  messagesStream.appendChild(row);
}

function renderAssistantResponse(id, data, record = true) {
  if (record) {
    conversationMessages.push({ role: 'assistant', data });
    persistCurrentConversation();
  }

  const el = document.getElementById(id);
  if (!el) return;

  const gemAvatar = `
    <div class="assistant-avatar">
      <svg class="brand-gem" viewBox="0 0 48 48" fill="none" style="width:18px; height:18px;">
        <polygon class="gem-facet f-table" points="16,8 32,8 38,18 10,18" />
        <polygon class="gem-facet f-left" points="8,18 16,8 10,18" />
        <polygon class="gem-facet f-right" points="32,8 40,18 38,18" />
        <polygon class="gem-facet f-center-tri" points="10,18 38,18 24,40" />
        <polygon class="gem-facet f-left-pav" points="8,18 10,18 24,40" />
        <polygon class="gem-facet f-right-pav" points="38,18 40,18 24,40" />
        <polygon class="gem-outline" points="16,8 32,8 40,18 24,40 8,18" />
      </svg>
    </div>
  `;

  // 1. Payment Confirmed (Deduction)
  if (data.type === 'payment_confirmed') {
    el.innerHTML = `
      ${gemAvatar}
      <div class="message-content">
        <p>${escapeHtml(data.message)}</p>
        <div class="receipt-card">
          <div class="receipt-top">
            <span class="receipt-badge-confirmed">ON-CHAIN SETTLEMENT CONFIRMED</span>
            <span style="font-size:12px; color:#8e8e8e;">NEAR Testnet</span>
          </div>
          <div class="receipt-amount-row">
            <span>${escapeHtml(data.amountNear)}</span>
            <span class="receipt-unit">NEAR</span>
          </div>
          <div class="receipt-meta">
            <div class="receipt-meta-row">
              <span>Recipient:</span>
              <strong>${escapeHtml(data.recipient)}</strong>
            </div>
            <div class="receipt-meta-row">
              <span>Account:</span>
              <strong style="color:#10a37f;">${escapeHtml(currentAccount)}</strong>
            </div>
            <div class="receipt-meta-row">
              <span>Transaction Hash:</span>
              <strong>${escapeHtml(data.txHash ? data.txHash.slice(0, 16) + '...' : 'Verified')}</strong>
            </div>
            <div class="receipt-meta-row">
              <span>Explorer Receipt:</span>
              <a href="${data.explorerUrl || '#'}" target="_blank" rel="noopener noreferrer" style="color:#10a37f; text-decoration:underline;">View on NearBlocks ↗</a>
            </div>
          </div>
        </div>
      </div>
    `;
    if (data.remainingBalance) updateTreasuryUI(data.remainingBalance);
    return;
  }

  // 2. Treasury Funded
  if (data.type === 'treasury_funded') {
    el.innerHTML = `
      ${gemAvatar}
      <div class="message-content">
        <div class="receipt-card">
          <div class="receipt-top">
            <span class="receipt-badge-confirmed">TREASURY DEPOSIT CONFIRMED</span>
          </div>
          <div class="receipt-amount-row">
            <span>+${escapeHtml(data.amountNear)}</span>
            <span class="receipt-unit">NEAR</span>
          </div>
          <div class="receipt-meta">
            <div class="receipt-meta-row">
              <span>Target Account:</span>
              <strong style="color:#10a37f;">${escapeHtml(currentAccount)}</strong>
            </div>
            <div class="receipt-meta-row">
              <span>New Available Balance:</span>
              <strong>${escapeHtml(data.newBalance)} NEAR</strong>
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
      ${gemAvatar}
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
      ${gemAvatar}
      <div class="message-content">
        <div style="font-size:14.5px; line-height:1.6; white-space:pre-wrap;">${formatMarkdown(data.message)}</div>
      </div>
    `;
    return;
  }

  // 5. Mandate Execution Result (Strictly Aligned Executive Experience with 4 Specialized Roles)
  if (data.mandateResult) {
    if (data.treasuryBalance) updateTreasuryUI(data.treasuryBalance);
    const res = data.mandateResult;
    const txLink = res.payout && res.payout.txHash
      ? `<a href="https://testnet.nearblocks.io/txns/${res.payout.txHash}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:underline; font-family:var(--font-mono);">${res.payout.txHash.slice(0, 16)}...</a>`
      : null;

    const delegationRows = res.delegation.map(d => `
      <div style="display:flex; align-items:flex-start; gap:8px;">
        <span style="color:#38bdf8; font-weight:600; min-width:85px; text-transform:capitalize;">${escapeHtml(d.role)}:</span>
        <span style="color:#cbd5e1; flex:1;">${escapeHtml(d.description)}</span>
        <code style="font-size:11px; color:#64748b; font-family:var(--font-mono);">${escapeHtml(d.agentAccount)}</code>
      </div>
    `).join('');

    const attacks = (res.attackSimulation && res.attackSimulation.length > 0) ? `
      <div style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.25); border-radius:8px; padding:12px;">
        <div style="font-size:12px; font-weight:600; color:#ef4444; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">
          Enforced Restrictions & Guardrails (Intercepted Actions)
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:12.5px;">
          ${res.attackSimulation.map(att => `
            <div style="background:rgba(239,68,68,0.1); border-left:3px solid #ef4444; padding:8px 10px; border-radius:4px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span style="font-weight:600; color:#fca5a5;">${escapeHtml(att.attempt)}</span>
                <span style="color:#ef4444; font-weight:700; font-size:11px;">🛑 ${att.status}</span>
              </div>
              <ul style="margin:4px 0 0 16px; padding:0; color:#f87171; font-size:11.5px; line-height:1.4;">
                ${att.reasons.map(r => `<li>${escapeHtml(r.message)}</li>`).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
        <div style="font-size:11.5px; color:#94a3b8; margin-top:8px; font-style:italic;">
          The agents performed the research autonomously within their permissions, while restricted purchase actions remained strictly under your control.
        </div>
      </div>
    ` : '';

    el.innerHTML = `
      ${gemAvatar}
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

        <!-- 2. Specialized Multi-Agent Roles (Researcher -> Analyst -> Verifier -> Orchestrator) -->
        <div style="margin-bottom:12px; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:10px 12px;">
          <div style="font-size:12px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">Specialized Agent Delegation</div>
          <div style="display:flex; flex-direction:column; gap:6px; font-size:12.5px;">
            ${delegationRows}
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

        <!-- 4. On-Chain Settlement / NEAR Escrow -->
        <div style="margin-bottom:12px; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:12px;">
          <div style="font-size:12px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">On-Chain Testnet Settlement</div>
          <div style="font-size:13px; color:#cbd5e1; line-height:1.5;">
            • <strong>Disbursement:</strong> Paid ${res.payout.amount} to <code style="color:#38bdf8;">${res.payout.recipient}</code> for verified research services.<br>
            • <strong>Testnet Transaction:</strong> ${txLink ? txLink + ' (Live on NearBlocks)' : '<em>Pending block inclusion</em>'}<br>
            • <strong>Policy Audit:</strong> Validated allowlist, verified rubric, under ${res.mandate.perAgentCap} cap.
          </div>
        </div>

        <!-- 5. Restriction Guardrails Enforced (Intercepted Actions) -->
        ${attacks}
      </div>
    `;
  }
}

window.prefillPayment = function(acc) {
  promptInput.value = 'Pay 5 NEAR to ' + acc;
  promptInput.focus();
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMarkdown(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#10a37f; text-decoration:underline;">$1</a>');
}

function renderMarkdownRich(md) {
  if (!md) return '';
  const lines = md.split('\n');
  let html = '';
  let inTable = false;
  let inList = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!inTable) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<table class="deliverable-table" style="width:100%; border-collapse:collapse; margin:10px 0; font-size:12.5px;">';
        inTable = true;
      }
      if (trimmed.includes('---')) continue;
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      html += '<tr>' + cells.map(c => '<td style="padding:6px 10px; border:1px solid #1e293b;">' + formatMarkdown(c) + '</td>').join('') + '</tr>';
      continue;
    } else if (inTable) {
      html += '</table>';
      inTable = false;
    }

    if (trimmed.startsWith('# ')) {
      html += '<h2 style="font-size:16px; font-weight:700; color:#fff; margin:14px 0 8px 0;">' + formatMarkdown(trimmed.slice(2)) + '</h2>';
    } else if (trimmed.startsWith('## ')) {
      html += '<h3 style="font-size:14px; font-weight:600; color:#38bdf8; margin:12px 0 6px 0;">' + formatMarkdown(trimmed.slice(3)) + '</h3>';
    } else if (trimmed.startsWith('### ')) {
      html += '<h4 style="font-size:13px; font-weight:600; color:#f1f5f9; margin:10px 0 4px 0;">' + formatMarkdown(trimmed.slice(4)) + '</h4>';
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      if (!inList) { html += '<ul style="margin:4px 0 8px 18px; padding:0;">'; inList = true; }
      html += '<li style="margin-bottom:3px;">' + formatMarkdown(trimmed.slice(2)) + '</li>';
    } else if (trimmed === '---') {
      html += '<hr style="border:0; border-top:1px solid #1e293b; margin:12px 0;">';
    } else if (trimmed.length > 0) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<p style="margin-bottom:8px;">' + formatMarkdown(trimmed) + '</p>';
    }
  }

  if (inTable) html += '</table>';
  if (inList) html += '</ul>';
  return html;
}

// Initial Boot
updateAccountBadgeUI();
loadTreasuryBalance();
loadConversationsList();
