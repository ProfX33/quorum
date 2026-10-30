// Demo: three autonomous agents, no browser and no human. Neither buyer can afford the
// dataset alone, so they end up pooling their money for it without ever talking to each
// other. They pay the seller in one transaction, get the data, and put it to use.
//
//   bun run demo         simulated network (no funds needed): starts its own backend on :4100
//                        and a mock Arcade. Watch it live: API_PROXY=http://localhost:4100 npm run dev
//   bun run demo --live  real transactions against the backend at API_URL. It prints the
//                        addresses to fund on the first run; each buyer needs about 1,500 sats.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { LockingScript, MerklePath, P2PKH, PrivateKey, Transaction } from "@bsv/sdk";
import { type Event, MarketAgent } from "../agent/market-agent.ts";
import { txUrl } from "../src/payments.ts";

const live = process.argv.includes("--live");
const DEMO_PORT = 4100;
const MOCK_CHAIN_PORT = 4199;
const PRICE = 700;
const BUDGET = 400; // what each buyer is willing to spend, less than the price
const BIDDING_SECONDS = 15;
const TIMEOUT_MS = 180_000;

const DATASET = `district,pm25,no2,temp_c
Maxvorstadt,14.2,31,9.1
Schwabing,11.8,24,8.9
Sendling,16.5,38,9.4
Haidhausen,12.9,27,9.0
Giesing,10.4,21,8.7
Pasing,13.3,26,8.8
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const colors = { seller: 36, alice: 33, bob: 35, demo: 2 } as const;
const say = (who: keyof typeof colors, message: string) =>
  console.log(`\x1b[${colors[who]}m${who.padEnd(6)}\x1b[0m ${message}`);

// ---------- Simulated network ----------

/** Every transaction is seen at once; nothing reaches the real network. */
function startMockChain() {
  Bun.serve({
    port: MOCK_CHAIN_PORT,
    routes: {
      "/tx": { POST: () => Response.json({ txStatus: "SEEN_ON_NETWORK" }, { status: 202 }) },
      "/tx/:txid": () => Response.json({ txStatus: "SEEN_ON_NETWORK" }),
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
}

async function startDemoBackend() {
  const base = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app";
  const database = base.replace(/\/[^/]*$/, "/app_demo");
  const admin = new SQL(base);
  await admin.unsafe("CREATE DATABASE app_demo").catch((e) => {
    if (e.errno !== "42P04") throw e; // 42P04: exists from an earlier run
  });
  await admin.close();

  const url = `http://localhost:${DEMO_PORT}`;
  const server = Bun.spawn(["bun", "src/index.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      PORT: String(DEMO_PORT),
      DATABASE_URL: database,
      ARCADE_URL: `http://localhost:${MOCK_CHAIN_PORT}`,
      WOC_URL: `http://localhost:${MOCK_CHAIN_PORT}/woc`,
    },
    stdout: "ignore",
    stderr: "inherit",
  });
  process.on("exit", () => server.kill());
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${url}/api/health`).then((r) => r.ok, () => false)) return url;
    await sleep(100);
  }
  throw new Error("The demo backend did not start");
}

/** A made-up mined transaction paying the wallet, standing in for real funding. */
function airdrop(agent: MarketAgent, satoshis: number) {
  const parent = new Transaction();
  parent.addOutput({ lockingScript: new P2PKH().lock(agent.wallet.key.toPublicKey().toHash()), satoshis });
  parent.merklePath = new MerklePath(1, [[{ offset: 0, hash: parent.id("hex"), txid: true }]]);
  agent.wallet.receive(parent, 0);
}

// ---------- The agents ----------

/** Lists the dataset, then serves its obligations until it has been paid and has delivered. */
async function sellerAgent(agent: MarketAgent) {
  const deadline = new Date(Date.now() + BIDDING_SECONDS * 1000).toISOString();
  const { id, dataHash } = await agent.sellData(new TextEncoder().encode(DATASET), "munich-air-quality.csv", {
    category: "environment",
    region: "Munich",
    name: "Munich air quality, district readings",
    description: "PM2.5, NO2 and temperature per district. Encrypted; the hash commits to the file.",
    price: PRICE,
    deadline,
  });
  say("seller", `listed the dataset for ${PRICE} sats, bidding closes in ${BIDDING_SECONDS}s (sha256 ${dataHash.slice(0, 16)}…)`);

  let delivered = 0;
  while (delivered < 2) {
    for (const e of await agent.work()) {
      if (e.type === "claimed") say("seller", `received ${e.amount} sats in one payment: ${e.txid}`);
      if (e.type === "delivered") say("seller", `wrapped the data key for buyer ${++delivered}`);
      if (e.type === "error") say("seller", `problem, will retry: ${e.error}`);
    }
    await sleep(1000);
  }
  return id;
}

/**
 * Looks for what its mission needs, bids its budget, follows the bid to the data, and acts
 * on it. Its only input is the public market: it never knows who else is bidding.
 */
async function buyerAgent(who: "alice" | "bob", agent: MarketAgent, joinAfterMs: number, mission: string, act: (rows: Row[]) => string) {
  say(who, `mission: ${mission}`);
  await sleep(joinAfterMs);
  let offer: any;
  while (!offer) {
    [offer] = (await agent.search({ q: "air quality", region: "Munich", kind: "data" })).offers
      .filter((o: any) => !o.mine && o.dataHash && !o.myBid);
    if (!offer) await sleep(500);
  }
  say(who, `found "${offer.name}" for ${offer.price} sats, budget ${BUDGET}, ${offer.bidCount} other bidder(s)`);
  if (offer.price > BUDGET && Math.ceil(offer.price / (offer.bidCount + 1)) > BUDGET) {
    say(who, `too expensive alone, but it only clears if enough agents share it: bidding my budget and waiting for others`);
  } else {
    say(who, `splitting with ${offer.bidCount} other(s) brings my share to ${Math.ceil(offer.price / (offer.bidCount + 1))} sats: bidding`);
  }
  await agent.bid(offer.id, BUDGET);

  for (;;) {
    for (const e of await agent.work()) {
      if (e.type === "pledged") say(who, `group formed, pledged my share of ${e.amount} sats (still mine until everyone has pledged)`);
      if (e.type === "error") say(who, `problem, will retry: ${e.error}`);
      if (e.type === "data") return report(who, agent, offer.id, e, act);
    }
    await sleep(1000);
  }
}

type Row = { district: string; pm25: number; no2: number; temp_c: number };

const parse = (csv: string): Row[] => {
  const [header, ...lines] = csv.trim().split("\n");
  const keys = header!.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((v, i) => [keys[i], i ? Number(v) : v])) as Row);
};

async function report(who: "alice" | "bob", agent: MarketAgent, offerId: string, e: Event, act: (rows: Row[]) => string) {
  const csv = new TextDecoder().decode(e.data);
  say(who, `decrypted ${e.data!.length} bytes, it matches the hash the seller committed to before bidding`);
  say(who, `result: ${act(parse(csv))}`);
  const { myBid } = await agent.offer(offerId);
  return { csv, paid: myBid.amount as number };
}

// ---------- Run ----------

let api = process.env.API_URL ?? "http://localhost:4000";
if (!live) {
  process.env.AGENT_WALLET_DIR = mkdtempSync(join(tmpdir(), "agent-demo-"));
  startMockChain();
  api = await startDemoBackend();
  console.log("Simulated network: no real transactions are made. Use --live for real ones.\n");
}

const [seller, alice, bob] = await Promise.all(
  ["demo-seller", "demo-alice", "demo-bob"].map((name) => MarketAgent.connect(name, api)),
) as [MarketAgent, MarketAgent, MarketAgent];

if (live) {
  await Promise.all([alice, bob].map((a) => a.wallet.sync()));
  const poor = [alice, bob].filter((a) => a.wallet.balance < 600);
  if (poor.length > 0) {
    console.error("Fund these addresses with at least 1,500 sats each, then run this again:");
    for (const a of poor) console.error(`  ${a.wallet.address} (has ${a.wallet.balance})`);
    process.exit(1);
  }
} else {
  airdrop(alice, 5000);
  airdrop(bob, 5000);
}
const before = { alice: alice.wallet.balance, bob: bob.wallet.balance, seller: seller.wallet.balance };

const timeout = sleep(TIMEOUT_MS).then(() => {
  throw new Error("The demo did not finish in time");
});
const offerId = sellerAgent(seller);
const results = await Promise.race([
  Promise.all([
    offerId,
    buyerAgent("alice", alice, 1000, "plan a cycling route through the cleanest air in Munich",
      (rows) => {
        const best = [...rows].sort((a, b) => a.pm25 - b.pm25).slice(0, 3).map((r) => r.district);
        return `route via ${best.join(" → ")}`;
      }),
    buyerAgent("bob", bob, 5000, "decide where delivery vans should be replaced by e-bikes first",
      (rows) => {
        const worst = [...rows].sort((a, b) => b.no2 - a.no2)[0]!;
        const mean = rows.reduce((sum, r) => sum + r.no2, 0) / rows.length;
        return `start in ${worst.district}: NO2 ${worst.no2} µg/m³ against a city mean of ${mean.toFixed(1)}`;
      }),
  ]),
  timeout,
]);
const [id, a, b] = results;

// The demo fails loudly if the story above is not what actually happened.
const offer = await alice.offer(id);
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(`Demo check failed: ${message}`);
};
check(a.csv === DATASET && b.csv === DATASET, "both buyers hold the exact dataset");
check(a.paid + b.paid === PRICE, "the shares add up to the price");
check(seller.wallet.balance - before.seller === PRICE, "the seller's wallet holds the full price");
check(offer.groupPayment.seen, "the network has seen the group payment");

const { txid, txUrl: link } = offer.groupPayment;
console.log(`
Done. ${PRICE} sats paid to the seller in one transaction, ${a.paid} + ${b.paid} from two agents.
Alone neither could have bought it: each had a budget of ${BUDGET}.
  alice spent ${before.alice - alice.wallet.balance} sats, bob ${before.bob - bob.wallet.balance} sats (shares plus mining fees)
  group payment ${live ? link ?? txUrl(txid) : `${txid} (simulated)`}`);
process.exit(0);
