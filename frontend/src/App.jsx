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
  const [tab, setTab] = useState('offers');
  const [form, setForm] = useState(null); // { mode, answering? }

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

  // Shared by the navbar on every page; the tabs and listing forms live on the market page.
  const nav = {
    activeTab: route.page === 'market' ? tab : null,
    setTab,
    form,
    setForm,
    goHome: () => setTab('offers'),
    openTab: (key) => {
      setTab(key);
      window.location.hash = '#/';
    },
    openForm: (mode) => {
      setForm({ mode });
      setTab(mode === 'offer' ? 'offers' : 'requests');
      window.location.hash = '#/';
    },
  };

  if (user === undefined) return null;
  if (signingIn && !user) {
    return <Login onLogin={(u) => (setUser(u), setSigningIn(false))} onCancel={() => setSigningIn(false)} />;
  }
  return (
    <>
      {route.page === 'offers' && <OfferDetail id={route.id} user={user} onSignIn={() => setSigningIn(true)} onLogout={() => setUser(null)} nav={nav} />}
      {route.page === 'users' && (
        <Profile identityKey={route.id} user={user} onSignIn={() => setSigningIn(true)} onLogout={() => setUser(null)} onUserChange={setUser} nav={nav} />
      )}
      {route.page === 'market' && <Market user={user} onSignIn={() => setSigningIn(true)} onLogout={() => setUser(null)} nav={nav} />}
      <SellerWorker user={user} />
    </>
  );
}
