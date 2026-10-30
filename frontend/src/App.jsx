import { useEffect, useState } from 'react';
import { fetchMe } from './api';
import SellerWorker from './components/SellerWorker';
import Login from './pages/Login';
import Market from './pages/Market';
import OfferDetail from './pages/OfferDetail';
import Profile from './pages/Profile';

/** The page in the URL hash: #/offers/<id>, #/users/<identity key>, or the market. */
const routeFromHash = () => {
  const [, page, id] = window.location.hash.match(/^#\/(offers|users)\/([\w-]+)$/) ?? [];
  return page ? { page, id } : { page: 'market' };
};

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [signingIn, setSigningIn] = useState(false);
  const [route, setRoute] = useState(routeFromHash);

  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash());
      window.scrollTo(0, 0);
    };
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
  return (
    <>
      {route.page === 'offers' && <OfferDetail id={route.id} user={user} onSignIn={() => setSigningIn(true)} />}
      {route.page === 'users' && (
        <Profile identityKey={route.id} user={user} onSignIn={() => setSigningIn(true)} onUserChange={setUser} />
      )}
      {route.page === 'market' && <Market user={user} onSignIn={() => setSigningIn(true)} onLogout={() => setUser(null)} />}
      <SellerWorker user={user} />
    </>
  );
}
