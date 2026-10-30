import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchProfile, removeAvatar, updateProfile, uploadAvatar } from '../api';
import { Countdown, OfferCard, sats, useNow } from '../components/OfferCard';
import RequestCard from '../components/RequestCard';
import { Avatar, UserLink, displayName } from '../components/UserLink';

const REFRESH_MS = 5000;
const AVATAR_PX = 256;

const BID_LABEL = {
  open: 'Open',
  won: 'Won, pledge due',
  pledged: 'Pledged',
  lost: 'Not in payment group',
  expired: 'Expired',
  paid: 'Paid',
  delivered: 'Delivered',
  received: 'Received',
  disputed: 'Disputed',
  defaulted: 'Payment missed',
};

const date = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** Crops the picture to a centred square of AVATAR_PX pixels, as JPEG, so uploads stay small. */
async function squareAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error('This file is not a picture the browser can read.');
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = AVATAR_PX;
    canvas
      .getContext('2d')
      .drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProfileEditor({ user, onSaved, onClose }) {
  const [name, setName] = useState(user.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      onSaved(await action());
      return true;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateProfile(name)).then((ok) => ok && onClose());
      }}
    >
      <label className="floating-label">
        <span>Display name</span>
        <input
          value={name}
          maxLength={50}
          placeholder="Display name"
          onChange={(e) => setName(e.target.value)}
          className="input input-bordered w-full max-w-sm"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) run(async () => uploadAvatar(await squareAvatar(file)));
          }}
        />
        <button type="button" disabled={busy} onClick={() => fileInput.current.click()} className="btn btn-outline btn-primary btn-sm">
          {user.avatarUrl ? 'Change picture' : 'Upload picture'}
        </button>
        {user.avatarUrl && (
          <button type="button" disabled={busy} onClick={() => run(removeAvatar)} className="btn btn-ghost btn-sm">
            Remove picture
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button disabled={busy} className="btn btn-primary btn-sm">
          {busy && <span className="loading loading-spinner loading-xs" />}
          Save
        </button>
        <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Done</button>
      </div>
      {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error}</span></div>}
    </form>
  );
}

function TxLink({ txid, txUrl }) {
  return (
    <a href={txUrl} target="_blank" rel="noreferrer" className="link font-mono" title={txid}>
      {txid.slice(0, 12)}…
    </a>
  );
}

function OfferLink({ offer }) {
  return <a href={`#/offers/${offer.id}`} className="link link-hover font-medium">{offer.name}</a>;
}

function BidsTable({ bids, own, now }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Offer</th>
            <th>Seller</th>
            <th>Status</th>
            <th className="text-right">Share</th>
            {own && <th className="text-right">Your max</th>}
            <th>Payment</th>
            <th>Placed</th>
          </tr>
        </thead>
        <tbody>
          {bids.map((b) => (
            <tr key={b.id}>
              <td><OfferLink offer={b.offer} /></td>
              <td><UserLink person={b.seller} /></td>
              <td>
                {b.status === 'open' && b.offer.status === 'open'
                  ? <Countdown deadline={b.offer.deadline} now={now} />
                  : <span className="badge badge-sm badge-neutral">{BID_LABEL[b.status]}</span>}
              </td>
              <td className="text-right tabular-nums">{b.amount != null ? sats(b.amount) : '—'}</td>
              {own && <td className="text-right tabular-nums">{sats(b.maxPrice)}</td>}
              <td>{b.txid ? <TxLink {...b} /> : '—'}</td>
              <td className="whitespace-nowrap text-white/70">{date(b.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransactionsTable({ transactions }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Type</th>
            <th>Offer</th>
            <th>With</th>
            <th className="text-right">Amount</th>
            <th>Transaction</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={`${t.role}-${t.offer.id}`}>
              <td>
                <span className={`badge badge-sm ${t.role === 'sale' ? 'badge-success' : 'badge-info'}`}>
                  {t.role === 'sale' ? 'Sale' : 'Purchase'}
                </span>
              </td>
              <td><OfferLink offer={t.offer} /></td>
              <td>
                <div className="flex flex-col gap-1">
                  {t.counterparties.map((p) => <UserLink key={p.identityKey} person={p} />)}
                </div>
              </td>
              <td className={`text-right tabular-nums ${t.role === 'sale' ? 'text-success' : ''}`}>
                {t.role === 'sale' ? '+' : '−'}{sats(t.amount)}
              </td>
              <td>
                <TxLink {...t} />
                {!t.seen && <span className="badge badge-ghost badge-xs ml-2">unconfirmed</span>}
              </td>
              <td className="whitespace-nowrap text-white/70">{date(t.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Profile({ identityKey, user, onSignIn, onUserChange }) {
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('offers');
  const [editing, setEditing] = useState(false);
  const own = user?.identityKey === identityKey;

  const load = useCallback(
    () =>
      fetchProfile(identityKey)
        .then((d) => {
          setData(d);
          setError('');
        })
        .catch((e) => setError(e.message)),
    [identityKey],
  );

  useEffect(() => {
    setData(null);
    setEditing(false);
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Own profile edits show at once, before the next refresh.
  const person = own ? { ...data?.user, ...user } : data?.user;
  const tabs = data && [
    ['offers', 'Sell offers', data.offers.length],
    ['requests', 'Buy requests', data.requests.length],
    ['bids', 'Bids', data.bids.length],
    ['transactions', 'Transactions', data.transactions.length],
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="navbar bg-base-200 rounded-box px-4 text-sm">
        <div className="navbar-start breadcrumbs">
          <ul>
            <li><a href="#/">Market</a></li>
            <li>{person ? displayName(person) : 'Profile'}</li>
          </ul>
        </div>
        <div className="navbar-end">
          {!user && <button onClick={onSignIn} className="btn btn-primary btn-sm">Sign in</button>}
        </div>
      </header>

      {error && (
        <div role="alert" className="alert alert-error alert-soft mt-8 text-sm">
          <span>{error === 'Not found' ? 'Nobody has signed in with this key yet.' : error}</span>
        </div>
      )}
      {!data && !error && <span className="loading loading-spinner mt-8" />}

      {data && (
        <>
          <section className="card card-border mt-8 bg-base-200">
            <div className="card-body flex-row flex-wrap items-start gap-6">
              <Avatar person={person} size="lg" />
              <div className="min-w-0 flex-1">
                <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
                  {person.name || <span className="text-white/60">Unnamed {person.kind === 'agent' ? 'agent' : 'user'}</span>}
                  <span className="badge badge-sm badge-outline">{person.kind}</span>
                  {own && <span className="badge badge-sm badge-primary">you</span>}
                </h1>
                <p className="mt-1 break-all font-mono text-xs text-white/70">{person.identityKey}</p>
                <p className="mt-1 text-xs text-white/70">Member since {new Date(person.createdAt).toLocaleDateString()}</p>
                {own && (
                  <div className="mt-4">
                    {editing ? (
                      <ProfileEditor user={user} onSaved={onUserChange} onClose={() => setEditing(false)} />
                    ) : (
                      <button onClick={() => setEditing(true)} className="btn btn-outline btn-primary btn-sm">Edit profile</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          <div role="tablist" className="tabs tabs-box tabs-sm mt-10 w-fit bg-base-200">
            {tabs.map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`tab gap-2 px-4 font-medium ${tab === key ? 'tab-active bg-primary! text-primary-content!' : ''}`}
              >
                {label}
                <span className="badge badge-sm">{count}</span>
              </button>
            ))}
          </div>

          <div className="mt-8 grid gap-8">
            {tabs.find(([k]) => k === tab)[2] === 0 && (
              <div role="alert" className="alert alert-soft text-sm"><span>Nothing here yet.</span></div>
            )}
            {tab === 'offers' &&
              data.offers.map((o) => <OfferCard linked key={o.id} offer={o} user={user} now={now} onChange={load} onSignIn={onSignIn} />)}
            {tab === 'requests' &&
              data.requests.map((r) => <RequestCard key={r.id} request={r} user={user} now={now} onChange={load} />)}
            {tab === 'bids' && data.bids.length > 0 && (
              <section className="card card-border bg-base-200"><div className="card-body p-4"><BidsTable bids={data.bids} own={own} now={now} /></div></section>
            )}
            {tab === 'transactions' && data.transactions.length > 0 && (
              <section className="card card-border bg-base-200"><div className="card-body p-4"><TransactionsTable transactions={data.transactions} /></div></section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
