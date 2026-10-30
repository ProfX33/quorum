import { useCallback, useEffect, useState } from 'react';
import { logout, searchMarket, withdrawRequest } from '../api';
import ListingForm from '../components/ListingForm';
import { Attributes, Countdown, OfferCard, STATUS_LABEL, sats, shortKey, useNow } from '../components/OfferCard';

const REFRESH_MS = 5000;

function RequestCard({ request, user, now, onAnswer, onChange }) {
  const open = request.status === 'open' && new Date(request.deadline).getTime() > now;
  return (
    <article className="rounded-lg border border-neutral-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-medium">{request.name}</h3>
          <Attributes item={request} />
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-medium">≤ {sats(request.maxPrice)}</div>
          <div className="text-sm">
            {request.status === 'open' ? <Countdown deadline={request.deadline} now={now} /> : STATUS_LABEL[request.status]}
          </div>
        </div>
      </div>
      {request.description && <p className="mt-3 whitespace-pre-line text-sm text-neutral-700">{request.description}</p>}
      <p className="mt-3 text-xs text-neutral-500">
        Buyer <span className="font-mono">{request.mine ? 'you' : shortKey(request.buyer)}</span>
      </p>
      {user && open && (
        <div className="mt-3">
          {request.mine ? (
            <button
              onClick={() => withdrawRequest(request.id).then(onChange)}
              className="text-sm text-neutral-500 hover:text-black"
            >
              Withdraw request
            </button>
          ) : (
            <button
              onClick={() => onAnswer(request)}
              className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-neutral-800"
            >
              Offer this
            </button>
          )}
        </div>
      )}
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
  const filterClass = 'rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black';
  const items = tab === 'offers' ? results.offers : results.requests;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-medium tracking-tight">Data Marketplace</h1>
        <div className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <span className="font-mono text-xs text-neutral-500" title={user.identityKey}>
                {shortKey(user.identityKey)}
              </span>
              <button onClick={handleLogout} className="text-neutral-500 hover:text-black">
                Sign out
              </button>
            </>
          ) : (
            <button onClick={onSignIn} className="rounded-md bg-black px-3 py-1.5 text-white hover:bg-neutral-800">
              Sign in
            </button>
          )}
        </div>
      </header>

      <div className="mt-6 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input placeholder="Search name, description…" value={filters.q} onChange={setFilter('q')} className={filterClass} />
        <select value={filters.kind} onChange={setFilter('kind')} className={filterClass}>
          <option value="">All types</option>
          <option>data</option>
          <option>service</option>
          <option>product</option>
        </select>
        <input placeholder="Category" value={filters.category} onChange={setFilter('category')} className={`${filterClass} sm:w-32`} />
        <input placeholder="Region" value={filters.region} onChange={setFilter('region')} className={`${filterClass} sm:w-32`} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200">
        <nav className="flex gap-5 text-sm">
          {[
            ['offers', `Sell offers (${results.offers.length})`],
            ['requests', `Buy requests (${results.requests.length})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 pb-2 ${tab === key ? 'border-black' : 'border-transparent text-neutral-500 hover:text-black'}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-4 pb-2 text-sm">
          <label className="flex items-center gap-1.5 text-neutral-500">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show closed
          </label>
          {user && (
            <>
              <button onClick={() => setForm({ mode: 'offer' })} className="hover:underline">
                + Sell
              </button>
              <button onClick={() => setForm({ mode: 'request' })} className="hover:underline">
                + Request
              </button>
            </>
          )}
        </div>
      </div>

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

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      <div className="mt-6 grid gap-4">
        {items.length === 0 && <p className="text-sm text-neutral-500">Nothing here yet.</p>}
        {tab === 'offers'
          ? items.map((o) => <OfferCard key={o.id} offer={o} user={user} now={now} onChange={load} onSignIn={onSignIn} />)
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
    </div>
  );
}
