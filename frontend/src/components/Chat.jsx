import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDealFiles, fetchMessages, followChat, sendMessage } from '../api';
import DealFiles from './DealFiles';
import { Avatar, UserLink } from './UserLink';

// New messages arrive over server-sent events at once; this only catches what a dropped connection missed.
const FALLBACK_REFRESH_MS = 15000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Must match backend/src/messages.ts
const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';
// How close to the bottom the reader must be for new messages to scroll into view.
const STICK_TO_BOTTOM_PX = 80;

// Bid states in which the buyer has paid, so they are in the chat (as in backend/src/profiles.ts).
const PAID_STATES = ['paid', 'delivered', 'received', 'disputed'];

/** Whether the user is the seller or a paying buyer of a sold offer. */
export const canChat = (offer) =>
  offer.status === 'sold' && !!offer.groupPayment?.txid && (offer.mine || PAID_STATES.includes(offer.myBid?.status));

const time = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

/** Everything between the seller and the buyers of a sold offer: their files and the chat, kept live. */
export default function DealRoom({ offer }) {
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const latest = useRef(null);

  const merge = useCallback((incoming) => {
    if (!incoming.length) return;
    const last = incoming[incoming.length - 1].createdAt;
    if (!latest.current || last > latest.current) latest.current = last;
    setMessages((old) => {
      const seen = new Set(old.map((m) => m.id));
      const added = incoming.filter((m) => !seen.has(m.id));
      return added.length ? [...old, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : old;
    });
  }, []);

  useEffect(() => {
    let stopped = false;
    setMessages([]);
    setFiles([]);
    latest.current = null;
    const catchUp = () =>
      fetchMessages(offer.id, latest.current)
        .then((m) => !stopped && (merge(m), setError('')))
        .catch((e) => !stopped && setError(e.message));
    const loadFiles = () => fetchDealFiles(offer.id).then((f) => !stopped && setFiles(f)).catch(() => {});

    // "ready" comes on every (re)connect, so whatever was sent meanwhile is fetched then.
    const close = followChat(offer.id, {
      ready: () => (catchUp(), loadFiles()),
      message: (m) => merge([m]),
      files: loadFiles,
    });
    const refresh = () => (catchUp(), loadFiles());
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    refresh();
    const t = setInterval(refresh, FALLBACK_REFRESH_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      close();
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [offer.id, merge]);

  const reloadFiles = () => fetchDealFiles(offer.id).then(setFiles).catch(() => {});

  return (
    <>
      <DealFiles offer={offer} files={files} onChange={reloadFiles} />
      <Chat offer={offer} messages={messages} onSent={(m) => merge([m])} loadError={error} />
    </>
  );
}

function Chat({ offer, messages, onSent, loadError }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const list = useRef(null);
  const fileInput = useRef(null);
  const atBottom = useRef(true);

  const scrollDown = () => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  };

  // New messages scroll into view, unless the reader has scrolled up to read older ones.
  useEffect(() => {
    if (atBottom.current || messages[messages.length - 1]?.mine) scrollDown();
  }, [messages]);

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
      onSent(await sendMessage(offer.id, text.trim(), image));
      setText('');
      setImage(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const shownError = error || loadError;
  return (
    <section className="card card-border mt-6 bg-base-200">
      <div className="card-body gap-3">
        <div>
          <h3 className="card-title text-base">Chat</h3>
          <p className="text-xs text-white/60">
            The seller and the buyers who paid for "{offer.name}" can see this chat.
          </p>
        </div>

        <div
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
          }}
          className="flex max-h-[28rem] min-h-40 flex-col gap-1 overflow-y-auto overflow-x-hidden rounded-box bg-base-300/50 p-3"
        >
          {messages.length === 0 && <p className="m-auto text-sm text-white/50">No messages yet.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`chat min-w-0 ${m.mine ? 'chat-end' : 'chat-start'}`}>
              <div className="chat-image"><Avatar person={m.sender} /></div>
              <div className="chat-header min-w-0 text-xs">
                {m.mine ? 'You' : <UserLink person={m.sender} size="xs" className="[&>.avatar]:hidden" />}
                <time className="ml-1 opacity-50">{time(m.createdAt)}</time>
              </div>
              {/* Long words and links wrap instead of running out of the bubble. */}
              <div className={`chat-bubble ${m.mine ? 'chat-bubble-primary' : ''} flex min-w-0 max-w-[85%] flex-col gap-2`}>
                {m.imageUrl && (
                  <a href={m.imageUrl} target="_blank" rel="noreferrer">
                    <img src={m.imageUrl} alt="" loading="lazy" className="max-h-64 max-w-full rounded" onLoad={() => atBottom.current && scrollDown()} />
                  </a>
                )}
                {m.text && <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</span>}
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
          {/* Grows with its text; Enter sends, Shift+Enter starts a new line. */}
          <textarea
            rows={1}
            maxLength={4000}
            placeholder="Write a message… (Shift+Enter for a new line)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e);
            }}
            className="textarea textarea-bordered textarea-sm field-sizing-content max-h-40 min-h-0 min-w-0 flex-1 resize-none [overflow-wrap:anywhere]"
          />
          <button disabled={sending || (!text.trim() && !image)} className="btn btn-primary btn-sm">
            {sending && <span className="loading loading-spinner loading-xs" />}
            Send
          </button>
        </form>
        {shownError && <div role="alert" className="alert alert-error alert-soft text-sm"><span>{shownError}</span></div>}
      </div>
    </section>
  );
}
