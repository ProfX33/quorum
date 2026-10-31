import { useEffect, useState } from 'react';
import { fetchQuote, placeBid, withdrawBid } from '../api';
import { payForBid, resumePayment } from '../delivery';
import { sats } from './OfferCard';

const QUOTE_DELAY_MS = 300;

/** What the maximum in the form would do, from the server's quote. */
function BidPreview({ quote }) {
  const { bid, price, minBidToJoin } = quote;
  const excess = bid.alreadyPledged - bid.maxPrice;
  const paid = Math.min(bid.maxPrice, price);
  return (
    <ul className="list-disc space-y-1 pl-4 text-xs text-base-content/80">
      {bid.due > 0 && (
        <li>
          You pledge <strong>{sats(bid.due)}</strong> now
          {bid.alreadyPledged > 0 && `, on top of the ${sats(bid.alreadyPledged)} already pledged`}, plus network fees. Your wallet shows the total and may ask you to sign several times.
        </li>
      )}
      {bid.due === 0 && excess > 0 && (
        <li>
          Nothing leaves your wallet. Your {sats(bid.alreadyPledged)} stay pledged, but only {sats(bid.maxPrice)} can be spent.
          The other {sats(excess)} come back after the deadline, or sooner if you withdraw your bid.
        </li>
      )}
      {bid.due === 0 && excess <= 0 && <li>Nothing leaves your wallet: your pledge already covers this.</li>}
      <li>
        {bid.inGroup
          ? <>If bidding closed now, you would pay <strong>{sats(bid.share)}</strong> in a group of {bid.groupSize}.</>
          : `If bidding closed now, you would not be in the group. It takes at least ${sats(minBidToJoin)} right now.`}
      </li>
      <li>
        You pay at most {sats(paid)}, plus network fees. If you end up out of the group, you get your pledge back, less the network fees.
      </li>
      {bid.maxPrice > price && <li>Your share can never pass the price of {sats(price)}, so anything above it only stays locked until the deadline.</li>}
    </ul>
  );
}

/** Places, changes or withdraws the user's bid, and says what that does before it happens. */
export default function BidForm({ offer, onChange, onCancel }) {
  const bid = offer.myBid;
  const [maxPrice, setMaxPrice] = useState(bid?.maxPrice ?? '');
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const value = Number(maxPrice);
  const valid = Number.isSafeInteger(value) && value > 0;
  const pledged = bid?.pledged ?? 0;
  const unchanged = bid?.status === 'open' && value === bid.maxPrice;

  useEffect(() => {
    if (!valid) return undefined;
    let stale = false;
    const t = setTimeout(() => {
      fetchQuote(offer.id, value).then((q) => !stale && setQuote(q), () => !stale && setQuote(null));
    }, QUOTE_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [offer.id, value, valid, offer.bidCount, offer.share, bid?.status, bid?.maxPrice, pledged]);

  const label = !bid ? 'Bid and pledge'
    : bid.status === 'lost' ? 'Bid again'
    : unchanged ? (value > pledged ? 'Pledge' : 'No change')
    : value < bid.maxPrice ? (value > pledged ? 'Lower and pledge' : 'Lower maximum')
    : (value > pledged ? 'Raise and pledge' : 'Raise maximum');

  async function run(steps) {
    setError('');
    try {
      await steps();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
      onChange();
    }
  }

  // Only pledged money counts, so the wallet is asked right away; a refused prompt leaves the bid to fund later.
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      setBusy('Saving your maximum…');
      const { id, pledged: held } = await placeBid(offer.id, value);
      if (value > held) {
        await payForBid(id, value, setBusy).catch((failed) => {
          throw new Error(`Your maximum of ${sats(value)} is saved, but the pledge did not finish, so only money already pledged counts. ${failed.message}`);
        });
      }
      onCancel();
    });
  };

  const withdraw = () => {
    if (pledged > 0 && !window.confirm(`Withdraw your bid? Your ${sats(pledged)} stop counting and go back to your wallet, less a small network fee.`)) return;
    run(async () => {
      // A bid without a registered pledge is deleted, so an unregistered one must get in first.
      setBusy('Withdrawing…');
      await resumePayment(bid.id);
      await withdrawBid(offer.id);
    });
  };

  return (
    <div className="grid gap-2">
      {!bid && (
        <p className="text-xs text-base-content/70">
          Enter the most you would pay. That amount is pledged now, on a key only your wallet controls. At the deadline you pay your share of the price, never more than your maximum, and the rest comes back.
        </p>
      )}
      <form className="join flex-wrap" onSubmit={submit}>
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
        <button disabled={!!busy || (unchanged && value <= pledged)} className="btn btn-primary btn-sm join-item">
          {busy && <span className="loading loading-spinner loading-xs" />}
          {busy || label}
        </button>
        {!bid && (
          <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm join-item">
            Cancel
          </button>
        )}
        {bid?.status === 'open' && (
          <button type="button" disabled={!!busy} onClick={withdraw} className="btn btn-ghost btn-sm join-item">
            Withdraw
          </button>
        )}
      </form>
      {valid && !unchanged && quote?.bid?.maxPrice === value && <BidPreview quote={quote} />}
      {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error}</span></div>}
    </div>
  );
}
