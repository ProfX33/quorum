# Agent Market — Group Buying for People and AI Agents

Agent Market is a group-buying marketplace for data and services, designed for both people and AI agents. Sellers list an offering at the price they want; buyers pool demand so each can pay only a fraction of that price. Non-custodial BSV payments let participants pay the seller directly from their own wallets.

## The Problem & Our Solution

Buying a useful dataset or service alone can mean paying more than one buyer wants to spend. Agent Market lets buyers coordinate around a seller's asking price: when enough buyers are willing to join, they each contribute a share, while the seller can still receive the full listed price. People can participate directly, and agent integrations can help automate discovery and bidding.

The marketplace coordinates bids and payment evidence to help a group purchase proceed once its members are ready to contribute. Each participant pays from their own wallet, avoiding pooled custody by the marketplace. This can help sellers reach a larger group of buyers without discounting the total price they asked for.

## Architecture & Tech Stack

- **Bun** — installs and runs the TypeScript backend and its scripts.
- **TypeScript backend** — coordinates marketplace activity, agent workflows, and payment-related operations.
- **`@bsv/sdk`** — provides BSV transaction and wallet integration for the backend.
- **BSV wallets** — keep payment authorization with the wallet owner; private keys should never be placed in application configuration.
- **Agent integration** — a Python buyer-agent prototype and Gemini decision support are included as supporting components; the marketplace's group-buying use case also serves human buyers.

## How Group Buying Works

1. **Browse:** People or agents discover available data and services in the marketplace.
2. **Join a group:** Buyers place bids indicating the maximum they are willing to pay. The marketplace coordinates a group when enough buyers can cover the seller's listed price with their agreed shares.
3. **Pay and receive:** Each member pays their share directly to the seller from their own wallet. Once payment is confirmed, the seller delivers the offering to the group.

The Python buyer-agent prototype and its setup are documented in [`agents/README.md`](agents/README.md).

## Local Setup & Run Instructions

Prerequisites: [Bun](https://bun.sh/) and Python 3.10 or later. Run each component from its own directory. Keep `.env` files local and never commit wallet secrets or API keys.

### 1. Configure and run the backend

```bash
cd backend
bun install
```

Create a local environment file from the template and configure the values required by the backend:

```bash
cp .env.example .env
```

Run the included group-buy demo:

```bash
bun run demo
```

The demo shows two agents pooling money for a dataset. See [`backend/.env.example`](backend/.env.example) for the available backend settings.

### 2. Configure and run the Python buyer-agent prototype

In a second terminal:

```bash
cd agents
python -m venv .venv
```

Activate the virtual environment and install dependencies:

```bash
# macOS / Linux
source .venv/bin/activate
pip install -r requirements.txt
```

```powershell
# Windows PowerShell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create the agent's local configuration from its example:

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env`. Fill in the required Gemini and backend settings as described in [`agents/README.md`](agents/README.md), then start the agent:

```bash
python buyer_agent.py
```

## Future Work (Stretch Goals)

The current implementation uses reputation-based settlement and payment coordination. A key stretch goal is a fully atomic **Assurance Contract** using `SIGHASH_ANYONECANPAY`: participants contribute inputs to one transaction, and the seller is paid only when the group is fully funded. This depends on confirming that the wallet APIs used by the project can create the required signatures; until then, the current settlement flow remains the practical MVP.
