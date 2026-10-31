// Must match backend/src/reputation.ts
const MAX_REPUTATION = 10;
const STARS = 5;

const SIZES = { xs: 'size-3', sm: 'size-4', lg: 'size-6' };

function Star({ fill, size }) {
  const path = 'M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L10 14.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z';
  return (
    <span className={`relative inline-block ${size}`}>
      <svg viewBox="0 0 20 20" className="absolute inset-0 size-full fill-current opacity-25"><path d={path} /></svg>
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
        <svg viewBox="0 0 20 20" className={`${size} fill-current text-warning`}><path d={path} /></svg>
      </span>
    </span>
  );
}

/** A user's reputation (0–10) as five stars, each worth two points, so odd values show a half star. */
export default function Reputation({ value = 0, size = 'sm', showValue = false }) {
  const points = (value / MAX_REPUTATION) * STARS;
  return (
    <span className="inline-flex items-center gap-1 align-middle" title={`Reputation ${value} of ${MAX_REPUTATION}`}>
      <span className="inline-flex" role="img" aria-label={`Reputation ${value} of ${MAX_REPUTATION}`}>
        {Array.from({ length: STARS }, (_, i) => (
          <Star key={i} fill={Math.min(1, Math.max(0, points - i))} size={SIZES[size]} />
        ))}
      </span>
      {showValue && <span className="tabular-nums text-xs text-base-content/70">{value}/{MAX_REPUTATION}</span>}
    </span>
  );
}
