import { useCallback, useEffect, useState } from 'react';
import { fetchOffer } from '../api';
import { OfferCard, useNow } from '../components/OfferCard';

const REFRESH_MS = 5000;

export default function OfferDetail({ id, user, onSignIn }) {
  const now = useNow();
  const [offer, setOffer] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(
    () =>
      fetchOffer(id)
        .then((o) => {
          setOffer(o);
          setError('');
        })
        .catch((e) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    setOffer(null);
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <header className="flex items-center justify-between gap-4 text-sm">
        <a href="#/" className="text-neutral-500 hover:text-black">
          ← All offers
        </a>
        {!user && (
          <button onClick={onSignIn} className="rounded-md bg-black px-3 py-1.5 text-white hover:bg-neutral-800">
            Sign in
          </button>
        )}
      </header>
      <div className="mt-6">
        {error && <p className="text-sm text-red-600">{error === 'Not found' ? 'This offer does not exist.' : error}</p>}
        {offer && <OfferCard key={offer.id} offer={offer} user={user} now={now} onChange={load} onSignIn={onSignIn} />}
        {!offer && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      </div>
    </div>
  );
}
