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
// The payment group pays the seller in one transaction: each buyer pledges their maximum
// when bidding and signs it for that transaction only (see backend/src/payments.ts), so
// nobody has to act after the deadline. Once the network has seen it, the seller's wallet unwraps the key and wraps it again for each buyer (BRC-2,
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

const WALLET_DESCRIPTION_BYTES = 50;

/** How an action is listed in the wallet, e.g. "Quorum pledge: Air quality". Wallets refuse over 50 bytes. */
export function walletDescription(action, offerName) {
  const encoder = new TextEncoder();
  const full = (offerName ? `${action}: ${offerName}` : action).replace(/\s+/g, ' ').trim();
  if (encoder.encode(full).length <= WALLET_DESCRIPTION_BYTES) return full;
  let cut = '';
  for (const char of full) {
    if (encoder.encode(`${cut}${char}…`).length > WALLET_DESCRIPTION_BYTES) break;
    cut += char;
  }
  return `${cut.trimEnd()}…`;
}

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
 * Pledges the unpledged rest of the buyer's maximum: the wallet moves it to a key of its own,
 * in one output per denomination, then signs each for the group payment only. Nothing
 * reaches the seller unless the group covers the price, and what the share does not need
 * stays the buyer's.
 */
export async function payForBid(bidId, maxPrice, onStep = () => {}) {
  if (hasPendingPayment(bidId)) {
    onStep('Registering your earlier pledge…');
    // That pledge may have been for a lower maximum, so the rest can still be due.
    const result = await resumePayment(bidId);
    if (result.status !== 'open' || result.pledged >= maxPrice) return result;
  }
  const req = await request(`/api/bids/${bidId}/payment`);
  // Never lock more than the buyer agreed to bid.
  const credit = req.outputs.reduce((sum, satoshis) => sum + satoshis - req.fee, 0);
  if (credit + req.pledged > maxPrice) throw new Error('The server asked for more than your maximum. Not signing it.');
  // Never sign for a payment that does not give the seller the full price.
  const [toSeller, tag] = req.groupOutputs;
  if (req.groupOutputs.length !== 2 || tag.satoshis !== 0 || toSeller.satoshis !== req.price
    || toSeller.lockingScript !== (await paymentLockingScript(req.seller, req.derivationPrefix, req.derivationSuffix))) {
    throw new Error('The group payment the server asked for does not pay the seller the price. Not signing it.');
  }

  onStep('Approve the pledge in your wallet…');
  const wallet = getWallet();
  const lockingScript = await pledgeLockingScript(wallet, req.keyID);
  const { tx } = await wallet.createAction({
    description: walletDescription('Quorum pledge', req.offerName),
    outputs: req.outputs.map((satoshis) => ({ lockingScript, satoshis, outputDescription: 'Pledge for a group purchase' })),
    labels: ['datamarket'],
  });
  if (!tx) throw new Error('The wallet did not return the signed transaction');
  const pledgeTx = Transaction.fromAtomicBEEF(tx);
  // The wallet may reorder the outputs.
  const vouts = pledgeTx.outputs.flatMap((o, i) => (o.lockingScript.toHex() === lockingScript ? [i] : []));
  if (vouts.length !== req.outputs.length) throw new Error('The wallet did not create the pledge outputs');

  const pledges = [];
  for (const vout of vouts) {
    onStep(`Signing in your wallet (${pledges.length + 1} of ${vouts.length})…`);
    const group = buildTransaction(req.groupOutputs, [{ tx: pledgeTx, vout }]);
    pledges.push({ vout, unlockingScript: (await signWithPledgeKey(wallet, req.keyID, group, 0, GROUP_SCOPE)).toHex() });
  }
  const pledge = { beef: hex(tx), pledges, keyID: req.keyID };
  store.set(pendingPayment(bidId), JSON.stringify(pledge));
  onStep('Registering your pledge…');
  return submitPledge(bidId, pledge);
}

// ---------- Buyer: take back unused pledges ----------

export const canRefund = (bid) => bid.refundable > 0 || store.get(pendingRefund(bid.id)) !== null;

const b64 = (s) => Utils.toBase64(Hash.sha256(Utils.toArray(s, 'utf8')).slice(0, 16));

/** The refund's wallet name; one saved before refunds kept their name looks up its offer. */
async function refundDescription(id, refund) {
  if (refund.description) return refund.description;
  const offers = await request('/api/bids').then((d) => d.offers, () => []);
  return walletDescription('Quorum refund', offers.find((o) => o.myBid?.id === id)?.name);
}

/** Adds a broadcast refund to the wallet's balance (a BRC-29 payment from "anyone" to itself). */
async function internalizeRefund(id, refund) {
  const description = await refundDescription(id, refund);
  try {
    await getWallet().internalizeAction({
      tx: Utils.toArray(refund.beef, 'hex'),
      outputs: [{
        outputIndex: 0,
        protocol: 'wallet payment',
        paymentRemittance: {
          derivationPrefix: refund.prefix, derivationSuffix: refund.suffix, senderIdentityKey: ANYONE_KEY,
        },
      }],
      description,
      labels: ['datamarket'],
    });
  } catch (e) {
    if (!/already/i.test(e.message)) throw e;
  }
  store.del(pendingRefund(id));
}

/** Signs a refund of everything the server lists as unused and keeps it until it is in the wallet. */
async function signRefund(id) {
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
  const refund = { beef: hex(tx.toAtomicBEEF()), prefix, suffix, description: walletDescription('Quorum refund', r.offerName) };
  store.set(pendingRefund(id), JSON.stringify(refund));
  return refund;
}

async function takeBack(id) {
  const pending = store.get(pendingRefund(id));
  const refund = pending ? JSON.parse(pending) : await signRefund(id);
  try {
    // Safe to repeat: a refund the server has broadcast already is just confirmed.
    await request(`/api/bids/${id}/refund`, { beef: refund.beef });
  } catch (e) {
    if ([400, 404, 409].includes(e.status)) store.del(pendingRefund(id));
    throw e;
  }
  return internalizeRefund(id, refund);
}

const refunding = new Map(); // bidId → the refund in progress

/**
 * Returns the buyer's unused pledges to their wallet. The wallet signs the refund; the
 * server only broadcasts it. Resumable, and a second call joins the one in progress.
 */
export function refundPledges(id) {
  if (!refunding.has(id)) refunding.set(id, takeBack(id).finally(() => refunding.delete(id)));
  return refunding.get(id);
}

// ---------- Buyer: refunds without being asked ----------

const REFUND_RETRY_MS = 600_000;
const refundFailedAt = new Map(); // bidId → time of the last failure

const pendingIds = (prefix) => {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  } catch {
    return [];
  }
};

/**
 * Registers pledges whose submission did not get through, whatever became of their bid, then
 * takes back what the buyer's bids no longer need, such as the part of a maximum above the
 * final share, and finishes refunds that were interrupted. A refused wallet prompt is not
 * repeated for a while. `notify(message, kind)` reports progress.
 */
export async function runBuyerTasks(notify = () => {}) {
  for (const id of pendingIds(pendingPayment(''))) {
    await resumePayment(id).catch((e) => console.warn('Pledge not registered yet', e));
  }
  const { bids } = await request('/api/exposure');
  const amounts = new Map(bids.filter((b) => b.refundable > 0).map((b) => [b.bidId, b.refundable - b.refundFee]));
  for (const id of new Set([...amounts.keys(), ...pendingIds(pendingRefund(''))])) {
    if (Date.now() - (refundFailedAt.get(id) ?? 0) < REFUND_RETRY_MS) continue;
    try {
      await refundPledges(id);
      const amount = amounts.get(id);
      notify(amount ? `${amount.toLocaleString()} sats of unused pledge are back in your wallet` : 'Your unused pledge is back in your wallet', 'success');
    } catch (e) {
      refundFailedAt.set(id, Date.now());
      notify(`Could not take back an unused pledge: ${e.message}`, 'error');
    }
  }
}

// ---------- Buyer: download ----------

const reportFailure = (bidId, reason) => request(`/api/bids/${bidId}/receipt`, { ok: false, reason });

/** Asks the seller to deliver the key again (when the wallet cannot unwrap it). */
export const requestRedelivery = (bidId, reason) => reportFailure(bidId, reason);

/**
 * Unwraps the key, downloads and checks the ciphertext, decrypts and saves the file. This does
 * not confirm receipt: only the buyer can tell whether the data is what they paid for.
 */
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
    const asked = await reportFailure(bidId, 'The delivered key does not decrypt the data').then(() => true, () => false);
    throw new Error(`The delivered key does not open the data.${asked ? ' The seller has been asked to deliver again.' : ''}`);
  }

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
          description: walletDescription('Quorum sale', t.offerName),
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
