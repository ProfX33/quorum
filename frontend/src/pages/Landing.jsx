import Navbar from '../components/Navbar';
import { SUPPORT_EMAIL } from '../components/Footer';
import { displayName } from '../components/UserLink';

const STEPS = [
  ['List', 'A seller lists a dataset or service at a fixed price and commits to the SHA-256 hash of what they will deliver.'],
  ['Bid', 'Buyers, agents or people, sign a bid with the most they are willing to pay. Nobody has to cover the full price alone.'],
  ['Reach quorum', 'As soon as the price split equally fits every bid in a group, the group locks. The largest group wins, so everyone pays the lowest share.'],
  ['Pay & receive', 'Each member pledges their share from their own wallet and the seller is paid in one transaction. Buyers check the data against the hash.'],
];

const FEATURES = [
  ['Non-custodial', 'Funds go from your wallet to the seller. We never hold your coins or your keys.', 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z M9 12l2 2 4-4'],
  ['Built for agents', 'A JSON command line, a TypeScript client and a REST API. No browser needed.', 'M4 6h16v12H4z M8 10l2 2-2 2 M13 14h3'],
  ['Verifiable delivery', 'The data hash is committed before anyone pays, so every buyer can prove what they got.', 'M5 12l4 4L19 6'],
  ['Earned reputation', 'Scores come only from paid, delivered deals and ratings that buyers sign.', 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z'],
  ['On-chain audit trail', 'Every payment carries an OP_RETURN tag, so each deal can be traced on BSV.', 'M9 7H6a3 3 0 000 6h3 M15 7h3a3 3 0 010 6h-3 M8 10h8'],
  ['Fair by construction', 'Matching is a deterministic rule. Ties go to the earliest bid.', 'M12 4v16 M5 8h14 M5 8l-2 6h4z M19 8l-2 6h4z'],
];

const QUOTES = [
  ['Our research agent used to skip datasets it could not justify on its own. Now it bids what the data is worth to us, and Quorum finds the other buyers.', 'BlockchainFan007', 'ML engineer, mobility startup'],
  ['We sold the same air-quality dataset to eleven agents in one afternoon. Buyers who would never pay the full price became customers.', 'Very frequent user', 'Environmental data provider'],
  ['No custody and no API keys to leak. The agent holds its own key and checks every payment before it signs. That is the only way I let software spend money.', 'Harry Potter', 'Defending the muggels'],
];

const BIDS = [
  ['Agent A', 1200, true],
  ['Agent B', 1100, true],
  ['Agent C', 600, false],
];
const SCALE = 1300; // sats at the top of the chart

export default function Landing({ user, onSignIn, onLogout, nav }) {
  const primaryCta = user ? (
    <a href="#/market" className="btn btn-primary btn-lg">Open the marketplace</a>
  ) : (
    <button onClick={onSignIn} className="btn btn-primary btn-lg">Sign in with BSV wallet</button>
  );

  return (
    <>
      <Navbar user={user} onSignIn={onSignIn} onLogout={onLogout} nav={nav} />

      <main className="overflow-x-clip">
        {/* Hero */}
        <section className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(126,163,204,0.25),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(243,249,210,0.08),transparent_50%)]" />
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:py-24 lg:grid-cols-2">
            <div>
              <span className="badge badge-outline border-primary/50 text-primary">Built on BSV · Non-custodial</span>
              <img src="/logo.svg" alt="Quorum" className="mt-8 h-14 sm:h-20" />
              <h1 className="mt-8 text-4xl font-semibold tracking-tight sm:text-5xl">
                Buy together. <span className="text-secondary">Pay your share.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
                Quorum is a group-buy marketplace for data and services. AI agents and people pool their bids on a
                listing, and once enough of them agree, each pays an equal share from their own wallet and every
                member gets the delivery.
              </p>
              <div className="mt-10 flex flex-wrap gap-4">
                {primaryCta}
                <a href="#/market" className="btn btn-ghost btn-lg border-white/20">Explore listings</a>
              </div>
              <p className="mt-6 text-sm text-white/50">
                {user ? `Signed in as ${displayName(user)}.` : 'No accounts, no passwords. Your wallet is your identity.'}
              </p>
            </div>
            <HeroArt />
          </div>
        </section>

        {/* Facts */}
        <section className="border-y border-white/10 bg-base-200/60">
          <dl className="mx-auto grid max-w-6xl gap-8 px-6 py-10 text-center sm:grid-cols-3">
            {[['0', 'coins held by Quorum'], ['1', 'transaction pays the seller'], ['SHA-256', 'proof of every delivery']].map(([value, label]) => (
              <div key={label}>
                <dt className="sr-only">{label}</dt>
                <dd className="text-3xl font-semibold text-secondary">{value}</dd>
                <dd className="mt-1 text-sm text-white/60">{label}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
          <SectionHeading eyebrow="How it works" title="Demand that adds up">
            Data is often too expensive for one buyer and worth it for many. Quorum turns those many small budgets
            into one sale.
          </SectionHeading>
          <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="card card-border relative border-white/10 bg-base-200">
                <div className="card-body">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-semibold text-primary-content">{i + 1}</span>
                  <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                  <p className="text-sm leading-relaxed text-white/70">{text}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* The matching rule, worked through */}
          <div className="card card-border mt-12 border-white/10 bg-base-200">
            <div className="card-body grid gap-10 p-8 md:grid-cols-2 md:items-center">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight">One dataset, 2,000 sats, three bidders</h3>
                <p className="mt-4 leading-relaxed text-white/70">
                  Quorum looks for the largest group whose equal share fits every member's bid. Three buyers would pay
                  667 each, more than Agent C offered. Two buyers pay 1,000 each, which both A and B accept. The group
                  locks, and Agent C's bid stays open for the next round.
                </p>
                <p className="mt-6 rounded-box bg-base-300 px-4 py-3 font-mono text-sm text-secondary">
                  share = ⌈2,000 / 2⌉ = 1,000 sats
                </p>
              </div>
              <MatchChart />
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="bg-base-200/60 py-24">
          <div className="mx-auto max-w-6xl px-6">
            <SectionHeading eyebrow="Why Quorum" title="Trust the math, not the middleman" />
            <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(([title, text, icon]) => (
                <div key={title} className="rounded-box border border-white/10 bg-base-100 p-6 transition hover:border-primary/50">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-primary" aria-hidden>
                    <path d={icon} />
                  </svg>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* For agents */}
        <section id="agents" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-12 px-6 py-24 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="For agents" title="Your agent shops on its own" align="left">
              An agent keeps its own key on its own machine. It searches the market, bids within its budget, pays
              its share and decrypts the delivery, and it checks every payment before signing it. Everything it does
              shows up live in the web app.
            </SectionHeading>
            <button onClick={() => nav.openTab('activity')} className="btn btn-outline btn-primary mt-8">Watch live activity</button>
          </div>
          <div className="mockup-code border border-white/10 bg-base-300 text-sm">
            <pre data-prefix="$"><code>bun agent/cli.ts search --q "air quality"</code></pre>
            <pre data-prefix="$"><code>bun agent/cli.ts bid &lt;offerId&gt; 1200</code></pre>
            <pre data-prefix="$"><code>bun agent/cli.ts work</code></pre>
            <pre data-prefix="›" className="text-secondary"><code>{'{ "group": "locked", "share": 1000 }'}</code></pre>
            <pre data-prefix="›" className="text-secondary"><code>{'{ "delivered": true, "hashOk": true }'}</code></pre>
          </div>
        </section>

        {/* Quotes */}
        <section className="bg-base-200/60 py-24">
          <div className="mx-auto max-w-6xl px-6">
            <SectionHeading eyebrow="Customers" title="What buyers and sellers say" />
            <div className="mt-14 grid gap-6 md:grid-cols-3">
              {QUOTES.map(([quote, name, role], i) => (
                <figure key={name} className="flex flex-col rounded-box border border-white/10 bg-base-100 p-8">
                  <svg viewBox="0 0 32 24" className="h-6 w-8 text-primary/60" fill="currentColor" aria-hidden>
                    <path d="M0 24V14C0 6 4 1 12 0l1 3c-4 1-6 4-6 8h5v13H0zm19 0V14c0-8 4-13 12-14l1 3c-4 1-6 4-6 8h5v13H19z" />
                  </svg>
                  <blockquote className="mt-5 flex-1 leading-relaxed text-white/85">{quote}</blockquote>
                  <figcaption className="mt-8 flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full font-semibold text-white" style={{ background: `hsl(${200 + i * 40} 40% 40%)` }}>
                      {name[0]}
                    </span>
                    <span>
                      <span className="block font-medium">{name}</span>
                      <span className="block text-sm text-white/55">{role}</span>
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* Sign in */}
        {!user && (
          <section className="mx-auto max-w-6xl px-6 py-24">
            <div className="relative overflow-hidden rounded-box border border-primary/30 bg-gradient-to-br from-primary/25 via-base-200 to-base-200 px-8 py-16 text-center">
              <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-secondary/10 blur-3xl" />
              <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">
                Your wallet is your account
              </h2>
              <p className="relative mx-auto mt-4 max-w-xl text-white/75">
                Sign in with a BSV wallet. Your account is created the first time you sign a challenge, with no email or password.
              </p>
              <div className="relative mt-8 flex justify-center">{primaryCta}</div>
            </div>
          </section>
        )}

        {/* Contact */}
        <section id="contact" className={`mx-auto max-w-6xl scroll-mt-20 px-6 pb-24 ${user ? 'pt-24' : ''}`}>
          <div className="grid gap-8 rounded-box border border-white/10 bg-base-200 p-8 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Questions? Talk to us.</h2>
              <p className="mt-2 text-white/70">
                Listing your data, connecting an agent or need help with a deal? Our team is happy to help.
              </p>
            </div>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="btn btn-secondary btn-lg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
                <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
              </svg>
              {SUPPORT_EMAIL}
            </a>
          </div>
        </section>
      </main>
    </>
  );
}

function SectionHeading({ eyebrow, title, children, align = 'center' }) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-2xl text-center' : ''}>
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {children && <p className="mt-4 leading-relaxed text-white/70">{children}</p>}
    </div>
  );
}

function MatchChart() {
  const shareAt = (1000 / SCALE) * 100;
  return (
    <figure aria-label="Bids of 1,200, 1,100 and 600 sats against a share of 1,000 sats">
      <div className="relative flex h-60 items-end justify-around gap-6 border-b border-white/20 px-4">
        <div className="absolute inset-x-0 border-t-2 border-dashed border-secondary/80" style={{ bottom: `${shareAt}%` }}>
          <span className="absolute -top-6 right-0 text-xs font-medium text-secondary">share 1,000</span>
        </div>
        {BIDS.map(([name, bid, inGroup]) => (
          <div key={name} className="flex h-full w-16 flex-col justify-end">
            <span className={`mb-1 text-center text-xs tabular-nums ${inGroup ? 'text-white' : 'text-white/50'}`}>{bid.toLocaleString('en')}</span>
            <div
              className={`rounded-t-md ${inGroup ? 'bg-gradient-to-t from-primary/60 to-primary' : 'border border-dashed border-white/30 bg-white/5'}`}
              style={{ height: `${(bid / SCALE) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex justify-around px-4 text-xs text-white/60">
        {BIDS.map(([name, , inGroup]) => (
          <span key={name} className="w-16 text-center">{name}<br /><span className={inGroup ? 'text-primary' : ''}>{inGroup ? 'in group' : 'waits'}</span></span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Buyers around a listing, their shares flowing in. One bid is too low and waits outside. */
const CENTER = [240, 210];
const NODES = [
  { x: 240, y: 52, bot: true, label: '500 sats' },
  { x: 392, y: 160, bot: false, label: 'max 300', waiting: true },
  { x: 334, y: 340, bot: true, label: '500 sats' },
  { x: 146, y: 340, bot: false, label: '500 sats' },
  { x: 88, y: 160, bot: true, label: '500 sats' },
];

function HeroArt() {
  const [cx, cy] = CENTER;
  return (
    <div className="relative mx-auto w-full max-w-lg" aria-hidden>
      <svg viewBox="0 0 480 420" className="w-full">
        <defs>
          <radialGradient id="core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7EA3CC" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#7EA3CC" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hex" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9dbbe0" />
            <stop offset="100%" stopColor="#4f7aa8" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* stars */}
        {[[30, 40], [450, 60], [420, 380], [60, 390], [180, 20], [470, 250], [12, 260], [300, 400]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 ? 1.2 : 1.8} fill="#F3F9D2" className="landing-twinkle" style={{ animationDelay: `${i * 0.4}s` }} />
        ))}

        <circle cx={cx} cy={cy} r="120" fill="url(#core)" />
        <g className="landing-spin" style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <circle cx={cx} cy={cy} r="158" fill="none" stroke="#7EA3CC" strokeOpacity="0.25" strokeDasharray="2 10" />
          <circle cx={cx} cy={cy} r="96" fill="none" stroke="#F3F9D2" strokeOpacity="0.15" strokeDasharray="30 14" />
        </g>

        {NODES.map((n, i) => {
          const path = `M${n.x} ${n.y} L${cx} ${cy}`;
          return (
            <g key={i}>
              <path d={path} stroke={n.waiting ? '#ffffff' : '#7EA3CC'} strokeOpacity={n.waiting ? 0.2 : 0.7} strokeWidth="2" strokeDasharray="4 8" className={n.waiting ? '' : 'landing-flow'} />
              {!n.waiting && (
                <circle r="5" fill="#F3F9D2" filter="url(#glow)">
                  <animateMotion dur="2.6s" begin={`${i * 0.5}s`} repeatCount="indefinite" path={path} keyPoints="0;1" keyTimes="0;1" />
                  <animate attributeName="opacity" values="0;1;1;0" dur="2.6s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}

        {/* the listing */}
        <g filter="url(#glow)">
          <polygon points="240,160 283,185 283,235 240,260 197,235 197,185" fill="url(#hex)" stroke="#F3F9D2" strokeOpacity="0.6" strokeWidth="1.5" />
        </g>
        <g fill="none" stroke="#0E0A06" strokeWidth="2.5">
          <ellipse cx={cx} cy="194" rx="20" ry="7" />
          <path d="M220 194v28c0 4 9 7 20 7s20-3 20-7v-28 M220 208c0 4 9 7 20 7s20-3 20-7" />
        </g>
        <rect x="166" y="269" width="148" height="32" rx="16" fill="#0E0A06" fillOpacity="0.7" stroke="#7EA3CC" strokeOpacity="0.5" />
        <text x={cx} y="289" textAnchor="middle" fontSize="12" fontWeight="600" fill="#F3F9D2">Dataset · 2,000 sats</text>

        {NODES.map((n, i) => (
          <g key={i} className="landing-float" style={{ animationDelay: `${i * 0.7}s` }} opacity={n.waiting ? 0.55 : 1}>
            <circle cx={n.x} cy={n.y} r="26" fill="#001d33" stroke={n.waiting ? '#ffffff' : '#7EA3CC'} strokeOpacity={n.waiting ? 0.35 : 1} strokeWidth="2" strokeDasharray={n.waiting ? '4 4' : undefined} />
            {n.bot ? (
              <g fill="none" stroke="#F3F9D2" strokeWidth="2" strokeLinecap="round">
                <rect x={n.x - 11} y={n.y - 8} width="22" height="17" rx="5" />
                <path d={`M${n.x} ${n.y - 8}v-5`} />
                <circle cx={n.x} cy={n.y - 14} r="1.5" fill="#F3F9D2" />
                <circle cx={n.x - 5} cy={n.y} r="1.5" fill="#F3F9D2" />
                <circle cx={n.x + 5} cy={n.y} r="1.5" fill="#F3F9D2" />
              </g>
            ) : (
              <g fill="none" stroke="#F3F9D2" strokeWidth="2" strokeLinecap="round">
                <circle cx={n.x} cy={n.y - 5} r="6" />
                <path d={`M${n.x - 11} ${n.y + 12}c1-6 5-9 11-9s10 3 11 9`} />
              </g>
            )}
            <text x={n.x} y={n.y + 44} textAnchor="middle" fontSize="11" fontWeight="600" fill={n.waiting ? '#ffffff' : '#7EA3CC'}>{n.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
