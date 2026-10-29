import { createHash } from 'node:crypto';
import { PublicKey, baseDecode, JsonRpcProvider } from 'near-api-js';

export function requestMessage(account: string, method: string, pathname: string, body: string, timestamp: string) {
  return `Mandate wallet request\n${account}\n${method}\n${pathname}\n${timestamp}\n${createHash('sha256').update(body).digest('hex')}`;
}

/** A linked address is read-only until a signature from an installed NEAR access key proves ownership. */
export async function verifyWalletRequest(provider: JsonRpcProvider, account: string, method: string, pathname: string,
  body: string, headers: Record<string, any>) {
  const timestamp = headers['x-mandate-timestamp'];
  const publicKey = headers['x-mandate-public-key'];
  const signature = headers['x-mandate-signature'];
  if (typeof timestamp !== 'string' || typeof publicKey !== 'string' || typeof signature !== 'string'
    || !Number.isFinite(Number(timestamp)) || Math.abs(Date.now() - Number(timestamp)) > 60_000) {
    throw new Error('Connect and authorize your wallet before spending agent wallet funds.');
  }
  const message = new TextEncoder().encode(requestMessage(account, method, pathname, body, timestamp));
  let payload: Uint8Array = message;
  let signatureBytes: Uint8Array = headers['x-mandate-auth-type'] === 'nep413' ? Buffer.from(signature, 'base64') : baseDecode(signature);
  if (headers['x-mandate-auth-type'] === 'nep413') {
    const nonce = Buffer.from(String(headers['x-mandate-nonce'] || ''), 'base64');
    if (nonce.length !== 32) throw new Error('Invalid wallet message nonce.');
    const str = (value: string) => { const bytes = Buffer.from(value); const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return Buffer.concat([length, bytes]); };
    const tag = Buffer.alloc(4); tag.writeUInt32LE(2147483648 + 413);
    payload = createHash('sha256').update(Buffer.concat([tag, str(new TextDecoder().decode(message)), nonce, str('mandate'), Buffer.from([0])])).digest();
    signatureBytes = Buffer.from(signature, 'base64');
  }
  if (!PublicKey.fromString(publicKey).verify(payload, signatureBytes)) throw new Error('Invalid wallet signature.');
  await provider.query({ request_type: 'view_access_key', finality: 'final', account_id: account, public_key: publicKey });
}
