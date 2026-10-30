import { useRef, useState } from 'react';
import { deleteDealFile, uploadDealFile } from '../api';

const MAX_FILE_BYTES = 20 * 1024 * 1024; // Must match backend/src/messages.ts

const fileSize = (n) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** The files with information the seller hands over: the seller uploads, the buyers download. */
export default function DealFiles({ offer, files, onChange }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);
  const seller = offer.mine;

  async function run(label, action) {
    setBusy(label);
    setError('');
    try {
      await action();
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  function upload(list) {
    const picked = [...(list ?? [])];
    if (input.current) input.current.value = '';
    if (!picked.length) return;
    const tooLarge = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (tooLarge) return setError(`${tooLarge.name} is too large (max 20 MB)`);
    run('Uploading…', async () => {
      for (const file of picked) await uploadDealFile(offer.id, file);
    });
  }

  if (!seller && files.length === 0) {
    return (
      <section className="card card-border mt-6 bg-base-200">
        <div className="card-body gap-1">
          <h3 className="card-title text-base">Information from the seller</h3>
          <p className="text-sm text-white/60">The seller has not uploaded any files yet. They appear here as soon as they do.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="card card-border mt-6 bg-base-200">
      <div className="card-body gap-3">
        <div>
          <h3 className="card-title text-base">{seller ? 'Information for your buyers' : 'Information from the seller'}</h3>
          <p className="text-xs text-white/60">
            {seller
              ? 'Upload the files your buyers need, e.g. access details or instructions. Only you and the buyers who paid can download them.'
              : 'Files the seller uploaded for you.'}
          </p>
        </div>

        {files.length > 0 && (
          <ul className="grid gap-1">
            {files.map((f) => (
              <li key={f.id} className="flex min-w-0 items-center gap-2 rounded-box bg-base-300/50 px-3 py-2 text-sm">
                <a href={f.url} download={f.name} className="link link-hover min-w-0 flex-1 truncate" title={f.name}>
                  {f.name}
                </a>
                <span className="shrink-0 text-xs text-white/50">{fileSize(f.size)}</span>
                {seller && (
                  <button
                    disabled={!!busy}
                    onClick={() => window.confirm(`Delete ${f.name}?`) && run('Deleting…', () => deleteDealFile(f.id))}
                    className="btn btn-ghost btn-xs shrink-0"
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {seller && (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              upload(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-box border-2 border-dashed px-4 py-6 text-center text-sm transition ${
              dragging ? 'border-primary bg-primary/10' : 'border-white/20 hover:border-primary'
            }`}
          >
            <input ref={input} type="file" multiple className="hidden" disabled={!!busy} onChange={(e) => upload(e.target.files)} />
            {busy ? (
              <span className="flex items-center gap-2"><span className="loading loading-spinner loading-xs" />{busy}</span>
            ) : (
              <>
                <span className="font-medium">Drop files here or click to upload</span>
                <span className="text-xs text-white/50">Any file type, up to 20 MB each</span>
              </>
            )}
          </label>
        )}
        {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error}</span></div>}
      </div>
    </section>
  );
}
