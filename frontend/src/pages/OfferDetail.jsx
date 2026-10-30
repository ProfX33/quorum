import { useCallback, useEffect, useState } from 'react';
import { fetchOffer } from '../api';
import Navbar from '../components/Navbar';
import { OfferCard, useNow } from '../components/OfferCard';

const REFRESH_MS = 5000;

export default function OfferDetail({ id, user, onSignIn, onLogout, nav }) {
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
    <>
      <Navbar user={user} onSignIn={onSignIn} onLogout={onLogout} nav={nav} />
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mt-8">
        {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error === 'Not found' ? 'This offer does not exist.' : error}</span></div>}
        {offer && <OfferCard key={offer.id} offer={offer} user={user} now={now} onChange={load} onSignIn={onSignIn} />}
        {!offer && !error && <span className="loading loading-spinner" />}
      </div>
    </div>
    </>
  );
}
