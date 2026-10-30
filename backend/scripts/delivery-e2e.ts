// End-to-end check of listing → settlement → payment → delivery → decryption, with two
// agents (ProtoWallet) against a running backend. The backend must use a mock Arcade
// (started here), so nothing reaches the real network:
//   createdb app_test
//   ARCADE_URL=http://localhost:4199 DATABASE_URL=postgres://app:app@localhost:5432/app_test PORT=4100 bun src/index.ts
//   API_URL=http://localhost:4100 bun scripts/delivery-e2e.ts
// It also serves as a reference for how an agent talks to the API.
import { LockingScript, MerklePath, P2PKH, PrivateKey, ProtoWallet, Transaction, Utils } from "@bsv/sdk";
import { AUTH_KEY_ID, AUTH_PROTOCOL } from "../src/auth.ts";

const api = process.env.API_URL ?? "http://localhost:4100";
// Must match frontend/src/delivery.js
const KEY_PROTOCOL: [2, string] = [2, "datamarket data key"];

// ---------- mock Arcade ----------
// "seen": every transaction is seen at once; "reject": accepted, then rejected (double spend).
let arcadeMode: "seen" | "reject" = "seen";
Bun.serve({
  port: 4199,
  routes: {
    "/tx": { POST: () => Response.json({ txStatus: arcadeMode === "seen" ? "SEEN_ON_NETWORK" : "RECEIVED" }, { status: 202 }) },
    "/tx/:txid": () => Response.json({ txStatus: arcadeMode === "seen" ? "SEEN_ON_NETWORK" : "REJECTED", extraInfo: "double spend" }),
  },
});

const assert = (cond: unknown, message: string) => {
  if (!cond) throw new Error("FAILED: " + message);
  console.log("ok -", message);
};

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

const seller = await agent();
const buyer = await agent();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- seller: encrypt, upload, list ----------
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
const listing = { kind: "data", category: "iot", region: "munich", name: "e2e sensors", price: 1000, dataHash };
assert((await seller.call("/api/offers", { body: { ...listing, deadline: new Date(Date.now() + 60_000).toISOString() } })).status === 400,
  "listing without sellerKeyWrap is refused");
const offer = await seller.call("/api/offers", {
  body: { ...listing, sellerKeyWrap: Utils.toHex(sellerKeyWrap), deadline: new Date(Date.now() + 3000).toISOString() },
});
assert(offer.id, "offer listed");
assert((await buyer.call(`/api/offers/${offer.id}/bid`, { body: { maxPrice: 1500 } })).id, "buyer bids");

// ---------- settlement ----------
let detail: any;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  detail = (await buyer.call(`/api/offers/${offer.id}`)).offer;
  if (detail.status !== "open") break;
}
assert(detail.status === "sold" && detail.myBid.status === "won" && detail.myBid.amount === 1000, "buyer won and owes 1000 sats");
const bidId = detail.myBid.id;

// ---------- buyer pays ----------
const request = await buyer.call(`/api/bids/${bidId}/payment`);
assert(request.outputs?.length === 2 && request.amount === 1000, "payment request lists seller output and tag");

/** What a BRC-100 wallet's createAction would return; here funded from a made-up mined parent. */
async function pay(outputs: { lockingScript: string; satoshis: number }[]) {
  const buyerKey = PrivateKey.fromRandom();
  const parent = new Transaction();
  parent.addOutput({ lockingScript: new P2PKH().lock(buyerKey.toPublicKey().toHash()), satoshis: 5000 });
  parent.merklePath = new MerklePath(1, [[{ offset: 0, hash: parent.id("hex"), txid: true }]]);
  const tx = new Transaction();
  tx.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(buyerKey) });
  for (const o of outputs) tx.addOutput({ lockingScript: LockingScript.fromHex(o.lockingScript), satoshis: o.satoshis });
  await tx.sign();
  return { tx, beef: Utils.toHex(tx.toAtomicBEEF()) };
}
const { tx, beef } = await pay(request.outputs);
assert((await buyer.call(`/api/bids/${bidId}/payment`, { body: { beef: (await pay([request.outputs[1]])).beef } })).status === 400,
  "a transaction not paying the seller is refused");

assert((await buyer.call(`/api/offers/${offer.id}/data`)).status !== 401, "ciphertext is downloadable");
assert((await seller.call(`/api/bids/${bidId}/payment`, { body: { beef } })).status === 404, "seller cannot submit the buyer's payment");
const paid = await buyer.call(`/api/bids/${bidId}/payment`, { body: { beef } });
assert(paid.txid === tx.id("hex"), "payment accepted");
assert((await buyer.call(`/api/bids/${bidId}/payment`, { body: { beef } })).txid === paid.txid, "re-submitting is idempotent");
assert((await buyer.call(`/api/bids/${bidId}/delivery`)).status === 409, "no key before delivery");

// ---------- seller: claim and deliver ----------
const { tasks } = await seller.call("/api/seller/tasks");
const task = tasks.find((t: any) => t.bidId === bidId);
assert(task?.claim?.outputIndex === tx.outputs.findIndex((o) => o.lockingScript.toHex() === request.outputs[0].lockingScript),
  "seller task points at the payment output");
assert((await seller.call(`/api/bids/${bidId}/claimed`, { body: {} })).ok, "payment marked claimed");

async function deliver(t: any) {
  const { plaintext: k } = await seller.wallet.decrypt({
    ciphertext: Utils.toArray(t.deliver.sellerKeyWrap, "hex"), protocolID: KEY_PROTOCOL, keyID: t.deliver.dataHash, counterparty: "self",
  });
  const { ciphertext: wrapped } = await seller.wallet.encrypt({
    plaintext: k, protocolID: KEY_PROTOCOL, keyID: t.offerId, counterparty: t.buyer,
  });
  return seller.call(`/api/bids/${t.bidId}/delivery`, { body: { wrappedKey: Utils.toHex(wrapped) } });
}
assert((await deliver(task)).ok, "key delivered");

// ---------- buyer: decrypt, verify, confirm ----------
const got = await buyer.call(`/api/bids/${bidId}/delivery`);
const { plaintext: k } = await buyer.wallet.decrypt({
  ciphertext: Utils.toArray(got.wrappedKey, "hex"), protocolID: KEY_PROTOCOL, keyID: got.offerId, counterparty: got.seller,
});
const enc = new Uint8Array(await (await fetch(`${api}/api/offers/${offer.id}/data`)).arrayBuffer());
assert(new Bun.CryptoHasher("sha256").update(enc).digest("hex") === detail.dataHash, "downloaded ciphertext matches the commitment");
const aesBuyer = await crypto.subtle.importKey("raw", Uint8Array.from(k), "AES-GCM", false, ["decrypt"]);
const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: enc.slice(0, 12) }, aesBuyer, enc.slice(12)));
assert(new TextDecoder().decode(decrypted) === new TextDecoder().decode(plaintext), "buyer decrypts the original data");

// A failed decryption sends the bid back to the seller for another delivery.
assert((await buyer.call(`/api/bids/${bidId}/receipt`, { body: { ok: false, reason: "test" } })).status === "paid", "failure asks for redelivery");
const again = (await seller.call("/api/seller/tasks")).tasks.find((t: any) => t.bidId === bidId);
assert(again?.deliver && !again.claim, "redelivery task, payment not claimed twice");
assert((await deliver(again)).ok, "key delivered again");
assert((await buyer.call(`/api/bids/${bidId}/receipt`, { body: { ok: true } })).status === "received", "buyer confirms receipt");

const final = (await seller.call(`/api/offers/${offer.id}`)).offer;
assert(final.sales?.received === 1, "seller sees the completed sale");

// ---------- a payment the network rejects is undone, and the buyer can pay again ----------
const second = await seller.call("/api/offers", {
  body: { ...listing, name: "e2e retry", sellerKeyWrap: Utils.toHex(sellerKeyWrap), deadline: new Date(Date.now() + 3000).toISOString() },
});
await buyer.call(`/api/offers/${second.id}/bid`, { body: { maxPrice: 1000 } });
const waitFor = async (check: (o: any) => boolean) => {
  for (let i = 0; i < 30; i++) {
    const o = (await buyer.call(`/api/offers/${second.id}`)).offer;
    if (check(o)) return o;
    await sleep(1000);
  }
  return (await buyer.call(`/api/offers/${second.id}`)).offer;
};
const won = await waitFor((o) => o.myBid?.status === "won");
const retryRequest = await buyer.call(`/api/bids/${won.myBid.id}/payment`);
arcadeMode = "reject";
assert((await buyer.call(`/api/bids/${won.myBid.id}/payment`, { body: { beef: (await pay(retryRequest.outputs)).beef } })).txid,
  "payment accepted while the network has not decided");
const undone = await waitFor((o) => o.myBid.status === "won");
assert(undone.myBid.status === "won" && /rejected/.test(undone.myBid.paymentError), "rejected payment is undone with a reason");
assert(!(await seller.call("/api/seller/tasks")).tasks.some((t: any) => t.bidId === won.myBid.id), "seller gets no task for it");
arcadeMode = "seen";
const retry = await buyer.call(`/api/bids/${won.myBid.id}/payment`);
assert((await buyer.call(`/api/bids/${won.myBid.id}/payment`, { body: { beef: (await pay(retry.outputs)).beef } })).txid,
  "buyer pays again");
assert((await waitFor((o) => o.myBid.paymentSeen)).myBid.status === "paid", "second payment seen on the network");
console.log("\nAll delivery checks passed.");
process.exit(0);
