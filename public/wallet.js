/* Local authentication keys only sign Mandate requests; linked-wallet transfers stay in the wallet. */
(() => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = bytes => {
    let value = 0n;
    for (const byte of bytes) value = value * 256n + BigInt(byte);
    let result = '';
    while (value) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
    for (const byte of bytes) { if (byte) break; result = '1' + result; }
    return result;
  };
  const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const unbase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  let config;
  async function getConfig() {
    if (!config) {
      const res = await fetch('/api/wallet/config');
      config = await res.json();
      if (!res.ok) throw new Error(config.error || 'Wallet configuration is unavailable.');
    }
    return config;
  }
  async function authorize() {
    const cfg = await getConfig();
    const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const auth = { publicKey: 'ed25519:' + b58(new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey))), privateKey: base64(await crypto.subtle.exportKey('pkcs8', key.privateKey)) };
    localStorage.setItem('mandate_pending_auth', JSON.stringify(auth));
    const url = new URL(cfg.walletUrl + '/login/');
    url.searchParams.set('public_key', auth.publicKey);
    url.searchParams.set('contract_id', cfg.authReceiver);
    url.searchParams.set('method_names', 'mandate_auth');
    url.searchParams.set('success_url', location.origin + location.pathname);
    url.searchParams.set('failure_url', location.origin + location.pathname + '?wallet_error=cancelled');
    location.assign(url);
  }
  function callback() {
    const params = new URLSearchParams(location.search);
    const account = params.get('account_id');
    const key = localStorage.getItem('mandate_pending_auth');
    if (account && key) {
      const auth = JSON.parse(key);
      // The backend checks that this key is installed on the returned account before any spend.
      if (!params.get('public_key') || params.get('public_key') === auth.publicKey) {
        auth.accountId = account;
        localStorage.setItem('mandate_auth_' + account, JSON.stringify(auth));
        localStorage.removeItem('mandate_pending_auth');
      }
    }
  }
  async function walletFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers);
    const account = headers.get('x-mandate-account') || localStorage.getItem('mandate_connected_wallet');
    if (account && ['POST', 'DELETE'].includes(method)) {
      const body = options.body || '';
      const timestamp = String(Date.now());
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
      const message = `Mandate wallet request\n${account}\n${method}\n${new URL(url, location.origin).pathname}\n${timestamp}\n${Array.from(hash, n => n.toString(16).padStart(2, '0')).join('')}`;
      const auth = JSON.parse(localStorage.getItem('mandate_auth_' + account) || 'null');
      if (auth) {
        const key = await crypto.subtle.importKey('pkcs8', unbase64(auth.privateKey), 'Ed25519', false, ['sign']);
        headers.set('x-mandate-public-key', auth.publicKey);
        headers.set('x-mandate-signature', b58(new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(message)))));
        headers.set('x-mandate-timestamp', timestamp);
      } else if (window.near?.isMeteor && typeof window.near.signMessage === 'function' && ['/api/wallet/execute', '/api/wallet/reconcile', '/api/wallet/resume', '/api/swap/execute', '/api/chat', '/api/allowlist'].includes(new URL(url, location.origin).pathname)) {
        const nonce = crypto.getRandomValues(new Uint8Array(32));
        const proof = await window.near.signMessage({ message, recipient: 'mandate', nonce });
        if (proof.accountId !== account) throw new Error('Sign using your linked account.');
        headers.set('x-mandate-auth-type', 'nep413');
        headers.set('x-mandate-public-key', proof.publicKey);
        headers.set('x-mandate-signature', proof.signature);
        headers.set('x-mandate-nonce', base64(nonce));
        headers.set('x-mandate-timestamp', timestamp);
      }
    }
    return fetch(url, { ...options, headers });
  }
  async function signDeposit(deposit) {
    const account = localStorage.getItem('mandate_connected_wallet');
    if (!account) throw new Error('Link your wallet first.');
    if (window.near?.isMeteor && typeof window.near.signAndSendTransaction === 'function') {
      const result = await window.near.signAndSendTransaction(deposit.walletTransaction);
      const txHash = result?.transaction?.hash || result?.transaction_outcome?.id;
      if (!txHash) throw new Error('The wallet did not return a transaction hash.');
      const res = await walletFetch('/api/wallet/deposit/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mandate-account': account }, body: JSON.stringify({ txHash }) });
      const confirmed = await res.json();
      if (!res.ok) throw new Error(confirmed.error);
      return confirmed;
    }
    const cfg = await getConfig();
    const url = new URL(cfg.walletUrl + '/sign');
    url.searchParams.set('transactions', deposit.transaction);
    url.searchParams.set('callbackUrl', location.origin + location.pathname);
    location.assign(url);
  }
  window.mandateWallet = { fetch: walletFetch, authorize, callback, signDeposit,
    authorized: account => !!localStorage.getItem('mandate_auth_' + account),
    disconnect: account => { if (account) localStorage.removeItem('mandate_auth_' + account); } };
  callback();
})();
