import { WalletClient } from '@bsv/sdk';

// Must match backend/src/auth.ts
const PROTOCOL = [2, 'tum hackathon login'];
const KEY_ID = '1';

async function request(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const fetchMe = () => request('/api/auth/me').then((d) => d.user).catch(() => null);
export const logout = () => request('/api/auth/logout', {});

/** Signs a server challenge with the user's BSV wallet; creates the account on first login. */
export async function loginWithWallet() {
  const wallet = new WalletClient('auto', window.location.hostname);
  const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true });
  const { nonce, message } = await request('/api/auth/challenge', { identityKey });
  const { signature } = await wallet.createSignature({
    data: Array.from(new TextEncoder().encode(message)),
    protocolID: PROTOCOL,
    keyID: KEY_ID,
    counterparty: 'anyone',
  });
  const hex = signature.map((b) => b.toString(16).padStart(2, '0')).join('');
  return request('/api/auth/login', { identityKey, nonce, signature: hex, kind: 'human' });
}
