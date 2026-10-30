import { useCallback, useEffect, useState } from 'react';
import { logout, searchMarket, withdrawRequest } from '../api';
import ListingForm from '../components/ListingForm';
import { Attributes, Countdown, OfferCard, STATUS_LABEL, sats, shortKey, useNow } from '../components/OfferCard';

const REFRESH_MS = 5000;

function RequestCard({ request, user, now, onAnswer, onChange }) {
  const open = request.status === 'open' && new Date(request.deadline).getTime() > now;
  return (
    <article className="card card-border bg-base-200">
      <div className="card-body gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="card-title">{request.name}</h3>
          <Attributes item={request} />
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-medium">≤ {sats(request.maxPrice)}</div>
          <div className="text-sm">
            {request.status === 'open' ? <Countdown deadline={request.deadline} now={now} /> : <span className="badge badge-neutral">{STATUS_LABEL[request.status]}</span>}
          </div>
        </div>
      </div>
      {request.description && <p className="mt-3 whitespace-pre-line text-sm text-white/90">{request.description}</p>}
      <p className="mt-3 text-xs text-white/70">
        Buyer <span className="font-mono">{request.mine ? 'you' : shortKey(request.buyer)}</span>
      </p>
      {user && open && (
        <div className="card-actions">
          {request.mine ? (
            <button
              onClick={() => withdrawRequest(request.id).then(onChange)}
              className="btn btn-ghost btn-sm"
            >
              Withdraw request
            </button>
          ) : (
            <button
              onClick={() => onAnswer(request)}
              className="btn btn-primary btn-sm"
            >
              Offer this
            </button>
          )}
        </div>
      )}
      </div>
    </article>
  );
}

export default function Market({ user, onSignIn, onLogout }) {
  const now = useNow();
  const [tab, setTab] = useState('offers');
  const [filters, setFilters] = useState({ q: '', kind: '', category: '', region: '' });
  const [showClosed, setShowClosed] = useState(false);
  const [results, setResults] = useState({ offers: [], requests: [] });
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // { mode, answering? }

  const load = useCallback(
    () =>
      searchMarket({ ...filters, status: showClosed ? 'all' : '' })
        .then((r) => {
          setResults(r);
          setError('');
        })
        .catch((e) => setError(e.message)),
    [filters, showClosed],
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

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const items = tab === 'offers' ? results.offers : results.requests;

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
              ['offers', 'Sell offers', results.offers.length],
              ['requests', 'Buy requests', results.requests.length],
            ].map(([key, label, count]) => (
              <li key={key}>
                <button role="tab" onClick={() => setTab(key)} className={tab === key ? 'menu-active' : ''}>
                  {label}
                  <span className="badge badge-sm">{count}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="navbar-end gap-3">
          {user ? (
            <>
              <button onClick={() => setForm({ mode: 'offer' })} className="btn btn-primary btn-sm">+ Sell</button>
              <button onClick={() => setForm({ mode: 'request' })} className="btn btn-outline btn-primary btn-sm">+ Request</button>
              <div className="dropdown dropdown-end">
                <div tabIndex={0} role="button" className="btn btn-ghost btn-sm font-mono" title={user.identityKey}>
                  {shortKey(user.identityKey)}
                </div>
                <ul tabIndex={0} className="menu dropdown-content z-20 mt-2 w-40 rounded-box bg-base-300 p-2 shadow">
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
        <section className="card card-border bg-base-200">
          <div className="card-body gap-4 sm:flex-row sm:items-center">
            <label className="input input-bordered flex flex-1 items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 opacity-70">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input type="search" placeholder="Search name, description…" value={filters.q} onChange={setFilter('q')} className="grow" />
            </label>
            <select value={filters.kind} onChange={setFilter('kind')} className="select select-bordered">
              <option value="">All types</option>
              <option>data</option>
              <option>service</option>
              <option>product</option>
            </select>
            <input placeholder="Category" value={filters.category} onChange={setFilter('category')} className="input input-bordered sm:w-36" />
            <input placeholder="Region" value={filters.region} onChange={setFilter('region')} className="input input-bordered sm:w-36" />
            <label className="label cursor-pointer gap-2 text-white">
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
              Show closed
            </label>
          </div>
        </section>

        <h2 className="mt-10 text-lg font-medium">{tab === 'offers' ? 'Sell offers' : 'Buy requests'}</h2>

      {form && (
        <div className="mt-6">
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
      <div className="mt-6 grid gap-6">
        {items.length === 0 && <div role="alert" className="alert alert-soft text-sm"><span>Nothing here yet.</span></div>}
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
    </main>
    </div>
  );
}
