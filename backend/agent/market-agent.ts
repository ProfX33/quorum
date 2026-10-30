import { Transaction, Utils } from "@bsv/sdk";
import { AUTH_KEY_ID, AUTH_PROTOCOL } from "../src/auth.ts";
import { groupOutputs, paymentLockingScript, pledgeLockingScript, refundTransaction, signPledge } from "../src/payments.ts";
import { AgentWallet } from "./wallet.ts";

// Everything the web app does for a signed-in user, for an agent without a browser: login,
// market, pledging, refunds, and the seller's claims and deliveries. Wire format and
// protocols are the ones of frontend/src/delivery.js.

// Must match frontend/src/delivery.js
const KEY_PROTOCOL: [2, string] = [2, "datamarket data key"];

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type Filters = { q?: string; kind?: string; category?: string; region?: string; status?: string };
type Call = { method?: string; body?: unknown; raw?: Uint8Array };

/** What `work` did in one round. */
export type Event = { type: string; offerId?: string; bidId?: string; txid?: string; amount?: number; data?: Uint8Array; error?: string };

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export class MarketAgent {
  private token = "";

  private constructor(readonly wallet: AgentWallet, readonly api: string) {}

  /** Opens the wallet `name` and signs in with it; the first login creates the account. */
  static async connect(name: string, api = process.env.API_URL ?? "http://localhost:4000") {
    const agent = new MarketAgent(AgentWallet.open(name), api.replace(/\/+$/, ""));
    await agent.login();
    return agent;
  }

  private async login() {
    const { identityKey } = this.wallet;
    const { nonce, message } = await this.call("/api/auth/challenge", { body: { identityKey } });
    const { signature } = await this.wallet.proto.createSignature({
      data: Utils.toArray(message, "utf8"), protocolID: AUTH_PROTOCOL, keyID: AUTH_KEY_ID, counterparty: "anyone",
    });
    const login = await this.call("/api/auth/login", {
      body: { identityKey, nonce, signature: Utils.toHex(signature), kind: "agent" },
    });
    this.token = login.token;
    return login;
  }

  /** The session token, for agents that talk to the REST API themselves. */
  get sessionToken() {
    return this.token;
  }

  private async fetch(path: string, { method, body, raw }: Call = {}) {
    const res = await fetch(this.api + path, {
      method: method ?? (body || raw ? "POST" : "GET"),
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        "Content-Type": raw ? "application/octet-stream" : "application/json",
      },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      throw new ApiError(data.error ?? `${path} answered ${res.status}`, res.status);
    }
    return res;
  }

  private call = async (path: string, init?: Call): Promise<any> => (await this.fetch(path, init)).json();

  // ---------- Market ----------

  search(filters: Filters = {}) {
    return this.call(`/api/search?${new URLSearchParams(filters)}`);
  }

  offer(id: string) {
    return this.call(`/api/offers/${id}`).then((d) => d.offer);
  }

  /** The offers this agent has bid on, with its bid in `myBid`. */
  bids(): Promise<any[]> {
    return this.call("/api/bids").then((d) => d.offers);
  }

  /** Places or updates the agent's maximum. It pays at most this, or nothing. */
  bid(offerId: string, maxPrice: number) {
    return this.call(`/api/offers/${offerId}/bid`, { body: { maxPrice } });
  }

  withdrawBid(offerId: string) {
    return this.call(`/api/offers/${offerId}/bid`, { method: "DELETE" });
  }

  /** Posts what the agent wants to buy, for sellers to answer with an offer. */
  createRequest(request: Record<string, unknown>) {
    return this.call("/api/requests", { body: request });
  }

  // ---------- Seller ----------

  /** Encrypts `data`, uploads the ciphertext and lists it. The key stays in the agent's wallet. */
  async sellData(data: Uint8Array<ArrayBuffer>, fileName: string, listing: Record<string, unknown>) {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, data));
    const blob = new Uint8Array([...iv, ...encrypted]);
    const dataHash = sha256(blob);
    const { ciphertext: wrap } = await this.wallet.proto.encrypt({
      plaintext: Array.from(key), protocolID: KEY_PROTOCOL, keyID: dataHash, counterparty: "self",
    });
    await this.call(`/api/data?name=${encodeURIComponent(fileName)}`, { raw: blob });
    const { id } = await this.call("/api/offers", {
      body: { kind: "data", ...listing, dataHash, sellerKeyWrap: Utils.toHex(wrap) },
    });
    return { id: id as string, dataHash };
  }

  /** Lists a service or product, which needs no upload. */
  sell(listing: Record<string, unknown>) {
    return this.call("/api/offers", { body: listing });
  }

  sellerTasks(): Promise<any[]> {
    return this.call("/api/seller/tasks").then((d) => d.tasks);
  }

  /** Takes a group payment into the wallet. */
  async claim(task: any) {
    const tx = Transaction.fromAtomicBEEF(Utils.toArray(task.claim.beef, "hex"));
    if (!(await tx.verify("scripts only"))) throw new Error("The group payment's signatures do not verify");
    this.wallet.receive(tx, task.claim.outputIndex, `${task.claim.derivationPrefix} ${task.claim.derivationSuffix}`);
    await this.call(`/api/offers/${task.offerId}/claimed`, { body: {} });
  }

  /** Wraps the data key for one buyer. */
  async deliver(task: any) {
    const { plaintext: key } = await this.wallet.proto.decrypt({
      ciphertext: Utils.toArray(task.deliver.sellerKeyWrap, "hex"),
      protocolID: KEY_PROTOCOL, keyID: task.deliver.dataHash, counterparty: "self",
    });
    const { ciphertext } = await this.wallet.proto.encrypt({
      plaintext: key, protocolID: KEY_PROTOCOL, keyID: task.offerId, counterparty: task.buyer,
    });
    await this.call(`/api/bids/${task.bidId}/delivery`, { body: { wrappedKey: Utils.toHex(ciphertext) } });
  }

  // ---------- Buyer ----------

  /**
   * Pledges the open share of a won bid. Nothing reaches the seller until the whole group has
   * pledged, and the server's request is checked first: the agent only signs for outputs that
   * pay the seller the price, and never for more than its own maximum.
   */
  async pay(bidId: string) {
    const pendingId = `pledge:${bidId}`;
    const resumed = this.wallet.pending(pendingId);
    if (resumed) return this.submitPledge(bidId, resumed.pledge, resumed.before);

    const req = await this.call(`/api/bids/${bidId}/payment`);
    const expected = await groupOutputs(req.seller, req.derivationPrefix, req.derivationSuffix, req.offerId, req.price);
    if (JSON.stringify(expected) !== JSON.stringify(req.groupOutputs)) {
      throw new Error("The group payment the server asked for does not pay the seller the price. Not signing it.");
    }
    const { myBid } = await this.offer(req.offerId);
    if (myBid?.id !== bidId || req.amount > myBid.maxPrice) {
      throw new Error(`The share of ${req.amount} sats is above this agent's maximum. Not signing it.`);
    }

    const before = this.wallet.snapshot();
    const tx = await this.wallet.createAction(await pledgeLockingScript(this.wallet.proto, req.keyID), req.satoshis);
    const unlockingScript = await signPledge(this.wallet.proto, req.keyID, req.groupOutputs, tx, 0);
    const pledge = { beef: Utils.toHex(tx.toAtomicBEEF()), vout: 0, unlockingScript, keyID: req.keyID };
    this.wallet.setPending(pendingId, { pledge, before });
    return this.submitPledge(bidId, pledge, before);
  }

  private async submitPledge(bidId: string, pledge: unknown, before: ReturnType<AgentWallet["snapshot"]>) {
    const pendingId = `pledge:${bidId}`;
    try {
      const result = await this.call(`/api/bids/${bidId}/payment`, { body: pledge });
      this.wallet.setPending(pendingId, undefined);
      return result;
    } catch (e) {
      // Refused before it was broadcast: the funds were never moved. Anything else, such as
      // a network failure, keeps the pledge, and the next pay submits it again.
      if (e instanceof ApiError && [400, 404].includes(e.status)) this.wallet.restore(before);
      else if (e instanceof ApiError && e.status === 409) this.wallet.setPending(pendingId, undefined);
      throw e;
    }
  }

  /** Takes back pledges that ended up unused, after the agent left the group or the offer failed. */
  async refund(bidId: string) {
    const pendingId = `refund:${bidId}`;
    let refund = this.wallet.pending(pendingId);
    if (!refund) {
      const r = await this.call(`/api/bids/${bidId}/refund`);
      const prefix = Utils.toBase64(crypto.getRandomValues(new Uint8Array(16)) as unknown as number[]);
      const suffix = Utils.toBase64(crypto.getRandomValues(new Uint8Array(16)) as unknown as number[]);
      const pledges = r.pledges.map((p: any) => ({
        tx: Transaction.fromAtomicBEEF(Utils.toArray(p.beef, "hex")), vout: p.vout, keyID: p.keyID,
      }));
      const to = await paymentLockingScript(this.wallet.identityKey, prefix, suffix);
      const tx = await refundTransaction(this.wallet.proto, pledges, to, r.fee);
      refund = { beef: Utils.toHex(tx.toAtomicBEEF()), keyID: `${prefix} ${suffix}` };
      this.wallet.setPending(pendingId, refund);
    }
    const result = await this.call(`/api/bids/${bidId}/refund`, { body: { beef: refund.beef } });
    this.wallet.receive(Transaction.fromAtomicBEEF(Utils.toArray(refund.beef, "hex")), 0, refund.keyID);
    this.wallet.setPending(pendingId, undefined);
    return result;
  }

  /** Unwraps the key, checks the download against the commitment, decrypts it and confirms receipt. */
  async download(bidId: string) {
    const d = await this.call(`/api/bids/${bidId}/delivery`);
    const blob = new Uint8Array(await (await this.fetch(`/api/offers/${d.offerId}/data`)).arrayBuffer());
    if (sha256(blob) !== d.dataHash) throw new Error("The download does not match the commitment");
    let data: Uint8Array;
    try {
      const { plaintext: key } = await this.wallet.proto.decrypt({
        ciphertext: Utils.toArray(d.wrappedKey, "hex"), protocolID: KEY_PROTOCOL, keyID: d.offerId, counterparty: d.seller,
      });
      const aes = await crypto.subtle.importKey("raw", Uint8Array.from(key), "AES-GCM", false, ["decrypt"]);
      data = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) }, aes, blob.slice(12)));
    } catch {
      await this.call(`/api/bids/${bidId}/receipt`, { body: { ok: false, reason: "The delivered key does not decrypt the data" } });
      throw new Error("The delivered key does not open the data. The seller has been asked to deliver again.");
    }
    await this.call(`/api/bids/${bidId}/receipt`, { body: { ok: true } });
    return data;
  }

  // ---------- Everything that is due ----------

  /**
   * One round of the agent's obligations: pledges won bids, collects delivered data, takes
   * back unused pledges, claims payments and delivers keys. Call it in a loop. A step that
   * fails is reported as an `error` event and comes up again in the next round.
   */
  async work() {
    const events: Event[] = [];
    const step = async (ids: Pick<Event, "offerId" | "bidId">, run: () => Promise<Event>) => {
      try {
        events.push({ ...ids, ...(await run()) });
      } catch (e) {
        events.push({ ...ids, type: "error", error: (e as Error).message });
      }
    };
    for (const offer of await this.bids()) {
      const bid = offer.myBid;
      const ids = { offerId: offer.id as string, bidId: bid.id as string };
      if (bid.status === "won") {
        await step(ids, async () => ({ type: "pledged", amount: bid.amount, ...(await this.pay(bid.id)) }));
      } else if (bid.status === "delivered") {
        await step(ids, async () => ({ type: "data", data: await this.download(bid.id) }));
      } else if (bid.refundable > 0) {
        await step(ids, async () => ({ type: "refunded", amount: bid.refundable, ...(await this.refund(bid.id)) }));
      }
    }
    for (const task of await this.sellerTasks()) {
      const ids = { offerId: task.offerId as string, bidId: task.bidId as string | undefined };
      if (task.claim) await step(ids, async () => (await this.claim(task), { type: "claimed", amount: task.amount, txid: task.txid }));
      if (task.deliver) await step(ids, async () => (await this.deliver(task), { type: "delivered" }));
    }
    return events;
  }
}
