#!/usr/bin/env bun
// The market as a command line tool, for agents in any language: every command prints one
// JSON document on stdout, and on failure { "error": ... } with exit code 1.
//   bun agent/cli.ts help
import { mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { type Filters, MarketAgent } from "./market-agent.ts";
import { AgentWallet, walletDir } from "./wallet.ts";

const USAGE = `Options: --wallet <name> (default: agent); API_URL sets the backend.

  address                          identity key, funding address and balance (works offline)
  login                            sign in; prints the Bearer token for the REST API
  search [--q --kind --category --region --status]
  offer <offerId>
  bids                             offers you have bid on, with their state in myBid
  bid <offerId> <maxPrice>         place or update your maximum, in satoshis, and pledge it
  withdraw <offerId>
  request --name --category --region --price <max> [--description] [--minutes 60]
  sell <file> --name --category --region --price [--description] [--minutes 60]
  pay <bidId>                      pledge the unpledged rest of an open bid
  refund <bidId>                   take back unused pledges
  download <bidId> [--out <file>]  decrypt delivered data and confirm receipt
  tasks                            payments to claim and keys to deliver, as a seller
  work                             do everything due now (run this in a loop)`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    wallet: { type: "string", default: "agent" },
    q: { type: "string" },
    kind: { type: "string" },
    category: { type: "string" },
    region: { type: "string" },
    status: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    price: { type: "string" },
    minutes: { type: "string", default: "60" },
    out: { type: "string" },
  },
});
const [command, ...args] = positionals;
const wallet = opts.wallet!;

const listing = () => ({
  name: opts.name,
  category: opts.category,
  region: opts.region,
  description: opts.description ?? "",
  deadline: new Date(Date.now() + Number(opts.minutes) * 60_000).toISOString(),
});

const required = (name: string, value: string | undefined) => {
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const commands: Record<string, () => Promise<unknown>> = {
  address: async () => {
    const w = AgentWallet.open(wallet);
    await w.sync().catch(() => {});
    return { identityKey: w.identityKey, address: w.address, balance: w.balance };
  },
  login: async () => {
    const agent = await MarketAgent.connect(wallet);
    return { token: agent.sessionToken, identityKey: agent.wallet.identityKey };
  },
  search: async () => {
    const { q, kind, category, region, status } = opts;
    const filters = Object.fromEntries(Object.entries({ q, kind, category, region, status }).filter(([, v]) => v));
    return (await MarketAgent.connect(wallet)).search(filters as Filters);
  },
  offer: async () => (await MarketAgent.connect(wallet)).offer(required("offerId", args[0])),
  bids: async () => ({ offers: await (await MarketAgent.connect(wallet)).bids() }),
  bid: async () => (await MarketAgent.connect(wallet)).bid(required("offerId", args[0]), Number(required("maxPrice", args[1]))),
  withdraw: async () => (await MarketAgent.connect(wallet)).withdrawBid(required("offerId", args[0])),
  request: async () =>
    (await MarketAgent.connect(wallet)).createRequest({
      kind: opts.kind ?? "data", ...listing(), maxPrice: Number(required("--price", opts.price)),
    }),
  sell: async () => {
    const file = required("file", args[0]);
    return (await MarketAgent.connect(wallet)).sellData(new Uint8Array(readFileSync(file)), basename(file), {
      ...listing(), price: Number(required("--price", opts.price)),
    });
  },
  pay: async () => (await MarketAgent.connect(wallet)).pay(required("bidId", args[0])),
  refund: async () => (await MarketAgent.connect(wallet)).refund(required("bidId", args[0])),
  download: async () => {
    const bidId = required("bidId", args[0]);
    return save(bidId, await (await MarketAgent.connect(wallet)).download(bidId), opts.out);
  },
  tasks: async () => ({ tasks: await (await MarketAgent.connect(wallet)).sellerTasks() }),
  work: async () => {
    const events = await (await MarketAgent.connect(wallet)).work();
    return {
      events: await Promise.all(events.map(async ({ data, ...e }) =>
        data ? { ...e, ...(await save(e.bidId!, data)) } : e)),
    };
  },
};

/** Writes decrypted data next to the wallets, or to `out`. */
async function save(bidId: string, data: Uint8Array, out?: string) {
  const dir = join(walletDir(), `${wallet}-data`);
  mkdirSync(dir, { recursive: true });
  const file = out ?? join(dir, bidId);
  await Bun.write(file, data);
  return { file, bytes: data.length };
}

if (!command || command === "help" || !commands[command]) {
  console.log(USAGE);
  process.exit(command && command !== "help" ? 1 : 0);
}
try {
  console.log(JSON.stringify(await commands[command]!(), null, 2));
  process.exit(0);
} catch (e) {
  console.log(JSON.stringify({ error: (e as Error).message }));
  process.exit(1);
}
