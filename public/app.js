let currentExecutor = 'escrow';

// DOM Elements
const sidebar = document.getElementById('sidebar');
const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
const newMandateBtn = document.getElementById('newMandateBtn');
const topBtnNewMandate = document.getElementById('topBtnNewMandate');
const heroScreen = document.getElementById('heroScreen');
const messagesStream = document.getElementById('messagesStream');
const chatContainer = document.getElementById('chatContainer');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const modeSelector = document.getElementById('modeSelector');
const currentModeLabel = document.getElementById('currentModeLabel');

// Modals
const createMandateModal = document.getElementById('createMandateModal');
const closeCreateMandateModal = document.getElementById('closeCreateMandateModal');
const mandateGoalInput = document.getElementById('mandateGoalInput');
const mandateBudgetInput = document.getElementById('mandateBudgetInput');
const mandateCapInput = document.getElementById('mandateCapInput');
const launchConfiguredMandateBtn = document.getElementById('launchConfiguredMandateBtn');

const policyModal = document.getElementById('policyModal');
const closePolicyModal = document.getElementById('closePolicyModal');
const navPolicy = document.getElementById('navPolicy');
const navAgents = document.getElementById('navAgents');
const openPolicyFooter = document.getElementById('openPolicyFooter');
const policyAgentsList = document.getElementById('policyAgentsList');

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
  setTimeout(() => toastNotify.classList.remove('show'), 2400);
}

// Mode toggle
const modes = [
  { id: 'escrow', label: 'Escrow (On-Chain)' },
  { id: 'mock', label: 'Mock (Simulated)' }
];
let modeIdx = 0;
modeSelector.addEventListener('click', () => {
  modeIdx = (modeIdx + 1) % modes.length;
  currentExecutor = modes[modeIdx].id;
  currentModeLabel.textContent = modes[modeIdx].label;
  showToast(`Execution mode switched to: ${modes[modeIdx].label}`);
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
sendBtn.addEventListener('click', () => handleSend());

// Modals
[newMandateBtn, topBtnNewMandate].forEach(btn => {
  if (btn) btn.addEventListener('click', () => createMandateModal.classList.add('open'));
});
closeCreateMandateModal.addEventListener('click', () => createMandateModal.classList.remove('open'));

[navPolicy, navAgents, openPolicyFooter].forEach(btn => {
  if (btn) btn.addEventListener('click', () => {
    policyModal.classList.add('open');
    loadAgents();
  });
});
closePolicyModal.addEventListener('click', () => policyModal.classList.remove('open'));

navLedger.addEventListener('click', () => {
  ledgerModal.classList.add('open');
  loadLedger();
});
closeLedgerModal.addEventListener('click', () => ledgerModal.classList.remove('open'));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    createMandateModal.classList.remove('open');
    policyModal.classList.remove('open');
    ledgerModal.classList.remove('open');
  }
});

// Launch Configured Mandate
launchConfiguredMandateBtn.addEventListener('click', () => {
  const goal = mandateGoalInput.value.trim() || 'Analyze competitive market pricing for cross-border stablecoin payments.';
  const budget = parseFloat(mandateBudgetInput.value) || 20;
  const cap = parseFloat(mandateCapInput.value) || 5;

  createMandateModal.classList.remove('open');
  executeMandateDirectly({ goal, budgetDollars: budget, capDollars: cap, executor: currentExecutor });
});

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
    const directive = item.getAttribute('data-directive');
    if (directive) {
      promptInput.value = directive;
      handleSend();
    }
  });
});

// Fetch Agents & Policy info
async function loadAgents() {
  try {
    const res = await fetch('/api/agents');
    const agents = await res.json();
    policyAgentsList.innerHTML = agents.map(a => `
      <div class="account-modal-card">
        <div class="acc-card-top">
          <span class="acc-title">${a.role}</span>
          <span class="acc-badge">Cap: ${a.spendingCap}</span>
        </div>
        <div style="font-size:12.5px; color:#b4b4b4; margin-top:4px;">${a.responsibility}</div>
        <div style="font-family:var(--font-mono); font-size:11.5px; color:#10a37f; margin-top:6px;">
          ${a.account}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Agents error', err);
  }
}

// Fetch Ledger
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

// User Send Prompt
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

// Execute Mandate with specific options from modal
async function executeMandateDirectly(params) {
  heroScreen.style.display = 'none';
  appendUserMessage(`Execute Mandate: "${params.goal}" [Budget: $${params.budgetDollars}, Cap: $${params.capDollars}]`);

  const placeholderId = 'assist_' + Date.now();
  appendAssistantLoading(placeholderId);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const res = await fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    renderAssistantResponse(placeholderId, {
      type: 'mandate_execution',
      thought: 'Decomposed business directive, assigned specialized agents, evaluated deliverable against rubric, and enforced spending limits.',
      mandateResult: data,
      message: 'Autonomous business mandate executed successfully with spending limits enforced.'
    });
  } catch (err) {
    updateAssistantError(placeholderId, err.message || 'Execution failed');
  } finally {
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
          <span>Delegating tasks, evaluating deliverables & checking spending limits...</span>
        </div>
      </div>
    </div>
  `;
  messagesStream.appendChild(row);
}

function renderAssistantResponse(id, data) {
  const el = document.getElementById(id);
  if (!el) return;

  // 1. Security Notice
  if (data.type === 'security_notice') {
    el.innerHTML = `
      <div class="assistant-avatar" style="background:#ef4444;">🛡️</div>
      <div class="message-content">
        <div class="thought-box">
          <div class="thought-header">
            <span>${escapeHtml(data.thought)}</span>
          </div>
        </div>
        <div class="mandate-card" style="border-left: 3px solid #ef4444;">
          <p style="font-size:14px; line-height:1.6; color:#ececec;">${escapeHtml(data.message)}</p>
        </div>
      </div>
    `;
    return;
  }

  // 2. Mandate Execution Result Card
  const result = data.mandateResult;
  if (result) {
    const stepsHtml = result.steps.map(s => `
      <div class="step-card ${s.badge}">
        <div class="step-top">
          <span class="step-phase">${escapeHtml(s.phase)}</span>
          <span class="step-title">${escapeHtml(s.title)}</span>
        </div>
        <div class="step-detail">${escapeHtml(s.detail)}</div>
      </div>
    `).join('');

    const attacksHtml = result.attackSimulation && result.attackSimulation.length > 0 ? `
      <div style="margin-top: 10px;">
        <div style="font-size:12px; font-weight:700; color:#ef4444; text-transform:uppercase; margin-bottom:6px;">
          Spending Limit Enforcement (Attack Defense):
        </div>
        ${result.attackSimulation.map(att => `
          <div style="background:#221111; border-left:3px solid #ef4444; padding:8px 10px; border-radius:0 6px 6px 0; margin-bottom:6px; font-size:12px;">
            <span style="font-weight:600; color:#fca5a5;">🛑 ${escapeHtml(att.attempt)} → <span class="badge-denied">DENIED</span></span>
            <div style="color:#b4b4b4; margin-top:2px;">${att.reasons.map(r => r.message || r.code).join(' | ')}</div>
          </div>
        `).join('')}
      </div>
    ` : '';

    el.innerHTML = `
      <div class="assistant-avatar">M</div>
      <div class="message-content">
        <div class="thought-box">
          <div class="thought-header" onclick="this.nextElementSibling.classList.toggle('hidden')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            <span>Thought for 1 second</span>
          </div>
          <div class="thought-body">${escapeHtml(data.thought)}</div>
        </div>

        <p style="font-size:14px; color:#ececec;">${escapeHtml(data.message)}</p>

        <div class="mandate-card">
          <div class="mandate-header-badge">
            <span class="mandate-title-text">Directive: "${escapeHtml(result.mandate.goal)}"</span>
            <span class="badge-success">${result.mandate.status.toUpperCase()}</span>
          </div>

          <!-- Budget Stats -->
          <div class="budget-pills-row">
            <div class="budget-stat-box">
              <div class="budget-stat-label">Total Budget</div>
              <div class="budget-stat-val">${result.budgetState.totalBudget}</div>
            </div>
            <div class="budget-stat-box">
              <div class="budget-stat-label">Spent</div>
              <div class="budget-stat-val" style="color:#f59e0b;">${result.budgetState.spent}</div>
            </div>
            <div class="budget-stat-box">
              <div class="budget-stat-label">Remaining</div>
              <div class="budget-stat-val" style="color:#10a37f;">${result.budgetState.remaining}</div>
            </div>
            <div class="budget-stat-box">
              <div class="budget-stat-label">Per-Agent Cap</div>
              <div class="budget-stat-val">${result.mandate.perAgentCap}</div>
            </div>
          </div>

          <!-- Steps Timeline -->
          <div class="steps-timeline">
            ${stepsHtml}
          </div>

          <!-- Deliverable Preview -->
          <div class="deliverable-box">
            <div class="deliverable-label">Verified Deliverable Preview (${result.deliverable.agent}):</div>
            <div class="deliverable-text">"${escapeHtml(result.deliverable.preview)}"</div>
          </div>

          <!-- Settlement status -->
          <div style="display:flex; align-items:center; justify-content:space-between; background:#222; padding:10px 14px; border-radius:8px;">
            <div>
              <span style="font-size:12px; color:#8e8e8e;">Payout:</span>
              <strong style="color:#fff; margin-left:6px;">${result.payout.amount} to ${result.payout.recipient}</strong>
            </div>
            <div>
              ${result.payout.explorerUrl ? `
                <a href="${result.payout.explorerUrl}" target="_blank" class="badge-success" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
                  View NEAR On-Chain Tx ↗
                </a>
              ` : `
                <span class="${result.payout.status === 'confirmed' ? 'badge-confirmed' : 'badge-denied'}">
                  ${result.payout.status.toUpperCase()}
                </span>
              `}
            </div>
          </div>

          ${attacksHtml}
        </div>
      </div>
    `;
    return;
  }

  // Fallback
  el.innerHTML = `
    <div class="assistant-avatar">M</div>
    <div class="message-content">
      <p>${escapeHtml(data.message || 'Operation finished.')}</p>
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
      <div class="deliverable-box" style="color:#fca5a5;">${escapeHtml(errMsg)}</div>
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
loadAgents();
