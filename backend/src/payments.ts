import {
  Hash,
  LockingScript,
  P2PKH,
  PrivateKey,
  ProtoWallet,
  PublicKey,
  Script,
  Signature,
  Spend,
  Transaction,
  TransactionSignature,
  UnlockingScript,
  Utils,
} from "@bsv/sdk";
import { isComplete } from "./settlement.ts";

// Payments are BRC-29 payments with the public "anyone" key (private key 1) as sender.
// Anybody, this server included, can then derive the seller's payment key from the
// seller's identity key alone, so the server can check that a payment really goes to the
// seller, and the seller's wallet claims it with internalizeAction ("wallet payment").
export const BRC29_PROTOCOL: [2, string] = [2, "3241645161d8"];
export const ANYONE_KEY = new PrivateKey(1).toPublicKey().toString();
const anyone = new ProtoWallet("anyone");

/** Satoshis per kilobyte an agent's wallet pays miners. */
export const MINING_FEE_RATE = 100;

// A payment group pays in one transaction, so the seller is paid the full price or not at
// all (an assurance contract). A bid is paid for when it is placed: the buyer moves their
// maximum into pledge outputs locked to a key of their own wallet (PLEDGE_PROTOCOL,
// counterparty 'self'), split with denominations() so that any share can be spent exactly,
// and signs each output with ALL|ANYONECANPAY: the signature fixes the outputs (price to the
// seller, tag) but not the other inputs. Only when the pledges cover the price can the
// server combine them into a valid transaction, and nobody has to sign anything after the
// deadline. Until then every buyer still owns their pledges, so there is no custody, and
// outputs left out of the payment stay theirs.
export const PLEDGE_PROTOCOL: [2, string] = [2, "datamarket pledge"];
export const GROUP_SCOPE =
  TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_ANYONECANPAY | TransactionSignature.SIGHASH_FORKID;
/** What every pledge input carries for the mining fee on top of the buyer's share. */
export const PLEDGE_FEE = Number(process.env.PLEDGE_FEE_SATS ?? 30);
/** Estimated mining fee of the transaction creating `outputs` pledge outputs, for one input and change. */
export const pledgeMiningFee = (outputs: number) => Math.ceil(((10 + 148 + 34 * (outputs + 1)) * MINING_FEE_RATE) / 1000);
/** Enough denominations for any bid; a transaction claiming more is not one of ours. */
const MAX_PLEDGE_OUTPUTS = 64;

export const NETWORK = process.env.BSV_NETWORK === "test" ? "test" : "main";
const ARCADE_URL = (process.env.ARCADE_URL ?? "https://arcade-v2-us-1.bsvblockchain.tech").replace(/\/+$/, "");
const WOC_URL = (process.env.WOC_URL ?? `https://api.whatsonchain.com/v1/bsv/${NETWORK}`).replace(/\/+$/, "");
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

/** OP_RETURN output that tags a group payment with the offer, for on-chain audit. */
export function tagLockingScript(offerId: string) {
  const push = (s: string) => Utils.toHex(Utils.toArray(s, "utf8"));
  return Script.fromASM(`OP_FALSE OP_RETURN ${push(TAG)} ${push(offerId)}`).toHex();
}

export type GroupOutput = { lockingScript: string; satoshis: number };

/**
 * The outputs of an offer's group payment: the full price to the seller, then the tag.
 * They stay the same when the group changes, so pledges signed earlier remain valid.
 */
export async function groupOutputs(sellerKey: string, prefix: string, suffix: string, offerId: string, price: number) {
  return [
    { lockingScript: await paymentLockingScript(sellerKey, prefix, suffix), satoshis: price },
    { lockingScript: tagLockingScript(offerId), satoshis: 0 },
  ] satisfies GroupOutput[];
}

const FINAL = 0xffffffff;

/** A transaction with the group outputs and the given pledges as inputs. */
export function groupTransaction(
  outputs: GroupOutput[],
  inputs: { sourceTransaction: Transaction; vout: number; unlockingScript?: string }[],
) {
  const tx = new Transaction();
  for (const i of inputs) {
    tx.addInput({
      sourceTransaction: i.sourceTransaction,
      sourceOutputIndex: i.vout,
      sequence: FINAL,
      ...(i.unlockingScript ? { unlockingScript: UnlockingScript.fromHex(i.unlockingScript) } : {}),
    });
  }
  for (const o of outputs) tx.addOutput({ lockingScript: LockingScript.fromHex(o.lockingScript), satoshis: o.satoshis });
  return tx;
}

// ---------- Buyer side (the browser has the same code in frontend/src/delivery.js) ----------

type Signer = Pick<ProtoWallet, "getPublicKey" | "createSignature">;

/** P2PKH locking script (hex) of the buyer's pledge key `keyID`. */
export async function pledgeLockingScript(wallet: Signer, keyID: string) {
  const { publicKey } = await wallet.getPublicKey({ protocolID: PLEDGE_PROTOCOL, keyID, counterparty: "self" });
  return new P2PKH().lock(PublicKey.fromString(publicKey).toHash()).toHex();
}

/** P2PKH unlocking script (hex) for input `index` of `tx`, signed by the pledge key `keyID`. */
async function signWithPledgeKey(wallet: Signer, keyID: string, tx: Transaction, index: number, scope: number) {
  const input = tx.inputs[index]!;
  const source = input.sourceTransaction!.outputs[input.sourceOutputIndex]!;
  const preimage = TransactionSignature.format({
    sourceTXID: input.sourceTransaction!.id("hex"),
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: source.satoshis!,
    transactionVersion: tx.version,
    otherInputs: tx.inputs.filter((_, i) => i !== index),
    inputIndex: index,
    outputs: tx.outputs,
    inputSequence: input.sequence ?? FINAL,
    subscript: source.lockingScript,
    lockTime: tx.lockTime,
    scope,
  });
  const args = { protocolID: PLEDGE_PROTOCOL, keyID, counterparty: "self" as const };
  // A P2PKH signature is over hash256 of the preimage.
  const { signature } = await wallet.createSignature({ ...args, hashToDirectlySign: Hash.hash256(preimage) });
  const { publicKey } = await wallet.getPublicKey(args);
  const sig = Signature.fromDER(signature);
  const checksig = new TransactionSignature(sig.r, sig.s, scope).toChecksigFormat();
  const pubkey = PublicKey.fromString(publicKey).encode(true) as number[];
  return new UnlockingScript([
    { op: checksig.length, data: checksig },
    { op: pubkey.length, data: pubkey },
  ]).toHex();
}

/** Signs the buyer's pledge output for the group payment. Returns the unlocking script, hex. */
export const signPledge = (wallet: Signer, keyID: string, outputs: GroupOutput[], pledgeTx: Transaction, vout: number) =>
  signWithPledgeKey(wallet, keyID, groupTransaction(outputs, [{ sourceTransaction: pledgeTx, vout }]), 0, GROUP_SCOPE);

/** A transaction returning the pledges, less `fee`, to `lockingScript`, signed by the buyer. */
export async function refundTransaction(
  wallet: Signer,
  pledges: { tx: Transaction; vout: number; keyID: string }[],
  lockingScript: string,
  fee: number,
) {
  const total = pledges.reduce((sum, p) => sum + p.tx.outputs[p.vout]!.satoshis!, 0);
  const tx = groupTransaction([{ lockingScript, satoshis: total - fee }], pledges.map((p) => ({ sourceTransaction: p.tx, vout: p.vout })));
  const scripts = await Promise.all(pledges.map((p, i) =>
    signWithPledgeKey(wallet, p.keyID, tx, i, TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID)));
  scripts.forEach((s, i) => (tx.inputs[i]!.unlockingScript = UnlockingScript.fromHex(s)));
  return tx;
}

// ---------- Server side ----------

const isP2PKH = (script: LockingScript) => {
  const c = script.chunks;
  return c.length === 5 && c[0]!.op === 0x76 && c[1]!.op === 0xa9 && c[2]!.data?.length === 20 && c[3]!.op === 0x88 && c[4]!.op === 0xac;
};

/** Checks one output of a pledge; see parsePledge. */
function parsePledgeOutput(
  tx: Transaction, vout: unknown, unlockingScript: unknown, outputs: GroupOutput[],
): { error: string } | { vout: number; satoshis: number; unlockingScript: string } {
  if (typeof unlockingScript !== "string") return { error: "unlockingScript must be hex" };
  const output = Number.isInteger(vout) ? tx.outputs[vout as number] : undefined;
  if (!output || !isP2PKH(output.lockingScript)) return { error: "vout must point at the P2PKH pledge output" };
  const satoshis = output.satoshis ?? 0;
  if (satoshis <= PLEDGE_FEE) return { error: `A pledge must be more than the ${PLEDGE_FEE} sats fee contribution` };

  let unlock: UnlockingScript;
  try {
    unlock = UnlockingScript.fromHex(unlockingScript);
  } catch {
    return { error: "unlockingScript is not a script" };
  }
  const sig = unlock.chunks[0]?.data;
  if (unlock.chunks.length !== 2 || !sig || sig[sig.length - 1] !== GROUP_SCOPE) {
    return { error: "The pledge must be signed with SIGHASH_ALL | ANYONECANPAY | FORKID" };
  }
  const group = groupTransaction(outputs, [{ sourceTransaction: tx, vout: vout as number }]);
  try {
    const valid = new Spend({
      sourceTXID: tx.id("hex"),
      sourceOutputIndex: vout as number,
      sourceSatoshis: satoshis,
      lockingScript: output.lockingScript,
      transactionVersion: group.version,
      otherInputs: [],
      inputIndex: 0,
      unlockingScript: unlock,
      outputs: group.outputs,
      inputSequence: FINAL,
      lockTime: group.lockTime,
    }).validate();
    if (!valid) throw new Error("invalid");
  } catch {
    return { error: "The pledge signature does not unlock the pledge for this offer's group payment" };
  }
  return { vout: vout as number, satoshis, unlockingScript: unlock.toHex() };
}

/**
 * Checks a pledge: `beef` (AtomicBEEF) creates P2PKH outputs, and each entry of `pledges`
 * ({ vout, unlockingScript }) spends one with an ALL|ANYONECANPAY signature over the group
 * outputs, so the server can use it in the group payment, but only there. Together they
 * must be denominated, or some share could not be paid without burning the difference.
 */
export async function parsePledge(beef: number[], pledges: unknown, outputs: GroupOutput[]) {
  if (!Array.isArray(pledges) || pledges.length === 0 || pledges.length > MAX_PLEDGE_OUTPUTS) {
    return { error: `pledges must list 1 to ${MAX_PLEDGE_OUTPUTS} outputs` };
  }
  let tx: Transaction;
  try {
    tx = Transaction.fromAtomicBEEF(beef);
  } catch {
    return { error: "The pledge is not a valid AtomicBEEF transaction" };
  }
  const parsed = [];
  for (const p of pledges) {
    const output = parsePledgeOutput(tx, p?.vout, p?.unlockingScript, outputs);
    if ("error" in output) return output;
    parsed.push(output);
  }
  if (new Set(parsed.map((p) => p.vout)).size !== parsed.length) return { error: "A pledge lists an output twice" };
  if (!isComplete(parsed.map((p) => p.satoshis - PLEDGE_FEE))) {
    return { error: "A pledge must be split into the denominations the payment request gives" };
  }

  // The wallet has usually broadcast the pledge already, so only a definite script failure
  // rejects it here. If the BEEF is merely incomplete for a local check, the network decides.
  try {
    if (!(await tx.verify("scripts only"))) return { error: "The pledge transaction's signatures do not verify" };
  } catch (e) {
    const message = (e as Error).message;
    if (/script evaluation/i.test(message)) return { error: `The pledge transaction does not verify: ${message}` };
    console.warn(`Pledge ${tx.id("hex")} not verifiable locally, leaving it to the network: ${message}`);
  }
  return { tx, txid: tx.id("hex"), outputs: parsed };
}

/**
 * Checks a refund the buyer's wallet signed: it may only spend outpoints in `allowed`
 * (`txid:vout`), with valid signatures. Returns the outpoints it spends.
 */
export async function parseRefund(beef: number[], allowed: Set<string>) {
  let tx: Transaction;
  try {
    tx = Transaction.fromAtomicBEEF(beef);
  } catch {
    return { error: "The refund is not a valid AtomicBEEF transaction" };
  }
  const spends = tx.inputs.map((i) => `${i.sourceTXID ?? i.sourceTransaction?.id("hex")}:${i.sourceOutputIndex}`);
  if (spends.length === 0 || spends.some((s) => !allowed.has(s))) return { error: "A refund may only spend your refundable pledges" };
  try {
    if (!(await tx.verify("scripts only"))) return { error: "The refund's signatures do not verify" };
  } catch (e) {
    return { error: `The refund does not verify: ${(e as Error).message}` };
  }
  return { tx, txid: tx.id("hex"), spends };
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

/**
 * The txid that spent output `vout` of `txid`, or null while it is unspent (WhatsOnChain).
 * Throws when the service cannot be reached.
 */
export async function spentBy(txid: string, vout: number): Promise<string | null> {
  const res = await fetch(`${WOC_URL}/tx/${txid}/${vout}/spent`, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`WhatsOnChain answered ${res.status}`);
  const data: any = await res.json().catch(() => ({}));
  return typeof data.txid === "string" ? data.txid : null;
}
