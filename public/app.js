let currentExecutor = 'escrow';
let accountsData = null;

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
const modeSelector = document.getElementById('modeSelector');
const currentModeLabel = document.getElementById('currentModeLabel');

// Modals
const keysModal = document.getElementById('keysModal');
const closeKeysModal = document.getElementById('closeKeysModal');
const navKeys = document.getElementById('navKeys');
const topBtnKeys = document.getElementById('topBtnKeys');
const openKeysFooter = document.getElementById('openKeysFooter');
const modalAccountsList = document.getElementById('modalAccountsList');
const copyAllKeysBtn = document.getElementById('copyAllKeysBtn');

const ledgerModal = document.getElementById('ledgerModal');
const closeLedgerModal = document.getElementById('closeLedgerModal');
const navLedger = document.getElementById('navLedger');
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

// Fetch Accounts Data
async function loadAccounts() {
  try {
    const res = await fetch('/api/accounts');
    accountsData = await res.json();
    renderAccountsModal(accountsData);
  } catch (err) {
    console.error('Failed to load accounts', err);
  }
}

// Render Accounts Modal
function renderAccountsModal(data) {
  if (!data) return;
  modalAccountsList.innerHTML = Object.keys(data).map(k => {
    const a = data[k];
    return `
      <div class="account-modal-card">
        <div class="acc-card-top">
          <div class="acc-label-wrap">
            <span class="acc-badge">${a.role.toUpperCase()}</span>
            <span class="acc-title">${a.label}</span>
          </div>
          <span class="acc-balance">${a.balance} NEAR</span>
        </div>
        <div class="acc-key-row">
          <span class="acc-key-label">Account ID:</span>
          <span class="acc-key-text">${a.accountId}</span>
          <button class="copy-mini-btn" onclick="copyText('${a.accountId}', 'Account ID')">Copy</button>
        </div>
        <div class="acc-key-row">
          <span class="acc-key-label">Public Key:</span>
          <span class="acc-key-text">${a.publicKey}</span>
          <button class="copy-mini-btn" onclick="copyText('${a.publicKey}', 'Public Key')">Copy</button>
        </div>
        <div class="acc-key-row">
          <span class="acc-key-label">Private Key:</span>
          <span class="acc-key-text" id="sec_${k}">••••••••••••••••••••••••••••••••••••••••</span>
          <div class="acc-btns">
            <button class="copy-mini-btn" onclick="toggleSecret('${k}', '${a.secretKey}')">Reveal</button>
            <button class="copy-mini-btn" onclick="copyText('${a.secretKey}', 'Private Key')">Copy Key</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.toggleSecret = function(key, secret) {
  const el = document.getElementById('sec_' + key);
  if (!el) return;
  if (el.textContent.includes('•')) {
    el.textContent = secret;
  } else {
    el.textContent = '••••••••••••••••••••••••••••••••••••••••';
  }
};

window.copyText = function(text, label) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${label || 'Text'} copied to clipboard!`);
  });
};

// Copy All Keys JSON
copyAllKeysBtn.addEventListener('click', () => {
  if (!accountsData) return;
  const jsonStr = JSON.stringify(accountsData, null, 2);
  navigator.clipboard.writeText(jsonStr).then(() => {
    showToast('All keys & account JSON copied to clipboard!');
  });
});

// Modal Open/Close Handlers
[navKeys, topBtnKeys, openKeysFooter].forEach(btn => {
  if (btn) btn.addEventListener('click', () => {
    keysModal.classList.add('open');
    loadAccounts();
  });
});
closeKeysModal.addEventListener('click', () => keysModal.classList.remove('open'));

navLedger.addEventListener('click', () => {
  ledgerModal.classList.add('open');
  loadLedger();
});
closeLedgerModal.addEventListener('click', () => ledgerModal.classList.remove('open'));

// Close modals on backdrop click or ESC
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    keysModal.classList.remove('open');
    ledgerModal.classList.remove('open');
  }
});
keysModal.addEventListener('click', (e) => {
  if (e.target === keysModal) keysModal.classList.remove('open');
});
ledgerModal.addEventListener('click', (e) => {
  if (e.target === ledgerModal) ledgerModal.classList.remove('open');
});

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
        <td><strong>${r.mandateId}</strong><br><small style="color:#8e8e8e">${r.taskId}</small></td>
        <td style="font-family:var(--font-mono); font-size:12px;">${r.recipient}</td>
        <td><strong>$${r.amountDollars}</strong></td>
        <td>
          <span class="${r.status === 'confirmed' ? 'badge-confirmed' : 'badge-denied'}">
            ${r.status.toUpperCase()}
          </span>
        </td>
        <td>
          ${r.txHash ? `<a href="${r.explorerUrl}" target="_blank" style="color:#10a37f; text-decoration:none;">${r.txHash.slice(0, 10)}... ↗</a>` : '-'}
        </td>
        <td style="max-width:280px; font-size:12px; color:#b4b4b4;">${r.note || 'Verified by Mandate Policy Engine'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Ledger error', err);
  }
}

// Mode Selector Toggle
const modes = [
  { id: 'escrow', label: 'Escrow (On-Chain)' },
  { id: 'mock', label: 'Mock (Simulated)' }
];
let modeIdx = 0;
modeSelector.addEventListener('click', () => {
  modeIdx = (modeIdx + 1) % modes.length;
  currentExecutor = modes[modeIdx].id;
  currentModeLabel.textContent = modes[modeIdx].label;
  showToast(`Switched executor mode to: ${modes[modeIdx].label}`);
});

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
sendBtn.addEventListener('click', handleSend);

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

// History item clicks
document.querySelectorAll('.history-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const act = item.getAttribute('data-action');
    if (act === 'escrow') {
      promptInput.value = 'Run full autonomous escrow settlement on NEAR testnet';
      handleSend();
    } else if (act === 'attacks') {
      promptInput.value = 'Test security guardrail against prompt injection and budget attacks';
      handleSend();
    } else if (act === 'keys') {
      promptInput.value = 'Show all funded NEAR testnet accounts and private keys';
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

  // Append user message bubble
  appendUserMessage(query);

  // Append assistant loading placeholder
  const placeholderId = 'assist_' + Date.now();
  appendAssistantLoading(placeholderId);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: query, executor: currentExecutor })
    });
    const data = await res.json();
    renderAssistantResponse(placeholderId, data);
  } catch (err) {
    updateAssistantError(placeholderId, err.message || 'Execution failed');
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
      <div class="thought-box">
        <div class="thought-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span>Thinking & verifying mandate policies...</span>
        </div>
      </div>
    </div>
  `;
  messagesStream.appendChild(row);
}

function renderAssistantResponse(id, data) {
  const el = document.getElementById(id);
  if (!el) return;

  let bodyHtml = '';

  // Accounts & Keys Display
  if (data.type === 'accounts' && data.accounts) {
    const cards = data.accounts.map(a => `
      <div class="key-row">
        <div class="key-info">
          <span class="key-role">${a.role.toUpperCase()} · ${a.balance} NEAR</span>
          <span class="key-val">${a.accountId}</span>
          <span class="key-val" style="color:#a3e635;">Key: ${a.secretKey}</span>
        </div>
        <button class="copy-mini-btn" onclick="copyText('${a.secretKey}', '${a.role} Private Key')">Copy Key</button>
      </div>
    `).join('');

    bodyHtml = `
      <p>${escapeHtml(data.message)}</p>
      <div class="chat-card">
        <div class="chat-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          <span>Funded NEAR Testnet Keystore</span>
        </div>
        ${cards}
      </div>
      <div style="margin-top: 8px;">
        <button class="btn-subtle" onclick="document.getElementById('keysModal').classList.add('open')">
          Open Full Key Manager Modal ↗
        </button>
      </div>
    `;
  } 
  // Attack Tests Display
  else if (data.type === 'attack_test' && data.attacks) {
    const list = data.attacks.map(att => `
      <div class="attack-item">
        <div class="attack-title">🛑 ${escapeHtml(att.attack)} → <span class="badge-denied">DENIED</span></div>
        <div class="attack-reason">${att.reasons.map(r => '• ' + escapeHtml(r)).join('<br>')}</div>
      </div>
    `).join('');

    bodyHtml = `
      <p>${escapeHtml(data.message)}</p>
      <div class="chat-card">
        <div class="chat-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>Security Guardrail Verification Results</span>
        </div>
        ${list}
      </div>
    `;
  }
  // Smart Contract Info
  else if (data.type === 'contract' && data.contract) {
    bodyHtml = `
      <p>${escapeHtml(data.message)}</p>
      <div class="chat-card">
        <div class="chat-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon></svg>
          <span>NEAR Testnet Escrow Contract Metadata</span>
        </div>
        <div style="font-size:13px; line-height:1.7; color:#ececec;">
          <div><strong>Contract ID:</strong> <code>${data.contract.id}</code></div>
          <div><strong>WASM Binary:</strong> ${data.contract.size}</div>
          <div><strong>Deploy Tx:</strong> <code>${data.contract.deployTx}</code></div>
          <div><strong>Init Tx:</strong> <code>${data.contract.initTx}</code></div>
          <div><strong>Public Methods:</strong> <code>${data.contract.methods.join(', ')}</code></div>
          <div style="margin-top:10px;">
            <a href="${data.contract.explorerUrl}" target="_blank" class="btn-subtle" style="display:inline-flex;">
              View on NEAR Explorer ↗
            </a>
          </div>
        </div>
      </div>
    `;
  }
  // General Execution Output
  else {
    bodyHtml = `
      <p>${escapeHtml(data.message || 'Execution completed.')}</p>
      <div class="chat-card">
        <div class="chat-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
          <span>Execution Engine Trace (${data.executor || currentExecutor})</span>
        </div>
        <div class="code-terminal">${escapeHtml(data.output || 'No output')}</div>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="assistant-avatar">M</div>
    <div class="message-content">
      ${data.thought ? `
        <div class="thought-box">
          <div class="thought-header" onclick="this.nextElementSibling.classList.toggle('hidden')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            <span>Thought for 1 second</span>
          </div>
          <div class="thought-body">${escapeHtml(data.thought)}</div>
        </div>
      ` : ''}
      ${bodyHtml}
    </div>
  `;
}

function updateAssistantError(id, errMsg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `
    <div class="assistant-avatar" style="background:#ef4444;">!</div>
    <div class="message-content">
      <div style="color:#ef4444; font-weight:600;">Execution encountered an error:</div>
      <div class="code-terminal" style="color:#fca5a5;">${escapeHtml(errMsg)}</div>
    </div>
  `;
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
loadAccounts();
