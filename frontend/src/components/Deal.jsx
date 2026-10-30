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

/** What the buyer does after settlement: pledge, wait for the group, download (or take the pledge back). */
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
    if (['won', 'defaulted', 'lost'].includes(bid.status) && hasPendingPayment(bid.id)) {
      run('Registering your pledge…', () => resumePayment(bid.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bid.id, bid.status]);

  const spinner = busy && <span className="loading loading-spinner loading-xs" />;
  const group = offer.groupPayment;
  const refundButton = canRefund(bid) && (
    <button disabled={!!busy} onClick={() => run('Waiting for wallet…', () => refundPledges(bid.id))} className="btn btn-primary btn-sm">
      {spinner}
      {busy || (bid.refundable > 0 ? `Take back ${sats(bid.refundable)}` : 'Finish taking back your pledge')}
    </button>
  );
  let body;
  if (bid.status === 'won') {
    const due = bid.amount - bid.pledged;
    body = (
      <>
        <span>
          {bid.pledged > 0
            ? <>The group got smaller, so your share is now <strong>{sats(bid.amount)}</strong>. You have pledged {sats(bid.pledged)}; pledge the remaining <strong>{sats(due)}</strong></>
            : <>You are in the payment group. Pledge your share of <strong>{sats(bid.amount)}</strong></>}{' '}
          before the window closes: {offer.paymentDeadline && <Countdown deadline={offer.paymentDeadline} now={now} />}.
          The seller is paid in one transaction once everyone has pledged. Until then your pledge stays yours.
        </span>
        <button disabled={!!busy} onClick={() => run('Waiting for wallet…', () => payForBid(bid.id))} className="btn btn-primary btn-sm">
          {spinner}
          {busy || `Pledge ${sats(due)}`}
        </button>
      </>
    );
  } else if (bid.status === 'pledged') {
    body = (
      <span>
        Pledged. Waiting for the rest of the group: {group?.pledged ?? 0} of {group?.members ?? '?'} have pledged
        {offer.paymentDeadline && <>, window closes <Countdown deadline={offer.paymentDeadline} now={now} /></>}.
        If the group does not complete, you can take your pledge back.
      </span>
    );
  } else if (bid.status === 'defaulted') {
    body = (
      <>
        <span>The payment window closed before you pledged, so you are out of the group.</span>
        {refundButton}
      </>
    );
  } else if (bid.status === 'lost') {
    body = (
      <>
        <span>The group could not pay the price, so nothing was paid. Your pledge is yours to take back.</span>
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
      {bid.paymentError && ['won', 'pledged'].includes(bid.status) && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          <span>{bid.paymentError}.{bid.status === 'won' ? ' Your pledge was spent elsewhere, please pledge again.' : ' Waiting for the members whose pledge was spent.'}</span>
        </div>
      )}
      {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error}</span></div>}
    </div>
  );
}

const SALE_STATES = [
  ['won', 'awaiting pledge'],
  ['pledged', 'pledged'],
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
      <span>
        The group pays you the full {sats(offer.price)} in one transaction once every member has pledged, or nothing at all.
        {offer.kind === 'data' && ' While you are signed in here, the payment goes into your wallet and each buyer then gets the key automatically.'}
      </span>
    </div>
  );
}
