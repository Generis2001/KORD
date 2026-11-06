/* Local authentication keys only sign KORD requests; linked-wallet transfers stay in the wallet. */
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
  let config, meteorClient, meteorSdk;
  let authorizationVersion = 0;
  async function getConfig() {
    if (!config) {
      const res = await fetch('/api/wallet/config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Wallet configuration is unavailable.');
      config = data;
    }
    return config;
  }
  async function getMeteorClient() {
    if (!meteorClient) {
      meteorClient = (async () => {
        const cfg = await getConfig();
        // Load the self-hosted SDK only when a wallet interaction needs it.
        if (!window.kordMeteor) {
          if (!meteorSdk) {
            meteorSdk = new Promise((resolve, reject) => {
              const script = document.createElement('script');
              script.src = 'meteor.bundle.js';
              const failed = () => { script.remove(); meteorSdk = null; reject(new Error('Meteor Wallet could not load. Try again.')); };
              script.onload = () => window.kordMeteor?.createClient ? resolve() : failed();
              script.onerror = failed;
              document.head.appendChild(script);
            });
          }
          await meteorSdk;
        }
        return window.kordMeteor.createClient(cfg);
      })().catch(error => { meteorClient = null; throw error; });
    }
    return meteorClient;
  }
  function storedAuth(account) {
    try {
      const auth = JSON.parse(localStorage.getItem('kord_auth_' + account) || 'null');
      return auth?.accountId === account && auth.publicKey && auth.privateKey ? auth : null;
    } catch { return null; }
  }
  async function authorize(expectedAccount = null) {
    const version = ++authorizationVersion;
    const client = await getMeteorClient();
    const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const auth = { publicKey: 'ed25519:' + b58(new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey))), privateKey: base64(await crypto.subtle.exportKey('pkcs8', key.privateKey)) };
    const account = await client.signIn(auth.publicKey);
    if (expectedAccount && account !== expectedAccount) throw new Error('Authorize using your linked account: ' + expectedAccount + '.');
    auth.accountId = account;
    const res = await walletFetch('/api/wallet/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kord-account': account }, body: '{}' }, auth);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Meteor Wallet authorization could not be verified.');
    if (version !== authorizationVersion || (expectedAccount && localStorage.getItem('kord_connected_wallet') !== expectedAccount)) {
      throw new Error('Your linked wallet changed. Connect Meteor Wallet again.');
    }
    localStorage.setItem('kord_auth_' + account, JSON.stringify(auth));
    localStorage.removeItem('kord_pending_auth');
    return account;
  }
  async function walletFetch(url, options = {}, suppliedAuth = null) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers);
    const account = headers.get('x-kord-account') || localStorage.getItem('kord_connected_wallet');
    if (account) headers.set('x-kord-account', account);
    const target = new URL(url, location.origin);
    const privateHistory = target.pathname === '/api/conversations';
    if (account && (['POST', 'DELETE'].includes(method) || privateHistory && method === 'GET')) {
      const body = options.body || '';
      const timestamp = String(Date.now());
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
      const message = `KORD wallet request\n${account}\n${method}\n${target.pathname + (privateHistory ? target.search : '')}\n${timestamp}\n${Array.from(hash, n => n.toString(16).padStart(2, '0')).join('')}`;
      const auth = suppliedAuth || storedAuth(account);
      if (auth) {
        const key = await crypto.subtle.importKey('pkcs8', unbase64(auth.privateKey), 'Ed25519', false, ['sign']);
        headers.set('x-kord-public-key', auth.publicKey);
        headers.set('x-kord-signature', b58(new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(message)))));
        headers.set('x-kord-timestamp', timestamp);
      } else if (!privateHistory && ['/api/wallet/execute', '/api/wallet/reconcile', '/api/wallet/resume', '/api/swap/execute', '/api/chat', '/api/allowlist'].includes(target.pathname)) {
        const client = await getMeteorClient();
        if (await client.isConnected(account)) {
          const nonce = crypto.getRandomValues(new Uint8Array(32));
          const proof = await client.signMessage(account, { message, recipient: 'KORD', nonce });
          if (proof.accountId !== account) throw new Error('Sign using your linked account.');
          headers.set('x-kord-auth-type', 'nep413');
          headers.set('x-kord-public-key', proof.publicKey);
          headers.set('x-kord-signature', base64(proof.signature));
          headers.set('x-kord-nonce', base64(nonce));
          headers.set('x-kord-timestamp', timestamp);
        }
      }
    }
    return fetch(url, { ...options, method, headers });
  }
  async function signDeposit(deposit) {
    const account = localStorage.getItem('kord_connected_wallet');
    if (!account) throw new Error('Link your wallet first.');
    if (deposit.walletTransaction?.signerId !== account) throw new Error('Deposit using your linked account.');
    const client = await getMeteorClient();
    const result = await client.signAndSendTransaction(deposit.walletTransaction);
    const txHash = result?.transaction?.hash || result?.transaction_outcome?.id;
    if (!txHash) throw new Error('Meteor Wallet did not return a transaction hash.');
    const res = await walletFetch('/api/wallet/deposit/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kord-account': account }, body: JSON.stringify({ txHash }) });
    const confirmed = await res.json();
    if (!res.ok) throw new Error(confirmed.error);
    return confirmed;
  }
  window.kordWallet = { fetch: walletFetch, authorize, signDeposit,
    authorized: account => !!storedAuth(account),
    disconnect: async account => {
      ++authorizationVersion;
      if (account) {
        localStorage.removeItem('kord_auth_' + account);
        const client = await getMeteorClient();
        await client.disconnect(account);
      }
    } };
})();
