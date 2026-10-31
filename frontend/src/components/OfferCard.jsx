import { useEffect, useState } from 'react';
import { placeBid, withdrawBid, withdrawOffer } from '../api';
import { canRefund, payForBid } from '../delivery';
import { BuyerDeal, SellerDeal } from './Deal';
import Reputation from './Reputation';
import { UserLink, profileHref, shortKey } from './UserLink';

export { shortKey } from './UserLink';

export function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export const sats = (n) => `${n.toLocaleString()} sats`;

export function Countdown({ deadline, now }) {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return <span className="badge badge-ghost">Ended</span>;
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hms = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return (
    <span className={`badge badge-soft font-mono tabular-nums ${ms < 60000 ? 'badge-error' : 'badge-info'}`}>
      {days > 0 && `${days}d `}
      {hms}
    </span>
  );
}

export function Attributes({ item }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <span className="badge badge-primary badge-sm px-3">{item.kind}</span>
      <span className="badge badge-outline badge-sm px-3">{item.category}</span>
      {item.region && <span className="badge badge-outline badge-sm px-3">{item.region}</span>}
    </div>
  );
}

export const KindBadge = ({ kind }) => (
  <span className={`badge badge-xs font-sans ${kind === 'agent' ? 'badge-primary' : 'badge-ghost'}`}>{kind === 'agent' ? 'Agent' : 'Human'}</span>
);

export const STATUS_LABEL = {
  sold: 'Sold',
  unsold: 'Not sold',
  won: 'You won',
  pledged: 'In payment group',
  lost: 'Not in payment group',
  expired: 'Expired',
  paid: 'Paid',
  delivered: 'Delivered',
  received: 'Received',
  disputed: 'Disputed',
  defaulted: 'Pledge spent',
};

// How far each bidder got, as shown next to them on an offer.
const BIDDER_LABEL = {
  open: '',
  won: 'in group',
  pledged: 'pledged',
  paid: 'paid',
  delivered: 'paid',
  received: 'paid',
  disputed: 'disputed',
  defaulted: 'spent pledge',
  lost: 'out',
};
const BIDDERS_ON_CARD = 6;

const fileSize = (n) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function OfferCard({ offer, user, now, onChange, onSignIn, linked = false }) {
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
    <article
      className={`card card-border bg-base-200 transition ${linked ? 'cursor-pointer hover:-translate-y-1 hover:border-primary hover:bg-base-300 hover:shadow-xl' : ''}`}
      onClick={(e) => {
        if (linked && !e.target.closest('a,button,input,select,form')) window.location.hash = `#/offers/${offer.id}`;
      }}
    >
      <div className="card-body gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="card-title">
            <a href={`#/offers/${offer.id}`} className="link link-hover">
              {offer.name}
            </a>
          </h3>
          <Attributes item={offer} />
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-medium">{sats(offer.price)}</div>
          <div className="text-sm">
            {offer.status === 'open' ? <Countdown deadline={offer.deadline} now={now} /> : <span className="badge badge-neutral">{STATUS_LABEL[offer.status]}</span>}
          </div>
        </div>
      </div>
      {offer.description && <p className="mt-3 whitespace-pre-line text-sm text-base-content/90">{offer.description}</p>}
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-base-content/70">
        <dt>Seller</dt>
        <dd className="flex items-center gap-2 font-mono">
          <a href={profileHref(offer.seller)} title={offer.seller} className="link link-hover">
            {offer.mine ? 'you' : shortKey(offer.seller)}
          </a>
          <KindBadge kind={offer.sellerKind} />
          <Reputation value={offer.sellerReputation} size="xs" />
        </dd>
        {offer.dataHash && (
          <>
            <dt>Commitment</dt>
            <dd className="truncate font-mono" title={offer.dataHash}>{offer.dataHash}</dd>
          </>
        )}
        {offer.file && (
          <>
            <dt>File</dt>
            <dd className="truncate">
              {offer.file.name} · {fileSize(offer.file.size)} encrypted ·{' '}
              <a href={`/api/offers/${offer.id}/data`} className="link" title="Download the ciphertext to check it against the commitment">
                ciphertext
              </a>
            </dd>
          </>
        )}
        <dt>Bidders</dt>
        <dd>
          {offer.bidCount}
          {offer.status === 'open' &&
            (offer.share
              ? ` pledged — would sell now: ${offer.payers} payer${offer.payers > 1 ? 's' : ''} at ~${sats(offer.share)}`
              : ' — not funded yet')}
          {offer.status === 'sold' && ` — paid by ${offer.payers}`}
        </dd>
        {offer.groupPayment && (
          <>
            <dt>Payment</dt>
            <dd>
              {offer.groupPayment.txid ? (
                <>
                  <a href={offer.groupPayment.txUrl} target="_blank" rel="noreferrer" className="link font-mono">
                    {offer.groupPayment.txid.slice(0, 16)}…
                  </a>
                  {offer.groupPayment.seen ? ' — seen on the network' : ' — broadcasting'}
                </>
              ) : (
                `${offer.groupPayment.pledged} of ${offer.groupPayment.members} pledged`
              )}
            </dd>
          </>
        )}
        {offer.bidders.length > 0 && (
          <>
            <dt className="sr-only">Bidder profiles</dt>
            <dd className="col-start-2 flex flex-wrap gap-x-4 gap-y-1">
              {(linked ? offer.bidders.slice(0, BIDDERS_ON_CARD) : offer.bidders).map((b) => (
                <span key={b.identityKey} className="inline-flex min-w-0 items-center gap-1">
                  <UserLink person={b} you={b.identityKey === user?.identityKey} />
                  {BIDDER_LABEL[b.status] && <span className="text-base-content/50">· {BIDDER_LABEL[b.status]}</span>}
                </span>
              ))}
              {linked && offer.bidders.length > BIDDERS_ON_CARD && (
                <a href={`#/offers/${offer.id}`} className="link link-hover">+{offer.bidders.length - BIDDERS_ON_CARD} more</a>
              )}
            </dd>
          </>
        )}
      </dl>

      {offer.myBid && ['open', 'lost'].includes(offer.myBid.status) && (
        <div role="alert" className="alert alert-soft alert-info text-sm">
          <span>
            Your max: {sats(offer.myBid.maxPrice)}
            {offer.myBid.status === 'lost' && ` — ${STATUS_LABEL.lost}`}
          </span>
        </div>
      )}
      {/* A lost bid can still hold pledges from before the group failed. */}
      {offer.myBid && ((offer.myBid.status === 'open' && open) || !['open', 'lost'].includes(offer.myBid.status) || (offer.myBid.status === 'lost' && canRefund(offer.myBid))) && (
        <BuyerDeal offer={offer} now={now} onChange={onChange} />
      )}
      {offer.mine && offer.sales && <SellerDeal offer={offer} />}

      {offer.mine && open && <div role="alert" className="alert alert-soft alert-info text-sm"><span>This is your offer — you can't bid on it.</span></div>}
      {offer.mine && open && (
        <button
          onClick={() => {
            const bids = offer.bidCount > 0 ? ` Its ${offer.bidCount} buying offer${offer.bidCount > 1 ? 's' : ''} will be dropped.` : '';
            if (!window.confirm(`Withdraw "${offer.name}"?${bids}`)) return;
            // On its own page the offer is gone afterwards: back to the market.
            run(() => withdrawOffer(offer.id).then(() => { if (!linked) window.location.hash = '#/market'; }));
          }}
          className="btn btn-ghost btn-sm self-start"
        >
          Withdraw offer
        </button>
      )}
      {!user && !offer.mine && open && onSignIn && (
        <button
          onClick={onSignIn}
          className="btn btn-primary btn-sm self-start"
        >
          Sign in to make a buying offer
        </button>
      )}
      {user && !offer.mine && open && !offer.myBid && !composing && (
        <button
          onClick={() => setComposing(true)}
          className="btn btn-primary btn-sm self-start"
        >
          Make buying offer
        </button>
      )}
      {user && !offer.mine && open && (offer.myBid || composing) && (
        <form
          className="join flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            // Only pledged money counts, so the wallet is asked right away; a refused prompt leaves the bid to fund later.
            run(async () => {
              const { id } = await placeBid(offer.id, Number(maxPrice));
              const pledged = offer.myBid?.pledged ?? 0;
              if (Number(maxPrice) > pledged) await payForBid(id, Number(maxPrice));
            }).then((ok) => ok && setComposing(false));
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
            className="input input-bordered input-sm join-item w-44"
          />
          <button className="btn btn-primary btn-sm join-item">
            {offer.myBid ? 'Update and pledge' : 'Bid and pledge'}
          </button>
          {!offer.myBid && (
            <button type="button" onClick={() => setComposing(false)} className="btn btn-ghost btn-sm join-item">
              Cancel
            </button>
          )}
          {offer.myBid?.status === 'open' && (
            <button
              type="button"
              onClick={() => run(() => withdrawBid(offer.id))}
              className="btn btn-ghost btn-sm join-item"
            >
              Withdraw
            </button>
          )}
        </form>
      )}
      {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error}</span></div>}
      </div>
    </article>
  );
}
