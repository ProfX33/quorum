import { useEffect, useState } from 'react';
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

const TERMINAL = [
  ['$', 'bun agent/cli.ts search --q "air quality"'],
  ['$', 'bun agent/cli.ts bid <offerId> 1200'],
  ['$', 'bun agent/cli.ts work'],
  ['›', '{ "group": "locked", "share": 1000 }'],
  ['›', '{ "delivered": true, "hashOk": true }'],
];

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Adds .is-in to every .reveal element once it scrolls into view. */
function useReveal(deps) {
  useEffect(() => {
    const elements = document.querySelectorAll('.reveal:not(.is-in)');
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), observer.unobserve(e.target))),
      { threshold: 0.15 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, deps);
}

/** Types `text` out character by character. */
function useTypewriter(text, msPerChar = 55) {
  const [length, setLength] = useState(() => (reducedMotion() ? text.length : 0));
  useEffect(() => {
    if (length >= text.length) return;
    const t = setTimeout(() => setLength((n) => n + 1), length === 0 ? 400 : msPerChar);
    return () => clearTimeout(t);
  }, [length, text, msPerChar]);
  return text.slice(0, length);
}

export default function Landing({ user, onSignIn, onLogout, nav }) {
  useReveal([user]);
  const primaryCta = user ? (
    <a href="#/market" className="btn btn-primary btn-lg">Open the marketplace</a>
  ) : (
    <button onClick={onSignIn} className="btn btn-primary btn-lg">Sign in with BSV wallet</button>
  );

  return (
    <>
      <Navbar user={user} onSignIn={onSignIn} onLogout={onLogout} nav={nav} />

      <main className="space-y-3 overflow-x-clip px-2 pt-3 lg:px-3">
        {/* Hero: pitch and art side by side */}
        <section className="grid gap-3 xl:grid-cols-[1.15fr_1fr]">
          <div className="panel relative flex flex-col justify-between gap-10 overflow-hidden p-6 sm:p-10">
            <div className="flex flex-wrap gap-2">
              <span className="chip"><span className="dot text-[#003FFF]" />Built on BSV</span>
              <span className="chip"><span className="dot text-primary" style={{ animationDelay: '1s' }} />Non-custodial</span>
            </div>
            <div>
              <Headline text={'Buy together.\nPay your share.'} />
              <p className="mt-8 max-w-xl leading-relaxed text-base-content/65">
                Quorum is a group-buy marketplace for data and services. AI agents and people pool their bids on a
                listing, and once enough of them agree, each pays an equal share from their own wallet and every
                member gets the delivery.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                {primaryCta}
                <a href="#/market" className="btn btn-ghost btn-lg border-line bg-base-300 hover:border-base-content/30">Explore listings</a>
              </div>
              <p className="mt-6 text-xs uppercase tracking-[0.12em] text-base-content/40">
                {user ? `Signed in as ${displayName(user)}.` : 'No accounts, no passwords. Your wallet is your identity.'}
              </p>
            </div>
          </div>
          <div className="panel bg-grid relative min-h-80 overflow-hidden">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(242,92,5,0.12),transparent_60%)]" />
            <span className="chip absolute left-5 top-5 z-10"><span className="dot text-primary" />Live match</span>
            <span className="absolute right-5 top-5 z-10 font-mono text-xs text-base-content/35">4 / 5 bids fit</span>
            <div className="relative flex h-full items-center justify-center p-6 pt-16">
              <HeroArt />
            </div>
          </div>
        </section>

        {/* Toy tiles */}
        <section className="grid gap-3 md:grid-cols-3">
          <SplitTile />
          <KeyTile />
          <FactsTile />
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-24 pt-24">
          <SectionHeading eyebrow="How it works" title="Demand that adds up">
            Data is often too expensive for one buyer and worth it for many. Quorum turns those many small budgets
            into one sale.
          </SectionHeading>
          <ol className="mt-14 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="panel reveal group p-6 transition-colors hover:border-primary/40" style={{ '--delay': `${i * 90}ms` }}>
                <span className="font-pixel text-5xl text-base-content/15 transition-colors group-hover:text-primary group-hover:text-glow">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-6 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-base-content/60">{text}</p>
              </li>
            ))}
          </ol>

          {/* The matching rule, worked through */}
          <div className="panel reveal mt-3 grid gap-10 p-6 sm:p-10 md:grid-cols-2 md:items-center">
            <div>
              <span className="chip">Worked example</span>
              <h3 className="mt-5 font-pixel text-3xl text-primary">One dataset, 2,000 sats, three bidders</h3>
              <p className="mt-4 leading-relaxed text-base-content/65">
                Quorum looks for the largest group whose equal share fits every member's bid. Three buyers would pay
                667 each, more than Agent C offered. Two buyers pay 1,000 each, which both A and B accept. The group
                locks, and Agent C's bid stays open for the next round.
              </p>
              <p className="mt-6 rounded-field border border-line bg-base-100 px-4 py-3 font-mono text-sm text-secondary">
                <span className="text-base-content/35">› </span>share = ⌈2,000 / 2⌉ = 1,000 sats
              </p>
            </div>
            <MatchChart />
          </div>
        </section>

        {/* Features */}
        <section className="pt-24">
          <SectionHeading eyebrow="Why Quorum" title="Trust the math, not the middleman" />
          <div className="mt-14 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {FEATURES.map(([title, text, icon], i) => (
              <div key={title} className="panel reveal group p-6 transition-colors hover:border-primary/40" style={{ '--delay': `${(i % 3) * 90}ms` }}>
                <span className="flex h-11 w-11 items-center justify-center rounded-field border border-line bg-base-300 text-base-content/70 transition group-hover:border-primary/50 group-hover:text-primary">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
                    <path d={icon} />
                  </svg>
                </span>
                <h3 className="mt-5 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-base-content/60">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* For agents */}
        <section id="agents" className="grid scroll-mt-24 items-center gap-3 pt-24 xl:grid-cols-2">
          <div className="p-2 sm:p-6">
            <SectionHeading eyebrow="For agents" title="Your agent shops on its own" align="left">
              An agent keeps its own key on its own machine. It searches the market, bids within its budget, pays
              its share and decrypts the delivery, and it checks every payment before signing it. Everything it does
              shows up live in the web app.
            </SectionHeading>
            <button onClick={() => nav.openTab('activity')} className="btn btn-outline btn-primary mt-8">Watch live activity</button>
          </div>
          <div className="panel reveal overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-error/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-accent/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-secondary/80" />
              <span className="ml-3 text-xs text-base-content/35">agent@quorum ~</span>
            </div>
            <div className="space-y-2 p-5 font-mono text-sm sm:p-6">
              {TERMINAL.map(([prefix, line], i) => (
                <div key={i} className="reveal flex gap-3" style={{ '--delay': `${300 + i * 450}ms` }}>
                  <span className={prefix === '$' ? 'text-primary' : 'text-base-content/30'}>{prefix}</span>
                  <code className={prefix === '$' ? 'text-base-content/85' : 'text-secondary'}>{line}</code>
                </div>
              ))}
              <div className="reveal flex gap-3" style={{ '--delay': `${300 + TERMINAL.length * 450}ms` }}>
                <span className="text-primary">$</span><span className="cursor-block text-primary" />
              </div>
            </div>
          </div>
        </section>

        {/* Quotes */}
        <section className="pt-24">
          <SectionHeading eyebrow="Customers" title="What buyers and sellers say" />
          <div className="mt-14 grid gap-3 lg:grid-cols-3">
            {QUOTES.map(([quote, name, role], i) => (
              <figure key={name} className="panel reveal flex flex-col p-8" style={{ '--delay': `${i * 90}ms` }}>
                <span aria-hidden className="font-pixel text-5xl leading-none text-primary">“</span>
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-base-content/80">{quote}</blockquote>
                <figcaption className="mt-8 flex items-center gap-3 border-t border-line pt-5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-field border border-line bg-base-300 font-pixel text-lg text-primary">
                    {name[0]}
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{name}</span>
                    <span className="block text-xs text-base-content/45">{role}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* Sign in */}
        {!user && (
          <section className="pt-24">
            <div className="panel bg-grid reveal relative overflow-hidden px-6 py-20 text-center">
              <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-3xl" />
              <h2 className="relative font-pixel text-4xl text-primary text-glow sm:text-6xl">Your wallet is your account</h2>
              <p className="relative mx-auto mt-5 max-w-xl text-base-content/65">
                Sign in with a BSV wallet. Your account is created the first time you sign a challenge, with no email or password.
              </p>
              <div className="relative mt-10 flex justify-center">{primaryCta}</div>
            </div>
          </section>
        )}

        {/* Contact */}
        <section id="contact" className="scroll-mt-24 pt-24">
          <div className="panel reveal grid gap-8 p-6 sm:p-10 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <span className="chip"><span className="dot text-primary" />Support online</span>
              <h2 className="mt-5 font-pixel text-3xl sm:text-4xl">Questions? Talk to us.</h2>
              <p className="mt-3 text-base-content/60">
                Listing your data, connecting an agent or need help with a deal? Our team is happy to help.
              </p>
            </div>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="btn btn-primary btn-lg normal-case tracking-normal">
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

/** The hero headline, typed out; an invisible copy reserves its final size so nothing jumps. */
function Headline({ text }) {
  const typed = useTypewriter(text);
  return (
    <h1 className="grid font-pixel text-5xl leading-[1.05] text-primary text-glow sm:text-6xl 2xl:text-7xl">
      <span className="invisible whitespace-pre-line [grid-area:1/1]" aria-hidden>{text}</span>
      <span className="cursor-block whitespace-pre-line [grid-area:1/1]">
        <span className="sr-only">{text}</span>
        <span aria-hidden>{typed}</span>
      </span>
    </h1>
  );
}

function SectionHeading({ eyebrow, title, children, align = 'center' }) {
  return (
    <div className={`reveal ${align === 'center' ? 'mx-auto max-w-2xl text-center' : ''}`}>
      <span className="chip"><span className="dot text-primary" />{eyebrow}</span>
      <h2 className="mt-5 font-pixel text-4xl leading-tight sm:text-5xl">{title}</h2>
      {children && <p className="mt-5 leading-relaxed text-base-content/60">{children}</p>}
    </div>
  );
}

/** Hover (or tap) and the price splits into equal shares. */
function SplitTile() {
  const coins = [0, 1, 2, 3];
  return (
    <div tabIndex={0} className="panel group relative flex min-h-64 flex-col overflow-hidden p-5 outline-none">
      <span className="chip self-start">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden><path d="M5 3l14 8-6 2-3 6L5 3z" /></svg>
        Hover
      </span>
      <div className="relative flex flex-1 items-center justify-center">
        {coins.map((i) => (
          <span
            key={i}
            className="absolute flex h-16 w-16 items-center justify-center rounded-full border border-primary/40 bg-base-300 font-pixel text-lg text-primary transition-all duration-500 ease-out group-hover:shadow-[0_0_24px_-6px] group-hover:shadow-primary group-focus:shadow-[0_0_24px_-6px] group-focus:shadow-primary [transform:translateX(0)] group-hover:[transform:translateX(var(--x))] group-focus:[transform:translateX(var(--x))]"
            style={{ '--x': `${(i - 1.5) * 4.5}rem`, transitionDelay: `${i * 40}ms`, zIndex: 4 - i }}
          >
            500
          </span>
        ))}
        <span className="pointer-events-none absolute z-10 flex h-24 w-24 items-center justify-center rounded-full bg-primary font-pixel text-2xl text-primary-content shadow-[0_0_40px_-8px] shadow-primary transition duration-300 group-hover:scale-50 group-hover:opacity-0 group-focus:scale-50 group-focus:opacity-0">
          2,000
        </span>
      </div>
      <p className="text-center text-xs uppercase tracking-[0.12em] text-base-content/40">
        <span className="group-hover:hidden group-focus:hidden">One price, too high alone</span>
        <span className="hidden text-primary group-hover:inline group-focus:inline">4 buyers × 500 sats each</span>
      </p>
    </div>
  );
}

/** Press M anywhere on the landing page to jump to the marketplace. */
function KeyTile() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    const go = () => {
      setDown(true);
      setTimeout(() => (window.location.hash = '#/market'), 220);
    };
    const onKey = (e) => {
      if (e.key.toLowerCase() !== 'm' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="panel flex min-h-64 flex-col p-5">
      <span className="chip self-start">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" /></svg>
        Keyboard input
      </span>
      <div className="flex flex-1 items-center justify-center gap-4 font-pixel text-3xl text-base-content/25">
        Hit the
        <a href="#/market" onClick={() => setDown(true)} data-down={down} className="keycap text-2xl" aria-label="Open the marketplace">M</a>
        key
      </div>
      <p className="text-center text-xs uppercase tracking-[0.12em] text-base-content/40">Jumps straight to the market</p>
    </div>
  );
}

function FactsTile() {
  const facts = [['0', 'coins held by Quorum'], ['1', 'transaction pays the seller'], ['SHA-256', 'proof of every delivery']];
  return (
    <div className="panel flex min-h-64 flex-col p-5">
      <span className="chip self-start"><span className="dot text-primary" />By the numbers</span>
      <dl className="mt-4 flex flex-1 flex-col justify-center divide-y divide-line">
        {facts.map(([value, label]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-xs uppercase tracking-[0.1em] text-base-content/45">{label}</dt>
            <dd className="font-pixel text-2xl text-primary">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MatchChart() {
  const shareAt = (1000 / SCALE) * 100;
  return (
    <figure className="reveal" aria-label="Bids of 1,200, 1,100 and 600 sats against a share of 1,000 sats">
      <div className="bg-grid relative flex h-64 items-end justify-around gap-6 rounded-field border border-line bg-base-100 px-4">
        <div className="absolute inset-x-0 z-10 border-t-2 border-dashed border-secondary/80" style={{ bottom: `${shareAt}%` }}>
          <span className="absolute -top-6 right-2 text-xs font-medium text-secondary">share 1,000</span>
        </div>
        {BIDS.map(([name, bid, inGroup], i) => (
          <div key={name} className="flex h-full w-16 flex-col justify-end">
            <span className={`mb-1 text-center font-pixel text-base tabular-nums ${inGroup ? 'text-primary' : 'text-base-content/40'}`}>{bid.toLocaleString('en')}</span>
            <div
              className={`grow-up rounded-t-md ${inGroup ? 'bg-gradient-to-t from-primary/30 to-primary shadow-[0_0_30px_-8px] shadow-primary' : 'border border-dashed border-base-content/25 bg-base-content/5'}`}
              style={{ height: `${(bid / SCALE) * 100}%`, animationDelay: `${i * 150}ms` }}
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex justify-around px-4 text-xs uppercase tracking-[0.08em] text-base-content/50">
        {BIDS.map(([name, , inGroup]) => (
          <span key={name} className="w-16 text-center">{name}<br /><span className={inGroup ? 'text-secondary' : ''}>{inGroup ? 'in group' : 'waits'}</span></span>
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
            <stop offset="0%" stopColor="#F25C05" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#F25C05" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hex" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FF9B5E" />
            <stop offset="100%" stopColor="#E04A00" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* stars */}
        {[[30, 40], [450, 60], [420, 380], [60, 390], [180, 20], [470, 250], [12, 260], [300, 400]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 ? 1.2 : 1.8} fill="#F25C05" className="landing-twinkle" style={{ animationDelay: `${i * 0.4}s` }} />
        ))}

        <circle cx={cx} cy={cy} r="120" fill="url(#core)" />
        <g className="landing-spin" style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <circle cx={cx} cy={cy} r="158" fill="none" stroke="#F25C05" strokeOpacity="0.25" strokeDasharray="2 10" />
          <circle cx={cx} cy={cy} r="96" fill="none" stroke="#F25C05" strokeOpacity="0.15" strokeDasharray="30 14" />
        </g>

        {NODES.map((n, i) => {
          const path = `M${n.x} ${n.y} L${cx} ${cy}`;
          return (
            <g key={i}>
              <path d={path} style={{ stroke: n.waiting ? 'var(--color-base-content)' : '#F25C05' }} strokeOpacity={n.waiting ? 0.2 : 0.7} strokeWidth="2" strokeDasharray="4 8" className={n.waiting ? '' : 'landing-flow'} />
              {!n.waiting && (
                <circle r="5" fill="#F25C05" filter="url(#glow)">
                  <animateMotion dur="2.6s" begin={`${i * 0.5}s`} repeatCount="indefinite" path={path} keyPoints="0;1" keyTimes="0;1" />
                  <animate attributeName="opacity" values="0;1;1;0" dur="2.6s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}

        {/* the listing */}
        <g filter="url(#glow)">
          <polygon points="240,160 283,185 283,235 240,260 197,235 197,185" fill="url(#hex)" stroke="#F25C05" strokeOpacity="0.6" strokeWidth="1.5" />
        </g>
        <g fill="none" stroke="#FFFFFF" strokeWidth="2.5">
          <ellipse cx={cx} cy="194" rx="20" ry="7" />
          <path d="M220 194v28c0 4 9 7 20 7s20-3 20-7v-28 M220 208c0 4 9 7 20 7s20-3 20-7" />
        </g>
        <rect x="146" y="266" width="188" height="38" rx="19" fill="#1A1A1A" fillOpacity="0.92" stroke="#F25C05" strokeOpacity="0.5" />
        <text x={cx} y="290" textAnchor="middle" fontSize="12" fontWeight="600" fill="#FFFFFF">Dataset · 2,000 sats</text>

        {NODES.map((n, i) => (
          <g key={i} className="landing-float" style={{ animationDelay: `${i * 0.7}s` }} opacity={n.waiting ? 0.55 : 1}>
            <circle cx={n.x} cy={n.y} r="26" style={{ fill: 'var(--color-base-200)', stroke: n.waiting ? 'var(--color-base-content)' : '#F25C05' }} strokeOpacity={n.waiting ? 0.35 : 1} strokeWidth="2" strokeDasharray={n.waiting ? '4 4' : undefined} />
            {n.bot ? (
              <g fill="none" stroke="#F25C05" strokeWidth="2" strokeLinecap="round">
                <rect x={n.x - 11} y={n.y - 8} width="22" height="17" rx="5" />
                <path d={`M${n.x} ${n.y - 8}v-5`} />
                <circle cx={n.x} cy={n.y - 14} r="1.5" fill="#F25C05" />
                <circle cx={n.x - 5} cy={n.y} r="1.5" fill="#F25C05" />
                <circle cx={n.x + 5} cy={n.y} r="1.5" fill="#F25C05" />
              </g>
            ) : (
              <g fill="none" stroke="#F25C05" strokeWidth="2" strokeLinecap="round">
                <circle cx={n.x} cy={n.y - 5} r="6" />
                <path d={`M${n.x - 11} ${n.y + 12}c1-6 5-9 11-9s10 3 11 9`} />
              </g>
            )}
            <text x={n.x} y={n.y + 44} textAnchor="middle" fontSize="11" fontWeight="600" style={{ fill: n.waiting ? 'var(--color-base-content)' : '#F25C05' }}>{n.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
