import { useState } from 'react';
import { createOffer, createRequest } from '../api';
import { encryptAndUpload } from '../delivery';

const KINDS = [
  { value: 'data', label: 'Data', hint: 'A file, encrypted and delivered after payment' },
  { value: 'service', label: 'Service', hint: 'Work you perform for the buyer' },
  { value: 'product', label: 'Product', hint: 'A physical or digital good' },
];

export const CATEGORIES = [
  'Business & Finance', 'Climate & Environment', 'Education', 'Energy', 'Entertainment & Media',
  'Healthcare', 'Images & Video', 'Legal', 'Mobility & Transport', 'Real Estate',
  'Research & Science', 'Retail & E-commerce', 'Social & Marketing', 'Software & AI', 'Other',
];

export const REGIONS = [
  'Global', 'Europe', 'Germany', 'North America', 'United States', 'South America',
  'Asia', 'China', 'India', 'Middle East', 'Africa', 'Oceania',
];

// Keeps a pre-filled legacy value (e.g. from an older request) selectable.
const withCurrent = (list, v) => (v && !list.includes(v) ? [v, ...list] : list);

// <input type="datetime-local"> wants local time without a zone.
const toLocalInput = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

const Req = () => (
  <span className="text-error" aria-hidden="true">
    *
  </span>
);

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
    category: answering?.category || 'Other',
    region: answering?.region ?? '',
    name: answering?.name ?? '',
    description: '',
    price: '',
    deadline: toLocalInput(defaultDeadline),
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy('Publishing…');
    setError('');
    const { price, deadline, ...rest } = form;
    const body = {
      ...rest,
      category: rest.category || 'Other',
      deadline: new Date(deadline).toISOString(),
    };
    try {
      if (isOffer) {
        // Data is encrypted here; only the ciphertext and the wallet-wrapped key leave the browser.
        const data = form.kind === 'data' ? await encryptAndUpload(file, setBusy) : {};
        setBusy('Publishing…');
        await createOffer({ ...body, ...data, price: Number(price), requestId: answering?.id });
      } else {
        await createRequest({ ...body, maxPrice: Number(price) });
      }
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card card-border bg-base-200 card-body">
      <h2 className="card-title">
        {answering ? `Answer request “${answering.name}”` : isOffer ? 'New sell offer' : 'New buy request'}
      </h2>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div className="fieldset text-sm sm:col-span-2">
          <span className="label">Type</span>
          <div className="join w-full">
            {KINDS.map((k) => (
              <input
                key={k.value}
                type="radio"
                name="kind"
                aria-label={k.label}
                checked={form.kind === k.value}
                onChange={() => setForm((f) => ({ ...f, kind: k.value }))}
                className="btn join-item flex-1 checked:btn-primary"
              />
            ))}
          </div>
          <span className="label text-xs">{KINDS.find((k) => k.value === form.kind)?.hint}</span>
        </div>
        <label className="fieldset text-sm sm:col-span-2">
          <span className="label">
            Name <Req />
          </span>
          <input required maxLength={200} placeholder="Short, descriptive title" value={form.name} onChange={set('name')} className={inputClass} />
        </label>
        <label className="fieldset text-sm">
          <span className="label">Category</span>
          <select value={form.category} onChange={set('category')} className="select select-bordered w-full">
            {withCurrent(CATEGORIES, form.category).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="fieldset text-sm">
          <span className="label">
            Region <span className="opacity-50">(optional)</span>
          </span>
          <select value={form.region} onChange={set('region')} className="select select-bordered w-full">
            <option value="">No region</option>
            {withCurrent(REGIONS, form.region).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="fieldset text-sm sm:col-span-2">
          <span className="label">Description</span>
          <textarea rows={4} maxLength={5000} placeholder="Describe the details: contents, format, quality, conditions…" value={form.description} onChange={set('description')} className="textarea textarea-bordered w-full" />
        </label>
        <label className="fieldset text-sm">
          <span className="label">{isOffer ? 'Price' : 'Max. price you pay'} <Req /></span>
          <label className="input input-bordered flex w-full items-center gap-2">
            <input required type="number" min={1} step={1} placeholder="0" value={form.price} onChange={set('price')} className="grow" />
            <span className="text-xs opacity-60">sats</span>
          </label>
        </label>
        <label className="fieldset text-sm">
          <span className="label">
            Deadline <Req />
          </span>
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
          <label className="fieldset text-sm sm:col-span-2">
            <span className="label">
              Data file (max. 20 MB) <Req />
            </span>
            <input
              required
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="file-input file-input-bordered w-full"
            />
            <span className="label whitespace-normal text-xs">
              Encrypted in your browser before upload. The key stays locked in your wallet and is
              released to each buyer once their payment is on-chain. The file name and size are public.
            </span>
          </label>
        )}
      </div>
      <p className="mt-2 text-xs opacity-60">
        <span className="text-error">*</span> required
      </p>
      {error && <div role="alert" className="alert alert-error alert-soft mt-3 text-sm"><span>{error}</span></div>}
      <div className="card-actions mt-5">
        <button disabled={!!busy} className="btn btn-primary">
          {busy && <span className="loading loading-spinner loading-xs" />}
          {busy || 'Publish'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}
