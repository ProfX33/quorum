import { useEffect, useState } from 'react';
import { request } from '../api';
import { downloadPurchase, hasPendingPayment, payForBid, requestRedelivery, resumePayment } from '../delivery';
import { Countdown, sats } from './OfferCard';

function TxLink({ bid }) {
  if (!bid.txid) return null;
  return (
    <a href={bid.txUrl} target="_blank" rel="noreferrer" className="link font-mono text-xs">
      {bid.txid.slice(0, 16)}…
    </a>
  );
}

/** What the buyer does after settlement: pay, wait, download. */
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

  // A payment signed earlier whose submission did not get through is resubmitted, never paid twice.
  useEffect(() => {
    if (['won', 'defaulted'].includes(bid.status) && hasPendingPayment(bid.id)) {
      run('Registering your payment…', () => resumePayment(bid.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bid.id, bid.status]);

  const spinner = busy && <span className="loading loading-spinner loading-xs" />;
  let body;
  if (bid.status === 'won') {
    body = (
      <>
        <span>
          You are in the payment group. Pay <strong>{sats(bid.amount)}</strong> straight to the seller before the
          window closes: {offer.paymentDeadline && <Countdown deadline={offer.paymentDeadline} now={now} />}
        </span>
        <button disabled={!!busy} onClick={() => run('Waiting for wallet…', () => payForBid(bid.id))} className="btn btn-primary btn-sm">
          {spinner}
          {busy || `Pay ${sats(bid.amount)}`}
        </button>
      </>
    );
  } else if (bid.status === 'defaulted') {
    body = <span>The payment window closed before you paid.</span>;
  } else if (bid.status === 'paid' && !bid.paymentSeen) {
    body = <span>Payment sent, waiting for the network to see it… <TxLink bid={bid} /></span>;
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
          {bid.status === 'received' ? 'Received.' : 'The key has been delivered.'} <TxLink bid={bid} />
        </span>
        {offer.kind === 'data' && (
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
            {busy || (bid.status === 'received' ? 'Download again' : 'Download & decrypt')}
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
    body = <span>Delivery failed and is disputed{bid.disputeReason ? `: ${bid.disputeReason}` : '.'}</span>;
  } else {
    return null;
  }

  const tone = { won: 'alert-warning', defaulted: 'alert-error', disputed: 'alert-error', received: 'alert-success', delivered: 'alert-success' }[bid.status] ?? 'alert-info';
  return (
    <div className="grid gap-2">
      <div role="alert" className={`alert alert-soft text-sm ${tone} flex flex-wrap`}>{body}</div>
      {bid.paymentError && bid.status === 'won' && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{bid.paymentError}. Please pay again.</span></div>}
      {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error}</span></div>}
    </div>
  );
}

const SALE_STATES = [
  ['won', 'awaiting payment'],
  ['paid', 'paid'],
  ['delivered', 'delivered'],
  ['received', 'received'],
  ['defaulted', 'did not pay'],
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
      {offer.kind === 'data' && (
        <span>While you are signed in here, payments go into your wallet and each buyer gets the key automatically.</span>
      )}
    </div>
  );
}
