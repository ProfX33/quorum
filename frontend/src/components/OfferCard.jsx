import { useEffect, useState } from 'react';
import { placeBid, withdrawBid } from '../api';

export function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export const shortKey = (key) => `${key.slice(0, 8)}…${key.slice(-6)}`;
export const sats = (n) => `${n.toLocaleString()} sats`;

export function Countdown({ deadline, now }) {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return <span className="text-neutral-500">Ended</span>;
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hms = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return (
    <span className={`font-mono tabular-nums ${ms < 60000 ? 'text-red-600' : ''}`}>
      {days > 0 && `${days}d `}
      {hms}
    </span>
  );
}

export function Attributes({ item }) {
  return (
    <p className="mt-1 text-xs text-neutral-500">
      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-700">{item.kind}</span>
      {' · '}
      {item.category} · {item.region}
    </p>
  );
}

export const STATUS_LABEL = { sold: 'Sold', unsold: 'Not sold', won: 'You won', lost: 'Not in payment group', expired: 'Expired' };

export function OfferCard({ offer, user, now, onChange, onSignIn }) {
  const [maxPrice, setMaxPrice] = useState(offer.myBid?.maxPrice ?? '');
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);
  const open = offer.status === 'open' && new Date(offer.deadline).getTime() > now;

  async function run(action) {
    setError('');
    try {
      await action();
      onChange();
      return true;
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <article className="rounded-lg border border-neutral-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-medium">
            <a href={`#/offers/${offer.id}`} className="hover:underline">
              {offer.name}
            </a>
          </h3>
          <Attributes item={offer} />
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-medium">{sats(offer.price)}</div>
          <div className="text-sm">
            {offer.status === 'open' ? <Countdown deadline={offer.deadline} now={now} /> : STATUS_LABEL[offer.status]}
          </div>
        </div>
      </div>
      {offer.description && <p className="mt-3 whitespace-pre-line text-sm text-neutral-700">{offer.description}</p>}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-neutral-500">
        <dt>Seller</dt>
        <dd className="font-mono">{offer.mine ? 'you' : shortKey(offer.seller)}</dd>
        {offer.dataHash && (
          <>
            <dt>Commitment</dt>
            <dd className="truncate font-mono" title={offer.dataHash}>{offer.dataHash}</dd>
          </>
        )}
        <dt>Bidders</dt>
        <dd>
          {offer.bidCount}
          {offer.status === 'open' &&
            (offer.share
              ? ` — would sell now: ${offer.payers} payer${offer.payers > 1 ? 's' : ''} at ~${sats(offer.share)}`
              : ' — not funded yet')}
          {offer.status === 'sold' && ` — paid by ${offer.payers}`}
        </dd>
      </dl>

      {offer.myBid && (
        <p className="mt-3 text-sm">
          Your max: {sats(offer.myBid.maxPrice)}
          {offer.myBid.status === 'won' && <strong> — you pay {sats(offer.myBid.amount)}</strong>}
          {offer.myBid.status !== 'open' && offer.myBid.status !== 'won' && ` — ${STATUS_LABEL[offer.myBid.status]}`}
        </p>
      )}

      {offer.mine && open && <p className="mt-3 text-sm text-neutral-500">This is your offer — you can't bid on it.</p>}
      {!user && !offer.mine && open && onSignIn && (
        <button
          onClick={onSignIn}
          className="mt-3 rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-neutral-800"
        >
          Sign in to make a buying offer
        </button>
      )}
      {user && !offer.mine && open && !offer.myBid && !composing && (
        <button
          onClick={() => setComposing(true)}
          className="mt-3 rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-neutral-800"
        >
          Make buying offer
        </button>
      )}
      {user && !offer.mine && open && (offer.myBid || composing) && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => placeBid(offer.id, Number(maxPrice))).then((ok) => ok && setComposing(false));
          }}
        >
          <input
            required
            type="number"
            min={1}
            step={1}
            placeholder="Max. you pay (sats)"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className="w-44 rounded-md border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-black"
          />
          <button className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
            {offer.myBid ? 'Update buying offer' : 'Place buying offer'}
          </button>
          {!offer.myBid && (
            <button type="button" onClick={() => setComposing(false)} className="text-sm text-neutral-500 hover:text-black">
              Cancel
            </button>
          )}
          {offer.myBid && (
            <button
              type="button"
              onClick={() => run(() => withdrawBid(offer.id))}
              className="text-sm text-neutral-500 hover:text-black"
            >
              Withdraw
            </button>
          )}
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </article>
  );
}
