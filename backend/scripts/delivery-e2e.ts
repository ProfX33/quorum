// End-to-end check of listing → settlement → group payment → delivery → decryption, with
// agents (ProtoWallet) against a running backend. The backend must use a mock Arcade and
// WhatsOnChain (started here), so nothing reaches the real network:
//   createdb app_test
//   ARCADE_URL=http://localhost:4199 WOC_URL=http://localhost:4199/woc \
//     DELIVERY_GRACE_HOURS=0.002 DATABASE_URL=postgres://app:app@localhost:5432/app_test PORT=4100 bun src/index.ts
//   API_URL=http://localhost:4100 bun scripts/delivery-e2e.ts
// It also serves as a reference for how an agent talks to the API.
import { MerklePath, P2PKH, PrivateKey, ProtoWallet, Transaction, Utils, LockingScript } from "@bsv/sdk";
import { AUTH_KEY_ID, AUTH_PROTOCOL } from "../src/auth.ts";
import { PLEDGE_FEE, paymentLockingScript, pledgeLockingScript, refundTransaction, signPledge } from "../src/payments.ts";

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

/** Lists an offer. */
async function list(name: string, seconds = 3) {
  const offer = await seller.call("/api/offers", {
    body: { ...listing, name, sellerKeyWrap: Utils.toHex(sellerKeyWrap), deadline: new Date(Date.now() + seconds * 1000).toISOString() },
  });
  return offer.id as string;
}

/** Lists an offer, has the buyers bid and pledge their maximum, and waits for settlement. */
async function sale(name: string, bids: [Agent, number][]) {
  const id = await list(name, 1 + bids.length);
  const pledges = [];
  for (const [b, maxPrice] of bids) {
    const bid = await b.call(`/api/offers/${id}/bid`, { body: { maxPrice } });
    pledges.push(await pledge(b, bid.id));
  }
  const settled = await waitFor(bids[0]![0], id, (o) => o.status !== "open");
  return { id, settled, pledges };
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
async function fund(lockingScript: string, values: number[]) {
  const funding = PrivateKey.fromRandom();
  const parent = new Transaction();
  parent.addOutput({ lockingScript: new P2PKH().lock(funding.toPublicKey().toHash()), satoshis: 50_000 });
  parent.merklePath = new MerklePath(1, [[{ offset: 0, hash: parent.id("hex"), txid: true }]]);
  const tx = new Transaction();
  tx.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(funding) });
  for (const satoshis of values) tx.addOutput({ lockingScript: LockingScript.fromHex(lockingScript), satoshis });
  const total = values.reduce((sum, v) => sum + v, 0);
  tx.addOutput({ lockingScript: new P2PKH().lock(funding.toPublicKey().toHash()), satoshis: 49_000 - total });
  await tx.sign();
  pledgeTxids.add(tx.id("hex"));
  return tx;
}

const signAll = (b: Agent, keyID: string, outputs: any, tx: Transaction, vouts: number[]) =>
  Promise.all(vouts.map(async (vout) => ({ vout, unlockingScript: await signPledge(b.wallet, keyID, outputs, tx, vout) })));

/** The buyer's side of a pledge: check the group outputs, lock the maximum, sign each output for the group. */
async function pledge(b: Agent, bidId: string) {
  const req = await b.call(`/api/bids/${bidId}/payment`);
  if (req.error) return req;
  // Never sign for outputs that do not pay the full price to the seller.
  const sellerScript = await paymentLockingScript(req.seller, req.derivationPrefix, req.derivationSuffix);
  if (req.groupOutputs[0].lockingScript !== sellerScript || req.groupOutputs[0].satoshis !== req.price) {
    throw new Error("The group payment does not pay the seller the price");
  }
  const tx = await fund(await pledgeLockingScript(b.wallet, req.keyID), req.outputs);
  const pledges = await signAll(b, req.keyID, req.groupOutputs, tx, req.outputs.map((_: number, i: number) => i));
  const body = { beef: Utils.toHex(tx.toAtomicBEEF()), pledges, keyID: req.keyID };
  return { ...(await b.call(`/api/bids/${bidId}/payment`, { body })), tx, body };
}

/** Takes back everything refundable and returns the refund transaction. */
async function refund(b: Agent, bidId: string) {
  const r = await b.call(`/api/bids/${bidId}/refund`);
  const to = await paymentLockingScript(b.identityKey, "cmVmdW5k", "dGVzdA==");
  const pledges = r.pledges.map((p: any) => ({ tx: Transaction.fromAtomicBEEF(Utils.toArray(p.beef, "hex")), vout: p.vout, keyID: p.keyID }));
  const tx = await refundTransaction(b.wallet, pledges, to, r.fee);
  return { tx, ...(await b.call(`/api/bids/${bidId}/refund`, { body: { beef: Utils.toHex(tx.toAtomicBEEF()) } })) };
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

// ---------- 1. both buyers pledge up front: paid at the deadline with nobody acting ----------
console.log("\n# group pays in full");
{
  const id = await list("e2e group", 4);
  const before = await alice.call(`/api/offers/${id}/bid`, { body: { maxPrice: 600 } });
  const bobBid = await bob.call(`/api/offers/${id}/bid`, { body: { maxPrice: 700 } });
  assert((await alice.call(`/api/offers/${id}`)).offer.bidCount === 0, "a bid does not count until it is pledged");

  const badRequest = await alice.call(`/api/bids/${before.id}/payment`);
  assert(badRequest.due === 600 && badRequest.outputs.length === 10, "the maximum is pledged in denominations");
  const script = await pledgeLockingScript(alice.wallet, badRequest.keyID);
  const lump = await fund(script, [600 + PLEDGE_FEE]);
  assert((await alice.call(`/api/bids/${before.id}/payment`, { body: {
    beef: Utils.toHex(lump.toAtomicBEEF()), keyID: badRequest.keyID,
    pledges: await signAll(alice, badRequest.keyID, badRequest.groupOutputs, lump, [0]),
  } })).status === 400, "a lump sum, which would burn the excess, is refused");
  const stray = await fund(script, [1 + PLEDGE_FEE]);
  const wrongOutputs = [{ ...badRequest.groupOutputs[0], satoshis: 1 }, badRequest.groupOutputs[1]];
  assert((await alice.call(`/api/bids/${before.id}/payment`, { body: {
    beef: Utils.toHex(stray.toAtomicBEEF()), keyID: badRequest.keyID,
    pledges: await signAll(alice, badRequest.keyID, wrongOutputs, stray, [0]),
  } })).status === 400, "a pledge signed for other outputs is refused");

  const first = await pledge(alice, before.id);
  assert(first.status === "open" && first.pledged === 600, "alice has pledged her maximum");
  assert((await alice.call(`/api/bids/${before.id}/payment`, { body: first.body })).pledged === 600, "re-submitting a pledge is idempotent");
  assert((await alice.call(`/api/bids/${before.id}/payment`)).status === 409, "there is nothing more to pledge");
  assert((await bob.call(`/api/bids/${before.id}/payment`, { body: first.body })).status === 404, "nobody else can submit it");
  assert((await alice.call(`/api/bids/${before.id}/refund`)).status === 409, "alice cannot take her pledge back while it backs her bid");
  const half = (await alice.call(`/api/offers/${id}`)).offer;
  assert(half.bidCount === 1 && half.myBid.pledged === 600, "her bid counts now");
  assert(!(await claimOf(id)), "the seller gets nothing to claim yet");
  assert((await alice.call(`/api/bids/${before.id}/delivery`)).status === 409, "and alice gets no key");
  assert((await pledge(bob, bobBid.id)).pledged === 700, "bob pledges his maximum");

  const paid = await waitFor(alice, id, (o) => o.myBid.paymentSeen);
  assert(paid.status === "sold" && paid.myBid.status === "paid" && paid.myBid.amount === 500 && paid.groupPayment.seen,
    "after the deadline the group payment is on the network, and nobody signed anything");
  assert(paid.myBid.refundable === 100 + 3 * PLEDGE_FEE && paid.myBid.refundFee === 3 * PLEDGE_FEE, "what alice's share did not need stays hers");
  const exposure = await alice.call("/api/exposure");
  assert(exposure.bids.some((b: any) => b.bidId === before.id && b.refundable === paid.myBid.refundable && b.locked === 0),
    "and her exposure lists it as refundable");

  const claim = await claimOf(id);
  const tx = groupPayment(claim);
  assert(claim.amount === 1000 && tx.outputs[claim.claim.outputIndex]!.satoshis === 1000, "one transaction pays the seller the full price");
  assert(tx.getFee() === tx.inputs.length * PLEDGE_FEE, "only the fee contributions reach the miners, not the excess");
  assert(tx.id("hex") === paid.groupPayment.txid, "the claim is the broadcast group payment");
  assert((await seller.call(`/api/offers/${id}/claimed`, { body: {} })).ok, "group payment claimed once");
  assert(!(await claimOf(id)), "nothing left to claim");
  const back = await refund(alice, before.id);
  assert(back.tx.outputs[0]!.satoshis === 100, "alice takes the rest of her maximum back");

  const deliveries = (await seller.call("/api/seller/tasks")).tasks.filter((t: any) => t.deliver && t.offerId === id);
  assert(deliveries.length === 2, "a delivery task per buyer");
  for (const t of deliveries) assert((await deliver(t)).ok, "key delivered");
  assert((await decrypt(alice, before.id, id)) === new TextDecoder().decode(plaintext), "alice decrypts the original data");
  assert((await decrypt(bob, bobBid.id, id)) === new TextDecoder().decode(plaintext), "bob decrypts the original data");

  // A failed decryption sends the bid back to the seller for another delivery.
  assert((await alice.call(`/api/bids/${before.id}/receipt`, { body: { ok: false, reason: "test" } })).status === "paid", "failure asks for redelivery");
  const again = (await seller.call("/api/seller/tasks")).tasks.find((t: any) => t.bidId === before.id);
  assert(again?.deliver && !(await claimOf(id)), "redelivery task, payment not claimed twice");
  assert((await deliver(again)).ok, "key delivered again");
  assert((await alice.call(`/api/bids/${before.id}/receipt`, { body: { ok: true } })).status === "received", "alice confirms receipt");
  assert((await seller.call(`/api/offers/${id}`)).offer.sales?.received === 1, "seller sees the completed sale");
  assert((await alice.call(`/api/bids/${before.id}/report`, { body: { reason: "too late" } })).status === 409, "a confirmed sale cannot be reported");
}

// ---------- 2. a troll bids high and never pays: it changes nothing ----------
console.log("\n# a bid without money");
{
  const id = await list("e2e troll", 3);
  const troll = await bob.call(`/api/offers/${id}/bid`, { body: { maxPrice: 100_000 } });
  const honest = await alice.call(`/api/offers/${id}/bid`, { body: { maxPrice: 1000 } });
  await pledge(alice, honest.id);
  const paid = await waitFor(alice, id, (o) => o.myBid.paymentSeen);
  assert(paid.myBid.amount === 1000 && paid.myBid.status === "paid", "the unfunded bid is ignored and alice pays without waiting for anyone");
  assert((await bob.call(`/api/offers/${id}`)).offer.myBid.status === "lost", "the troll is out");
  assert((await bob.call(`/api/bids/${troll.id}/payment`)).status === 409, "and it is too late to pledge");
}

// ---------- 3. nobody can cover the price: the offer fails and alice takes her pledge back ----------
console.log("\n# the group fails");
{
  const { id, settled, pledges: [p] } = await sale("e2e fail", [[alice, 300], [bob, 300]]);
  const a = settled.myBid;
  assert(p.pledged === 300, "alice pledged her maximum");
  assert(settled.status === "unsold" && a.status === "lost", "the group cannot afford the price: the offer fails");
  assert(a.refundable === 300 + p.body.pledges.length * PLEDGE_FEE && !(await claimOf(id)), "the seller gets nothing and alice can take back her pledge");

  const partial = await alice.call(`/api/bids/${a.id}/refund`);
  assert(partial.pledges?.length === p.body.pledges.length, "refund lists all her outputs");
  const to = await paymentLockingScript(alice.identityKey, "cmVmdW5k", "dGVzdA==");
  const pledges = partial.pledges.map((r: any) => ({ tx: Transaction.fromAtomicBEEF(Utils.toArray(r.beef, "hex")), vout: r.vout, keyID: r.keyID }));
  const someoneElse = await refundTransaction(bob.wallet, pledges, to, partial.fee);
  assert((await alice.call(`/api/bids/${a.id}/refund`, { body: { beef: Utils.toHex(someoneElse.toAtomicBEEF()) } })).status === 400,
    "a refund not signed by the pledge key is refused");
  const subset = await refundTransaction(alice.wallet, pledges.slice(0, 2), to, 2 * PLEDGE_FEE);
  assert((await alice.call(`/api/bids/${a.id}/refund`, { body: { beef: Utils.toHex(subset.toAtomicBEEF()) } })).status === 400,
    "a refund must take back all of it");
  const tx = await refundTransaction(alice.wallet, pledges, to, partial.fee);
  assert(tx.outputs[0]!.satoshis === 300, "refund returns the pledge less the fee");
  const done = await alice.call(`/api/bids/${a.id}/refund`, { body: { beef: Utils.toHex(tx.toAtomicBEEF()) } });
  assert(done.txid === tx.id("hex"), "refund broadcast");
  assert((await alice.call(`/api/bids/${a.id}/refund`, { body: { beef: Utils.toHex(tx.toAtomicBEEF()) } })).txid === done.txid, "re-submitting is idempotent");
  assert((await alice.call(`/api/offers/${id}`)).offer.myBid.refundable === 0, "nothing left to refund");
}

// ---------- 4. alice double-spends her pledge: she is dropped, bob pays without doing anything ----------
console.log("\n# a pledge is spent elsewhere");
{
  rejectGroups = true;
  const { id, settled, pledges: [p] } = await sale("e2e reject", [[alice, 1500], [bob, 1500]]);
  const a = settled.myBid;
  const unseen = await waitFor(bob, id, (o) => o.myBid.status === "paid");
  assert(unseen.myBid.refundable === 0 && (await bob.call(`/api/bids/${unseen.myBid.id}/refund`)).status === 409,
    "what his share does not need stays held while the network has not seen the payment");
  assert((await bob.call("/api/exposure")).bids.some((x: any) => x.bidId === unseen.myBid.id && x.locked > 0 && x.refundable === 0),
    "and it shows as locked");
  for (const { vout } of p.body.pledges) spent.set(`${p.tx.id("hex")}:${vout}`, "ff".repeat(32));
  const undone = await waitFor(alice, id, (o) => o.myBid.status === "defaulted");
  assert(undone.myBid.status === "defaulted" && !undone.myBid.paymentSeen, "the rejected payment is undone and alice is out");
  rejectGroups = false;
  const paid = await waitFor(bob, id, (o) => o.myBid.paymentSeen);
  assert(paid.myBid.status === "paid" && paid.myBid.amount === 1000, "bob is regrouped at once and his pledge pays the whole price, unsigned by him");
  const claim = await claimOf(id);
  assert(claim && groupPayment(claim).outputs[0]!.satoshis === 1000, "the seller still gets the full price");
  const left = await alice.call(`/api/bids/${a.id}/refund`);
  const usedOnes = new Set(groupPayment(claim).inputs.map((i) => `${i.sourceTXID ?? i.sourceTransaction?.id("hex")}:${i.sourceOutputIndex}`));
  assert(left.pledges.every((r: any) => !usedOnes.has(`${r.txid}:${r.vout}`)) && left.pledges.length < p.body.pledges.length,
    "only outputs of hers that were never part of a payment are still listed");
}

// ---------- reporting a data product ----------
console.log("\n# reporting a data product");
{
  const { id, settled } = await sale("e2e report", [[alice, 500], [bob, 500]]);
  const a = settled.myBid.id;
  await waitFor(alice, id, (o) => o.myBid.paymentSeen);
  const b = (await bob.call(`/api/offers/${id}`)).offer.myBid;
  const report = (who: Agent, bidId: string) => who.call(`/api/bids/${bidId}/report`, { body: { reason: "not what was described" } });
  const reputation = async () => (await seller.call(`/api/offers/${id}`)).offer.sellerReputation;
  const task = async (who: Agent) =>
    (await seller.call("/api/seller/tasks")).tasks.find((t: any) => t.deliver && t.offerId === id && t.buyer === who.identityKey);

  assert(b.reportFrom && (await report(bob, b.id)).status === 409, "an offline seller gets time to deliver first");
  await deliver(await task(alice));
  assert((await decrypt(alice, a, id)) === new TextDecoder().decode(plaintext), "alice decrypts the data");
  assert((await alice.call(`/api/offers/${id}`)).offer.myBid.status === "delivered", "decrypting does not confirm receipt");

  const before = await reputation();
  assert((await alice.call(`/api/bids/${a}/report`, { body: { reason: "  " } })).status === 400, "a report needs a reason");
  assert((await report(bob, a)).status === 404, "nobody else can report her bid");
  assert((await report(alice, a)).status === "disputed", "she reports the data after looking at it");
  assert((await reputation()) === Math.floor(before / 2), "the seller's reputation halves");
  assert((await report(alice, a)).status === 409, "reporting twice is refused");
  assert((await alice.call(`/api/bids/${a}/receipt`, { body: { ok: true } })).status === 409, "a report cannot be turned into a confirmation");
  assert((await decrypt(alice, a, id)) === new TextDecoder().decode(plaintext), "she can still download what she paid for");

  await sleep(8000);
  assert((await report(bob, b.id)).status === "disputed", "after the grace period bob reports the missing key");
  assert((await reputation()) === Math.floor(before / 2), "one offer costs the seller once");
  assert(!(await task(alice)) && (await deliver(await task(bob))).ok, "the seller can still deliver to bob");
  const late = (await bob.call(`/api/offers/${id}`)).offer.myBid;
  assert(late.status === "disputed" && late.hasKey, "the bid stays disputed");
  assert((await decrypt(bob, b.id, id)) === new TextDecoder().decode(plaintext), "and bob gets his data");
  assert(!(await task(bob)), "nothing left to deliver");
}

// ---------- 5. changing your mind before the deadline ----------
console.log("\n# withdrawing");
{
  const id = await list("e2e withdraw", 6);
  const a = await alice.call(`/api/offers/${id}/bid`, { body: { maxPrice: 400 } });
  await pledge(alice, a.id);
  await alice.call(`/api/offers/${id}/bid`, { body: { maxPrice: 1000 } });
  const topUp = await pledge(alice, a.id);
  assert(topUp.pledged === 1000, "raising the maximum pledges the difference");
  assert((await alice.call(`/api/offers/${id}/bid`, { method: "DELETE" })).ok, "alice withdraws");
  const out = (await alice.call(`/api/offers/${id}`)).offer;
  assert(out.bidCount === 0 && out.myBid.status === "lost" && out.myBid.refundable > 1000, "her bid no longer counts and her pledge is refundable");
  assert((await alice.call(`/api/offers/${id}/bid`, { body: { maxPrice: 1000 } })).id === a.id, "she can come back");
  const paid = await waitFor(alice, id, (o) => o.myBid.paymentSeen);
  assert(paid.myBid.amount === 1000, "and two pledges together pay the exact share");

  const pulled = await list("e2e pulled", 30);
  const b = await bob.call(`/api/offers/${pulled}/bid`, { body: { maxPrice: 200 } });
  const unfunded = await alice.call(`/api/offers/${pulled}/bid`, { body: { maxPrice: 200 } });
  await pledge(bob, b.id);
  assert((await seller.call(`/api/offers/${pulled}`, { method: "DELETE" })).ok, "the seller withdraws a funded offer");
  const gone = (await bob.call(`/api/offers/${pulled}`)).offer;
  assert(gone.status === "unsold" && gone.myBid.status === "lost", "it stays on record");
  assert((await refund(bob, b.id)).tx.outputs[0]!.satoshis === 200, "bob takes his pledge back");
  assert((await alice.call(`/api/bids/${unfunded.id}/payment`)).status === 409, "and nobody can pledge to it any more");
}

console.log("\nAll delivery checks passed.");
process.exit(0);
