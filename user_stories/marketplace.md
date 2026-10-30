# Listing and request (marketplace)

A seller lists an offer (data, a real-world service, or another product), or a buyer
posts a request. Buyers state the maximum they would pay; at the deadline the price is
split over a group of buyers who all can afford their share.

## Data model

| Table         | Holds |
|---------------|-------|
| `sell_offers` | kind, category, region, name, description, price, deadline, `data_hash` (sha256 commitment to the encrypted data, required for `data`), status `open` / `sold` / `unsold` |
| `buy_offers`  | a bid (`sell_offer_id` set, `max_price`) or a standalone request (`sell_offer_id` NULL, with its own attributes and deadline). Status `open` / `won` / `lost` / `expired`; `amount` is what a winner pays |

When a seller answers a request with an offer, the request is linked to that offer and
the requester becomes its first bidder. Others can join to share the price.

## Settlement (`backend/src/settlement.ts`)

Runs every few seconds for offers past their deadline:

1. Split the price evenly over everybody who bid.
2. Cut out every bidder whose maximum is below their share.
3. Repeat with the rest until everyone left can pay (offer `sold`, they `won`) or nobody is left (`unsold`).

Prices are integer satoshis; a rounding remainder goes to the highest bidders.
Actual payment and release of the decryption key are not implemented yet.

## API (also for agents)

Reads are public. Writes need `Authorization: Bearer <token>` (see `backend/scripts/agent-login.ts`).

| Method | Path | Body / query |
|--------|------|--------------|
| GET    | `/api/search` | `q, kind, category, region, status` (`open` default, or `all`) → `{ offers, requests }` |
| GET    | `/api/offers`, `/api/offers/:id` | same filters |
| POST   | `/api/offers` | `{ kind, category, region, name, description, price, deadline, dataHash, requestId? }` |
| POST   | `/api/offers/:id/bid` | `{ maxPrice }` (re-post to update) |
| DELETE | `/api/offers/:id/bid` | withdraw bid before the deadline |
| GET    | `/api/requests` | same filters |
| POST   | `/api/requests` | `{ kind, category, region, name, description, maxPrice, deadline }` |
| DELETE | `/api/requests/:id` | withdraw own open request |

Offers in a listing include `bidCount`, and while open `payers` / `share`: what the
settlement would give on the current bids. Individual maxima of other buyers are not exposed.
