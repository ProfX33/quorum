import { useEffect, useState } from 'react';
import { logout, searchMarket } from '../api';
import { Avatar, displayName, profileHref } from './UserLink';

const TABS = [
  ['offers', 'Sell offers'],
  ['requests', 'Buy requests'],
  ['activity', 'Live activity'],
];

/** Site-wide header. `counts` (optional) adds the active-listing badges to the tabs. */
const REFRESH_MS = 5000;

/** Pages that don't load the market themselves get the badge counts from here. */
function useActiveCounts(enabled) {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      searchMarket({ status: 'all' })
        .then((r) => {
          const active = (i) => i.status === 'open' && new Date(i.deadline).getTime() > Date.now();
          setCounts({ offers: r.offers.filter(active).length, requests: r.requests.filter(active).length });
        })
        .catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled]);
  return counts;
}

export default function Navbar({ user, onSignIn, onLogout, nav, counts }) {
  const fetched = useActiveCounts(!counts);
  counts ??= fetched;

  async function handleLogout() {
    await logout();
    onLogout();
  }

  return (
    <header className="navbar sticky top-0 z-10 border-b border-white/10 bg-base-200 px-6">
      <div className="navbar-start">
        <a href="#/" aria-label="Home" onClick={() => nav.goHome()}>
          <img src="/logo.svg" alt="Logo" className="h-8" />
        </a>
      </div>
      <nav className="navbar-center">
        <ul role="tablist" className="menu menu-horizontal gap-2 px-1">
          {TABS.map(([key, label]) => (
            <li key={key}>
              <button role="tab" onClick={() => nav.openTab(key)} className={nav.activeTab === key
                  ? 'bg-primary! text-primary-content! hover:bg-primary/85! focus:bg-primary!'
                  : 'bg-transparent! hover:bg-white/10! focus:bg-transparent! focus-visible:bg-white/10!'}>
                {label}
                {counts[key] !== undefined && <span
                    className={`badge badge-sm min-w-6 border-0 px-1.5 font-medium tabular-nums ${
                      nav.activeTab === key ? 'bg-black/20 text-primary-content' : 'bg-white/15 text-base-content'
                    }`}
                  >
                    {counts[key]}
                  </span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="navbar-end gap-3">
        {user ? (
          <>
            <button onClick={() => nav.openForm('offer')} className="btn btn-primary btn-sm">+ Sell</button>
            <button onClick={() => nav.openForm('request')} className="btn btn-outline btn-primary btn-sm">+ Request</button>
            <div className="dropdown dropdown-end">
              <div tabIndex={0} role="button" className={`btn btn-ghost btn-sm gap-2 ${user.name ? '' : 'font-mono'}`} title={user.identityKey}>
                <Avatar person={user} size="xs" />
                <span className="max-w-40 truncate">{displayName(user)}</span>
              </div>
              <ul tabIndex={0} className="menu dropdown-content z-20 mt-2 w-40 rounded-box bg-base-300 p-2 shadow">
                <li><a href={profileHref(user.identityKey)}>My profile</a></li>
                <li><button onClick={handleLogout}>Sign out</button></li>
              </ul>
            </div>
          </>
        ) : (
          <button onClick={onSignIn} className="btn btn-primary btn-sm">Sign in</button>
        )}
      </div>
    </header>
  );
}
