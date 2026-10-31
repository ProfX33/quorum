// Demo: autonomous agents crowdfund a dataset none of them can afford, with no browser and no
// human. Every agent is its own MCP server process with its own wallet, and uses the same tools
// any LLM agent gets. They never talk to each other: all they share is the public market, where
// they watch the group form until the price is covered. Then they pay the seller in one
// transaction, get the data, and put it to use.
//
//   bun run demo            simulated network (no funds needed): starts its own backend on :4100
//                           and a mock Arcade.
//   bun run demo --present  for an audience: slower, and it keeps running at the end so the web
//                           app stays up. In frontend/: API_PROXY=http://localhost:4100 npm run dev
//   bun run demo --live     real transactions against the backend at API_URL. It prints the
//                           addresses to fund on the first run.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MerklePath, P2PKH, Transaction } from "@bsv/sdk";
import { AgentWallet } from "../agent/wallet.ts";
import { txUrl } from "../src/payments.ts";
import { findPaymentGroup } from "../src/settlement.ts";

const live = process.argv.includes("--live");
const present = process.argv.includes("--present");
const DEMO_PORT = 4100;
const MOCK_CHAIN_PORT = 4199;
const PRICE = 1200;
const BIDDING_SECONDS = present ? 60 : 20;
const TIMEOUT_MS = (BIDDING_SECONDS + 150) * 1000;
const FILE_NAME = "munich-air-quality.csv";

const DATASET = `district,pm25,no2,temp_c
Maxvorstadt,14.2,31,9.1
Schwabing,11.8,24,8.9
Sendling,16.5,38,9.4
Haidhausen,12.9,27,9.0
Giesing,10.4,21,8.7
Pasing,13.3,26,8.8
`;

type Row = { district: string; pm25: number; no2: number; temp_c: number };
type Buyer = { name: string; budget: number; arrivesAt: number; mission: string; act: (rows: Row[]) => string };

const lowest = (rows: Row[], key: "pm25" | "no2") => [...rows].sort((a, b) => a[key] - b[key]);

// The market only sells if an even split fits everybody in the group. Until dave arrives none
// does, however much is pledged; he makes a group of four at 300 sats, and erin stays out of it.
const BUYERS: Buyer[] = [
  {
    name: "alice", budget: 500, arrivesAt: 0.1,
    mission: "plan a cycling route through the cleanest air in Munich",
    act: (rows) => `route via ${lowest(rows, "pm25").slice(0, 3).map((r) => r.district).join(" → ")}`,
  },
  {
    name: "erin", budget: 150, arrivesAt: 0.25,
    mission: "add air quality to a local newsletter, if it is cheap enough",
    act: () => "",
  },
  {
    name: "bob", budget: 450, arrivesAt: 0.4,
    mission: "decide where delivery vans should be replaced by e-bikes first",
    act: (rows) => {
      const worst = lowest(rows, "no2").at(-1)!;
      const mean = rows.reduce((sum, r) => sum + r.no2, 0) / rows.length;
      return `start in ${worst.district}: NO2 ${worst.no2} µg/m³ against a city mean of ${mean.toFixed(1)}`;
    },
  },
  {
    name: "carol", budget: 350, arrivesAt: 0.55,
    mission: "find the district for a new open-air kindergarten",
    act: (rows) => `build in ${lowest(rows, "no2")[0]!.district}, which has the lowest NO2`,
  },
  {
    name: "dave", budget: 320, arrivesAt: 0.7,
    mission: "warn asthma patients about today's worst district",
    act: (rows) => `warning issued for ${lowest(rows, "pm25").at(-1)!.district}`,
  },
];

const group = findPaymentGroup(PRICE, BUYERS.map((b) => ({ id: b.name, maxPrice: b.budget })))!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const n = (sats: number) => sats.toLocaleString("en-US");
const colors: Record<string, number> = { seller: 36, market: 32, alice: 33, bob: 35, carol: 34, dave: 91, erin: 96 };
const say = (who: string, message: string) => console.log(`\x1b[${colors[who]}m${who.padEnd(6)}\x1b[0m ${message}`);

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
function airdrop(wallet: string, satoshis: number) {
  const w = AgentWallet.open(wallet);
  const parent = new Transaction();
  parent.addOutput({ lockingScript: new P2PKH().lock(w.key.toPublicKey().toHash()), satoshis });
  parent.merklePath = new MerklePath(1, [[{ offset: 0, hash: parent.id("hex"), txid: true }]]);
  w.receive(parent, 0);
}

// ---------- The agents ----------

// Polls that would drown out the story.
const QUIET = ["do_due_work", "get_offer", "wallet_status"];

/** An agent's connection to its own MCP server, which holds its key. */
class Agent {
  private constructor(readonly name: string, private readonly client: Client) {}

  static async start(name: string, api: string) {
    const client = new Client({ name: `demo-${name}`, version: "0.1.0" });
    await client.connect(new StdioClientTransport({
      command: "bun",
      args: ["agent/mcp.ts", "--wallet", `demo-${name}`],
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, API_URL: api } as Record<string, string>,
      stderr: "inherit",
    }));
    return new Agent(name, client);
  }

  async call(tool: string, args: Record<string, unknown> = {}): Promise<any> {
    if (!QUIET.includes(tool)) {
      const { offerId, bidId, path, description, ...shown } = args;
      say(this.name, `\x1b[2m→ ${tool}${Object.keys(shown).length ? ` ${JSON.stringify(shown)}` : ""}\x1b[0m`);
    }
    const result = await this.client.callTool({ name: tool, arguments: args });
    const data = JSON.parse((result.content as { text: string }[])[0]!.text);
    if (result.isError) throw new Error(`${tool}: ${data.error}`);
    return data;
  }

  stop = () => this.client.close();
}

/** Serves its obligations until it has been paid and has delivered to the whole group. */
async function sellerAgent(agent: Agent) {
  let delivered = 0;
  while (delivered < group.length) {
    for (const e of (await agent.call("do_due_work")).events) {
      if (e.type === "claimed") say("seller", `received ${n(e.amount)} sats in one payment: ${e.txid}`);
      if (e.type === "delivered") say("seller", `wrapped the data key for buyer ${++delivered}`);
      if (e.type === "error") say("seller", `problem, will retry: ${e.error}`);
    }
    await sleep(1000);
  }
}

/**
 * Looks for what its mission needs, checks how the group is forming, bids its budget, follows
 * the bid to the data, and acts on it. Its only input is the public market.
 */
async function buyerAgent({ name, budget, arrivesAt, act }: Buyer, agent: Agent) {
  await sleep(arrivesAt * BIDDING_SECONDS * 1000);
  // Newest last: an interrupted run can leave an older listing open.
  const offer = (await agent.call("search_offers", { q: "air quality", region: "Munich", kind: "data" })).offers
    .filter((o: any) => !o.mine && o.dataHash && !o.myBid).at(-1);
  say(name, `found "${offer.name}" for ${n(offer.price)} sats, I have ${n(budget)}`);

  const { bid, minBidToJoin } = await agent.call("quote_offer", { offerId: offer.id, maxPrice: budget });
  if (bid.inGroup) {
    say(name, `the quote says my ${n(budget)} completes a group of ${bid.groupSize} at ${n(bid.share)} sats each. Exactly what was missing`);
  } else {
    say(name, `the quote says it takes a bid of ${n(minBidToJoin)} to buy this today. I bid anyway: if no group forms I take my pledge back and only lose the network fees`);
  }
  await agent.call("place_bid", { offerId: offer.id, maxPrice: budget });

  const { group: market } = await agent.call("quote_offer", { offerId: offer.id });
  say("market", market.forms
    ? `\x1b[1mgroup found: ${market.size} of ${market.fundedBidders} agents, ${n(market.share)} sats each\x1b[0m`
    : `${market.fundedBidders} agent(s) pledged ${n(market.fundedTotal)} sats, but no even split fits them yet`);

  let csv: string | undefined;
  for (;;) {
    for (const e of (await agent.call("do_due_work")).events) {
      if (e.type === "refunded") say(name, `took back ${n(e.amount)} sats I did not end up needing`);
      if (e.type === "error") say(name, `problem, will retry: ${e.error}`);
      if (e.type === "data") {
        csv = e.text as string;
        say(name, `decrypted ${e.bytes} bytes, which match the hash the seller committed to before bidding`);
        say(name, `result: ${act(parse(csv))}`);
        await agent.call("confirm_delivery", { bidId: e.bidId });
      }
    }
    const { myBid } = await agent.call("get_offer", { offerId: offer.id });
    if (["received", "lost"].includes(myBid.status) && myBid.refundable === 0) {
      return { offerId: offer.id as string, csv, paid: (myBid.amount ?? 0) as number };
    }
    await sleep(1000);
  }
}

const parse = (csv: string): Row[] => {
  const [header, ...lines] = csv.trim().split("\n");
  const keys = header!.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((v, i) => [keys[i], i ? Number(v) : v])) as Row);
};

// ---------- Run ----------

let api = process.env.API_URL ?? "http://localhost:4000";
if (!live) {
  process.env.AGENT_WALLET_DIR = mkdtempSync(join(tmpdir(), "agent-demo-"));
  startMockChain();
  api = await startDemoBackend();
  for (const b of BUYERS) airdrop(`demo-${b.name}`, 5000);
  console.log("Simulated network: no real transactions are made. Use --live for real ones.\n");
}

const seller = await Agent.start("seller", api);
const buyers = await Promise.all(BUYERS.map((b) => Agent.start(b.name, api)));
const everyone = [seller, ...buyers];
await Promise.all(everyone.map((a) => a.call("set_name", { name: `${a.name} (demo agent)` })));
const balances = async () => Promise.all(everyone.map(async (a) => (await a.call("wallet_status")).balance as number));
const before = await balances();

if (live) {
  const poor = await Promise.all(BUYERS.map(async (b, i) => {
    const { address, balance } = await buyers[i]!.call("wallet_status");
    return balance < b.budget + 500 ? `  ${address}: at least ${n(b.budget + 500)} sats (has ${n(balance)})` : "";
  }));
  if (poor.some(Boolean)) {
    console.error(`Fund these addresses, then run this again:\n${poor.filter(Boolean).join("\n")}`);
    process.exit(1);
  }
}

for (const b of BUYERS) say(b.name, `mission: ${b.mission} (budget ${n(b.budget)} sats)`);
console.log();

const file = join(mkdtempSync(join(tmpdir(), "agent-demo-data-")), FILE_NAME);
writeFileSync(file, DATASET);
const { id, dataHash } = await seller.call("sell_data", {
  path: file,
  category: "environment",
  region: "Munich",
  name: "Munich air quality, district readings",
  description: "PM2.5, NO2 and temperature per district. Encrypted; the hash commits to the file.",
  price: PRICE,
  minutes: BIDDING_SECONDS / 60,
});
say("seller", `listed the dataset for ${n(PRICE)} sats, bidding closes in ${BIDDING_SECONDS}s (sha256 ${dataHash.slice(0, 16)}…)`);
if (present) console.log(`\x1b[2m       watch it at http://localhost:3000/#/offers/${id}\x1b[0m`);

const results = await Promise.race([
  Promise.all([sellerAgent(seller), ...BUYERS.map((b, i) => buyerAgent(b, buyers[i]!))]),
  sleep(TIMEOUT_MS).then(() => {
    throw new Error("The demo did not finish in time");
  }),
]);
const outcomes = results.slice(1) as Awaited<ReturnType<typeof buyerAgent>>[];

// The demo fails loudly if the story above is not what actually happened.
const after = await balances();
const offer = await seller.call("get_offer", { offerId: id });
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(`Demo check failed: ${message}`);
};
const inGroup = BUYERS.map((b) => group.some((p) => p.id === b.name));
check(outcomes.every((o) => o.offerId === id), "every buyer bought the seller's listing");
check(outcomes.every((o, i) => (inGroup[i] ? o.csv === DATASET : o.csv === undefined)), "the group holds the exact dataset, and only the group");
check(outcomes.reduce((sum, o) => sum + o.paid, 0) === PRICE, "the shares add up to the price");
check(after[0]! - before[0]! === PRICE, "the seller's wallet holds the full price");
check(offer.groupPayment.seen, "the network has seen the group payment");

const { txid, txUrl: link } = offer.groupPayment;
console.log(`\nDone. ${n(PRICE)} sats paid to the seller in one transaction, by ${group.length} agents.`);
console.log(`The largest budget was ${n(Math.max(...BUYERS.map((b) => b.budget)))} sats: none of them could have bought it alone.\n`);
console.log("  agent   budget   share   network fees");
BUYERS.forEach((b, i) => {
  const { paid } = outcomes[i]!;
  const fees = before[i + 1]! - after[i + 1]! - paid;
  console.log(`  ${b.name.padEnd(6)} ${n(b.budget).padStart(7)} ${n(paid).padStart(7)} ${n(fees).padStart(14)}`);
});
console.log(`\n  group payment ${live ? link ?? txUrl(txid) : `${txid} (simulated)`}`);

await Promise.all(everyone.map((a) => a.stop()));
if (present) {
  console.log(`\nThe web app stays up at http://localhost:3000/#/offers/${id}. Ctrl+C to end.`);
  await new Promise(() => {});
}
process.exit(0);
