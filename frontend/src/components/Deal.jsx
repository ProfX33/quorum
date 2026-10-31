import { useEffect, useState } from 'react';
import { request } from '../api';
import {
  canRefund,
  downloadPurchase,
  hasPendingPayment,
  payForBid,
  refundPledges,
  requestRedelivery,
  resumePayment,
} from '../delivery';
import { Countdown, sats } from './OfferCard';

function TxLink({ bid }) {
  if (!bid.txid) return null;
  return (
    <a href={bid.txUrl} target="_blank" rel="noreferrer" className="link font-mono text-xs">
      {bid.txid.slice(0, 16)}…
    </a>
  );
}

/** What the buyer does: pledge while bidding, wait for the group, download (or take the pledge back). */
export function BuyerDeal({ offer, now, onChange }) {
  const bid = offer.myBid;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [canAskAgain, setCanAskAgain] = useState(false);

  async function run(label, action) {
    setBusy(label);
    setError('');
    try {
      await action();
      onChange();
    } catch (e) {
      setError(e.message);
      return e;
    } finally {
      setBusy('');
    }
  }

  // A pledge signed earlier whose submission did not get through is resubmitted, never pledged twice.
  useEffect(() => {
    if (['open', 'defaulted', 'lost'].includes(bid.status) && hasPendingPayment(bid.id)) {
      run('Registering your pledge…', () => resumePayment(bid.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bid.id, bid.status]);

  const spinner = busy && <span className="loading loading-spinner loading-xs" />;
  const group = offer.groupPayment;
  const refundButton = canRefund(bid) && (
    <button disabled={!!busy} onClick={() => run('Waiting for wallet…', () => refundPledges(bid.id))} className="btn btn-primary btn-sm">
      {spinner}
      {busy || (bid.refundable > 0 ? `Take back ${sats(bid.refundable - bid.refundFee)}` : 'Finish taking back your pledge')}
    </button>
  );
  const downloadButton = (
    <button
      disabled={!!busy}
      onClick={async () => {
        const failed = await run('Decrypting…', () => downloadPurchase(bid.id, offer.file?.name));
        // The wallet refusing to unwrap may be a denied prompt; the buyer decides whether to ask again.
        setCanAskAgain(!!failed && bid.status === 'delivered' && !/seller has been asked/.test(failed.message));
      }}
      className="btn btn-primary btn-sm"
    >
      {spinner}
      {busy || (bid.status === 'delivered' ? 'Download & decrypt' : 'Download again')}
    </button>
  );
  // The payment went through: what the share did not need comes back.
  const leftover = (bid.paymentSeen && bid.status !== 'defaulted') && canRefund(bid);
  let body;
  if (bid.status === 'open') {
    const due = bid.maxPrice - bid.pledged;
    if (due <= 0) {
      body = (
        <span>
          Your {sats(bid.pledged)} are pledged, so your bid counts. At the deadline the group pays by itself, you only pay your share
          and take back the rest. The pledge stays yours until then: withdraw your bid to get it back.
        </span>
      );
    } else {
      body = (
        <>
          <span>
            Only pledged money counts at the deadline. Pledge <strong>{sats(due)}</strong> to back your maximum
            (plus a small fee per output). You pay your share at most, and the pledge stays yours unless the group covers the price.
          </span>
          <button disabled={!!busy} onClick={() => run('Waiting for wallet…', () => payForBid(bid.id, bid.maxPrice))} className="btn btn-primary btn-sm">
            {spinner}
            {busy || `Pledge ${sats(due)}`}
          </button>
        </>
      );
    }
  } else if (bid.status === 'pledged') {
    body = (
      <span>
        You are in the payment group for <strong>{sats(bid.amount)}</strong>. The payment is being built from the group's pledges, nothing more is needed from you.
      </span>
    );
  } else if (bid.status === 'defaulted') {
    body = (
      <>
        <span>Your pledge was spent elsewhere, so you are out of the group. The others paid without you.</span>
        {refundButton}
      </>
    );
  } else if (bid.status === 'lost') {
    body = (
      <>
        <span>You are not in the payment group, so nothing was paid. Your pledge is yours to take back.</span>
        {refundButton}
      </>
    );
  } else if (bid.status === 'paid' && !bid.paymentSeen) {
    body = <span>The whole group has pledged. Payment sent, waiting for the network to see it… <TxLink bid={bid} /></span>;
  } else if (bid.status === 'paid' && offer.kind === 'data') {
    body = (
      <span>
        Paid <TxLink bid={bid} />. The seller's wallet releases the key to you as soon as the seller is online.
      </span>
    );
  } else if (bid.status === 'paid') {
    body = (
      <>
        <span>Paid <TxLink bid={bid} />. Confirm once you have received it.</span>
        <button disabled={!!busy} onClick={() => run('Confirming…', () => request(`/api/bids/${bid.id}/receipt`, { ok: true }))} className="btn btn-primary btn-sm">
          {spinner}
          {busy || 'Confirm receipt'}
        </button>
      </>
    );
  } else if (bid.status === 'delivered' || bid.status === 'received') {
    body = (
      <>
        <span>
          {bid.status === 'received'
            ? 'Received.'
            : 'The key has been delivered. Check the data, then confirm it is what you paid for, or report the seller below.'}{' '}
          <TxLink bid={bid} />
        </span>
        {offer.kind === 'data' && downloadButton}
        {bid.status === 'delivered' && (
          <button
            disabled={!!busy}
            onClick={() => {
              if (window.confirm("Confirm this is what you paid for? You can't report the seller afterwards.")) {
                run('Confirming…', () => request(`/api/bids/${bid.id}/receipt`, { ok: true }));
              }
            }}
            className="btn btn-outline btn-sm"
          >
            Confirm receipt
          </button>
        )}
        {canAskAgain && (
          <button
            disabled={!!busy}
            onClick={() => run('Asking…', () => requestRedelivery(bid.id, `Wallet could not unwrap the key: ${error}`))}
            className="btn btn-ghost btn-sm"
          >
            Ask the seller to deliver again
          </button>
        )}
      </>
    );
  } else if (bid.status === 'disputed') {
    body = (
      <>
        <span>
          {bid.reportedAt ? 'You reported this sale' : 'Delivery failed and is disputed'}
          {bid.disputeReason ? `: ${bid.disputeReason}` : '.'}
          {offer.kind === 'data' && !bid.hasKey && ' The seller can still deliver the key.'}
        </span>
        {offer.kind === 'data' && bid.hasKey && downloadButton}
      </>
    );
  } else {
    return null;
  }

  const tone = { open: 'alert-info', defaulted: 'alert-error', disputed: 'alert-error', received: 'alert-success', delivered: 'alert-success' }[bid.status] ?? 'alert-info';
  return (
    <div className="grid gap-2">
      <div role="alert" className={`alert alert-soft text-sm ${tone} flex flex-wrap`}>{body}</div>
      {leftover && (
        <div role="alert" className="alert alert-soft alert-info flex flex-wrap text-sm">
          <span>
            You paid {sats(bid.amount)}. The rest of your pledge goes back to your wallet by itself while you are signed in, less the network fee.
          </span>
          {refundButton}
        </div>
      )}
      {bid.paymentError && bid.status === 'pledged' && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          <span>{bid.paymentError}. The group is paying again without the members whose pledge was spent.</span>
        </div>
      )}
      {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error}</span></div>}
    </div>
  );
}

const SALE_STATES = [
  ['pledged', 'pledged'],
  ['paid', 'paid'],
  ['delivered', 'delivered'],
  ['received', 'received'],
  ['defaulted', 'spent pledge'],
  ['disputed', 'disputed'],
];

/** The seller's view of a sold offer. */
export function SellerDeal({ offer }) {
  const sales = offer.sales ?? {};
  return (
    <div role="alert" className="alert alert-soft alert-info flex flex-wrap text-sm">
      <span className="flex flex-wrap gap-1">
        {SALE_STATES.filter(([k]) => sales[k]).map(([k, label]) => (
          <span key={k} className="badge badge-sm">{sales[k]} {label}</span>
        ))}
      </span>
      <span>
        The group pays you the full {sats(offer.price)} in one transaction from what it has pledged, or nothing at all.
        {offer.kind === 'data' && ' While you are signed in here, the payment goes into your wallet and each buyer then gets the key automatically.'}
      </span>
    </div>
  );
}

// Bid states in which the buyer has paid but not confirmed receipt (as in backend/src/reputation.ts).
const REPORTABLE_STATES = ['paid', 'delivered', 'disputed'];

/** Whether the user paid for this offer, so they can report its seller or see that they did. */
export const canReport = (offer) =>
  !!offer.myBid && (!!offer.myBid.reportedAt || (REPORTABLE_STATES.includes(offer.myBid.status) && !!offer.groupPayment?.seen));

/** A paying buyer reports that the seller did not hand over what was described, which halves the seller's reputation. */
export function ReportSeller({ offer, onChange }) {
  const bid = offer.myBid;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function report(e) {
    e.preventDefault();
    if (!reason.trim() || !window.confirm("Report the seller? This halves their reputation and can't be undone.")) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/bids/${bid.id}/report`, { reason: reason.trim() });
      setOpen(false);
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const reportFrom = bid.reportFrom && new Date(bid.reportFrom);
  if (reportFrom && reportFrom > new Date()) {
    return (
      <div role="alert" className="alert alert-soft alert-info mt-6 text-sm">
        <span>The seller may just be offline. If the key has not arrived by {reportFrom.toLocaleString()}, you can report them here.</span>
      </div>
    );
  }
  if (bid.reportedAt) {
    return (
      <div role="alert" className="alert alert-warning alert-soft mt-6 text-sm">
        <span>
          You reported the seller on {new Date(bid.reportedAt).toLocaleString()}
          {bid.disputeReason ? `: ${bid.disputeReason}` : '.'}
        </span>
      </div>
    );
  }
  return (
    <section className="card card-border mt-6 bg-base-200">
      <div className="card-body gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="card-title text-base">Didn't get what you paid for?</h3>
            <p className="text-xs text-white/60">
              {offer.kind === 'data'
                ? "Report the seller if the data never arrived or isn't what they described. Their reputation is halved, and the report is final."
                : 'Report the seller if they did not hand it over. Their reputation is halved, and the report is final.'}
            </p>
          </div>
          {!open && <button onClick={() => setOpen(true)} className="btn btn-outline btn-error btn-sm">Report seller</button>}
        </div>
        {open && (
          <form onSubmit={report} className="grid gap-2">
            <textarea
              rows={3}
              maxLength={500}
              placeholder="What went wrong?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="textarea textarea-bordered w-full"
            />
            <div className="flex gap-2">
              <button disabled={busy || !reason.trim()} className="btn btn-error btn-sm">
                {busy && <span className="loading loading-spinner loading-xs" />}
                Report seller
              </button>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">Cancel</button>
            </div>
          </form>
        )}
        {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error}</span></div>}
      </div>
    </section>
  );
}
