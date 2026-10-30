import { useState } from 'react';
import { createOffer, createRequest, sha256File } from '../api';

const KINDS = ['data', 'service', 'product'];

// <input type="datetime-local"> wants local time without a zone.
const toLocalInput = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

const inputClass = 'input input-bordered w-full';

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
    <form onSubmit={handleSubmit} className="card card-border bg-base-200 card-body">
      <h2 className="card-title">
        {answering ? `Answer request “${answering.name}”` : isOffer ? 'New sell offer' : 'New buy request'}
      </h2>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <label className="fieldset text-sm">
          <span className="label">Type</span>
          <select value={form.kind} onChange={set('kind')} className="select select-bordered w-full">
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="fieldset text-sm">
          <span className="label">Name</span>
          <input required maxLength={200} value={form.name} onChange={set('name')} className={inputClass} />
        </label>
        <label className="fieldset text-sm">
          <span className="label">Category</span>
          <input required maxLength={100} value={form.category} onChange={set('category')} className={inputClass} />
        </label>
        <label className="fieldset text-sm">
          <span className="label">Region</span>
          <input required maxLength={100} value={form.region} onChange={set('region')} className={inputClass} />
        </label>
        <label className="fieldset text-sm sm:col-span-2">
          <span className="label">Description</span>
          <textarea rows={3} maxLength={5000} value={form.description} onChange={set('description')} className="textarea textarea-bordered w-full" />
        </label>
        <label className="fieldset text-sm">
          <span className="label">{isOffer ? 'Price (sats)' : 'Max. price you pay (sats)'}</span>
          <input required type="number" min={1} step={1} value={form.price} onChange={set('price')} className={inputClass} />
        </label>
        <label className="fieldset text-sm">
          <span className="label">Deadline</span>
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
          <div className="fieldset text-sm sm:col-span-2">
            <span className="label">Commitment: sha256 of the encrypted data</span>
            <div className="join w-full">
              <input
                required
                pattern="[0-9a-fA-F]{64}"
                placeholder="64 hex characters"
                value={form.dataHash}
                onChange={set('dataHash')}
                className={`${inputClass} join-item font-mono text-xs`}
              />
              <label className="btn btn-outline join-item shrink-0">
                From file
                <input type="file" className="hidden" onChange={handleFile} />
              </label>
            </div>
          </div>
        )}
      </div>
      {error && <div role="alert" className="alert alert-error alert-soft mt-3 text-sm"><span>{error}</span></div>}
      <div className="card-actions mt-5">
        <button disabled={busy} className="btn btn-primary">
          {busy && <span className="loading loading-spinner loading-xs" />}
          {busy ? 'Publishing…' : 'Publish'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}
