// Presentation behavior only. Wallet, chat, and transaction logic live in app.js.
(() => {
  const root = document.documentElement;
  const themeButton = document.getElementById('themeToggleBtn');
  const sidebar = document.getElementById('sidebar');
  const openSidebar = document.getElementById('sidebarOpenBtn');
  const mobile = window.matchMedia('(max-width: 767px)');
  const prompt = document.getElementById('promptInput');
  const dialogs = [...document.querySelectorAll('.modal-backdrop')];
  let activeDialog = null;
  let returnFocus = null;
  let sidebarReturnFocus = null;

  function updateThemeButton() {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    themeButton.title = `Switch to ${next} theme`;
    themeButton.setAttribute('aria-label', themeButton.title);
    document.querySelector('meta[name="theme-color"]').content = next === 'light' ? '#262623' : '#f8f6f1';
  }
  updateThemeButton();
  themeButton.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('mandate_theme', root.dataset.theme); } catch {}
    updateThemeButton();
  });

  function updateSidebar() {
    const open = !sidebar.classList.contains('collapsed');
    openSidebar.setAttribute('aria-expanded', String(open));
    sidebar.inert = !open;
    if (mobile.matches && open && !sidebarReturnFocus) {
      sidebarReturnFocus = document.activeElement;
      document.getElementById('sidebarCloseBtn').focus({ preventScroll: true });
    } else if (!open && sidebarReturnFocus) {
      if (!activeDialog) sidebarReturnFocus.focus({ preventScroll: true });
      sidebarReturnFocus = null;
    }
    document.querySelector('.main-panel').inert = !!activeDialog || (mobile.matches && open);
  }
  function applyViewport() {
    sidebar.classList.toggle('collapsed', mobile.matches);
    sidebarReturnFocus = null;
    updateSidebar();
  }
  applyViewport();
  mobile.addEventListener('change', applyViewport);
  new MutationObserver(updateSidebar).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  document.getElementById('sidebarBackdrop').addEventListener('click', () => sidebar.classList.add('collapsed'));
  document.querySelectorAll('.sidebar-nav button, .sidebar .history-item, #newChatBtn').forEach(button => {
    button.addEventListener('click', () => {
      if (mobile.matches) sidebar.classList.add('collapsed');
    });
  });

  const keyboardCards = ['sidebarDisconnectedCard', 'connectMyNearWalletBtn', 'connectMeteorWalletBtn', 'useConnectedWalletBtn'];
  keyboardCards.forEach(id => {
    const element = document.getElementById(id);
    if (!element) return;
    element.setAttribute('role', 'button');
    element.tabIndex = 0;
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        element.click();
      }
    });
  });

  function resizePrompt() {
    prompt.style.height = 'auto';
    prompt.style.height = Math.min(prompt.scrollHeight, 160) + 'px';
  }
  prompt.addEventListener('input', resizePrompt);
  window.addEventListener('resize', resizePrompt);
  document.getElementById('newChatBtn').addEventListener('click', () => {
    resizePrompt();
    if (!mobile.matches) prompt.focus();
  });

  function focusableIn(container) {
    return [...container.querySelectorAll('button, a[href], input, textarea, [tabindex="0"]')]
      .filter(element => !element.disabled && !element.closest('[inert]') && element.getClientRects().length);
  }
  dialogs.forEach(dialog => {
    const card = dialog.querySelector('.modal-card');
    const title = card.querySelector('h2');
    title.id = `${dialog.id}Title`;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', title.id);
    card.querySelector('.modal-close').setAttribute('aria-label', 'Close dialog');
    new MutationObserver(() => {
      if (dialog.classList.contains('open')) {
        if (activeDialog && activeDialog !== dialog) activeDialog.classList.remove('open');
        if (!activeDialog) returnFocus = document.activeElement;
        activeDialog = dialog;
        document.querySelector('.app-container').inert = true;
        // Wait for the existing click handler to finish updating dialog content.
        requestAnimationFrame(() => {
          if (activeDialog === dialog) (focusableIn(card)[0] || card).focus({ preventScroll: true });
        });
      } else if (activeDialog === dialog) {
        activeDialog = null;
        document.querySelector('.app-container').inert = false;
        updateSidebar();
        const target = returnFocus && !returnFocus.closest('[inert]') ? returnFocus : openSidebar;
        target.focus({ preventScroll: true });
        returnFocus = null;
      }
    }).observe(dialog, { attributes: true, attributeFilter: ['class'] });
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (activeDialog) activeDialog.classList.remove('open');
      else if (mobile.matches) sidebar.classList.add('collapsed');
    }
    if (event.key === 'Tab') {
      const container = activeDialog || (mobile.matches && !sidebar.classList.contains('collapsed') ? sidebar : null);
      if (!container) return;
      const items = focusableIn(container);
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j' && !activeDialog) {
      event.preventDefault();
      document.getElementById('newChatBtn').click();
      prompt.focus();
    }
  });

  // Labels add context without changing the existing form fields or requests.
  document.querySelectorAll('input:not([aria-label])').forEach(input => {
    input.setAttribute('aria-label', input.closest('div')?.querySelector('label')?.textContent.trim() || input.placeholder || input.id);
  });
  const shortcut = document.querySelector('.new-chat-btn kbd');
  if (!/Mac|iPhone|iPad/.test(navigator.platform)) shortcut.textContent = 'Ctrl J';
})();
