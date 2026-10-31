import { WalletClient } from '@bsv/sdk';

// Must match backend/src/auth.ts
const PROTOCOL = [2, 'tum hackathon login'];
const KEY_ID = '1';

let wallet;
/** The user's BRC-100 wallet (BSV Desktop / BSV Browser). Keys never leave it. */
export const getWallet = () => (wallet ??= new WalletClient('auto', window.location.hostname));

export async function request(path, body, method) {
  const res = await fetch(path, {
    method: method ?? (body ? 'POST' : 'GET'),
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status });
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
export const fetchActivity = () => request('/api/activity').then((d) => d.events);
export const fetchOffer = (id) => request(`/api/offers/${id}`).then((d) => d.offer);
export const createOffer = (offer) => request('/api/offers', offer);
export const createRequest = (req) => request('/api/requests', req);
export const fetchQuote = (offerId, maxPrice) => request(`/api/offers/${offerId}/quote?maxPrice=${maxPrice}`);
export const fetchExposure = () => request('/api/exposure');
export const placeBid = (offerId, maxPrice) => request(`/api/offers/${offerId}/bid`, { maxPrice });
export const withdrawOffer = (offerId) => request(`/api/offers/${offerId}`, undefined, 'DELETE');
export const withdrawBid =(offerId) => request(`/api/offers/${offerId}/bid`, undefined, 'DELETE');
export const withdrawRequest = (requestId) => request(`/api/requests/${requestId}`, undefined, 'DELETE');

// Profiles, addressed by identity key. Updates return the signed-in user.
export const fetchProfile = (identityKey) => request(`/api/users/${identityKey}`);
export const updateProfile = (name) => request('/api/profile', { name }, 'PUT').then((d) => d.user);
export const removeAvatar = () => request('/api/profile/avatar', undefined, 'DELETE').then((d) => d.user);
export async function uploadAvatar(blob) {
  const res = await fetch('/api/profile/avatar', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': blob.type }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.user;
}

/** Signs a server challenge with the user's BSV wallet; creates the account on first login. */
export async function loginWithWallet() {
  const wallet = getWallet();
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

// Chat of a sold offer, for its seller and paying buyers. A message has text, an image, or both.
export const fetchMessages = (offerId, after) =>
  request(`/api/offers/${offerId}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`).then((d) => d.messages);
export async function sendMessage(offerId, text, image) {
  const form = new FormData();
  if (text) form.append('text', text);
  if (image) form.append('image', image);
  const res = await fetch(`/api/offers/${offerId}/messages`, { method: 'POST', credentials: 'include', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Sending failed (${res.status})`);
  return data.message;
}

// Files with information the seller hands over for a sold offer; buyers download them.
export const fetchDealFiles = (offerId) => request(`/api/offers/${offerId}/files`).then((d) => d.files);
export const deleteDealFile = (fileId) => request(`/api/deal-files/${fileId}`, undefined, 'DELETE');
export async function uploadDealFile(offerId, file) {
  const res = await fetch(`/api/offers/${offerId}/files?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data;
}

/** Follows the chat of a sold offer: handlers for "ready", "message" and "files". Returns a close function. */
export function followChat(offerId, handlers) {
  const source = new EventSource(`/api/offers/${offerId}/events`, { withCredentials: true });
  for (const [event, handle] of Object.entries(handlers)) {
    source.addEventListener(event, (e) => handle(JSON.parse(e.data || '{}')));
  }
  return () => source.close();
}
