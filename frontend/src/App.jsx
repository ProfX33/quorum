import { useEffect, useState } from 'react';
import { fetchMe } from './api';
import Login from './pages/Login';
import Market from './pages/Market';
import OfferDetail from './pages/OfferDetail';

const offerIdFromHash = () => window.location.hash.match(/^#\/offers\/([\w-]+)$/)?.[1] ?? null;

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [signingIn, setSigningIn] = useState(false);
  const [offerId, setOfferId] = useState(offerIdFromHash);

  useEffect(() => {
    const onHash = () => setOfferId(offerIdFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    fetchMe().then(setUser);
  }, []);

  if (user === undefined) return null;
  if (signingIn && !user) {
    return <Login onLogin={(u) => (setUser(u), setSigningIn(false))} onCancel={() => setSigningIn(false)} />;
  }
  if (offerId) {
    return <OfferDetail id={offerId} user={user} onSignIn={() => setSigningIn(true)} />;
  }
  return <Market user={user} onSignIn={() => setSigningIn(true)} onLogout={() => setUser(null)} />;
}
