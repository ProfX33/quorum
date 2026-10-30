# Using the market as an agent

An agent needs no browser and no BSV Desktop. It has its own key on its own machine, and
the server never holds its funds or keys. There are three ways in, from easiest to most work:

| Interface | For | Where |
|-----------|-----|-------|
| JSON command line | agents in any language, LLM tools | [`backend/agent/cli.ts`](../backend/agent/cli.ts) |
| TypeScript client | agents written with Bun | [`backend/agent/market-agent.ts`](../backend/agent/market-agent.ts) |
| REST API | reading the market; writing needs your own BSV signing | [API table](../user_stories/marketplace.md#api-also-for-agents) |

Reads over REST are plain HTTP. Paying is not: pledges have to be signed with the agent's
key, on the agent's machine. That is what the command line and the client do for you.

## See it work

From `backend/`, with Postgres running:

```sh
bun run demo          # simulated network, no funds needed
bun run demo --live   # real transactions; prints the addresses to fund first
```

Two buyer agents want the same dataset. It costs 2,000 sats and each has a budget of 1,200,
so neither can buy it alone. Both bid independently, the market groups them, they pay the
seller in one transaction, and each decrypts the data and uses it for its own mission.

Everything agents do shows up in the web app under **Live activity**, with links to the
transactions, and needs no sign-in. To watch the simulated run:
`API_PROXY=http://localhost:4100 npm run dev` in `frontend/`. Its transactions are made up, so
their WhatsOnChain links lead nowhere; those of a `--live` run are real.

`buyer_agent.py` is a separate agent that decides with Gemini and pays through the command
line (`USE_MOCK_LLM=True` runs it without an API key).

## The command line

Run from `backend/`. Every command prints one JSON document; a failure prints
`{ "error": ... }` and exits with 1. `API_URL` sets the backend. `--wallet <name>` picks the
agent (default `agent`).

```sh
bun agent/cli.ts help

# Create a wallet and fund the address it prints (this step is not needed to sell)
bun agent/cli.ts --wallet alice address

# Buy: find an offer, state the most you would pay, then keep calling work
bun agent/cli.ts --wallet alice search --q "air quality" --region Munich
bun agent/cli.ts --wallet alice bid <offerId> 1200
bun agent/cli.ts --wallet alice work

# Sell: encrypts the file, uploads it and lists it; work claims payments and delivers keys
bun agent/cli.ts --wallet seller sell data.csv --name "Air quality" --category environment \
  --region Munich --price 2000 --minutes 10
bun agent/cli.ts --wallet seller work
```

`work` does everything that is due: it pledges open bids, decrypts delivered data, takes back
unused pledges, claims payments and delivers keys. Run it in a loop. Each step is also its
own command (`pay`, `download`, `refund`, `tasks`).

## What a bid commits you to

- You pay your share of the price, never more than the `maxPrice` you bid. The agent checks
  this and the group payment itself before signing, whatever the server asks for.
- Bidding locks your whole `maxPrice` right away, plus 30 sats per output for fees, in about
  log2(`maxPrice`) outputs. A bid without a pledge does not count at the deadline.
- Nobody signs anything after the deadline: the group's pledges are combined into the
  payment. What your share did not need stays yours, and `work` takes it back, less the fees.
- A pledge stays on your own key until the group payment. You can withdraw before the
  deadline, or if the group fails, and take it back.
- Pledge amounts are public on-chain, so others can see your maximum.
- `dataHash` proves you got the data the seller committed to, not that the data is good.

## Wallets

Wallets are files in `backend/.agent-wallets/` (or `AGENT_WALLET_DIR`), readable only by your
user and ignored by git. **The file contains the private key: back it up, and do not commit
it.** It also holds the agent's coins, since it tracks what the agent can spend. One wallet
serves one process at a time.

The first use takes the key from `AGENT_PRIVATE_KEY` or generates one. Funds sent to the
address are picked up from WhatsOnChain the next time the wallet needs money.
