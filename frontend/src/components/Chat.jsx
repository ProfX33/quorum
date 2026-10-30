import { useEffect, useRef, useState } from 'react';
import { fetchMessages, sendMessage } from '../api';
import { Avatar, UserLink } from './UserLink';

const REFRESH_MS = 3000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Must match backend/src/messages.ts
const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

// Bid states in which the buyer has paid, so they are in the chat (as in backend/src/profiles.ts).
const PAID_STATES = ['paid', 'delivered', 'received', 'disputed'];

/** Whether the user is the seller or a paying buyer of a sold offer. */
export const canChat = (offer) =>
  offer.status === 'sold' && !!offer.groupPayment?.txid && (offer.mine || PAID_STATES.includes(offer.myBid?.status));

const time = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

/** The chat of a sold offer between its seller and the buyers who paid: text and images. */
export default function Chat({ offer }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const list = useRef(null);
  const fileInput = useRef(null);
  const latest = useRef(null);

  const merge = (incoming) => {
    if (!incoming.length) return;
    latest.current = incoming[incoming.length - 1].createdAt;
    setMessages((old) => {
      const seen = new Set(old.map((m) => m.id));
      return [...old, ...incoming.filter((m) => !seen.has(m.id))];
    });
  };

  useEffect(() => {
    let stopped = false;
    setMessages([]);
    latest.current = null;
    const load = () =>
      fetchMessages(offer.id, latest.current)
        .then((m) => !stopped && merge(m))
        .catch((e) => !stopped && setError(e.message));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [offer.id]);

  // Keep the newest message in view.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!image) return setPreview(null);
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function pickImage(file) {
    setError('');
    if (file && file.size > MAX_IMAGE_BYTES) {
      setError('Image too large (max 5 MB)');
      file = null;
    }
    setImage(file ?? null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function send(e) {
    e.preventDefault();
    if (sending || (!text.trim() && !image)) return;
    setSending(true);
    setError('');
    try {
      merge([await sendMessage(offer.id, text.trim(), image)]);
      setText('');
      setImage(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="card card-border mt-6 bg-base-200">
      <div className="card-body gap-3">
        <div>
          <h3 className="card-title text-base">Chat</h3>
          <p className="text-xs text-white/60">
            The seller and the buyers who paid for "{offer.name}" can see this chat.
          </p>
        </div>

        <div ref={list} className="flex max-h-[28rem] min-h-40 flex-col gap-1 overflow-y-auto rounded-box bg-base-300/50 p-3">
          {messages.length === 0 && <p className="m-auto text-sm text-white/50">No messages yet.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`chat ${m.mine ? 'chat-end' : 'chat-start'}`}>
              <div className="chat-image"><Avatar person={m.sender} /></div>
              <div className="chat-header text-xs">
                {m.mine ? 'You' : <UserLink person={m.sender} size="xs" className="[&>.avatar]:hidden" />}
                <time className="ml-1 opacity-50">{time(m.createdAt)}</time>
              </div>
              <div className={`chat-bubble ${m.mine ? 'chat-bubble-primary' : ''} grid gap-2`}>
                {m.imageUrl && (
                  <a href={m.imageUrl} target="_blank" rel="noreferrer">
                    <img src={m.imageUrl} alt="" loading="lazy" className="max-h-64 rounded" onLoad={() => list.current && (list.current.scrollTop = list.current.scrollHeight)} />
                  </a>
                )}
                {m.text && <span className="whitespace-pre-wrap break-words">{m.text}</span>}
              </div>
            </div>
          ))}
        </div>

        {preview && (
          <div className="flex items-center gap-2">
            <img src={preview} alt="" className="h-16 rounded" />
            <button type="button" onClick={() => setImage(null)} className="btn btn-ghost btn-xs">Remove image</button>
          </div>
        )}
        <form onSubmit={send} className="flex items-end gap-2">
          <input ref={fileInput} type="file" accept={IMAGE_TYPES} className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
          <button type="button" onClick={() => fileInput.current?.click()} className="btn btn-ghost btn-sm" title="Attach an image">
            Image
          </button>
          <textarea
            rows={1}
            maxLength={4000}
            placeholder="Write a message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) send(e);
            }}
            className="textarea textarea-bordered textarea-sm min-h-0 flex-1"
          />
          <button disabled={sending || (!text.trim() && !image)} className="btn btn-primary btn-sm">
            {sending && <span className="loading loading-spinner loading-xs" />}
            Send
          </button>
        </form>
        {error && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{error}</span></div>}
      </div>
    </section>
  );
}
