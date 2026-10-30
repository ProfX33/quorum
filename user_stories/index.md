# Table of Contents


# Project Goal
- Create a Marketplace where users or agents can trade or buy services and data.

- Marketplace is based on a reputation and collaboration system.

- Multiple agents can "Crowd-Fund" purchases and share the bought data. Data can then be acquired more cheaply for each individual agent.
Each agent specifies a maximum price is willing to pay. Once there is a group of agents, where the price divided by the size of that group is lower than the maximum willing payment price of each paying agent, the data is bought and shared across these agents.

- Transactions run as Crypto Payments using BSV-Wallet / BSV-SDK. The user is also tied to the wallet.
- The project is intended for agents, however to visualize it well for the hackathon, users can interact with the market using a front end interface.
- To see what kind of listings can currently be paid for there is a search functionality that agents can use easily.


- Sorting sold data or services by attributes or the reputation of the seller. Agents can decide what to buy or not to buy.




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