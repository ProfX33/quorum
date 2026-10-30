import { useState } from 'react';
import { createOffer, createRequest, sha256File } from '../api';

const KINDS = ['data', 'service', 'product'];

// <input type="datetime-local"> wants local time without a zone.
const toLocalInput = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

const inputClass =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black';

/**
 * Create form for a sell offer (mode "offer") or a buy request (mode "request").
 * `answering` is a request this offer fulfils; its requester becomes the first bidder.
 */
export default function ListingForm({ mode, answering, onDone, onCancel }) {
  const isOffer = mode === 'offer';
  const defaultDeadline = answering
    ? new Date(Math.min(new Date(answering.deadline).getTime(), Date.now() + 86400000))
    : new Date(Date.now() + 86400000);
  const [form, setForm] = useState({
    kind: answering?.kind ?? 'data',
    category: answering?.category ?? '',
    region: answering?.region ?? '',
    name: answering?.name ?? '',
    description: '',
    price: '',
    deadline: toLocalInput(defaultDeadline),
    dataHash: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataHash = await sha256File(file);
    setForm((f) => ({ ...f, dataHash }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { price, deadline, dataHash, ...rest } = form;
    const body = { ...rest, deadline: new Date(deadline).toISOString() };
    try {
      if (isOffer) {
        await createOffer({ ...body, price: Number(price), dataHash: dataHash || undefined, requestId: answering?.id });
      } else {
        await createRequest({ ...body, maxPrice: Number(price) });
      }
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-neutral-200 p-5">
      <h2 className="font-medium">
        {answering ? `Answer request “${answering.name}”` : isOffer ? 'New sell offer' : 'New buy request'}
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-neutral-500">Type</span>
          <select value={form.kind} onChange={set('kind')} className={inputClass}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-neutral-500">Name</span>
          <input required maxLength={200} value={form.name} onChange={set('name')} className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="text-neutral-500">Category</span>
          <input required maxLength={100} value={form.category} onChange={set('category')} className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="text-neutral-500">Region</span>
          <input required maxLength={100} value={form.region} onChange={set('region')} className={inputClass} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-neutral-500">Description</span>
          <textarea rows={3} maxLength={5000} value={form.description} onChange={set('description')} className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="text-neutral-500">{isOffer ? 'Price (sats)' : 'Max. price you pay (sats)'}</span>
          <input required type="number" min={1} step={1} value={form.price} onChange={set('price')} className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="text-neutral-500">Deadline</span>
          <input
            required
            type="datetime-local"
            value={form.deadline}
            max={answering ? toLocalInput(new Date(answering.deadline)) : undefined}
            onChange={set('deadline')}
            className={inputClass}
          />
        </label>
        {isOffer && form.kind === 'data' && (
          <div className="text-sm sm:col-span-2">
            <span className="text-neutral-500">Commitment: sha256 of the encrypted data</span>
            <div className="flex gap-2">
              <input
                required
                pattern="[0-9a-fA-F]{64}"
                placeholder="64 hex characters"
                value={form.dataHash}
                onChange={set('dataHash')}
                className={`${inputClass} font-mono text-xs`}
              />
              <label className="shrink-0 cursor-pointer rounded-md border border-neutral-300 px-3 py-2 hover:border-black">
                From file
                <input type="file" className="hidden" onChange={handleFile} />
              </label>
            </div>
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-5 flex gap-3">
        <button
          disabled={busy}
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? 'Publishing…' : 'Publish'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-neutral-500 hover:text-black">
          Cancel
        </button>
      </div>
    </form>
  );
}
