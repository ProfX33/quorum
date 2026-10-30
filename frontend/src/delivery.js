import { Utils } from '@bsv/sdk';
import { getWallet, request } from './api';

// Data is encrypted in the browser with a random AES-256-GCM key; the server only stores
// the ciphertext (iv || ciphertext+tag) and the key wrapped by the seller's wallet to itself.
// After a buyer's payment is seen on the network, the seller's wallet unwraps the key and
// wraps it again for that buyer (BRC-2, counterparty = buyer). See backend/src/delivery.ts.

// Must match backend/scripts/delivery-e2e.ts (agents use the same protocol)
const KEY_PROTOCOL = [2, 'datamarket data key'];

const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error('Encryption needs a secure page (https or localhost)');
  return crypto.subtle;
};

const hex = (bytes) => Utils.toHex(Array.from(bytes));

async function sha256Hex(bytes) {
  return hex(new Uint8Array(await subtle().digest('SHA-256', bytes)));
}

// localStorage may be unavailable (private mode); payments then simply are not resumable.
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not persisted */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* nothing stored */ } },
};
const pendingPayment = (bidId) => `datamarket:payment:${bidId}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Seller: encrypt and upload ----------

/** Encrypts the file, uploads the ciphertext and returns what the offer needs. */
export async function encryptAndUpload(file, onStep = () => {}) {
  const wallet = getWallet();
  onStep('Encrypting…');
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await subtle().importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, aes, await file.arrayBuffer()));
  const blob = new Uint8Array(iv.length + encrypted.length);
  blob.set(iv);
  blob.set(encrypted, iv.length);
  const dataHash = await sha256Hex(blob);

  onStep('Securing the key in your wallet…');
  const { ciphertext: wrap } = await wallet.encrypt({
    plaintext: Array.from(key), protocolID: KEY_PROTOCOL, keyID: dataHash, counterparty: 'self',
  });
  // Before anything is published, make sure the wallet can recover the key later.
  const { plaintext } = await wallet.decrypt({ ciphertext: wrap, protocolID: KEY_PROTOCOL, keyID: dataHash, counterparty: 'self' });
  if (hex(plaintext) !== hex(key)) throw new Error('Your wallet could not recover the data key');

  onStep('Uploading…');
  const res = await fetch(`/api/data?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  if (data.dataHash !== dataHash) throw new Error('The upload was corrupted, please try again');
  return { dataHash, sellerKeyWrap: hex(wrap) };
}

// ---------- Buyer: pay ----------

/**
 * Submits a signed payment, retrying while the network is unreachable. The signed
 * transaction is kept until the server has recorded it, so a reload never pays twice.
 */
async function submitPayment(bidId, beef) {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await request(`/api/bids/${bidId}/payment`, { beef });
      store.del(pendingPayment(bidId));
      return result;
    } catch (e) {
      // Only a definite answer about this transaction discards it; anything else is retried.
      // (an expired session, 401, keeps it too: sign in again and it is resubmitted).
      const definite = [400, 404, 409].includes(e.status);
      if (definite) {
        store.del(pendingPayment(bidId));
        throw e;
      }
      if (attempt >= 3) throw new Error('Your payment is signed but could not be registered yet. It is retried when you open this offer again.');
      await sleep(2000 * (attempt + 1));
    }
  }
}

export const hasPendingPayment = (bidId) => store.get(pendingPayment(bidId)) !== null;

/** Resubmits a payment signed earlier whose submission did not get through. */
export async function resumePayment(bidId) {
  const beef = store.get(pendingPayment(bidId));
  return beef ? submitPayment(bidId, beef) : null;
}

/** Pays the buyer's share from their wallet, straight to the seller. */
export async function payForBid(bidId) {
  if (hasPendingPayment(bidId)) return resumePayment(bidId);
  const payment = await request(`/api/bids/${bidId}/payment`);
  const { tx } = await getWallet().createAction({
    description: payment.description,
    outputs: payment.outputs,
    labels: ['datamarket'],
  });
  if (!tx) throw new Error('The wallet did not return the signed transaction');
  const beef = hex(tx);
  store.set(pendingPayment(bidId), beef);
  return submitPayment(bidId, beef);
}

// ---------- Buyer: download ----------

const reportFailure = (bidId, reason) => request(`/api/bids/${bidId}/receipt`, { ok: false, reason });

/** Asks the seller to deliver the key again (when the wallet cannot unwrap it). */
export const requestRedelivery = (bidId, reason) => reportFailure(bidId, reason);

/** Unwraps the key, downloads and checks the ciphertext, decrypts and saves the file. */
export async function downloadPurchase(bidId, fileName) {
  const d = await request(`/api/bids/${bidId}/delivery`);
  const { plaintext: key } = await getWallet().decrypt({
    ciphertext: Utils.toArray(d.wrappedKey, 'hex'), protocolID: KEY_PROTOCOL, keyID: d.offerId, counterparty: d.seller,
  });

  const res = await fetch(`/api/offers/${d.offerId}/data`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Download failed (${res.status}), please retry`);
  const blob = new Uint8Array(await res.arrayBuffer());
  if ((await sha256Hex(blob)) !== d.dataHash) throw new Error('The download does not match the commitment, please retry');

  let data;
  try {
    const aes = await subtle().importKey('raw', Uint8Array.from(key), 'AES-GCM', false, ['decrypt']);
    data = await subtle().decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12) }, aes, blob.slice(12));
  } catch {
    // The key is definitely wrong: the seller is asked to deliver again.
    await reportFailure(bidId, 'The delivered key does not decrypt the data').catch(() => {});
    throw new Error('The delivered key does not open the data. The seller has been asked to deliver again.');
  }
  await request(`/api/bids/${bidId}/receipt`, { ok: true });

  const url = URL.createObjectURL(new Blob([data]));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName || 'data' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- Seller: claim payments and deliver keys ----------

const RETRY_AFTER_MS = 60_000;
const failedAt = new Map(); // `${kind}:${bidId}` → time of the last failure

const due = (id) => Date.now() - (failedAt.get(id) ?? 0) > RETRY_AFTER_MS;

/**
 * Does the seller's pending work: takes paid shares into the wallet (internalizeAction)
 * and wraps the data key for each buyer whose payment the network has seen.
 * `notify(message, kind)` reports progress.
 */
export async function runSellerTasks(notify = () => {}) {
  const { tasks } = await request('/api/seller/tasks');
  if (tasks.length === 0) return;
  const wallet = getWallet();
  for (const t of tasks) {
    const claimId = `claim:${t.bidId}`;
    if (t.claim && due(claimId)) {
      try {
        await wallet.internalizeAction({
          tx: Utils.toArray(t.claim.beef, 'hex'),
          outputs: [{
            outputIndex: t.claim.outputIndex,
            protocol: 'wallet payment',
            paymentRemittance: {
              derivationPrefix: t.claim.derivationPrefix,
              derivationSuffix: t.claim.derivationSuffix,
              senderIdentityKey: t.claim.senderIdentityKey,
            },
          }],
          description: 'Data market sale',
          labels: ['datamarket'],
        });
        await request(`/api/bids/${t.bidId}/claimed`, {});
        notify(`Received ${t.amount.toLocaleString()} sats for “${t.offerName}”`, 'success');
      } catch (e) {
        if (/already/i.test(e.message)) {
          await request(`/api/bids/${t.bidId}/claimed`, {}).catch(() => {});
        } else {
          failedAt.set(claimId, Date.now());
          // The money is on-chain at your key either way; this only adds it to the wallet balance.
          notify(`Could not add a payment to your wallet: ${e.message}`, 'error');
        }
      }
    }
    const deliverId = `deliver:${t.bidId}`;
    if (t.deliver && due(deliverId)) {
      try {
        const { plaintext: key } = await wallet.decrypt({
          ciphertext: Utils.toArray(t.deliver.sellerKeyWrap, 'hex'),
          protocolID: KEY_PROTOCOL,
          keyID: t.deliver.dataHash,
          counterparty: 'self',
        });
        const { ciphertext } = await wallet.encrypt({
          plaintext: key, protocolID: KEY_PROTOCOL, keyID: t.offerId, counterparty: t.buyer,
        });
        await request(`/api/bids/${t.bidId}/delivery`, { wrappedKey: hex(ciphertext) });
        notify(`Delivered “${t.offerName}” to a buyer`, 'success');
      } catch (e) {
        failedAt.set(deliverId, Date.now());
        notify(`Could not deliver “${t.offerName}”: ${e.message}`, 'error');
      }
    }
  }
}
