# Table of Contents


PROJECT.md — Project context for coding agents

Read this file together with AGENTS.md (from the BSV developer pack). If anything here conflicts with AGENTS.md or BSV_STACK_COMPLETE_GUIDE.md, the developer pack wins for anything about BSV APIs, package versions and wallet setup. This file wins on what we are building and what is in scope.

1. What we are building

It is a non-custodial group-buy protocol and marketplace for data and services on BSV for agents or users. Sellers list datasets or services at a fixed price. Buyers (mostly AI agents, also humans through a web UI) place bids on a listing with the most they're willing to pay. When enough bids exist that listing_price / group_size <= every group member's max bid, the group locks, each member pays an equal share straight from their own wallet, and the seller delivers the data to every member. Agents get data cheaper by pooling demand, and sellers reach buyers who would never pay the full price alone. A reputation score built from completed, paid deals helps agents decide whom to buy from.

Hackathon: TUM Blockchain & AI Hackathon, BSV Association track ("DeFi Rails for Agentic Payments"), 30–31 October 2026. The group-buy protocol is the DeFi product and the core of the project. The marketplace UI and the agent show it working.

2. Core concepts
Concept	Meaning
Identity	A participant is their wallet's identity public key. No usernames or passwords. Sign-in = the wallet signs a challenge.
Listing	{id, seller_identity_key, title, description, tags, price_sats, data_hash, delivery_type, expires_at}. data_hash = SHA-256 of the payload, committed up front so buyers can check what they receive.
Bid	{listing_id, buyer_identity_key, max_price_sats, expires_at, signature}. Signed by the buyer's wallet, so no one can fake a bid.
Group	The set of bids that clears a listing. Locked once formed; each member owes ceil(price / k).
Deal	A group whose members all paid, with on-chain txids and a delivery receipt. Deals are where reputation comes from.
Reputation	Derived only from completed deals: number of deals, total value settled, delivery rate, and ratings that buyers sign after delivery. One rating per buyer per deal. Display it, don't over-engineer it.
3. Matching rule (deterministic)

For a listing with price P and open, unexpired bids:

Sort bids by max_price_sats descending: b1 >= b2 >= ... >= bn.
Find the largest k such that ceil(P / k) <= b_k.
If such a k exists, the top k bids form the group, each paying share = ceil(P / k). Bids below b_k stay open for a later round, if the listing allows repeat sales.
Ties at the cut-off: earliest bid wins.

Choosing the largest k gives everyone the lowest share. The matching engine should be a pure function with unit tests. It runs off-chain, and only payments and receipts go on-chain.

4. Payment flow

MVP (build this first): direct split payments

Group locks, and every member is notified (an agent learns it by polling or from a webhook).
Each member pays share directly to the seller's address from their own wallet (createAction). Put an OP_RETURN output on each payment tagging {protocol_id, listing_id, group_id} so the payments can be found and audited on-chain.
The backend watches for all k payments (by txid, as reported by clients and checked against the chain).
When all are paid, the seller delivers (see §6). If a member doesn't pay within the timeout, the group dissolves and the seller refunds paid members out of their own wallet (that refund is a known MVP limitation; say so in the README), and the listing goes back to matching.

Stretch: atomic assurance contract One transaction with a single output paying P to the seller. Each member adds one input worth share, signed with SIGHASH_ALL | SIGHASH_ANYONECANPAY, so their signature commits only to the seller output and their own input. The transaction can't be broadcast until it is fully funded, so nobody ever pays for a group that fails to fill. Before you build this, check in the developer pack whether BRC-100 wallets (createAction / signAction) can produce ANYONECANPAY signatures. If they can't, stay with the MVP.

5. Visuals
All current available listings should be searchable and visible to agents.
The project should have a frontend where a user can view the listings and list things / buy things themselves in a graphical interface. The user can basically act like an agent. This will also be used to demonstrate functionality during the presentation.











Context given by the organizers of the Hackathon:
# BSV Association: DeFi Rails for Agentic Payments
Help me build a project for the BSV track of the TUM Blockchain & AI Hackathon (30-31 October 2026, Munich). Ask what I want to build before writing code.

Track rules: https://hackathon.tum-blockchain.com/prizes#bsv-association
Submission rules: https://hackathon.tum-blockchain.com/prizes#how-to-submit

Source of truth
- BSV developer pack: https://drive.google.com/drive/folders/179lAsiQEiV1Fpf9SY8b0y4456-3QfxfG?usp=sharing
  Read START-HERE.md, copy AGENTS.md to the repository root and use BSV_STACK_COMPLETE_GUIDE.md as the main reference. Prefer its tested code (Appendix A) over code from memory.
- Use the package versions pinned in AGENTS.md. The old ts-sdk and wallet-toolbox repositories are superseded by ts-stack: https://github.com/bsv-blockchain/ts-stack (docs: https://bsv-blockchain.github.io/ts-stack/).
- The starter kit in the pack (starter/bsv21-token-kit, 38 tests) shows how every flow is called.

Optional agent plugins from bOpen (community tools, not maintained by BSV Association; if they disagree with the developer pack, follow the pack)
- bsv-skills: transactions, key derivation, BRC-100 wallets, script templates, message signing. Claude Code: /plugin install bsv-skills@b-open-io
- 1sat: 1Sat Ordinals, BSV-21 tokens, wallet connection for dApps. Claude Code: /plugin install 1sat@b-open-io
- bsv-mcp: MCP server for price, transaction and address lookups. Claude Code: /plugin install bsv-mcp@b-open-io
- Codex, OpenCode and other harnesses: https://bopen.ai/agents

Rules
- Connect user flows to a standard BSV wallet (BSV Desktop or BSV Browser) through WalletClient. Keys never leave the wallet: never ask for a private key or recovery phrase.
- Make real transactions on BSV (testnet or mainnet) and keep user funds non-custodial.
- Include an AI agent that makes a real payment through the project.
- Broadcast through Arcade (https://arcade-v2-us-1.bsvblockchain.tech) and link example transactions on WhatsOnChain (https://whatsonchain.com).
- For test funds, message the BSV support contact listed on the track page with your BSV address and team name.
- Keep keys and secrets out of prompts and repositories.