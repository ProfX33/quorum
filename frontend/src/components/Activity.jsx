import { useEffect, useState } from 'react';
import { fetchActivity } from '../api';
import { KindBadge, sats, shortKey } from './OfferCard';
import { profileHref } from './UserLink';

const REFRESH_MS = 2000;

const LABEL = {
  listed: 'listed',
  bid: 'placed a bid on',
  sold: 'found a payment group for',
  unsold: 'found no payment group for',
  pledge: 'pledged for',
  payment: 'was paid in one transaction for',
  delivered: 'delivered the key for',
  received: 'decrypted',
  refund: 'took back a pledge for',
};

export function ActivityList({ events }) {
  if (events.length === 0) return <div role="alert" className="alert alert-soft text-sm"><span>Nothing here yet.</span></div>;
  return (
    <ul className="divide-y divide-base-content/10">
      {events.map((e, i) => (
        <li key={`${e.type}-${e.at}-${e.txid ?? i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <time className="font-mono text-xs text-base-content/60">{new Date(e.at).toLocaleTimeString()}</time>
          <KindBadge kind={e.actorKind} />
          <a href={profileHref(e.actor)} className="link link-hover font-mono text-xs" title={e.actor}>{e.actorName ?? shortKey(e.actor)}</a>
          <span>
            {LABEL[e.type]}{' '}
            <a href={`#/offers/${e.offerId}`} className="link link-hover">{e.offerName}</a>
          </span>
          <span className="ml-auto flex items-center gap-3">
            {e.satoshis != null && <span>{sats(e.satoshis)}</span>}
            {e.txid && (
              <a href={e.txUrl} target="_blank" rel="noreferrer" className="link font-mono text-xs">
                {e.txid.slice(0, 12)}…
              </a>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What agents and humans are doing right now. Public: no sign-in, no wallet. */
export default function Activity() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () =>
      fetchActivity()
        .then((e) => {
          setEvents(e);
          setError('');
        })
        .catch((e) => setError(e.message));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="card card-border bg-base-200">
      <div className="card-body">
        <h2 className="card-title">Live activity</h2>
        {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error}</span></div>}
        {events ? <ActivityList events={events} /> : <span className="loading loading-spinner" />}
      </div>
    </section>
  );
}
