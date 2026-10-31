import { useEffect, useState } from 'react';
import { fetchMe } from './api';
import Footer from './components/Footer';
import SellerWorker from './components/SellerWorker';
import Landing from './pages/Landing';
import Legal from './pages/Legal';
import Login from './pages/Login';
import Market from './pages/Market';
import OfferDetail from './pages/OfferDetail';
import Profile from './pages/Profile';

/**
 * The page in the URL hash: #/market, #/offers/<id>, #/users/<identity key>, #/legal/<page>,
 * or the landing page (#/, optionally with a section: #/#how-it-works).
 */
const routeFromHash = () => {
  const hash = window.location.hash;
  if (hash === '#/market') return { page: 'market' };
  const [, page, id] = hash.match(/^#\/(offers|users|legal)\/([\w-]+)$/) ?? [];
  if (page) return { page, id };
  return { page: 'home', section: hash.match(/^#\/#([\w-]+)$/)?.[1] };
};

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [signingIn, setSigningIn] = useState(false);
  const [route, setRoute] = useState(routeFromHash);
  const [tab, setTab] = useState('offers');
  const [form, setForm] = useState(null); // { mode, answering? }

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // After the page has rendered, so a section on the landing page exists to scroll to.
  useEffect(() => {
    const section = route.section && document.getElementById(route.section);
    if (section) section.scrollIntoView({ behavior: 'smooth' });
    else window.scrollTo(0, 0);
  }, [route, user === undefined]);

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
      window.location.hash = '#/market';
    },
    openForm: (mode) => {
      setForm({ mode });
      setTab(mode === 'offer' ? 'offers' : 'requests');
      window.location.hash = '#/market';
    },
  };

  if (user === undefined) return null;
  const signIn = signingIn && !user;
  return (
    <div className={`flex min-h-screen flex-col ${signIn ? '' : 'lg:pl-72'}`}>
      <div className="flex flex-1 flex-col">
        {signIn ? <Login onLogin={(u) => (setUser(u), setSigningIn(false))} onCancel={() => setSigningIn(false)} /> : <>
      {route.page === 'home' && <Landing user={user} onSignIn={() => setSigningIn(true)} onLogout={() => setUser(null)} nav={nav} />}
      {route.page === 'legal' && <Legal page={route.id} user={user} onSignIn={() => setSigningIn(true)} onLogout={() => setUser(null)} nav={nav} />}
      {route.page === 'offers' && <OfferDetail id={route.id} user={user} onSignIn={() => setSigningIn(true)} onLogout={() => setUser(null)} nav={nav} />}
      {route.page === 'users' && (
        <Profile identityKey={route.id} user={user} onSignIn={() => setSigningIn(true)} onLogout={() => setUser(null)} onUserChange={setUser} nav={nav} />
      )}
      {route.page === 'market' && <Market user={user} onSignIn={() => setSigningIn(true)} onLogout={() => setUser(null)} nav={nav} />}
        </>}
      </div>
      <Footer />
      {!signIn && <SellerWorker user={user} />}
    </div>
  );
}
