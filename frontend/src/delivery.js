import {
  Hash,
  LockingScript,
  P2PKH,
  PrivateKey,
  ProtoWallet,
  PublicKey,
  Signature,
  Transaction,
  TransactionSignature,
  UnlockingScript,
  Utils,
} from '@bsv/sdk';
import { getWallet, request } from './api';

// Data is encrypted in the browser with a random AES-256-GCM key; the server only stores
// the ciphertext (iv || ciphertext+tag) and the key wrapped by the seller's wallet to itself.
// The payment group pays the seller in one transaction: each buyer pledges their share and
// signs it for that transaction only (see backend/src/payments.ts). Once the network has
// seen it, the seller's wallet unwraps the key and wraps it again for each buyer (BRC-2,
// counterparty = buyer). See backend/src/delivery.ts.

// Must match backend/scripts/delivery-e2e.ts (agents use the same protocol)
const KEY_PROTOCOL = [2, 'datamarket data key'];
// Must match backend/src/payments.ts
const PLEDGE_PROTOCOL = [2, 'datamarket pledge'];
const BRC29_PROTOCOL = [2, '3241645161d8'];
const ANYONE_KEY = new PrivateKey(1).toPublicKey().toString();
const GROUP_SCOPE = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_ANYONECANPAY | TransactionSignature.SIGHASH_FORKID;
const REFUND_SCOPE = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID;

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
const pendingPayment = (bidId) => `datamarket:pledge:${bidId}`;
const pendingRefund = (bidId) => `datamarket:refund:${bidId}`;

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

// ---------- Pledge transactions (same as backend/src/payments.ts) ----------

const anyone = new ProtoWallet('anyone');

/** The BRC-29 key of `identityKey` for one payment, from the public "anyone" sender. */
async function paymentLockingScript(identityKey, prefix, suffix) {
  const { publicKey } = await anyone.getPublicKey({
    protocolID: BRC29_PROTOCOL, keyID: `${prefix} ${suffix}`, counterparty: identityKey,
  });
  return new P2PKH().lock(PublicKey.fromString(publicKey).toHash()).toHex();
}

async function pledgeLockingScript(wallet, keyID) {
  const { publicKey } = await wallet.getPublicKey({ protocolID: PLEDGE_PROTOCOL, keyID, counterparty: 'self' });
  return new P2PKH().lock(PublicKey.fromString(publicKey).toHash()).toHex();
}

function buildTransaction(outputs, inputs) {
  const tx = new Transaction();
  for (const i of inputs) tx.addInput({ sourceTransaction: i.tx, sourceOutputIndex: i.vout, sequence: 0xffffffff });
  for (const o of outputs) tx.addOutput({ lockingScript: LockingScript.fromHex(o.lockingScript), satoshis: o.satoshis });
  return tx;
}

/** P2PKH unlocking script for input `index` of `tx`, signed in the wallet by the pledge key `keyID`. */
async function signWithPledgeKey(wallet, keyID, tx, index, scope) {
  const input = tx.inputs[index];
  const source = input.sourceTransaction.outputs[input.sourceOutputIndex];
  const preimage = TransactionSignature.format({
    sourceTXID: input.sourceTransaction.id('hex'),
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: source.satoshis,
    transactionVersion: tx.version,
    otherInputs: tx.inputs.filter((_, i) => i !== index),
    inputIndex: index,
    outputs: tx.outputs,
    inputSequence: input.sequence,
    subscript: source.lockingScript,
    lockTime: tx.lockTime,
    scope,
  });
  const args = { protocolID: PLEDGE_PROTOCOL, keyID, counterparty: 'self' };
  // A P2PKH signature is over hash256 of the preimage.
  const { signature } = await wallet.createSignature({ ...args, hashToDirectlySign: Hash.hash256(preimage) });
  const { publicKey } = await wallet.getPublicKey(args);
  const sig = Signature.fromDER(signature);
  const checksig = new TransactionSignature(sig.r, sig.s, scope).toChecksigFormat();
  const pubkey = PublicKey.fromString(publicKey).encode(true);
  return new UnlockingScript([
    { op: checksig.length, data: checksig },
    { op: pubkey.length, data: pubkey },
  ]);
}

// ---------- Buyer: pledge ----------

/**
 * Submits a signed pledge, retrying while the network is unreachable. The pledge is kept
 * until the server has recorded it, so a reload never pledges twice.
 */
async function submitPledge(bidId, pledge) {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await request(`/api/bids/${bidId}/payment`, pledge);
      store.del(pendingPayment(bidId));
      return result;
    } catch (e) {
      // Only a definite answer about this pledge discards it; anything else is retried.
      // (an expired session, 401, keeps it too: sign in again and it is resubmitted).
      const definite = [400, 404, 409].includes(e.status);
      if (definite) {
        store.del(pendingPayment(bidId));
        throw e;
      }
      if (attempt >= 3) throw new Error('Your pledge is signed but could not be registered yet. It is retried when you open this offer again.');
      await sleep(2000 * (attempt + 1));
    }
  }
}

export const hasPendingPayment = (bidId) => store.get(pendingPayment(bidId)) !== null;

/** Resubmits a pledge signed earlier whose submission did not get through. */
export async function resumePayment(bidId) {
  const pledge = store.get(pendingPayment(bidId));
  return pledge ? submitPledge(bidId, JSON.parse(pledge)) : null;
}

/**
 * Pledges the buyer's open share: the wallet moves it to a key of its own, then signs it
 * for the group payment only. Nothing reaches the seller until the whole group has pledged.
 */
export async function payForBid(bidId) {
  if (hasPendingPayment(bidId)) return resumePayment(bidId);
  const req = await request(`/api/bids/${bidId}/payment`);
  // Never sign for a payment that does not give the seller the full price.
  const [toSeller] = req.groupOutputs;
  if (toSeller.satoshis !== req.price
    || toSeller.lockingScript !== (await paymentLockingScript(req.seller, req.derivationPrefix, req.derivationSuffix))) {
    throw new Error('The group payment the server asked for does not pay the seller the price. Not signing it.');
  }

  const wallet = getWallet();
  const lockingScript = await pledgeLockingScript(wallet, req.keyID);
  const { tx } = await wallet.createAction({
    description: req.description,
    outputs: [{ lockingScript, satoshis: req.satoshis, outputDescription: 'Pledge for a group purchase' }],
    labels: ['datamarket'],
  });
  if (!tx) throw new Error('The wallet did not return the signed transaction');
  const pledgeTx = Transaction.fromAtomicBEEF(tx);
  const vout = pledgeTx.outputs.findIndex((o) => o.lockingScript.toHex() === lockingScript);

  const group = buildTransaction(req.groupOutputs, [{ tx: pledgeTx, vout }]);
  const unlockingScript = (await signWithPledgeKey(wallet, req.keyID, group, 0, GROUP_SCOPE)).toHex();
  const pledge = { beef: hex(tx), vout, unlockingScript, keyID: req.keyID };
  store.set(pendingPayment(bidId), JSON.stringify(pledge));
  return submitPledge(bidId, pledge);
}

// ---------- Buyer: take back unused pledges ----------

export const canRefund = (bid) => bid.refundable > 0 || store.get(pendingRefund(bid.id)) !== null;

const b64 = (s) => Utils.toBase64(Hash.sha256(Utils.toArray(s, 'utf8')).slice(0, 16));

/** Adds a broadcast refund to the wallet's balance (a BRC-29 payment from "anyone" to itself). */
async function internalizeRefund(id, refund) {
  await getWallet().internalizeAction({
    tx: Utils.toArray(refund.beef, 'hex'),
    outputs: [{
      outputIndex: 0,
      protocol: 'wallet payment',
      paymentRemittance: {
        derivationPrefix: refund.prefix, derivationSuffix: refund.suffix, senderIdentityKey: ANYONE_KEY,
      },
    }],
    description: 'Data market refund',
    labels: ['datamarket'],
  });
  store.del(pendingRefund(id));
}

/**
 * Returns the buyer's unused pledges to their wallet. The wallet signs the refund; the
 * server only broadcasts it. Resumable: a refund broadcast earlier is just internalized.
 */
export async function refundPledges(id) {
  const pending = store.get(pendingRefund(id));
  if (pending) return internalizeRefund(id, JSON.parse(pending));

  const r = await request(`/api/bids/${id}/refund`);
  const wallet = getWallet();
  const { publicKey: me } = await wallet.getPublicKey({ identityKey: true });
  const pledges = r.pledges.map((p) => ({ tx: Transaction.fromAtomicBEEF(Utils.toArray(p.beef, 'hex')), vout: p.vout, keyID: p.keyID }));
  const first = `${r.pledges[0].txid}:${r.pledges[0].vout}`;
  const prefix = b64(`refund ${id}`);
  const suffix = b64(first);
  const total = r.pledges.reduce((sum, p) => sum + p.satoshis, 0);
  const tx = buildTransaction(
    [{ lockingScript: await paymentLockingScript(me, prefix, suffix), satoshis: total - r.fee }],
    pledges,
  );
  for (let i = 0; i < pledges.length; i++) {
    tx.inputs[i].unlockingScript = await signWithPledgeKey(wallet, pledges[i].keyID, tx, i, REFUND_SCOPE);
  }
  const refund = { beef: hex(tx.toAtomicBEEF()), prefix, suffix };
  await request(`/api/bids/${id}/refund`, { beef: refund.beef });
  // Broadcast: from here on the money is at the wallet's key, it only needs adding to the balance.
  store.set(pendingRefund(id), JSON.stringify(refund));
  return internalizeRefund(id, refund);
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
 * Does the seller's pending work: takes group payments into the wallet (internalizeAction)
 * and wraps the data key for each buyer of an offer whose payment the network has seen.
 * `notify(message, kind)` reports progress.
 */
export async function runSellerTasks(notify = () => {}) {
  const { tasks } = await request('/api/seller/tasks');
  if (tasks.length === 0) return;
  const wallet = getWallet();
  for (const t of tasks) {
    const claimId = `claim:${t.offerId}`;
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
        await request(`/api/offers/${t.offerId}/claimed`, {});
        notify(`Received ${t.amount.toLocaleString()} sats for “${t.offerName}”`, 'success');
      } catch (e) {
        if (/already/i.test(e.message)) {
          await request(`/api/offers/${t.offerId}/claimed`, {}).catch(() => {});
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
