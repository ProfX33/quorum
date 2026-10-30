import { P2PKH, PrivateKey, ProtoWallet, PublicKey, Script, Transaction, Utils } from "@bsv/sdk";

// Payments are BRC-29 payments with the public "anyone" key (private key 1) as sender.
// Anybody, this server included, can then derive the seller's payment key from the
// seller's identity key alone, so the server can check that a payment really goes to the
// seller, and the seller's wallet claims it with internalizeAction ("wallet payment").
export const BRC29_PROTOCOL: [2, string] = [2, "3241645161d8"];
export const ANYONE_KEY = new PrivateKey(1).toPublicKey().toString();
const anyone = new ProtoWallet("anyone");

export const NETWORK = process.env.BSV_NETWORK === "test" ? "test" : "main";
const ARCADE_URL = (process.env.ARCADE_URL ?? "https://arcade-v2-us-1.bsvblockchain.tech").replace(/\/+$/, "");
const TAG = "tum-datamarket";

export const txUrl = (txid: string) =>
  `https://${NETWORK === "test" ? "test." : ""}whatsonchain.com/tx/${txid}`;

/** Random BRC-29 derivation prefix or suffix. */
export const derivationNonce = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");

/** P2PKH locking script (hex) of the seller's key for one payment. */
export async function paymentLockingScript(sellerKey: string, prefix: string, suffix: string) {
  const { publicKey } = await anyone.getPublicKey({
    protocolID: BRC29_PROTOCOL,
    keyID: `${prefix} ${suffix}`,
    counterparty: sellerKey,
  });
  return new P2PKH().lock(PublicKey.fromString(publicKey).toHash()).toHex();
}

/** OP_RETURN output that tags a payment with the offer and bid, for on-chain audit. */
export function tagLockingScript(offerId: string, bidId: string) {
  const push = (s: string) => Utils.toHex(Utils.toArray(s, "utf8"));
  return Script.fromASM(`OP_FALSE OP_RETURN ${push(TAG)} ${push(offerId)} ${push(bidId)}`).toHex();
}

/**
 * Checks a payment the buyer's wallet produced (AtomicBEEF): it must pay at least `amount`
 * to `lockingScript`, and all its inputs must be validly signed against the parent
 * transactions carried in the BEEF. Whether the inputs are still unspent is up to the
 * network; see broadcast / networkStatus.
 */
export async function parsePayment(beef: number[], lockingScript: string, amount: number) {
  let tx: Transaction;
  try {
    tx = Transaction.fromAtomicBEEF(beef);
  } catch {
    return { error: "Payment is not a valid AtomicBEEF transaction" };
  }
  const vout = tx.outputs.findIndex(
    (o) => o.lockingScript.toHex() === lockingScript && (o.satoshis ?? 0) >= amount,
  );
  if (vout < 0) return { error: `The transaction does not pay ${amount} sats to the seller's payment address` };
  // The wallet has usually broadcast the payment already, so only a definite script
  // failure rejects it here. If the BEEF is merely incomplete for a local check, the
  // network decides: nothing is delivered before it has seen the transaction.
  try {
    if (!(await tx.verify("scripts only"))) return { error: "The transaction's signatures do not verify" };
  } catch (e) {
    const message = (e as Error).message;
    if (/script evaluation/i.test(message)) return { error: `The transaction does not verify: ${message}` };
    console.warn(`Payment ${tx.id("hex")} not verifiable locally, leaving it to the network: ${message}`);
  }
  return { tx, txid: tx.id("hex"), vout };
}

export type NetworkState = { state: "accepted" | "seen" | "rejected" | "unknown"; reason?: string };

const SEEN = ["SEEN_ON_NETWORK", "SEEN_MULTIPLE_NODES", "MINED", "IMMUTABLE"];

const toState = (txStatus: unknown, reason?: string): NetworkState =>
  SEEN.includes(String(txStatus)) ? { state: "seen" }
  : txStatus === "REJECTED" || String(txStatus).includes("DOUBLE_SPEND") ? { state: "rejected", reason }
  : { state: "accepted" };

/**
 * Submits the transaction to Arcade. Re-submitting a known transaction is harmless.
 * Throws when Arcade cannot be reached or is overloaded, so the caller can retry.
 */
export async function broadcast(tx: Transaction): Promise<NetworkState> {
  let body: Uint8Array;
  try {
    body = Uint8Array.from(tx.toEF());
  } catch {
    body = Uint8Array.from(tx.toBinary());
  }
  const res = await fetch(`${ARCADE_URL}/tx`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (res.status === 400) return { state: "rejected", reason: String(data.reason ?? data.error ?? "rejected") };
  if (!res.ok) throw new Error(`Arcade answered ${res.status}`);
  return toState(data.txStatus, data.reason);
}

/** Asks Arcade how far the transaction got. Throws when Arcade cannot be reached. */
export async function networkStatus(txid: string): Promise<NetworkState> {
  const res = await fetch(`${ARCADE_URL}/tx/${txid}`, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return { state: "unknown" };
  if (!res.ok) throw new Error(`Arcade answered ${res.status}`);
  const data: any = await res.json().catch(() => ({}));
  return toState(data.txStatus ?? data.status, data.reason ?? data.extraInfo);
}
