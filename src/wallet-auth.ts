import { createHash } from 'node:crypto';
import { PublicKey, baseDecode, JsonRpcProvider } from 'near-api-js';

export function requestMessage(account: string, method: string, pathname: string, body: string, timestamp: string, brand = 'KORD') {
  return `${brand} wallet request\n${account}\n${method}\n${pathname}\n${timestamp}\n${createHash('sha256').update(body).digest('hex')}`;
}

/** Admit the exact signed request, then recheck key revocation before a long research job settles. */
export async function authorizeWalletRequest(provider: JsonRpcProvider, account: string, method: string, pathname: string,
  body: string, headers: Record<string, any>) {
  const header = (name: string) => headers['x-kord-' + name] ?? headers['x-mandate-' + name];
  const timestamp = header('timestamp');
  const publicKey = header('public-key');
  const signature = header('signature');
  if (typeof timestamp !== 'string' || typeof publicKey !== 'string' || typeof signature !== 'string'
    || !Number.isFinite(Number(timestamp)) || Math.abs(Date.now() - Number(timestamp)) > 60_000) {
    throw new Error('Connect and authorize your wallet before spending agent wallet funds.');
  }
  const nep413 = header('auth-type') === 'nep413';
  const signatureBytes = nep413 ? Buffer.from(signature, 'base64') : baseDecode(signature);
  const nonce = nep413 ? Buffer.from(String(header('nonce') || ''), 'base64') : null;
  if (nonce && nonce.length !== 32) throw new Error('Invalid wallet message nonce.');
  const key = PublicKey.fromString(publicKey);
  // Older installed browser keys and in-flight requests remain usable after the branding change.
  const valid = [['KORD', 'KORD'], ['Mandate', 'mandate']].some(([brand, recipient]) => {
    const message = requestMessage(account, method, pathname, body, timestamp, brand);
    let payload: Uint8Array = new TextEncoder().encode(message);
    if (nonce) {
      const str = (value: string) => { const bytes = Buffer.from(value); const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return Buffer.concat([length, bytes]); };
      const tag = Buffer.alloc(4); tag.writeUInt32LE(2147483648 + 413);
      payload = createHash('sha256').update(Buffer.concat([tag, str(message), nonce, str(recipient), Buffer.from([0])])).digest();
    }
    return key.verify(payload, signatureBytes);
  });
  if (!valid) throw new Error('Invalid wallet signature.');
  const checkKey = async () => {
    await provider.query({ request_type: 'view_access_key', finality: 'final', account_id: account, public_key: publicKey });
  };
  await checkKey();
  return checkKey;
}

/** A linked address alone does not prove ownership. */
export async function verifyWalletRequest(provider: JsonRpcProvider, account: string, method: string, pathname: string,
  body: string, headers: Record<string, any>) {
  await authorizeWalletRequest(provider, account, method, pathname, body, headers);
}
