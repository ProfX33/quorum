import { WalletClient } from '@bsv/sdk';

// Must match backend/src/auth.ts
const PROTOCOL = [2, 'tum hackathon login'];
const KEY_ID = '1';

async function request(path, body, method) {
  const res = await fetch(path, {
    method: method ?? (body ? 'POST' : 'GET'),
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

// Marketplace. Prices are satoshis; filters: q, kind, category, region, status.
const query = (filters) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  return params.size ? `?${params}` : '';
};
export const searchMarket = (filters) => request(`/api/search${query(filters)}`);
export const fetchOffer = (id) => request(`/api/offers/${id}`).then((d) => d.offer);
export const createOffer = (offer) => request('/api/offers', offer);
export const createRequest = (req) => request('/api/requests', req);
export const placeBid = (offerId, maxPrice) => request(`/api/offers/${offerId}/bid`, { maxPrice });
export const withdrawBid = (offerId) => request(`/api/offers/${offerId}/bid`, undefined, 'DELETE');
export const withdrawRequest = (requestId) => request(`/api/requests/${requestId}`, undefined, 'DELETE');

/** Hex sha256 of a file, used as the commitment to the encrypted data. */
export async function sha256File(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

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
