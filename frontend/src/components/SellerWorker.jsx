import { useEffect, useRef, useState } from 'react';
import { runBuyerTasks, runSellerTasks } from '../delivery';

const POLL_MS = 10_000;
const TOAST_MS = 8_000;

/**
 * Runs while a user is signed in: claims the payments they received as a seller, delivers
 * the data keys to the buyers, and takes back the pledges their own bids no longer need.
 * Shows what happened as toasts.
 */
export default function SellerWorker({ user }) {
  const [toasts, setToasts] = useState([]);
  const running = useRef(false);

  useEffect(() => {
    if (!user) return;
    const notify = (message, kind) => {
      const id = Math.random();
      setToasts((t) => [...t, { id, message, kind }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
    };
    const tick = async () => {
      if (running.current) return;
      running.current = true;
      await runSellerTasks(notify).catch((e) => console.warn('Seller tasks failed', e));
      await runBuyerTasks(notify).catch((e) => console.warn('Buyer tasks failed', e));
      running.current = false;
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [user]);

  if (toasts.length === 0) return null;
  return (
    <div className="toast toast-end z-30">
      {toasts.map((t) => (
        <div key={t.id} role="alert" className={`alert text-sm ${t.kind === 'error' ? 'alert-error' : 'alert-success'}`}>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
