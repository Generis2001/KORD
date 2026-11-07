// --- Multi-User & Wallet State ---
let connectedWallet = localStorage.getItem('mandate_connected_wallet') || null;
let currentAccount = connectedWallet;
let activeConversationId = null;
const conversationHistories = new Map();
let conversationAccount;
let conversationNavigation = 0;
let conversationMessages = [];
const pendingMandates = new Map();

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

// Wallet Elements
const connectWalletBtn = document.getElementById('connectWalletBtn');
const walletModal = document.getElementById('walletModal');
const closeWalletModal = document.getElementById('closeWalletModal');
const walletStatusDot = document.getElementById('walletStatusDot');
const walletBtnText = document.getElementById('walletBtnText');
const walletConnectedCard = document.getElementById('walletConnectedCard');
const walletProviderOptions = document.getElementById('walletProviderOptions');
const modalConnectedAccount = document.getElementById('modalConnectedAccount');
const modalConnectedBalance = document.getElementById('modalConnectedBalance');
const disconnectWalletBtn = document.getElementById('disconnectWalletBtn');
const connectMeteorWalletBtn = document.getElementById('connectMeteorWalletBtn');
const manualWalletInput = document.getElementById('manualWalletInput');
const confirmManualWalletBtn = document.getElementById('confirmManualWalletBtn');
const liveOnchainBalanceText = document.getElementById('liveOnchainBalanceText');

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
  const sidebarSwitchBtn = document.getElementById('sidebarSwitchBtn');
  const openAccountModalBtn = document.getElementById('openAccountModalBtn');
  if (sidebarSwitchBtn) {
    sidebarSwitchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadAccountsList();
      accountModal.classList.add('open');
    });
  }
  if (openAccountModalBtn) {
    openAccountModalBtn.addEventListener('click', () => {
      loadAccountsList();
      accountModal.classList.add('open');
    });
  }
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
    ...(currentAccount ? { 'x-mandate-account': currentAccount } : {})
  };
}

function formatUsdtAmount(value) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  return match ? match[1] + '.' + (match[2] || '').padEnd(6, '0').slice(0, 6) : '—';
}

// Sidebar toggle
if (sidebarOpenBtn) sidebarOpenBtn.addEventListener('click', () => sidebar.classList.remove('collapsed'));
if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', () => sidebar.classList.add('collapsed'));

function showToast(msg) {
  toastNotify.textContent = msg;
  toastNotify.classList.add('show');
  setTimeout(() => toastNotify.classList.remove('show'), 2800);
}

function updateTreasuryUI(balStr) {
  if (!balStr) return;
  const formatted = balStr.includes('NEAR') ? balStr : balStr + ' NEAR';
  if (footerTreasuryBalance) footerTreasuryBalance.textContent = formatted;
  if (modalTreasuryBal) modalTreasuryBal.textContent = formatted;
  if (headerBalancePill) headerBalancePill.textContent = formatted;
  if (modalActiveAccountBal) modalActiveAccountBal.textContent = formatted;
  if (liveOnchainBalanceText) liveOnchainBalanceText.textContent = formatted;
}

function updateAccountBadgeUI() {
  if (headerAccountName) headerAccountName.textContent = currentAccount;
  if (modalActiveAccountName) modalActiveAccountName.textContent = currentAccount;
  const sidebarAccountName = document.getElementById('sidebarAccountName');
  if (sidebarAccountName) sidebarAccountName.textContent = currentAccount;
}

// Update Wallet UI state
function updateWalletUI() {
  const sidebarDisconnectedCard = document.getElementById('sidebarDisconnectedCard');
  const sidebarConnectedCard = document.getElementById('sidebarConnectedCard');
  const sidebarAccountName = document.getElementById('sidebarAccountName');

  if (connectedWallet) {
    currentAccount = connectedWallet;
    if (connectWalletBtn) {
      connectWalletBtn.classList.add('connected');
    }
    if (walletStatusDot) walletStatusDot.classList.add('online');
    if (walletBtnText) walletBtnText.textContent = connectedWallet.slice(0, 14) + (connectedWallet.length > 14 ? '...' : '');
    if (walletConnectedCard) walletConnectedCard.style.display = 'block';
    if (modalConnectedAccount) modalConnectedAccount.textContent = connectedWallet;
    if (sidebarDisconnectedCard) sidebarDisconnectedCard.style.display = 'none';
    if (sidebarConnectedCard) sidebarConnectedCard.style.display = 'block';
    if (sidebarAccountName) sidebarAccountName.textContent = connectedWallet;
    agentSnapshot = null;
    for (const id of ['sidebarNearBalance', 'sidebarUsdtBalance', 'linkedNearBalance', 'linkedUsdtBalance']) document.getElementById(id).textContent = '—';
    document.getElementById('sidebarAgentCard').style.display = 'block';
    loadTreasuryBalance();
  } else {
    currentAccount = null;
    if (connectWalletBtn) {
      connectWalletBtn.classList.remove('connected');
    }
    if (walletStatusDot) walletStatusDot.classList.remove('online');
    if (walletBtnText) walletBtnText.textContent = 'Connect wallet';
    if (walletConnectedCard) walletConnectedCard.style.display = 'none';
    document.getElementById('sidebarAgentCard').style.display = 'none';
    agentSnapshot = null;
    if (sidebarDisconnectedCard) sidebarDisconnectedCard.style.display = 'flex';
    if (sidebarConnectedCard) sidebarConnectedCard.style.display = 'none';
  }
  activateConversationAccount(currentAccount);
}

let agentSnapshot = null;
let collectingUnstaked = false;
async function loadConnectedWalletBalance() { return loadTreasuryBalance(); }
async function loadTreasuryBalance() {
  if (!connectedWallet) return;
  const owner = connectedWallet;
  try {
    const res = await mandateWallet.fetch('/api/wallet', { headers: getApiHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not refresh wallet balances.');
    if (connectedWallet !== owner) return;
    agentSnapshot = data;
    const recovery = document.getElementById('agentWalletRecovery');
    recovery.replaceChildren();
    for (const op of data.operations.filter(op => ['pending', 'needs_review', 'funding_confirmed'].includes(op.status))) {
      const row = document.createElement('div');
      row.textContent = op.action + ' ' + op.amount + ' ' + op.asset + ': ' + op.status.replaceAll('_', ' ') + ' ';
      const button = document.createElement('button');
      button.className = 'btn-subtle';
      button.textContent = op.status === 'funding_confirmed' ? 'Resume swap payout' : 'Check on-chain status';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const res = await mandateWallet.fetch('/api/wallet/' + (op.status === 'funding_confirmed' ? 'resume' : 'reconcile'), { method: 'POST', headers: getApiHeaders(), body: JSON.stringify({ id: op.id }) });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error);
          document.getElementById('agentWalletResult').textContent = 'Transaction status: ' + result.operation.status.replaceAll('_', ' ');
          await loadTreasuryBalance();
        } catch (error) { document.getElementById('agentWalletResult').textContent = error.message; }
        finally { button.disabled = false; }
      });
      row.appendChild(button); recovery.appendChild(row);
    }
    updateTreasuryUI(data.formatted);
    const values = { sidebarNearBalance: Number(data.balanceNear).toFixed(4), sidebarUsdtBalance: formatUsdtAmount(data.userUsdt),
      linkedNearBalance: Number(data.linked.near).toFixed(4), linkedUsdtBalance: formatUsdtAmount(data.linked.usdt),
      modalConnectedBalance: Number(data.linked.near).toFixed(4) + ' NEAR', agentNearAvailable: Number(data.balanceNear).toFixed(4), agentUsdtAvailable: formatUsdtAmount(data.userUsdt),
      agentNearStaked: Number(data.staking.NEAR.staked).toFixed(4), agentUsdtStaked: formatUsdtAmount(data.staking.USDT.staked),
      agentNearPending: Number(data.staking.NEAR.unstaked).toFixed(4), agentUsdtPending: formatUsdtAmount(data.staking.USDT.unstaked) };
    for (const [id, value] of Object.entries(values)) { const el = document.getElementById(id); if (el) el.textContent = value; }
    const address = document.getElementById('agentWalletAddress');
    address.textContent = data.accountId;
    address.href = 'https://' + (data.network === 'testnet' ? 'testnet.' : '') + 'nearblocks.io/address/' + data.accountId;
    const authorization = document.getElementById('authorizeAgentWalletBtn');
    authorization.style.display = mandateWallet.authorized(owner) ? 'none' : 'block';
    if (swapDestinationWallet) swapDestinationWallet.value = data.accountId;
    updateAgentAction();
    // One unstake mandate authorizes collection after the cooldown; no second command is needed.
    if (!collectingUnstaked && mandateWallet.authorized(owner)) {
      const toCollect = ['NEAR', 'USDT'].filter(asset => data.staking[asset].available && data.operations.some(op => op.action === 'unstake' && op.asset === asset && op.status === 'confirmed'));
      if (toCollect.length) {
        collectingUnstaked = true;
        try {
          for (const asset of toCollect) {
            if (connectedWallet !== owner) break;
            const result = await mandateWallet.fetch('/api/wallet/execute', { method: 'POST', headers: getApiHeaders(), body: JSON.stringify({ id: 'claim-' + crypto.randomUUID(), action: 'claim', asset, amount: data.staking[asset].withdrawable }), continuingUnstake: true });
            const receipt = await result.json();
            if (result.ok) showToast('Unstaked ' + asset + ' returned to your agent wallet');
            else throw new Error(receipt.error || receipt.operation?.error || 'Unstaked withdrawal needs review.');
          }
        } finally { collectingUnstaked = false; }
      }
    }
  } catch (err) {
    console.error('Failed to load agent wallet', err);
    const status = document.getElementById('agentWalletResult');
    if (status) status.textContent = err.message;
  }
}

// Complete any pending wallet redirect receipts.
async function checkWalletCallback() {
  const params = new URLSearchParams(location.search);
  const accountId = params.get('account_id');
  if (accountId) {
    connectedWallet = accountId;
    currentAccount = accountId;
    localStorage.setItem('mandate_connected_wallet', accountId);
    updateWalletUI();
  }
  const hashes = params.get('transactionHashes');
  if (hashes && connectedWallet) {
    for (const txHash of hashes.split(',')) {
      try {
        const res = await mandateWallet.fetch('/api/wallet/deposit/confirm', { method: 'POST', headers: getApiHeaders(), body: JSON.stringify({ txHash }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('Agent wallet deposit confirmed');
      } catch (err) { showToast('Deposit verification: ' + err.message); }
    }
    loadTreasuryBalance();
    loadLedger();
  }
  if (params.get('errorCode') || params.get('wallet_error')) showToast('Wallet action was cancelled or rejected.');
  if (accountId || hashes || params.get('errorCode') || params.get('wallet_error')) history.replaceState({}, document.title, location.pathname);
}

function updateAgentAction() {
  const action = document.getElementById('agentWalletAction').value;
  const asset = document.getElementById('agentWalletAsset').value;
  const labels = { deposit: 'Deposit', withdraw: 'Withdraw', stake: 'Stake', unstake: 'Unstake', claim: 'Withdraw unstaked' };
  confirmFundBtn.textContent = labels[action] + ' ' + asset;
  const explanations = {
    deposit: 'Sign the deposit in your linked wallet. Deposit NEAR first to activate the agent wallet and cover gas.',
    withdraw: 'Send funds from your agent wallet back to ' + (connectedWallet || 'your linked wallet') + '.',
    stake: 'Stake from your agent wallet with Mandate’s staking provider.',
    unstake: 'Start unstaking. Funds are collected after the provider cooldown while your authorized workspace is open.',
    claim: 'Withdraw funds whose staking cooldown has finished into your agent wallet.'
  };
  const pos = agentSnapshot?.staking[asset];
  document.getElementById('agentWalletActionHelp').textContent = ['stake', 'unstake', 'claim'].includes(action) && pos && !pos.configured
    ? asset + ' staking will be available after provider setup.' : explanations[action];
}
async function depositToAgent(amount, asset = 'NEAR') {
  const res = await mandateWallet.fetch('/api/wallet/deposit', { method: 'POST', headers: getApiHeaders(), body: JSON.stringify({ amount: String(amount), asset }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return mandateWallet.signDeposit(data);
}
window.sendOnchainNear = amount => depositToAgent(amount).catch(err => showToast(err.message));
window.fundDirectly = window.sendOnchainNear;
for (const id of ['agentWalletAction', 'agentWalletAsset']) document.getElementById(id).addEventListener('change', updateAgentAction);
let authorizingMeteor = false;
async function authorizeWithMeteor(expectedAccount = null) {
  if (authorizingMeteor) return;
  authorizingMeteor = true;
  const button = document.getElementById('authorizeAgentWalletBtn');
  button.disabled = true;
  const sourceModal = fundModal.classList.contains('open') ? fundModal : walletModal.classList.contains('open') ? walletModal : null;
  let authorized = false;
  // Release the workspace dialog's focus trap before Meteor opens its own popup.
  walletModal.classList.remove('open');
  fundModal.classList.remove('open');
  try {
    connectedWallet = await mandateWallet.authorize(expectedAccount);
    currentAccount = connectedWallet;
    localStorage.setItem('mandate_connected_wallet', connectedWallet);
    updateWalletUI();
    walletModal.classList.remove('open');
    button.style.display = 'none';
    authorized = true;
    showToast('Agent spending authorized with Meteor Wallet');
  } catch (err) { showToast(err.message); }
  finally {
    if (sourceModal === fundModal || (sourceModal && !authorized)) sourceModal.classList.add('open');
    authorizingMeteor = false;
    button.disabled = false;
  }
}
document.getElementById('authorizeAgentWalletBtn').addEventListener('click', () => authorizeWithMeteor(connectedWallet));
document.getElementById('copyAgentAddressBtn').addEventListener('click', async () => {
  if (!agentSnapshot) return;
  try { await navigator.clipboard.writeText(agentSnapshot.accountId); showToast('Agent wallet address copied'); }
  catch { showToast('Select the wallet address to copy it'); }
});
function openAgentWallet() {
  if (!connectedWallet) { walletModal.classList.add('open'); return; }
  fundModal.classList.add('open');
  loadTreasuryBalance();
}
document.getElementById('manageAgentWalletBtn').addEventListener('click', openAgentWallet);
if (confirmFundBtn) confirmFundBtn.addEventListener('click', async () => {
  const amount = customFundInput.value.trim();
  const action = document.getElementById('agentWalletAction').value;
  const asset = document.getElementById('agentWalletAsset').value;
  const status = document.getElementById('agentWalletResult');
  if (!amount || Number(amount) <= 0) { status.textContent = 'Enter a positive amount.'; return; }
  confirmFundBtn.disabled = true;
  status.textContent = 'Processing…';
  try {
    if (action === 'deposit') await depositToAgent(amount, asset);
    else {
      const res = await mandateWallet.fetch('/api/wallet/execute', { method: 'POST', headers: getApiHeaders(), body: JSON.stringify({ id: crypto.randomUUID(), action, asset, amount }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.operation?.error || 'Transaction needs review.');
      status.innerHTML = escapeHtml(action === 'unstake' ? 'Unstaking started. Collection follows the provider cooldown.' : 'Transaction confirmed.') +
        (data.explorerUrl ? ' <a href="' + escapeHtml(data.explorerUrl) + '" target="_blank" rel="noopener noreferrer">View receipt ↗</a>' : '');
    }
    await loadTreasuryBalance();
    loadLedger();
  } catch (err) { status.textContent = err.message; }
  finally { confirmFundBtn.disabled = false; updateAgentAction(); }
});

// Modal Toggles
if (connectWalletBtn) {
  connectWalletBtn.addEventListener('click', () => {
    walletModal.classList.add('open');
    updateWalletUI();
  });
}
if (closeWalletModal) {
  closeWalletModal.addEventListener('click', () => walletModal.classList.remove('open'));
}

if (disconnectWalletBtn) {
  disconnectWalletBtn.addEventListener('click', () => {
    mandateWallet.disconnect(connectedWallet).catch(err => console.warn('Meteor disconnect:', err));
    connectedWallet = null;
    localStorage.removeItem('mandate_connected_wallet');
    updateWalletUI();
    showToast('Wallet disconnected');
  });
}

if (connectMeteorWalletBtn) connectMeteorWalletBtn.addEventListener('click', () => authorizeWithMeteor());

if (confirmManualWalletBtn) {
  confirmManualWalletBtn.addEventListener('click', () => {
    const acc = (manualWalletInput.value || '').trim().toLowerCase();
    if (!acc) return;
    const linkedId = /^[a-f0-9]{64}$/.test(acc) || acc.endsWith('.testnet') ? acc : acc + '.testnet';
    if (!/^[a-f0-9]{64}$/.test(linkedId) && !/^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(linkedId)) { showToast('Enter a valid NEAR account ID'); return; }
    connectedWallet = linkedId;
    currentAccount = connectedWallet;
    localStorage.setItem('mandate_connected_wallet', connectedWallet);
    localStorage.setItem('mandate_current_account', currentAccount);
    manualWalletInput.value = '';
    updateWalletUI();
    walletModal.classList.remove('open');
    showToast('Linked wallet: ' + connectedWallet);
    loadTreasuryBalance();
  });
}

if (openFundModalBtn) {
  openFundModalBtn.addEventListener('click', () => {
    openAgentWallet();
  });
}
if (closeFundModal) closeFundModal.addEventListener('click', () => fundModal.classList.remove('open'));

function openAllowlist() {
  allowlistModal.classList.add('open');
  loadAllowlist();
}
if (navAllowlist) navAllowlist.addEventListener('click', openAllowlist);
if (headerAllowlistBtn) headerAllowlistBtn.addEventListener('click', openAllowlist);
if (closeAllowlistModal) closeAllowlistModal.addEventListener('click', () => allowlistModal.classList.remove('open'));

function openLedger() {
  ledgerModal.classList.add('open');
  loadLedger();
}
if (navLedger) navLedger.addEventListener('click', openLedger);
if (headerLedgerBtn) headerLedgerBtn.addEventListener('click', openLedger);
if (closeLedgerModal) closeLedgerModal.addEventListener('click', () => ledgerModal.classList.remove('open'));

// Account Modal Listeners
if (accountSelectorBtn) {
  accountSelectorBtn.addEventListener('click', () => {
    accountModal.classList.add('open');
    loadAccountsList();
  });
}
if (closeAccountModal) {
  closeAccountModal.addEventListener('click', () => {
    accountModal.classList.remove('open');
  });
}

// Load Accounts List
async function loadAccountsList() {
  try {
    const res = await mandateWallet.fetch('/api/accounts', { headers: getApiHeaders() });
    const data = await res.json();
    if (data && data.users) {
      accountsListContainer.innerHTML = data.users.map(u => {
        const isActive = u.accountId.toLowerCase() === currentAccount.toLowerCase();
        const deleteBtn = !isActive
          ? `<button class="btn-subtle" onclick="deleteAccount(event, '${escapeHtml(u.accountId)}')" style="color:var(--danger); padding:2px 8px; font-size:11px; margin-left:8px;" title="Remove Account">✕</button>`
          : '';
        return `
          <div class="account-card-item ${isActive ? 'active' : ''}" onclick="switchAccount('${escapeHtml(u.accountId)}')">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:14px;">${isActive ? '🟢' : '⚪'}</span>
              <span style="font-family:var(--font-mono); font-size:13px; font-weight:600; color:${isActive ? 'var(--success)' : 'var(--text-primary)'};">${escapeHtml(u.accountId)}</span>
            </div>
            <div style="display:flex; align-items:center;">
              <span style="font-size:12px; color:var(--text-muted); font-weight:500;">${isActive && agentSnapshot ? Number(agentSnapshot.balanceNear).toFixed(4) + ' NEAR' : 'Linked profile'}</span>
              ${deleteBtn}
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    accountsListContainer.innerHTML = '<div style="font-size:12px; color:var(--danger);">Failed to load accounts.</div>';
  }
}

window.deleteAccount = async function(e, accId) {
  e.stopPropagation();
  if (accId.toLowerCase() === currentAccount.toLowerCase()) {
    alert('Cannot delete the currently active account. Switch to another account first.');
    return;
  }
  if (!confirm('Remove account ' + accId + '?')) return;
  try {
    await mandateWallet.fetch('/api/accounts', {
      method: 'DELETE',
      headers: getApiHeaders(),
      body: JSON.stringify({ accountId: accId })
    });
    showToast('Removed ' + accId);
    loadAccountsList();
  } catch (err) {
    alert('Failed to remove: ' + err.message);
  }
};

window.switchAccount = function(newAccId) {
  if (!newAccId || newAccId === currentAccount) {
    accountModal.classList.remove('open');
    return;
  }
  currentAccount = newAccId.trim().toLowerCase();
  connectedWallet = currentAccount;
  localStorage.setItem('mandate_current_account', currentAccount);
  localStorage.setItem('mandate_connected_wallet', currentAccount);
  updateAccountBadgeUI();
  updateWalletUI();
  accountModal.classList.remove('open');
  showToast('Switched account to ' + currentAccount);
  loadTreasuryBalance();
  loadAllowlist();
  loadLedger();
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
    const res = await mandateWallet.fetch('/api/accounts', {
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
    const res = await mandateWallet.fetch('/api/allowlist', { headers: getApiHeaders() });
    const list = await res.json();
    if (!res.ok || !Array.isArray(list)) throw new Error(list.error || 'Approved payees could not be loaded.');
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
    const res = await mandateWallet.fetch('/api/allowlist', {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({ accountId: acc, label })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'The payee could not be saved.');
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
    const res = await mandateWallet.fetch('/api/allowlist', {
      method: 'DELETE',
      headers: getApiHeaders(),
      body: JSON.stringify({ accountId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'The payee could not be removed.');
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
    const res = await mandateWallet.fetch('/api/ledger', { headers: getApiHeaders() });
    const records = await res.json();
    if (!records || records.length === 0) {
      ledgerTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-td" style="padding:24px; text-align:center; color:var(--text-muted);">
            No settlement disbursements recorded for <code>${escapeHtml(currentAccount)}</code> yet.<br>
            <span style="font-size:12px; color:var(--text-muted); margin-top:4px; display:inline-block;">
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
        : '<span style="color:var(--text-muted);">-</span>';

      const amountDisplay = r.amountNear
        ? r.amountDollars + ' (' + r.amountNear + ' NEAR)'
        : r.amountDollars;

      return `
        <tr>
          <td><code class="tx-id">#${r.id}</code></td>
          <td style="font-size:12.5px; color:var(--text-secondary); max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(r.mandateId || r.taskId || '')}">
            ${escapeHtml(r.mandateId || r.taskId || 'Direct Transfer')}
          </td>
          <td><code class="link-mono">${escapeHtml(r.recipient)}</code></td>
          <td style="font-weight:600; color:var(--text-primary);">${escapeHtml(amountDisplay)}</td>
          <td>${statusBadge}</td>
          <td>${explorerLink}</td>
          <td style="font-size:12px; color:var(--text-muted);">${escapeHtml(r.note || '-')}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    ledgerTableBody.innerHTML = '<tr><td colspan="7" class="empty-td error">Failed to load ledger records.</td></tr>';
  }
}

// --- Durable Chat History & Conversations ---
function historyFor(account) {
  if (!account) return null;
  if (!conversationHistories.has(account)) {
    conversationHistories.set(account, new ConversationHistory(account, {
      request: (url, options) => mandateWallet.fetch(url, options),
      onChange: () => { if (currentAccount === account) renderConversationsList(); },
      onError: message => { if (currentAccount === account) document.getElementById('conversationSyncStatus').textContent = message; }
    }));
  }
  return conversationHistories.get(account);
}

function activateConversationAccount(account) {
  if (conversationAccount === account) return;
  conversationAccount = account;
  conversationNavigation++;
  const history = historyFor(account);
  const record = history && (history.get(history.activeId) || history.create());
  activeConversationId = record?.id || null;
  conversationMessages = record?.messages || [];
  renderConversationMessages();
  renderConversationsList();
  if (history) void loadConversationsList(true);
}

function renderConversationsList() {
  if (!conversationsListContainer) return;
  const history = historyFor(currentAccount);
  const records = history?.list() || [];
  const status = document.getElementById('conversationSyncStatus');
  status.textContent = records.some(record => record.pending) ? 'Saved in this browser · sync pending' : '';
  conversationsListContainer.replaceChildren();
  if (!records.length) {
    conversationsListContainer.innerHTML = '<div class="conversations-empty"><span>A fresh start.</span>Your conversations will live here.</div>';
    return;
  }
  for (const record of records) {
    const row = document.createElement('div');
    row.className = 'history-item' + (record.id === activeConversationId ? ' active' : '');
    const open = document.createElement('button');
    open.className = 'history-open-btn';
    open.textContent = record.title || 'Mandate Session';
    open.title = record.title || 'Mandate Session';
    open.style.overflow = 'hidden'; open.style.textOverflow = 'ellipsis'; open.style.whiteSpace = 'nowrap';
    if (record.id === activeConversationId) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => switchConversation(record.id));
    const remove = document.createElement('button');
    remove.className = 'history-delete-btn';
    remove.setAttribute('aria-label', 'Delete conversation: ' + record.title);
    remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/></svg>';
    remove.addEventListener('click', event => deleteConversation(event, record.id));
    row.append(open, remove); conversationsListContainer.append(row);
  }
}

async function loadConversationsList(restore = false) {
  const owner = currentAccount;
  const history = historyFor(owner);
  if (!history) { renderConversationsList(); return; }
  const navigation = conversationNavigation;
  try {
    await history.refresh();
    if (owner !== currentAccount) return;
    if (!history.get(activeConversationId)) { resetChatToNew(); return; }
    if (restore && navigation === conversationNavigation) {
      const record = history.get(activeConversationId);
      if (record?.messages.length || record?.loaded === false) {
        const loaded = await history.load(record.id);
        if (owner === currentAccount && navigation === conversationNavigation) {
          conversationMessages = loaded.messages;
          renderConversationMessages();
        }
      }
    }
    renderConversationsList();
  } catch (error) {
    if (owner === currentAccount) { renderConversationsList(); document.getElementById('conversationSyncStatus').textContent = error.message; }
  }
}

window.switchConversation = async function(id) {
  const owner = currentAccount;
  const history = historyFor(owner);
  const navigation = ++conversationNavigation;
  try {
    const record = await history.load(id);
    if (owner !== currentAccount || navigation !== conversationNavigation) return;
    activeConversationId = record.id;
    conversationMessages = record.messages;
    history.setActive(record.id);
    renderConversationMessages();
  } catch (error) { if (owner === currentAccount) showToast(error.message); }
};

window.deleteConversation = async function(event, id) {
  event.stopPropagation();
  const owner = currentAccount;
  try {
    await historyFor(owner).remove(id);
    if (owner !== currentAccount) return;
    if (activeConversationId === id) resetChatToNew();
    renderConversationsList();
  } catch (error) { if (owner === currentAccount) showToast(error.message); }
};

function resetChatToNew() {
  conversationNavigation++;
  const record = historyFor(currentAccount)?.create();
  activeConversationId = record?.id || null;
  conversationMessages = record?.messages || [];
  promptInput.value = '';
  renderConversationMessages();
}

function renderConversationMessages() {
  messagesStream.replaceChildren();
  heroScreen.style.display = conversationMessages.length ? 'none' : 'flex';
  let directive = null;
  for (const message of conversationMessages) {
    if (message.role === 'user') { directive = message.text; appendUserMessage(message.text, false); }
    else if (message.data) {
      const id = 'msg-' + crypto.randomUUID();
      appendAssistantLoading(id);
      renderAssistantResponse(id, message.data, false, { historical: true, text: directive });
    }
    if (message.role === 'user' && message.requestId && pendingMandates.has(message.requestId)) appendAssistantLoading('loading-' + message.requestId, pendingMandates.get(message.requestId));
  }
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

newChatBtn.addEventListener('click', resetChatToNew);
window.addEventListener('online', () => { if (currentAccount) void loadConversationsList(); });
window.addEventListener('pagehide', () => { for (const history of conversationHistories.values()) { history.cache(); void history.flush(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentAccount) void loadConversationsList(); });

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

  if (!connectedWallet) {
    const wm = document.getElementById('walletModal');
    if (wm) wm.classList.add('open');
    showToast('Please connect your NEAR testnet wallet first');
    return;
  }

  const conversation = { account: currentAccount, id: activeConversationId, requestId: 'mandate_' + crypto.randomUUID(), text, steps: [] };
  pendingMandates.set(conversation.requestId, conversation);
  heroScreen.style.display = 'none';
  appendUserMessage(text, true, conversation.requestId);
  promptInput.value = '';
  promptInput.style.height = 'auto';

  const placeholderId = 'loading-' + conversation.requestId;
  appendAssistantLoading(placeholderId, conversation);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const res = await mandateWallet.fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mandate-account': conversation.account },
      body: JSON.stringify({ message: text, id: conversation.requestId, stream: true })
    });
    const data = await MandateChat.read(res, conversation, step => {
      conversation.steps.push(step);
      if (conversation.account === currentAccount && conversation.id === activeConversationId) updateMandateProgress(placeholderId, conversation);
    });
    pendingMandates.delete(conversation.requestId);
    renderAssistantResponse(placeholderId, data, true, conversation);
    if (conversation.account !== currentAccount || conversation.id !== activeConversationId) return;
    if (data.type === 'wallet_deposit' && data.deposit) {
      const button = document.createElement('button');
      button.className = 'btn-primary';
      button.textContent = 'Sign deposit in wallet ↗';
      button.addEventListener('click', async () => { try { await mandateWallet.signDeposit(data.deposit); await loadTreasuryBalance(); } catch (err) { showToast(err.message); } });
      document.getElementById(placeholderId)?.querySelector('.message-content')?.appendChild(button);
    }
    if (data && data.balanceNear !== undefined) {
      const sidebarNear = document.getElementById('sidebarNearBalance');
      if (sidebarNear) sidebarNear.textContent = Number(data.balanceNear).toFixed(2);
      if (currentAccount) localStorage.setItem('mandate_bal_near_' + currentAccount, Number(data.balanceNear).toFixed(2));
    }
    if (data && data.userUsdt !== undefined) {
      const sidebarUsdt = document.getElementById('sidebarUsdtBalance');
      if (sidebarUsdt) sidebarUsdt.textContent = formatUsdtAmount(data.userUsdt);
      if (currentAccount) localStorage.setItem('mandate_bal_usdt_' + currentAccount, formatUsdtAmount(data.userUsdt));
    }
    loadTreasuryBalance();
    loadLedger();
  } catch (err) {
    pendingMandates.delete(conversation.requestId);
    renderAssistantResponse(placeholderId, {
      type: 'text',
      message: '❌ Error communicating with Mandate: ' + err.message
    }, true, conversation);
  }
}

function appendUserMessage(text, record = true, requestId = undefined) {
  if (record) {
    historyFor(currentAccount).append(activeConversationId, { role: 'user', text, requestId });
  }
  const row = document.createElement('div');
  row.className = 'message-row user';
  row.innerHTML = '<div class="message-bubble user">' + escapeHtml(text) + '</div>';
  messagesStream.appendChild(row);
}

// Mandate loading indicator
function appendAssistantLoading(id, request = null) {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.id = id;
  row.innerHTML = `
    <div class="assistant-avatar">
      <svg class="mandate-mark" viewBox="0 0 48 48" aria-hidden="true"><use href="assets/mandate-mark.svg#mark"/></svg>
    </div>
    <div class="message-content">
      <div class="mandate-loader" role="status">
        <span class="loader-dots" aria-hidden="true"><span></span><span></span><span></span></span>
        <span>Working on your mandate…</span>
      </div>
    </div>
  `;
  messagesStream.appendChild(row);
  if (request) updateMandateProgress(id, request);
}

function runDisclosure(label, body, running = false, open = false) {
  return `<details class="mandate-run${running ? ' is-running' : ''}"${open ? ' open' : ''}>
    <summary><svg class="run-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg><span class="run-label"${running ? ' role="status"' : ''}>${escapeHtml(label)}</span></summary>
    <div class="mandate-run-details">${body}</div></details>`;
}

function runSteps(steps) {
  return `<ol class="run-steps">${steps.map(step => `<li><span>${escapeHtml(step.phase)}</span><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.detail)}</p></li>`).join('')}</ol>`;
}

function updateMandateProgress(id, request) {
  const content = document.getElementById(id)?.querySelector('.message-content');
  if (!content) return;
  const open = content.querySelector('details')?.open || false;
  const last = request.steps.at(-1);
  const next = { Orchestrator: 'Researching sources…', Researcher: 'Comparing findings…', Analyst: 'Checking evidence…', Verifier: 'Finishing your report…' };
  const label = last?.activity || next[last?.phase] || 'Working on your mandate…';
  content.innerHTML = runDisclosure(label, `<h4>Agent workflow</h4>${request.steps.length ? runSteps(request.steps) : '<p>Waiting for the workflow to start.</p>'}`, true, open);
}

function renderAssistantResponse(id, data, record = true, conversation = null) {
  if (record) {
    const owner = conversation?.account || currentAccount;
    const thread = conversation?.id || activeConversationId;
    if (conversation?.requestId) historyFor(owner)?.reply(thread, conversation.requestId, data);
    else historyFor(owner)?.append(thread, { role: 'assistant', data });
    if (owner !== currentAccount || thread !== activeConversationId) return;
  }
  const el = document.getElementById(id);
  if (!el) { if (record) renderConversationMessages(); return; }

  const mandateAvatar = `
    <div class="assistant-avatar">
      <svg class="mandate-mark" viewBox="0 0 48 48" aria-hidden="true"><use href="assets/mandate-mark.svg#mark"/></svg>
    </div>
  `;

  // 1. Payment Confirmed (Deduction)
  if (data.type === 'payment_confirmed') {
    el.innerHTML = `
      ${mandateAvatar}
      <div class="message-content">
        <p>${escapeHtml(data.message)}</p>
        <div class="receipt-card">
          <div class="receipt-top">
            <span class="receipt-badge-confirmed">ON-CHAIN SETTLEMENT CONFIRMED</span>
            <span style="font-size:12px; color:var(--text-muted);">NEAR Testnet</span>
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
              <strong style="color:var(--success);">${escapeHtml(currentAccount)}</strong>
            </div>
            <div class="receipt-meta-row">
              <span>Transaction Hash:</span>
              <strong>${escapeHtml(data.txHash ? data.txHash.slice(0, 16) + '...' : 'Verified')}</strong>
            </div>
            <div class="receipt-meta-row">
              <span>Explorer Receipt:</span>
              <a href="${data.explorerUrl || '#'}" target="_blank" rel="noopener noreferrer" style="color:var(--success); text-decoration:underline;">View on NearBlocks ↗</a>
            </div>
          </div>
        </div>
      </div>
    `;
    if (record && data.remainingBalance) updateTreasuryUI(data.remainingBalance);
    return;
  }

  // 2. Treasury Funded
  if (data.type === 'treasury_funded') {
    el.innerHTML = `
      ${mandateAvatar}
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
              <strong style="color:var(--success);">${escapeHtml(currentAccount)}</strong>
            </div>
            <div class="receipt-meta-row">
              <span>New Available Balance:</span>
              <strong>${escapeHtml(data.newBalance)} NEAR</strong>
            </div>
          </div>
        </div>
      </div>
    `;
    if (record) updateTreasuryUI(data.newBalance);
    return;
  }

  // 3. Allowlist View
  if (data.type === 'allowlist_view' && data.allowlist) {
    const rows = data.allowlist.map(a => `
      <tr>
        <td><strong>${escapeHtml(a.accountId)}</strong></td>
        <td style="color:var(--text-muted);">${escapeHtml(a.label || 'Approved')}</td>
        <td>
          <button class="btn-mini-pay" onclick="prefillPayment('${escapeHtml(a.accountId)}')">Pay</button>
        </td>
      </tr>
    `).join('');

    el.innerHTML = `
      ${mandateAvatar}
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
  if (data.type === 'greeting' || data.type === 'text' || data.type === 'wallet_deposit' || data.type === 'allowlist_warning' || data.type === 'security_notice' || data.type === 'payment_failed' || data.error) {
    if (record && data.treasuryBalance) updateTreasuryUI(data.treasuryBalance);
    el.innerHTML = `
      ${mandateAvatar}
      <div class="message-content">
        <div style="font-size:14.5px; line-height:1.6; white-space:pre-wrap;">${formatMarkdown(data.message || data.error)}</div>
      </div>
    `;
    return;
  }

  // Research receipts always render the recorded verification and settlement state.
  if (data.mandateResult) {
    const result = data.mandateResult;
    const mismatchedHistory = conversation?.historical && conversation.text && !MandateChat.matchesGoal(result.mandate, conversation.text);
    const currentWorkflow = Array.isArray(result.deliverable.sources);
    const passed = currentWorkflow && result.deliverable.verification.passed;
    const payout = result.payout;
    const sources = result.deliverable.sources || [];
    const tasks = result.delegation.map(task => `<li><strong>${escapeHtml(task.role)}</strong> · ${escapeHtml(task.status)}<br>${escapeHtml(task.description)}</li>`).join('');
    const problems = currentWorkflow ? result.deliverable.verification.problems : ['This historical report predates live source verification. Run a new mandate to check its claims.'];
    const issues = problems.map(problem => `<li>${escapeHtml(problem)}</li>`).join('');
    let settlement = 'No research fee requested. No wallet funds were spent.';
    if (payout.status === 'confirmed' && payout.onchain && payout.txHash) {
      settlement = `Escrow released ${escapeHtml(payout.amount)} to ${escapeHtml(payout.recipient)}. <a href="${escapeHtml(payout.explorerUrl)}" target="_blank" rel="noopener noreferrer">View confirmed receipt ↗</a>`;
    } else if (payout.status !== 'not_requested') {
      settlement = `Escrow ${escapeHtml(payout.status)}. ${payout.reasons.map(reason => escapeHtml(reason.message)).join(' ')}${payout.explorerUrl ? ` <a href="${escapeHtml(payout.explorerUrl)}" target="_blank" rel="noopener noreferrer">View transaction ↗</a>` : ''}`;
    }
    if (!currentWorkflow) settlement = 'Historical settlement record. Source verification is unavailable for this report.' + (payout.explorerUrl ? ` <a href="${escapeHtml(payout.explorerUrl)}" target="_blank" rel="noopener noreferrer">View recorded receipt ↗</a>` : '');
    const label = mismatchedHistory ? 'Saved report for another directive' : !currentWorkflow ? 'Historical research report' : result.mandate.status === 'completed' ? 'Mandate completed' : 'Mandate needs more evidence or settlement review';
    const open = el.querySelector('.mandate-run')?.open || false;
    const details = `<p class="run-directive">${escapeHtml(result.mandate.goal)}</p>
      ${currentWorkflow ? MandateResearch.feeReceipt(payout, result.budgetState.totalBudget) : '<h4>Settlement</h4><p>' + settlement + '</p>'}
      <p>${escapeHtml(result.mandate.restrictions?.[0] || 'Purchases require explicit authorization.')}</p>
      <h4>Agent workflow</h4>${result.steps?.length ? runSteps(result.steps) : `<ol>${tasks}</ol>`}
      ${result.deliverable.searches?.length ? `<h4>Online discovery</h4><ul>${result.deliverable.searches.map(search => `<li>${escapeHtml(search.provider)} · ${escapeHtml(search.query)} · ${search.found} candidate links${search.error ? ' · ' + escapeHtml(search.error) : ''}</li>`).join('')}</ul>` : ''}
      <h4>${passed ? 'Evidence checks passed' : 'Evidence checks found gaps'}</h4>
      ${issues ? `<ul>${issues}</ul>` : '<p>Source integrity, freshness, coverage and calculations checked.</p>'}
      <p>These checks establish source provenance and coverage. Publisher claims, announcements and targets are not independently certified.</p>
      <h4>Source receipts</h4>${sources.length ? sources.map(source => `<div class="run-source"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a><br><small>Retrieved ${escapeHtml(source.retrievedAt)} · SHA-256 ${escapeHtml(source.hash.slice(0, 16))}…</small>${source.findings?.length ? [...new Set(source.findings.map(finding => finding.excerpt))].map(excerpt => `<blockquote>${escapeHtml(excerpt)}</blockquote>`).join('') : source.excerpt ? `<span>${escapeHtml(source.excerpt)}</span>` : ''}</div>`).join('') : '<p>No source evidence was retrieved.</p>'}
      ${mismatchedHistory ? `<h4>Recorded report</h4><div class="deliverable-body">${renderMarkdownRich(result.deliverable.preview)}</div>` : ''}`;
    el.innerHTML = `${mandateAvatar}<div class="message-content">
      ${runDisclosure(label, details, false, open)}
      <div class="mandate-answer deliverable-body">${mismatchedHistory ? '<p>This saved response belongs to another directive. Its original report is available in the disclosure above. Send your current request again for a fresh result.</p>' : renderMarkdownRich(result.deliverable.preview)}</div>
      ${!mismatchedHistory && result.deliverable.followUpQuestions?.length ? '<button class="refine-research">Refine request ↗</button>' : ''}
    </div>`;
    el.querySelector('.refine-research')?.addEventListener('click', () => {
      promptInput.value = result.mandate.goal + '\nAdditional details: ';
      promptInput.style.height = 'auto';
      promptInput.style.height = Math.min(promptInput.scrollHeight, 180) + 'px';
      promptInput.focus();
      showToast('Add the requested details. Authorize a research fee explicitly if you want one for this new request.');
    });
    if (record && currentWorkflow && payout.status === 'confirmed') void loadTreasuryBalance();
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
    .replace(/\[([^\]]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g, (_, label, url) => /^https?:\/\//i.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--success); text-decoration:underline;">${label}</a>` : label);
}

function renderMarkdownRich(md) {
  if (!md) return '';
  const lines = md.split('\n');
  let html = '';
  let inTable = false;
  let inList = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (inList && !trimmed.startsWith('- ') && !trimmed.startsWith('• ')) { html += '</ul>'; inList = false; }
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!inTable) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<div class="deliverable-table-scroll" role="region" aria-label="Comparison table" tabindex="0"><table class="deliverable-table" style="width:100%; border-collapse:collapse; margin:10px 0; font-size:12.5px;">';
        inTable = true;
      }
      if (trimmed.includes('---')) continue;
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      html += '<tr>' + cells.map(c => '<td style="padding:6px 10px; border:1px solid var(--border-subtle);">' + formatMarkdown(c) + '</td>').join('') + '</tr>';
      continue;
    } else if (inTable) {
      html += '</table></div>';
      inTable = false;
    }

    if (trimmed.startsWith('# ')) {
      html += '<h2 style="font-size:16px; font-weight:700; color:var(--text-primary); margin:14px 0 8px 0;">' + formatMarkdown(trimmed.slice(2)) + '</h2>';
    } else if (trimmed.startsWith('## ')) {
      html += '<h3 style="font-size:14px; font-weight:600; color:var(--accent-text); margin:12px 0 6px 0;">' + formatMarkdown(trimmed.slice(3)) + '</h3>';
    } else if (trimmed.startsWith('### ')) {
      html += '<h4 style="font-size:13px; font-weight:600; color:var(--text-primary); margin:10px 0 4px 0;">' + formatMarkdown(trimmed.slice(4)) + '</h4>';
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      if (!inList) { html += '<ul style="margin:4px 0 8px 18px; padding:0;">'; inList = true; }
      html += '<li style="margin-bottom:3px;">' + formatMarkdown(trimmed.slice(2)) + '</li>';
    } else if (trimmed === '---') {
      html += '<hr style="border:0; border-top:1px solid var(--border-subtle); margin:12px 0;">';
    } else if (trimmed.length > 0) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<p style="margin-bottom:8px;">' + formatMarkdown(trimmed) + '</p>';
    }
  }

  if (inTable) html += '</table></div>';
  if (inList) html += '</ul>';
  return html;
}


// ==============================================================================
// AGENT SWAP & PAYOUT LOGIC
// ==============================================================================
const swapModal = document.getElementById('swapModal');
const closeSwapModal = document.getElementById('closeSwapModal');
const navSwap = document.getElementById('navSwap');
const headerSwapBtn = document.getElementById('headerSwapBtn');

const swapInputNear = document.getElementById('swapInputNear');
const swapOutputUsdt = document.getElementById('swapOutputUsdt');
const swapMinOutput = document.getElementById('swapMinOutput');
const swapDestinationWallet = document.getElementById('swapDestinationWallet');
const swapAuthCheck = document.getElementById('swapAuthCheck');
const btnExecuteSwap = document.getElementById('btnExecuteSwap');

const swapUserQuotaText = document.getElementById('swapUserQuotaText');
const swapPoolLiquidityText = document.getElementById('swapPoolLiquidityText');
const swapRateText = document.getElementById('swapRateText');
const swapQuoteSourceText = document.getElementById('swapQuoteSourceText');
const swapFeeText = document.getElementById('swapFeeText');
const swapQuoteStatus = document.getElementById('swapQuoteStatus');
const refreshSwapQuoteBtn = document.getElementById('refreshSwapQuoteBtn');
const useConnectedWalletBtn = document.getElementById('useConnectedWalletBtn');

const swapStepperCard = document.getElementById('swapStepperCard');
const swapStep1 = document.getElementById('swapStep1');
const swapStep2 = document.getElementById('swapStep2');
const swapStep3 = document.getElementById('swapStep3');
const swapStep4 = document.getElementById('swapStep4');
const swapResultBox = document.getElementById('swapResultBox');
const swapHistoryTableBody = document.getElementById('swapHistoryTableBody');

function openSwapModal() {
  if (swapModal) {
    swapModal.classList.add('open');
    if (swapDestinationWallet && !swapDestinationWallet.value) {
      swapDestinationWallet.value = agentSnapshot?.accountId || '';
    }
    updateSwapQuote();
    loadSwapHistory();
    // Update user quota
    if (modalActiveAccountBal && swapUserQuotaText) {
      swapUserQuotaText.textContent = modalActiveAccountBal.textContent;
    }
  }
}

if (navSwap) navSwap.addEventListener('click', openSwapModal);
if (headerSwapBtn) headerSwapBtn.addEventListener('click', openSwapModal);
if (closeSwapModal) closeSwapModal.addEventListener('click', () => swapModal.classList.remove('open'));

if (useConnectedWalletBtn) {
  useConnectedWalletBtn.addEventListener('click', () => {
    if (connectedWallet && swapDestinationWallet) {
      swapDestinationWallet.value = agentSnapshot?.accountId || '';
    } else {
      showToast('No wallet connected. Using account: ' + currentAccount);
      if (swapDestinationWallet) swapDestinationWallet.value = agentSnapshot?.accountId || '';
    }
  });
}

// Quick amount buttons
document.querySelectorAll('.btn-quick-swap').forEach(btn => {
  btn.addEventListener('click', () => {
    const amt = btn.getAttribute('data-amt');
    if (amt && swapInputNear) {
      swapInputNear.value = amt;
      updateSwapQuote();
    }
  });
});

if (swapInputNear) {
  swapInputNear.addEventListener('input', () => {
    updateSwapQuote();
  });
}

let swapQuoteVersion = 0;
let swapQuoteReady = false;
let swapInFlight = false;
let swapQuoteExpiresAt = 0;
let swapQuoteExpiryTimer;
if (refreshSwapQuoteBtn) refreshSwapQuoteBtn.addEventListener('click', updateSwapQuote);
async function updateSwapQuote() {
  if (!swapInputNear) return;
  const version = ++swapQuoteVersion;
  swapQuoteReady = false;
  swapQuoteExpiresAt = 0;
  clearTimeout(swapQuoteExpiryTimer);
  if (btnExecuteSwap) btnExecuteSwap.disabled = true;
  if (swapQuoteStatus) swapQuoteStatus.textContent = 'Fetching a current quote…';
  if (swapRateText) swapRateText.textContent = 'Fetching rate…';
  if (swapQuoteSourceText) swapQuoteSourceText.textContent = 'Fetching price source…';
  if (swapFeeText) swapFeeText.textContent = '—';
  if (swapOutputUsdt) swapOutputUsdt.value = '';
  if (swapMinOutput) swapMinOutput.value = '';
  const amt = swapInputNear.value.trim();
  if (!Number.isFinite(Number(amt)) || Number(amt) <= 0) {
    if (swapQuoteStatus) swapQuoteStatus.textContent = 'Enter a positive NEAR amount.';
    return;
  }
  try {
    const dest = swapDestinationWallet ? encodeURIComponent(swapDestinationWallet.value.trim()) : '';
    const res = await mandateWallet.fetch('/api/swap/quote?amountNear=' + encodeURIComponent(amt) + '&destination=' + dest);
    const data = await res.json();
    if (version !== swapQuoteVersion) return;
    if (!res.ok || data.error) throw new Error(data.error || 'Live quote unavailable.');
    if (data) {
      if (swapOutputUsdt) swapOutputUsdt.value = formatUsdtAmount(data.outputUsdtExact ?? data.outputUsdt);
      if (swapMinOutput) swapMinOutput.value = formatUsdtAmount(data.minOutputUsdtExact ?? data.minOutputUsdt);
      if (swapPoolLiquidityText) swapPoolLiquidityText.textContent = formatUsdtAmount(data.poolLiquidityUsdt) + ' Test USDT';
      if (swapRateText) swapRateText.textContent = '1 NEAR ≈ ' + Number(data.exchangeRate).toFixed(6) + ' Test USDT';
      if (swapQuoteSourceText) {
        swapQuoteSourceText.textContent = data.rateType === 'market_reference_testnet'
          ? 'Ref Finance market reference · testnet treasury settlement'
          : data.rateType === 'testnet_dex' ? 'Ref Finance testnet pool ' + data.poolId + ' · reserve-based price'
          : 'Fixed demonstration rate · testnet treasury settlement';
      }
      if (swapFeeText) swapFeeText.textContent = Number(data.feeBps || 0) / 100 + '% · network gas paid separately';
      swapQuoteExpiresAt = Date.parse(data.expiresAt);
      if (!Number.isFinite(swapQuoteExpiresAt) || swapQuoteExpiresAt <= Date.now()) throw new Error('Quote expired. Refresh for a current rate.');
      if (swapQuoteStatus) swapQuoteStatus.textContent = 'Quote observed at ' + new Date(data.quotedAt).toLocaleTimeString() + '. Default minimum allows 2% price movement.';
      swapQuoteReady = true;
      if (btnExecuteSwap) btnExecuteSwap.disabled = swapInFlight;
      swapQuoteExpiryTimer = setTimeout(() => {
        if (version !== swapQuoteVersion) return;
        swapQuoteReady = false;
        if (btnExecuteSwap) btnExecuteSwap.disabled = true;
        if (swapQuoteStatus) swapQuoteStatus.textContent = 'Quote expired. Refresh for a current rate.';
      }, swapQuoteExpiresAt - Date.now());
    }
  } catch (error) {
    if (version !== swapQuoteVersion) return;
    if (swapQuoteStatus) swapQuoteStatus.textContent = error.message;
    if (swapRateText) swapRateText.textContent = 'Quote unavailable';
    if (swapQuoteSourceText) swapQuoteSourceText.textContent = 'Refresh to fetch a current quote.';
    if (swapPoolLiquidityText) swapPoolLiquidityText.textContent = '—';
    if (swapOutputUsdt) swapOutputUsdt.value = '';
    if (swapMinOutput) swapMinOutput.value = '';
  }
}

async function loadSwapHistory() {
  if (!swapHistoryTableBody) return;
  try {
    const res = await mandateWallet.fetch('/api/swap/history', { headers: getApiHeaders() });
    const data = await res.json();
    if (data && Array.isArray(data.swaps) && data.swaps.length > 0) {
      swapHistoryTableBody.innerHTML = data.swaps.map(s => {
        const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent';
        const isSuccess = s.status === 'payout_confirmed';
        const statusBadge = '<span style="color:var(--' + (isSuccess ? 'success' : s.status === 'failed' ? 'danger' : 'warning') + '); font-weight:600; font-size:11px;">' +
          (isSuccess ? 'Confirmed' : escapeHtml(s.status.replaceAll('_', ' '))) + '</span>';
        const txLink = s.payoutTxHash
          ? '<a href="https://testnet.nearblocks.io/txns/' + s.payoutTxHash + '" target="_blank" rel="noopener noreferrer" style="color:var(--success); text-decoration:underline; font-family:var(--font-mono); font-size:11px;">' + s.payoutTxHash.slice(0, 8) + '...</a>'
          : '<span style="color:var(--text-muted); font-size:11px;">-</span>';
        return '<tr>' +
          '<td>' + dateStr + '</td>' +
          '<td><strong>' + escapeHtml(String(s.inputNear)) + ' NEAR</strong></td>' +
          '<td style="color:var(--success); font-weight:600;">' + (s.outputAmount == null ? '—' : formatUsdtAmount(s.outputAmount) + ' Test USDT') + '</td>' +
          '<td>' + (s.exchangeRate == null ? '—' : '1 NEAR = ' + Number(s.exchangeRate).toFixed(6) + ' USDT') + '</td>' +
          '<td style="font-family:var(--font-mono); font-size:11px;">' + escapeHtml(s.destinationWallet) + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + txLink + '</td>' +
        '</tr>';
      }).join('');
    } else {
      swapHistoryTableBody.innerHTML = '<tr><td colspan="7" class="loading-td">No swap transactions yet</td></tr>';
    }
  } catch {
    swapHistoryTableBody.innerHTML = '<tr><td colspan="7" class="loading-td">Failed to load swap history</td></tr>';
  }
}

function resetStepper() {
  if (!swapStepperCard) return;
  swapStepperCard.style.display = 'block';
  [swapStep1, swapStep2, swapStep3, swapStep4].forEach(s => {
    if (s) {
      s.className = 'swap-step-item';
    }
  });
  if (swapResultBox) {
    swapResultBox.style.display = 'none';
    swapResultBox.innerHTML = '';
  }
}

function setStepState(stepEl, state) {
  if (!stepEl) return;
  stepEl.className = 'swap-step-item ' + state;
}

if (btnExecuteSwap) {
  btnExecuteSwap.addEventListener('click', async () => {
    if (!swapQuoteReady || swapInFlight || Date.now() >= swapQuoteExpiresAt) { showToast('Refresh the quote for a current swap rate.'); return; }
    if (!swapAuthCheck || !swapAuthCheck.checked) {
      alert('Please check the authorization box to authorize the agent to execute this swap.');
      return;
    }

    const amt = swapInputNear.value.trim();
    if (!Number.isFinite(Number(amt)) || Number(amt) <= 0) {
      alert('Please enter a valid NEAR amount to allocate.');
      return;
    }

    const dest = (swapDestinationWallet.value || '').trim().toLowerCase();
    if (!dest) {
      alert('Please enter a valid destination NEAR wallet.');
      return;
    }

    const minOut = swapMinOutput.value.trim();
    if (!Number.isFinite(Number(minOut)) || Number(minOut) <= 0) { showToast('Enter a positive minimum output.'); return; }

    // UI Progress Stepper
    resetStepper();
    swapInFlight = true;
    btnExecuteSwap.disabled = true;
    btnExecuteSwap.textContent = 'Processing Swap...';

    setStepState(swapStep1, 'active');

    try {
      // Backend authorization, storage registration and settlement are confirmed
      // together by the final response; do not mark steps complete ahead of it.
      const res = await mandateWallet.fetch('/api/swap/execute', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          id: crypto.randomUUID(),
          inputNear: amt,
          minOutputUsdt: minOut,
          destinationWallet: dest,
          note: 'Interactive Agent Swap & Payout'
        })
      });

      const data = await res.json();

      if (res.ok && data.status === 'confirmed') {
        setStepState(swapStep1, 'completed');
        setStepState(swapStep2, 'completed');
        setStepState(swapStep3, 'completed');
        setStepState(swapStep4, 'completed');

        swapResultBox.style.display = 'block';
        swapResultBox.style.background = 'var(--success-soft)';
        swapResultBox.style.border = '1px solid var(--success-border)';
        swapResultBox.style.color = 'var(--text-primary)';
        swapResultBox.innerHTML =
          '<strong>Swap confirmed</strong><br>' +
          'Received <strong>' + formatUsdtAmount(data.outputAmount) + ' Test USDT</strong> in your agent wallet.<br>' +
          '<a href="' + data.explorerUrl + '" target="_blank" rel="noopener noreferrer" style="color:var(--success); text-decoration:underline; font-family:var(--font-mono); font-size:11.5px; margin-top:4px; display:inline-block;">View Transaction on NearBlocks ↗</a>';

        showToast('Swap confirmed in your agent wallet');
        loadTreasuryBalance();
        loadSwapHistory();
      } else {
        setStepState(swapStep3, 'active');
        swapResultBox.style.display = 'block';
        swapResultBox.style.background = 'var(--danger-soft)';
        swapResultBox.style.border = '1px solid var(--danger-border)';
        swapResultBox.style.color = 'var(--danger)';
        swapResultBox.innerHTML = '<strong>❌ Swap Failed:</strong> ' + escapeHtml(data.error || data.operation?.error || 'Transaction needs review.');
      }
    } catch (err) {
      swapResultBox.style.display = 'block';
      swapResultBox.style.background = 'var(--danger-soft)';
      swapResultBox.style.border = '1px solid var(--danger-border)';
      swapResultBox.style.color = 'var(--danger)';
      swapResultBox.innerHTML = '<strong>❌ Network Error:</strong> ' + escapeHtml(err.message);
    } finally {
      swapInFlight = false;
      btnExecuteSwap.textContent = 'Authorize & Execute Swap';
      await updateSwapQuote();
    }
  });
}

// Initial Boot
updateAccountBadgeUI();
updateWalletUI();
checkWalletCallback();
loadTreasuryBalance();


// Universal modal backdrop click to close
document.querySelectorAll('.modal-backdrop').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('open');
    }
  });
});



  const sidebarDisconnectedCard = document.getElementById('sidebarDisconnectedCard');
  if (sidebarDisconnectedCard) {
    sidebarDisconnectedCard.addEventListener('click', () => {
      walletModal.classList.add('open');
    });
  }
  const sidebarDisconnectBtn = document.getElementById('sidebarDisconnectBtn');
  if (sidebarDisconnectBtn) {
    sidebarDisconnectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mandateWallet.disconnect(connectedWallet).catch(err => console.warn('Meteor disconnect:', err));
    connectedWallet = null;
      currentAccount = null;
      localStorage.removeItem('mandate_connected_wallet');
      localStorage.removeItem('mandate_current_account');
      updateWalletUI();
      showToast('Wallet disconnected');
    });
  }

setInterval(() => { if (connectedWallet && !document.hidden) loadTreasuryBalance(); }, 30000);
