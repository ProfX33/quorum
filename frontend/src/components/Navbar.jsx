import { useEffect, useState } from 'react';
import { logout, searchMarket } from '../api';
import { Avatar, displayName, profileHref } from './UserLink';
import { useTheme } from '../theme';

const MARKET = 'M3 4h18l1 6H2l1-6z M4 10v10h16V10 M10 20v-5h4v5';

const TABS = [
  ['offers', 'Offers', 'M3 12V4h8l10 10-8 8L3 12z M7.5 7.5h.01'],
  ['requests', 'Requests', 'M4 5h2l2.4 10.2a1 1 0 001 .8h8.2a1 1 0 001-.8L20 8H7 M10 20h.01 M17 20h.01'],
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

const SUN = 'M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5.6 5.6L4.2 4.2 M19.8 19.8l-1.4-1.4 M5.6 18.4l-1.4 1.4 M19.8 4.2l-1.4 1.4 M12 8a4 4 0 100 8 4 4 0 000-8z';
const MOON = 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z';

/** Switches between the light and dark theme. */
function ThemeToggle({ mode, toggle, className = '' }) {
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`shrink-0 text-base-content/60 transition hover:text-primary ${className}`}
    >
      <Icon d={mode === 'dark' ? SUN : MOON} className="h-5 w-5" />
    </button>
  );
}

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
  const [mode, toggleTheme] = useTheme();

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
            <span className="mt-2 hidden text-[0.62rem] uppercase tracking-[0.1em] text-base-content/40 lg:block">A group-buy market built on BSV</span>
          </a>

          <nav className="order-last -mx-1 flex w-full min-w-0 gap-1 overflow-x-auto lg:order-none lg:mx-0 lg:mt-8 lg:flex-col lg:gap-2">
            <a href="#/market" className="flex shrink-0 items-center gap-3 whitespace-nowrap rounded-field bg-primary px-3 py-2 text-sm text-primary-content transition hover:brightness-110 lg:py-2.5">
              <Icon d={MARKET} />
              Marketplace
            </a>
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
                          ? 'border-line bg-base-100 text-primary'
                          : 'border-transparent text-base-content/60 hover:bg-base-content/[0.04] hover:text-base-content'
                      }`}
                    >
                      {active && <span className="absolute inset-y-2 -left-px hidden w-0.5 rounded-full bg-primary shadow-[0_0_10px] shadow-primary lg:block" />}
                      <Icon d={icon} />
                      {label}
                      {counts[key] !== undefined && (
                        <span className={`ml-auto rounded px-1.5 text-xs tabular-nums ${active ? 'bg-primary text-primary-content' : 'bg-base-content/10 text-base-content/70'}`}>
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
                <a href={href} className="flex items-center gap-3 rounded-field px-3 py-2 text-sm text-base-content/60 transition hover:bg-base-content/[0.04] hover:text-base-content">
                  <Icon d={icon} />
                  {label}
                </a>
              </li>
            ))}
          </ul>

          <ThemeToggle mode={mode} toggle={toggleTheme} className="ml-auto lg:hidden" />

          <div className="flex items-center gap-2 lg:mt-auto lg:ml-0 lg:flex-col lg:items-stretch lg:border-t lg:border-line lg:pt-5">
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

      <StatusBar counts={counts} onSearch={() => nav.openTab('offers')} theme={<ThemeToggle mode={mode} toggle={toggleTheme} />} />
    </>
  );
}

/** The thin bar with status lights, like a terminal header. */
function StatusBar({ counts, onSearch, theme }) {
  return (
    <div className="sticky top-0 z-20 hidden px-3 pt-3 lg:block">
      <div className="panel flex h-12 items-center gap-6 px-5 text-xs uppercase tracking-[0.12em]">
        <span className="flex shrink-0 items-center gap-2 text-base-content/75"><span className="dot text-[#003FFF]" />Built on BSV</span>
        <span className="flex shrink-0 items-center gap-2 text-base-content/75"><span className="dot text-primary" style={{ animationDelay: '0.8s' }} />
          {counts.offers ?? '–'} live offers · {counts.requests ?? '–'} requests
        </span>
        <span className="flex-1" />
        {theme}
        <button onClick={onSearch} aria-label="Search the marketplace" className="shrink-0 text-base-content/60 transition hover:text-primary">
          <Icon d="M11 4a7 7 0 100 14 7 7 0 000-14z M21 21l-4.3-4.3" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
