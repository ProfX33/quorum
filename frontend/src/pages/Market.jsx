import { useCallback, useEffect, useState } from 'react';
import { logout, searchMarket } from '../api';
import Activity from '../components/Activity';
import ListingForm from '../components/ListingForm';
import { OfferCard, useNow } from '../components/OfferCard';
import RequestCard from '../components/RequestCard';
import { Avatar, displayName, profileHref } from '../components/UserLink';

const REFRESH_MS = 5000;

const VIEWS = [
  ['active', 'Active'],
  ['pending', 'Payment pending'],
  ['closed', 'Closed'],
];

const SORTS = {
  newest: ['Newest first', (a, b) => b.createdAt.localeCompare(a.createdAt)],
  oldest: ['Oldest first', (a, b) => a.createdAt.localeCompare(b.createdAt)],
  deadline: ['Deadline soonest', (a, b) => a.deadline.localeCompare(b.deadline)],
  priceDesc: ['Price high → low', (a, b) => (b.price ?? b.maxPrice) - (a.price ?? a.maxPrice)],
  priceAsc: ['Price low → high', (a, b) => (a.price ?? a.maxPrice) - (b.price ?? b.maxPrice)],
};

/** Which view an offer or request belongs to. Requests have no payment stage. */
function viewOf(item, now) {
  if (item.status === 'open') return new Date(item.deadline).getTime() > now ? 'active' : 'closed';
  if (item.status === 'sold' && !item.groupPayment?.seen) return 'pending';
  return 'closed';
}

const isRelated = (item, tab) => item.mine || (tab === 'offers' && !!item.myBid);

export default function Market({ user, onSignIn, onLogout }) {
  const now = useNow();
  const [tab, setTab] = useState('offers');
  const [filters, setFilters] = useState({ q: '', kind: '', category: '', region: '' });
  const [view, setView] = useState('active');
  const [sort, setSort] = useState('newest');
  const [onlyMine, setOnlyMine] = useState(false);
  const [results, setResults] = useState({ offers: [], requests: [] });
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // { mode, answering? }

  const load = useCallback(
    () =>
      searchMarket({ ...filters, status: 'all' })
        .then((r) => {
          setResults(r);
          setError('');
        })
        .catch((e) => setError(e.message)),
    [filters],
  );

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  async function handleLogout() {
    await logout();
    onLogout();
  }

  // The form lives in the listings, which the activity tab replaces.
  function openForm(mode) {
    setForm({ mode });
    if (tab === 'activity') setTab(mode === 'offer' ? 'offers' : 'requests');
  }

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const all = tab === 'offers' ? results.offers : results.requests;
  const visible = all.filter((i) => (!onlyMine || (!!user && isRelated(i, tab))));
  const views = tab === 'offers' ? VIEWS : VIEWS.filter(([k]) => k !== 'pending');
  const currentView = views.some(([k]) => k === view) ? view : 'active';
  const counts = Object.fromEntries(views.map(([k]) => [k, visible.filter((i) => viewOf(i, now) === k).length]));
  const items = visible.filter((i) => viewOf(i, now) === currentView).sort(SORTS[sort][1]);

  return (
    <div className="min-h-screen">
      <header className="navbar sticky top-0 z-10 border-b border-white/10 bg-base-200 px-6">
        <div className="navbar-start">
          <a href="#/" aria-label="Home">
            <img src="/logo.svg" alt="Logo" className="h-8" />
          </a>
        </div>
        <nav className="navbar-center">
          <ul role="tablist" className="menu menu-horizontal gap-2 px-1">
            {[
              ['offers', 'Sell offers', results.offers.filter((o) => viewOf(o, now) === 'active').length],
              ['requests', 'Buy requests', results.requests.filter((r) => viewOf(r, now) === 'active').length],
              ['activity', 'Live activity'],
            ].map(([key, label, count]) => (
              <li key={key}>
                <button role="tab" onClick={() => setTab(key)} className={tab === key ? 'menu-active' : ''}>
                  {label}
                  {count !== undefined && <span className="badge badge-sm">{count}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="navbar-end gap-3">
          {user ? (
            <>
              <button onClick={() => openForm('offer')} className="btn btn-primary btn-sm">+ Sell</button>
              <button onClick={() => openForm('request')} className="btn btn-outline btn-primary btn-sm">+ Request</button>
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

      <main className="mx-auto max-w-5xl px-6 py-10">
        {tab === 'activity' ? <Activity /> : <>
        <section className="card card-border bg-base-200">
          <div className="card-body gap-6 p-6">
            {/* Find: free text and attribute filters */}
            <div className="flex flex-wrap items-center gap-4">
              <label className="input input-bordered flex min-w-64 flex-1 items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 opacity-70">
                  <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
                </svg>
                <input type="search" placeholder="Search name, description…" value={filters.q} onChange={setFilter('q')} className="grow" />
              </label>
              <select value={filters.kind} onChange={setFilter('kind')} className="select select-bordered w-36">
                <option value="">All types</option>
                <option>data</option>
                <option>service</option>
                <option>product</option>
              </select>
              <input placeholder="Category" value={filters.category} onChange={setFilter('category')} className="input input-bordered w-36" />
              <input placeholder="Region" value={filters.region} onChange={setFilter('region')} className="input input-bordered w-36" />
            </div>

            <div className="divider my-0" />

            {/* Narrow down: status view, ownership, order */}
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
              {/* Left: view selection */}
              <div role="tablist" className="tabs tabs-box flex-nowrap gap-1 bg-base-100 p-1.5">
                {views.map(([key, label]) => {
                  const active = currentView === key;
                  return (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setView(key)}
                      className={`tab h-9 gap-2.5 px-4 text-sm font-medium ${active ? 'tab-active bg-primary! text-primary-content!' : ''}`}
                    >
                      {label}
                      <span
                        className={`tabular-nums text-sm font-semibold ${
                          active ? 'text-primary-content/80' : 'text-base-content/60'
                        }`}
                      >
                        {counts[key]}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* Right: ownership filter and order */}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={onlyMine}
                  onClick={() => setOnlyMine((v) => !v)}
                  className={`flex h-10 cursor-pointer items-center gap-3 rounded-field border bg-base-100 px-4 text-sm transition-colors ${
                    onlyMine ? 'border-primary' : 'border-base-content/20 hover:border-base-content/40'
                  }`}
                  title={user ? '' : 'Sign in to see your own offers'}
                >
                  <span
                    className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
                      onlyMine ? 'border-primary bg-primary' : 'border-base-content/50 bg-base-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full transition-transform ${
                        onlyMine ? 'translate-x-4 bg-primary-content' : 'bg-base-content'
                      }`}
                    />
                  </span>
                  Only mine
                </button>
                <label className="select w-56 border border-base-content/20 bg-base-100 text-sm">
                  <span className="label">Sort</span>
                  <select value={sort} onChange={(e) => setSort(e.target.value)}>
                    {Object.entries(SORTS).map(([key, [label]]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        </section>

        <h2 className="mt-12 text-lg font-medium">{tab === 'offers' ? 'Sell offers' : 'Buy requests'}</h2>

        {form && (
          <div className="mt-8">
            <ListingForm
              key={`${form.mode}-${form.answering?.id ?? ''}`}
              {...form}
              onCancel={() => setForm(null)}
              onDone={() => {
                setTab(form.mode === 'offer' ? 'offers' : 'requests');
                setForm(null);
                load();
              }}
            />
          </div>
        )}

        {error && <div role="alert" className="alert alert-error alert-soft mt-4 text-sm"><span>{error}</span></div>}
        <div className="mt-8 grid gap-8">
          {items.length === 0 && (
            <div role="alert" className="alert alert-soft text-sm">
              <span>
                Nothing here yet.
                {views.filter(([k]) => k !== currentView && counts[k] > 0).map(([k, label]) => (
                  <button key={k} className="link ml-2" onClick={() => setView(k)}>
                    See {label.toLowerCase()} ({counts[k]})
                  </button>
                ))}
              </span>
            </div>
          )}
          {tab === 'offers'
            ? items.map((o) => <OfferCard linked key={o.id} offer={o} user={user} now={now} onChange={load} onSignIn={onSignIn} />)
            : items.map((r) => (
                <RequestCard
                  key={r.id}
                  request={r}
                  user={user}
                  now={now}
                  onChange={load}
                  onAnswer={(request) => setForm({ mode: 'offer', answering: request })}
                />
              ))}
        </div>
          </>}
    </main>
    </div>
  );
}
