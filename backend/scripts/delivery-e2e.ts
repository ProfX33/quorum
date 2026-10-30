// End-to-end check of listing → settlement → group payment → delivery → decryption, with
// agents (ProtoWallet) against a running backend. The backend must use a mock Arcade and
// WhatsOnChain (started here), so nothing reaches the real network, and a short window:
//   createdb app_test
//   ARCADE_URL=http://localhost:4199 WOC_URL=http://localhost:4199/woc PAYMENT_WINDOW_MINUTES=0.15 \
//     DATABASE_URL=postgres://app:app@localhost:5432/app_test PORT=4100 bun src/index.ts
//   API_URL=http://localhost:4100 bun scripts/delivery-e2e.ts
// It also serves as a reference for how an agent talks to the API.
import { MerklePath, P2PKH, PrivateKey, ProtoWallet, Transaction, Utils, LockingScript } from "@bsv/sdk";
import { AUTH_KEY_ID, AUTH_PROTOCOL } from "../src/auth.ts";
import { paymentLockingScript, pledgeLockingScript, refundTransaction, signPledge } from "../src/payments.ts";

const api = process.env.API_URL ?? "http://localhost:4100";
// Must match frontend/src/delivery.js
const KEY_PROTOCOL: [2, string] = [2, "datamarket data key"];

// ---------- mock Arcade and WhatsOnChain ----------
// Every transaction is seen at once, unless rejectGroups is set: then only pledges are
// accepted and everything else (the group payment) is rejected.
let rejectGroups = false;
const pledgeTxids = new Set<string>();
const spent = new Map<string, string>(); // "txid:vout" → spending txid
Bun.serve({
  port: 4199,
  routes: {
    "/tx": { POST: () => Response.json({ txStatus: rejectGroups ? "RECEIVED" : "SEEN_ON_NETWORK" }, { status: 202 }) },
    "/tx/:txid": (req) =>
      Response.json(rejectGroups && !pledgeTxids.has(req.params.txid)
        ? { txStatus: "REJECTED", extraInfo: "double spend" }
        : { txStatus: rejectGroups ? "RECEIVED" : "SEEN_ON_NETWORK" }),
    "/woc/tx/:txid/:vout/spent": (req) => {
      const by = spent.get(`${req.params.txid}:${req.params.vout}`);
      return by ? Response.json({ txid: by, vin: 0 }) : new Response("Not found", { status: 404 });
    },
  },
});

const assert = (cond: unknown, message: string) => {
  if (!cond) throw new Error("FAILED: " + message);
  console.log("ok -", message);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function agent() {
  const wallet = new ProtoWallet(PrivateKey.fromRandom());
  const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true });
  let token = "";
  const call = async (path: string, init: { method?: string; body?: unknown; raw?: Uint8Array } = {}) => {
    const res = await fetch(api + path, {
      method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": init.raw ? "application/octet-stream" : "application/json",
      },
      body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined),
    });
    const data: any = await res.json().catch(() => ({}));
    return { status: res.status, ...data };
  };
  const { nonce, message } = await call("/api/auth/challenge", { body: { identityKey } });
  const { signature } = await wallet.createSignature({
    data: Utils.toArray(message, "utf8"), protocolID: AUTH_PROTOCOL, keyID: AUTH_KEY_ID, counterparty: "anyone",
  });
  token = (await call("/api/auth/login", { body: { identityKey, nonce, signature: Utils.toHex(signature), kind: "agent" } })).token;
  return { wallet, identityKey, call };
}
type Agent = Awaited<ReturnType<typeof agent>>;

const seller = await agent();
const alice = await agent();
const bob = await agent();

// ---------- seller: encrypt, upload ----------
const plaintext = new TextEncoder().encode("temperature,23.5\nhumidity,40\n");
const key = crypto.getRandomValues(new Uint8Array(32));
const iv = crypto.getRandomValues(new Uint8Array(12));
const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
const ciphertext = new Uint8Array([...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, plaintext))]);
const dataHash = new Bun.CryptoHasher("sha256").update(ciphertext).digest("hex");

const upload = await seller.call("/api/data?name=sensors.csv", { raw: ciphertext });
assert(upload.dataHash === dataHash, "server computes the same commitment");

const { ciphertext: sellerKeyWrap } = await seller.wallet.encrypt({
  plaintext: Array.from(key), protocolID: KEY_PROTOCOL, keyID: dataHash, counterparty: "self",
});
const listing = { kind: "data", category: "iot", region: "munich", price: 1000, dataHash };
assert((await seller.call("/api/offers", { body: { ...listing, name: "e2e", deadline: new Date(Date.now() + 60_000).toISOString() } })).status === 400,
  "listing without sellerKeyWrap is refused");

/** Lists an offer, lets the buyers bid, and waits for settlement. */
async function sale(name: string, bids: [Agent, number][]) {
  const offer = await seller.call("/api/offers", {
    body: { ...listing, name, sellerKeyWrap: Utils.toHex(sellerKeyWrap), deadline: new Date(Date.now() + 3000).toISOString() },
  });
  for (const [b, maxPrice] of bids) await b.call(`/api/offers/${offer.id}/bid`, { body: { maxPrice } });
  const settled = await waitFor(bids[0]![0], offer.id, (o) => o.status !== "open");
  return { id: offer.id as string, settled };
}

async function waitFor(who: Agent, offerId: string, check: (o: any) => boolean, seconds = 40) {
  for (let i = 0; i < seconds; i++) {
    const o = (await who.call(`/api/offers/${offerId}`)).offer;
    if (check(o)) return o;
    await sleep(1000);
  }
  return (await who.call(`/api/offers/${offerId}`)).offer;
}

/** What a BRC-100 wallet's createAction would return; here funded from a made-up mined parent. */
async function fund(lockingScript: string, satoshis: number) {
  const funding = PrivateKey.fromRandom();
  const parent = new Transaction();
  parent.addOutput({ lockingScript: new P2PKH().lock(funding.toPublicKey().toHash()), satoshis: 50_000 });
  parent.merklePath = new MerklePath(1, [[{ offset: 0, hash: parent.id("hex"), txid: true }]]);
  const tx = new Transaction();
  tx.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(funding) });
  tx.addOutput({ lockingScript: LockingScript.fromHex(lockingScript), satoshis });
  tx.addOutput({ lockingScript: new P2PKH().lock(funding.toPublicKey().toHash()), satoshis: 49_000 - satoshis });
  await tx.sign();
  pledgeTxids.add(tx.id("hex"));
  return tx;
}

/** The buyer's side of a pledge: check the group outputs, lock the share, sign it for the group. */
async function pledge(b: Agent, bidId: string) {
  const req = await b.call(`/api/bids/${bidId}/payment`);
  if (req.error) return req;
  // Never sign for outputs that do not pay the full price to the seller.
  const sellerScript = await paymentLockingScript(req.seller, req.derivationPrefix, req.derivationSuffix);
  if (req.groupOutputs[0].lockingScript !== sellerScript || req.groupOutputs[0].satoshis !== req.price) {
    throw new Error("The group payment does not pay the seller the price");
  }
  const tx = await fund(await pledgeLockingScript(b.wallet, req.keyID), req.satoshis);
  const unlockingScript = await signPledge(b.wallet, req.keyID, req.groupOutputs, tx, 0);
  const body = { beef: Utils.toHex(tx.toAtomicBEEF()), vout: 0, unlockingScript, keyID: req.keyID };
  return { ...(await b.call(`/api/bids/${bidId}/payment`, { body })), tx, body };
}

async function deliver(t: any) {
  const { plaintext: k } = await seller.wallet.decrypt({
    ciphertext: Utils.toArray(t.deliver.sellerKeyWrap, "hex"), protocolID: KEY_PROTOCOL, keyID: t.deliver.dataHash, counterparty: "self",
  });
  const { ciphertext: wrapped } = await seller.wallet.encrypt({
    plaintext: k, protocolID: KEY_PROTOCOL, keyID: t.offerId, counterparty: t.buyer,
  });
  return seller.call(`/api/bids/${t.bidId}/delivery`, { body: { wrappedKey: Utils.toHex(wrapped) } });
}

async function decrypt(b: Agent, bidId: string, offerId: string) {
  const got = await b.call(`/api/bids/${bidId}/delivery`);
  const { plaintext: k } = await b.wallet.decrypt({
    ciphertext: Utils.toArray(got.wrappedKey, "hex"), protocolID: KEY_PROTOCOL, keyID: got.offerId, counterparty: got.seller,
  });
  const enc = new Uint8Array(await (await fetch(`${api}/api/offers/${offerId}/data`)).arrayBuffer());
  assert(new Bun.CryptoHasher("sha256").update(enc).digest("hex") === dataHash, "downloaded ciphertext matches the commitment");
  const aesBuyer = await crypto.subtle.importKey("raw", Uint8Array.from(k), "AES-GCM", false, ["decrypt"]);
  const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: enc.slice(0, 12) }, aesBuyer, enc.slice(12)));
  return new TextDecoder().decode(decrypted);
}

const claimOf = async (offerId: string) => (await seller.call("/api/seller/tasks")).tasks.find((t: any) => t.claim && t.offerId === offerId);
const groupPayment = (claim: any) => Transaction.fromAtomicBEEF(Utils.toArray(claim.claim.beef, "hex"));

// ---------- 1. both buyers pledge: one payment of the full price, both get the data ----------
console.log("\n# group pays in full");
{
  const { id, settled } = await sale("e2e group", [[alice, 1500], [bob, 1500]]);
  const a = settled.myBid;
  assert(settled.status === "sold" && a.status === "won" && a.amount === 500, "alice won and owes half the price");
  const b = (await bob.call(`/api/offers/${id}`)).offer.myBid;

  const badRequest = await alice.call(`/api/bids/${a.id}/payment`);
  const stray = await fund(await pledgeLockingScript(alice.wallet, badRequest.keyID), badRequest.satoshis);
  const wrongOutputs = [{ ...badRequest.groupOutputs[0], satoshis: 1 }, badRequest.groupOutputs[1]];
  assert((await alice.call(`/api/bids/${a.id}/payment`, { body: {
    beef: Utils.toHex(stray.toAtomicBEEF()), vout: 0, keyID: badRequest.keyID,
    unlockingScript: await signPledge(alice.wallet, badRequest.keyID, wrongOutputs, stray, 0),
  } })).status === 400, "a pledge signed for other outputs is refused");

  const first = await pledge(alice, a.id);
  assert(first.status === "pledged", "alice's pledge covers her share");
  assert((await alice.call(`/api/bids/${a.id}/payment`, { body: first.body })).status === "pledged", "re-submitting a pledge is idempotent");
  assert((await bob.call(`/api/bids/${a.id}/payment`, { body: first.body })).status === 404, "nobody else can submit it");
  const half = (await alice.call(`/api/offers/${id}`)).offer;
  assert(!half.groupPayment.txid && half.groupPayment.pledged === 1 && half.groupPayment.members === 2, "no payment while bob has not pledged");
  assert(!(await claimOf(id)), "the seller gets nothing to claim yet");
  assert((await alice.call(`/api/bids/${a.id}/delivery`)).status === 409, "and alice gets no key");
  assert((await alice.call(`/api/bids/${a.id}/refund`)).status === 409, "alice cannot take her pledge back while in the group");

  assert((await pledge(bob, b.id)).status === "paid", "bob's pledge completes the group payment");
  const paid = await waitFor(alice, id, (o) => o.myBid.paymentSeen);
  assert(paid.myBid.status === "paid" && paid.groupPayment.seen, "group payment seen on the network");

  const claim = await claimOf(id);
  const tx = groupPayment(claim);
  assert(claim.amount === 1000 && tx.outputs[claim.claim.outputIndex]!.satoshis === 1000 && tx.inputs.length === 2,
    "one transaction with both pledges pays the seller the full price");
  assert(tx.id("hex") === paid.groupPayment.txid, "the claim is the broadcast group payment");
  assert((await seller.call(`/api/offers/${id}/claimed`, { body: {} })).ok, "group payment claimed once");
  assert(!(await claimOf(id)), "nothing left to claim");

  const deliveries = (await seller.call("/api/seller/tasks")).tasks.filter((t: any) => t.deliver && t.offerId === id);
  assert(deliveries.length === 2, "a delivery task per buyer");
  for (const t of deliveries) assert((await deliver(t)).ok, "key delivered");
  assert((await decrypt(alice, a.id, id)) === new TextDecoder().decode(plaintext), "alice decrypts the original data");
  assert((await decrypt(bob, b.id, id)) === new TextDecoder().decode(plaintext), "bob decrypts the original data");

  // A failed decryption sends the bid back to the seller for another delivery.
  assert((await alice.call(`/api/bids/${a.id}/receipt`, { body: { ok: false, reason: "test" } })).status === "paid", "failure asks for redelivery");
  const again = (await seller.call("/api/seller/tasks")).tasks.find((t: any) => t.bidId === a.id);
  assert(again?.deliver && !(await claimOf(id)), "redelivery task, payment not claimed twice");
  assert((await deliver(again)).ok, "key delivered again");
  assert((await alice.call(`/api/bids/${a.id}/receipt`, { body: { ok: true } })).status === "received", "alice confirms receipt");
  assert((await seller.call(`/api/offers/${id}`)).offer.sales?.received === 1, "seller sees the completed sale");
}

// ---------- 2. bob never pledges: alice is regrouped, tops up, and pays the full price ----------
console.log("\n# a member defaults");
{
  const { id, settled } = await sale("e2e default", [[alice, 1500], [bob, 1500]]);
  const a = settled.myBid;
  assert((await pledge(alice, a.id)).status === "pledged", "alice pledges her half");
  const regrouped = await waitFor(alice, id, (o) => o.myBid.status === "won" && o.myBid.amount === 1000);
  assert(regrouped.myBid.status === "won" && regrouped.myBid.pledged === 500, "after the window alice owes the whole price, her pledge still counts");
  assert((await bob.call(`/api/offers/${id}`)).offer.myBid.status === "defaulted", "bob is dropped");
  assert((await bob.call(`/api/bids/${(await bob.call(`/api/offers/${id}`)).offer.myBid.id}/refund`)).status === 409, "bob has nothing to refund");
  const topUp = await pledge(alice, a.id);
  assert(topUp.status === "paid", "alice's top-up completes the payment");
  const claim = await claimOf(id);
  assert(claim && groupPayment(claim).outputs[0]!.satoshis === 1000 && groupPayment(claim).inputs.length === 2,
    "the seller still gets the full price, from both of alice's pledges");
}

// ---------- 3. nobody can cover the price: the offer fails and alice takes her pledge back ----------
console.log("\n# the group fails");
{
  const { id, settled } = await sale("e2e fail", [[alice, 600], [bob, 600]]);
  const a = settled.myBid;
  const p = await pledge(alice, a.id);
  assert(p.status === "pledged", "alice pledges her half");
  const failed = await waitFor(alice, id, (o) => o.status === "unsold");
  assert(failed.status === "unsold" && failed.myBid.status === "lost", "alone alice cannot afford the price: the offer fails");
  assert(failed.myBid.refundable === 530 && !(await claimOf(id)), "the seller gets nothing and alice can take back 530 sats");

  const refund = await alice.call(`/api/bids/${a.id}/refund`);
  assert(refund.pledges?.length === 1, "refund lists her pledge");
  const to = await paymentLockingScript(alice.identityKey, "cmVmdW5k", "dGVzdA==");
  const pledges = refund.pledges.map((r: any) => ({ tx: Transaction.fromAtomicBEEF(Utils.toArray(r.beef, "hex")), vout: r.vout, keyID: r.keyID }));
  const tx = await refundTransaction(alice.wallet, pledges, to, refund.fee);
  assert(tx.outputs[0]!.satoshis === 500, "refund returns the pledge less the fee");
  const someoneElse = await refundTransaction(bob.wallet, pledges, to, refund.fee);
  assert((await alice.call(`/api/bids/${a.id}/refund`, { body: { beef: Utils.toHex(someoneElse.toAtomicBEEF()) } })).status === 400,
    "a refund not signed by the pledge key is refused");
  const done = await alice.call(`/api/bids/${a.id}/refund`, { body: { beef: Utils.toHex(tx.toAtomicBEEF()) } });
  assert(done.txid === tx.id("hex"), "refund broadcast");
  assert((await alice.call(`/api/bids/${a.id}/refund`, { body: { beef: Utils.toHex(tx.toAtomicBEEF()) } })).txid === done.txid, "re-submitting is idempotent");
  assert((await alice.call(`/api/offers/${id}`)).offer.myBid.refundable === 0, "nothing left to refund");
}

// ---------- 4. alice double-spends her pledge: the payment is rejected, only alice must pledge again ----------
console.log("\n# a pledge is spent elsewhere");
{
  const { id, settled } = await sale("e2e reject", [[alice, 1500], [bob, 1500]]);
  const a = settled.myBid;
  const b = (await bob.call(`/api/offers/${id}`)).offer.myBid;
  rejectGroups = true;
  const p = await pledge(alice, a.id);
  spent.set(`${p.tx.id("hex")}:0`, "ff".repeat(32));
  assert((await pledge(bob, b.id)).status === "paid", "group payment built while the network has not decided");
  const undone = await waitFor(alice, id, (o) => o.myBid.status === "won");
  assert(undone.myBid.status === "won" && undone.myBid.pledged === 0 && /rejected/.test(undone.myBid.paymentError),
    "rejected payment is undone, alice's spent pledge no longer counts");
  assert((await bob.call(`/api/offers/${id}`)).offer.myBid.status === "pledged", "bob's pledge stays in place");
  assert(!(await claimOf(id)), "the seller gets no task for it");
  rejectGroups = false;
  assert((await pledge(alice, a.id)).status === "paid", "alice pledges again and the group pays");
  assert((await waitFor(bob, id, (o) => o.myBid.paymentSeen)).myBid.status === "paid", "group payment seen on the network");
}

console.log("\nAll delivery checks passed.");
process.exit(0);
