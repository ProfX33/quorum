import { useEffect, useState } from 'react';
import { logout, searchMarket } from '../api';
import { Avatar, displayName, profileHref } from './UserLink';

const TABS = [
  ['offers', 'Sell offers', 'M3 12V4h8l10 10-8 8L3 12z M7.5 7.5h.01'],
  ['requests', 'Buy requests', 'M4 5h2l2.4 10.2a1 1 0 001 .8h8.2a1 1 0 001-.8L20 8H7 M10 20h.01 M17 20h.01'],
  ['activity', 'Live activity', 'M3 12h4l3-8 4 16 3-8h4'],
];

const LINKS = [
  ['#/#how-it-works', 'How it works', 'M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2V5z M4 19a2 2 0 012-2h12'],
  ['#/#agents', 'For agents', 'M4 6h16v12H4z M8 10l2 2-2 2 M13 14h3'],
  ['#/#contact', 'Contact', 'M4 4l16 8-16 8 3-8-3-8z M7 12h13'],
];

const Icon = ({ d, className = 'h-[1.1rem] w-[1.1rem]' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
    <path d={d} />
  </svg>
);

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

/** A sidebar on large screens, a bar on top on small ones; plus the status bar above the page. */
export default function Navbar({ user, onSignIn, onLogout, nav, counts }) {
  const fetched = useActiveCounts(!counts);
  counts ??= fetched;

  async function handleLogout() {
    await logout();
    onLogout();
  }

  return (
    <>
      <aside className="sticky top-0 z-30 bg-base-100/85 p-2 backdrop-blur lg:fixed lg:inset-y-0 lg:left-0 lg:w-72 lg:bg-transparent lg:p-3 lg:backdrop-blur-none">
        <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 lg:h-full lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0 lg:p-5">
          <a href="#/" aria-label="Home" onClick={() => nav.goHome()} className="block">
            <img src="/logo.svg" alt="Quorum" className="wordmark h-7 lg:h-10" />
            <span className="mt-2 hidden text-[0.62rem] uppercase tracking-[0.1em] text-white/40 lg:block">A group-buy market built on BSV</span>
          </a>

          <nav className="order-last -mx-1 w-full min-w-0 overflow-x-auto lg:order-none lg:mx-0 lg:mt-8">
            <ul role="tablist" className="flex gap-1 lg:flex-col">
              {TABS.map(([key, label, icon]) => {
                const active = nav.activeTab === key;
                return (
                  <li key={key}>
                    <button
                      role="tab"
                      aria-selected={active}
                      onClick={() => nav.openTab(key)}
                      className={`group relative flex w-full items-center gap-3 whitespace-nowrap rounded-field border px-3 py-2 text-sm transition lg:py-2.5 ${
                        active
                          ? 'border-[#2a2a2a] bg-base-300 text-primary'
                          : 'border-transparent text-white/60 hover:bg-white/[0.04] hover:text-white'
                      }`}
                    >
                      {active && <span className="absolute inset-y-2 -left-px hidden w-0.5 rounded-full bg-primary shadow-[0_0_10px] shadow-primary lg:block" />}
                      <Icon d={icon} />
                      {label}
                      {counts[key] !== undefined && (
                        <span className={`ml-auto rounded px-1.5 text-xs tabular-nums ${active ? 'bg-primary text-primary-content' : 'bg-white/10 text-white/70'}`}>
                          {counts[key]}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <ul className="mt-8 hidden space-y-1 border-t border-line pt-6 lg:block">
            {LINKS.map(([href, label, icon]) => (
              <li key={href}>
                <a href={href} className="flex items-center gap-3 rounded-field px-3 py-2 text-sm text-white/60 transition hover:bg-white/[0.04] hover:text-white">
                  <Icon d={icon} />
                  {label}
                </a>
              </li>
            ))}
          </ul>

          <div className="ml-auto flex items-center gap-2 lg:mt-auto lg:ml-0 lg:flex-col lg:items-stretch lg:border-t lg:border-line lg:pt-5">
            {user ? (
              <>
                <div className="flex gap-2">
                  <button onClick={() => nav.openForm('offer')} className="btn btn-primary btn-sm lg:flex-1">+ Sell</button>
                  <button onClick={() => nav.openForm('request')} className="btn btn-outline btn-primary btn-sm lg:flex-1">+ Request</button>
                </div>
                <div className="dropdown dropdown-end lg:dropdown-top">
                  <div tabIndex={0} role="button" className={`btn btn-ghost btn-sm gap-2 normal-case tracking-normal lg:w-full lg:justify-start lg:border-line lg:bg-base-300 ${user.name ? '' : 'font-mono'}`} title={user.identityKey}>
                    <Avatar person={user} size="xs" />
                    <span className="max-w-40 truncate">{displayName(user)}</span>
                  </div>
                  <ul tabIndex={0} className="menu dropdown-content z-40 my-2 w-48 rounded-box border border-line bg-base-300 p-2 shadow-2xl">
                    <li><a href={profileHref(user.identityKey)}>My profile</a></li>
                    <li><button onClick={handleLogout}>Sign out</button></li>
                  </ul>
                </div>
              </>
            ) : (
              <button onClick={onSignIn} className="btn btn-primary btn-sm lg:btn-md">Sign in</button>
            )}
          </div>
        </div>
      </aside>

      <StatusBar counts={counts} onSearch={() => nav.openTab('offers')} />
    </>
  );
}

/** The thin bar with status lights and a ticker, like a terminal header. */
function StatusBar({ counts, onSearch }) {
  const ticker = [
    'Non-custodial · your keys, your coins',
    'Equal shares · largest group wins',
    'SHA-256 commitment on every delivery',
    'One transaction pays the seller',
    'Agents welcome · JSON CLI & REST API',
  ];
  return (
    <div className="sticky top-0 z-20 hidden px-3 pt-3 lg:block">
      <div className="panel flex h-12 items-center gap-6 px-5 text-xs uppercase tracking-[0.12em]">
        <span className="flex shrink-0 items-center gap-2 text-white/75"><span className="dot text-accent" />Built on BSV</span>
        <span className="flex shrink-0 items-center gap-2 text-white/75"><span className="dot text-secondary" style={{ animationDelay: '0.8s' }} />
          {counts.offers ?? '–'} live offers · {counts.requests ?? '–'} requests
        </span>
        <div className="marquee min-w-0 flex-1 overflow-hidden text-white/35" aria-hidden>
          <div className="flex w-max gap-10">
            {[...ticker, ...ticker].map((t, i) => <span key={i} className="whitespace-nowrap">▸ {t}</span>)}
          </div>
        </div>
        <button onClick={onSearch} aria-label="Search the marketplace" className="shrink-0 text-white/60 transition hover:text-primary">
          <Icon d="M11 4a7 7 0 100 14 7 7 0 000-14z M21 21l-4.3-4.3" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
