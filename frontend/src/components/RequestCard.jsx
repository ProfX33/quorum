import { withdrawRequest } from '../api';
import { Attributes, Countdown, STATUS_LABEL, sats } from './OfferCard';
import { UserLink } from './UserLink';

/** A buy request; onAnswer (optional) lets another user answer it with a sell offer. */
export default function RequestCard({ request, user, now, onAnswer, onChange }) {
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
      <p className="mt-3 flex items-center gap-2 text-xs text-white/70">
        Buyer <UserLink person={request.buyerProfile} you={request.mine} />
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
          ) : onAnswer && (
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
