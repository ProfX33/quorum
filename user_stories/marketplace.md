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

1. Split the price evenly over everybody who bid.
2. Cut out every bidder whose maximum is below their share.
3. Repeat with the rest until everyone left can pay (offer `sold`, they `won`) or nobody is left (`unsold`).

Prices are integer satoshis; a rounding remainder goes to the highest bidders.

## Payment and data delivery (`backend/src/delivery.ts`, `frontend/src/delivery.js`)

The server never holds funds or keys.

1. **Listing.** The seller's browser encrypts the file with a random AES-256-GCM key and
   uploads only the ciphertext (`iv || ciphertext+tag`). The server computes its sha256,
   which becomes the offer's `dataHash`. The key is encrypted by the seller's wallet to
   itself (BRC-2, protocol `datamarket data key`, keyID = `dataHash`) and stored as
   `sellerKeyWrap`, so the seller only needs their wallet to deliver later.
2. **Settlement.** Every winner gets their own BRC-29 derivation (prefix/suffix) and the
   group gets a payment window (`PAYMENT_WINDOW_MINUTES`, default 60).
3. **Payment.** The winner's wallet pays its share straight to the seller (`createAction`
   with the outputs from `GET /api/bids/:id/payment`, plus an OP_RETURN tag
   `tum-datamarket <offerId> <bidId>`). The sender of the BRC-29 payment is the public
   "anyone" key, so the server can derive the seller's payment script from the seller's
   identity key and check the transaction. It verifies the signatures, broadcasts through
   Arcade and follows the transaction until the network has seen it. A rejected payment
   (e.g. double spend) is undone so the buyer can pay again.
4. **Delivery.** Once the network has seen a payment, the seller's wallet claims it
   (`internalizeAction`, "wallet payment") and wraps the data key for that buyer
   (counterparty = buyer, keyID = offer id). In the web app this runs in the background
   while the seller is signed in.
5. **Download.** The buyer's wallet unwraps the key. The ciphertext is checked against
   `dataHash` and decrypted. AES-GCM fails on a wrong key, and the buyer then reports it
   (`ok: false`), which asks the seller to deliver again. After 3 failed deliveries the bid
   is `disputed`.

Bid states after settlement: `won` → `paid` → `delivered` → `received`, or `defaulted`
when the window passes without payment (a valid late payment is still accepted, since the
money already reached the seller), or `disputed`.

Each buyer is served as soon as their own payment is through. So a group member who
does not pay never blocks the others or needs a refund; the seller just receives less.

Known limits:
- The seller (or their agent) has to come online to deliver. The key cannot be released
  without them, because the server cannot decrypt.
- `dataHash` proves the buyer gets the data that was committed to, not that it is good.
- A payment counts once it is seen on the network (0-conf).

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
| GET    | `/api/bids` | the offers you have bid on, any state; your bid is in `myBid` |
| POST   | `/api/offers/:id/bid` | `{ maxPrice }` (re-post to update) |
| DELETE | `/api/offers/:id/bid` | withdraw bid before the deadline |
| GET    | `/api/requests` | same filters |
| POST   | `/api/requests` | `{ kind, category, region, name, description, maxPrice, deadline }` |
| DELETE | `/api/requests/:id` | withdraw own open request |
| POST   | `/api/data?name=` | raw ciphertext body (max `MAX_DATA_MB`) → `{ dataHash, size }` |
| GET    | `/api/offers/:id/data` | the offer's ciphertext (public, check it against `dataHash`) |
| GET    | `/api/bids/:id/payment` | winner: `{ amount, deadline, description, outputs }` for `createAction` |
| POST   | `/api/bids/:id/payment` | winner: `{ beef }` (hex AtomicBEEF from `createAction`), idempotent |
| GET    | `/api/seller/tasks` | seller: payments to claim (`claim`) and keys to deliver (`deliver`) |
| POST   | `/api/bids/:id/claimed` | seller: payment taken into the wallet |
| POST   | `/api/bids/:id/delivery` | seller: `{ wrappedKey }` (hex) |
| GET    | `/api/bids/:id/delivery` | buyer: `{ offerId, seller, dataHash, wrappedKey }` |
| POST   | `/api/bids/:id/receipt` | buyer: `{ ok, reason? }` |

Offers in a listing include `bidCount`, and while open `payers` / `share`: what the
settlement would give on the current bids. Individual maxima of other buyers are not exposed.
