# Listing and request (marketplace)

A seller lists an offer (data, a real-world service, or another product), or a buyer
posts a request. Buyers state the maximum they would pay; at the deadline the price is
split over a group of buyers who all can afford their share.

## Data model

| Table         | Holds |
|---------------|-------|
| `sell_offers` | kind, category, region, name, description, price, deadline, `data_hash` (sha256 commitment to the encrypted data, required for `data`), `seller_key_wrap`, `payment_deadline`, status `open` / `sold` / `unsold` |
| `data_files`  | uploaded ciphertext by its sha256, owner, public file name and size |
| `buy_offers`  | a bid (`sell_offer_id` set, `max_price`) or a standalone request (`sell_offer_id` NULL, with its own attributes and deadline). Status `open` / `won` / `lost` / `expired`, then `paid` / `delivered` / `received` / `defaulted` / `disputed`; `amount` is what a winner pays, plus payment and delivery fields |

When a seller answers a request with an offer, the request is linked to that offer and
the requester becomes its first bidder. Others can join to share the price.

## Settlement (`backend/src/settlement.ts`)

Runs every few seconds for offers past their deadline:

Only pledged money counts: a bid is worth its maximum as far as its pledges cover it, and a
bid with no pledge is ignored.

1. Split the price evenly over every funded bid.
2. Cut out every bidder whose funded maximum is below their share.
3. Repeat with the rest until everyone left can pay (offer `sold`, they `pledged`) or nobody is left (`unsold`).

Prices are integer satoshis; a rounding remainder goes to the highest bidders.

## Payment and data delivery (`backend/src/delivery.ts`, `frontend/src/delivery.js`)

The server never holds funds or keys.

1. **Listing.** The seller's browser encrypts the file with a random AES-256-GCM key and
   uploads only the ciphertext (`iv || ciphertext+tag`). The server computes its sha256,
   which becomes the offer's `dataHash`. The key is encrypted by the seller's wallet to
   itself (BRC-2, protocol `datamarket data key`, keyID = `dataHash`) and stored as
   `sellerKeyWrap`, so the seller only needs their wallet to deliver later.
2. **Bidding is paying to commit.** While the offer is open, the buyer's wallet locks their
   maximum to a key of their own (`GET`/`POST /api/bids/:id/payment`). It is split into
   denominations (1, 2, 4, ... and the rest), each output carrying a 30 sat fee contribution,
   and each is signed `ALL|ANYONECANPAY` for the group outputs: the full price to the seller
   and an OP_RETURN tag. The seller's BRC-29 key is fixed at listing. Withdrawing before the
   deadline makes the pledge refundable, and raising a maximum pledges the difference.
3. **Payment.** At the deadline the group is formed from pledged money, and the server
   combines exactly the outputs that add up to each share into one transaction and broadcasts
   it through Arcade. Nobody signs anything after the deadline, so nobody can hold the group
   up by not paying. If a member spends their pledge elsewhere, the network rejects the
   payment; that member is `defaulted` and the group is re-formed at once from what the others
   have pledged, with larger shares up to their maxima, or the offer fails. An offer whose
   payment cannot be built within `PAYMENT_WINDOW_MINUTES` fails too.
4. **Delivery.** Once the network has seen a payment, the seller's wallet claims it
   (`internalizeAction`, "wallet payment") and wraps the data key for that buyer
   (counterparty = buyer, keyID = offer id). In the web app this runs in the background
   while the seller is signed in.
5. **Download.** The buyer's wallet unwraps the key. The ciphertext is checked against
   `dataHash` and decrypted. AES-GCM fails on a wrong key, and the buyer then reports it
   (`ok: false`), which asks the seller to deliver again. After 3 failed deliveries the bid
   is `disputed`.

Bid states: `open` → `pledged` (in the group) → `paid` → `delivered` → `received`, or
`disputed`; `lost` when withdrawn, unfunded, outside the group or the offer failed;
`defaulted` when the pledge was spent elsewhere.

Everything a buyer pledged and that no payment used stays theirs: they take it back with a
refund their own wallet signs (`GET`/`POST /api/bids/:id/refund`), less the fee contributions.

Known limits:
- The seller (or their agent) has to come online to deliver. The key cannot be released
  without them, because the server cannot decrypt.
- `dataHash` proves the buyer gets the data that was committed to, not that it is good.
- A payment counts once it is seen on the network (0-conf).
- A pledge is not locked: it sits on the buyer's own key, which is what keeps this
  non-custodial, so it can be spent until the group payment is seen. That cannot block the
  payment, but it can cost a retry per defector, make the others' shares larger, or fail the
  offer if the rest cannot cover the price. A defector pays only their mining fees.
- Every output costs its 30 sat fee contribution, spent or refunded, so a bid's overhead is
  about 30 sats times log2 of its maximum, even if the offer fails.
- Buyers' refunds need the pledge transactions, which the server hands out. If it is gone,
  the funds are still on the buyer's key, but the wallet has to find them itself.

`backend/scripts/delivery-e2e.ts` runs the whole flow with two agents against a mock Arcade.
It also shows how an agent uses this API.

## API (also for agents)

Reads are public. Writes need `Authorization: Bearer <token>` (see `backend/scripts/agent-login.ts`).
Agents do not have to call this directly: see [agents/README.md](../agents/README.md).

| Method | Path | Body / query |
|--------|------|--------------|
| GET    | `/api/search` | `q, kind, category, region, status` (`open` default, or `all`) → `{ offers, requests }` |
| GET    | `/api/offers`, `/api/offers/:id` | same filters |
| POST   | `/api/offers` | `{ kind, category, region, name, description, price, deadline, dataHash, sellerKeyWrap, requestId? }` (data offers: upload first) |
| GET    | `/api/activity` | the latest 50 public events (listings, bids, pledges, group payments, deliveries, refunds) with their txids; bid maxima are not included |
| GET    | `/api/offers/:id/quote` | optional `maxPrice`, else your own bid → `{ price, secondsLeft, biddingOpen, group (null once closed): { fundedBidders, unfundedBidders, fundedTotal, forms, size, share }, minBidToJoin, bid: { maxPrice, groupSize, inGroup, share, lockNow, alreadyPledged, fees, costAtShare, costIfNotBought, maxCost } }`; public, `bid` is null without a maximum and on your own or closed offers |
| GET    | `/api/exposure` | your pledges → `{ locked, refundable, refundFee, bids: [...] }` in satoshis |
| GET    | `/api/bids` | the offers you have bid on, any state; your bid is in `myBid` |
| POST   | `/api/offers/:id/bid` | `{ maxPrice }` (re-post to update) |
| DELETE | `/api/offers/:id/bid` | withdraw bid before the deadline |
| GET    | `/api/requests` | same filters |
| POST   | `/api/requests` | `{ kind, category, region, name, description, maxPrice, deadline }` |
| DELETE | `/api/requests/:id` | withdraw own open request |
| POST   | `/api/data?name=` | raw ciphertext body (max `MAX_DATA_MB`) → `{ dataHash, size }` |
| GET    | `/api/offers/:id/data` | the offer's ciphertext (public, check it against `dataHash`) |
| GET    | `/api/bids/:id/payment` | bidder: `{ amount, pledged, due, fee, outputs (satoshis), keyID, groupOutputs, ... }` |
| POST   | `/api/bids/:id/payment` | bidder: `{ beef, pledges: [{ vout, unlockingScript }], keyID }`, idempotent |
| GET    | `/api/bids/:id/refund` | buyer out of the group: `{ fee, pledges }` to sign |
| POST   | `/api/bids/:id/refund` | buyer: `{ beef }`, must spend all their unused pledges |
| GET    | `/api/seller/tasks` | seller: payments to claim (`claim`) and keys to deliver (`deliver`) |
| POST   | `/api/bids/:id/claimed` | seller: payment taken into the wallet |
| POST   | `/api/bids/:id/delivery` | seller: `{ wrappedKey }` (hex) |
| GET    | `/api/bids/:id/delivery` | buyer: `{ offerId, seller, dataHash, wrappedKey }` |
| POST   | `/api/bids/:id/receipt` | buyer: `{ ok, reason? }` |

Offers in a listing include `bidCount`, and while open `payers` / `share`: what the
settlement would give on the funded bids. The API does not expose other buyers' maxima, but
pledge amounts are public on-chain, and `/quote` works from them: trying different `maxPrice`
values reveals what the others have funded, which the chain shows anyway.

A quote is what would happen if bidding closed now. New bids lower the share, and a member
dropping out raises it; `maxCost` holds either way. `fees` is the fee contributions of all
the bid's outputs plus an estimate of the mining fee for the new pledge.
