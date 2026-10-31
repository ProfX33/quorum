import { useEffect, useRef } from 'react';
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

const TICKER = ['Pool your demand', 'Pay only your share', 'Settled on BSV', 'Zero custody', 'Built for AI agents'];

/** Heights (as a fraction of the stage) of the glowing bars under the hero, a skyline of bids. */
const BARS = [0.42, 0.58, 0.74, 0.95, 0.7, 0.5, 0.32, 0.22, 0.4, 0.62, 0.86, 1, 0.78, 0.55, 0.38];

export default function Landing({ user, onSignIn, onLogout, nav }) {
  const main = useReveal();
  const primaryCta = user ? (
    <a href="#/market" className="btn btn-primary btn-lg">Open the marketplace</a>
  ) : (
    <button onClick={onSignIn} className="btn btn-primary btn-lg">Sign in with BSV wallet</button>
  );

  return (
    <>
      <Ticker />
      <Navbar user={user} onSignIn={onSignIn} onLogout={onLogout} nav={nav} />

      <main ref={main} className="overflow-x-clip">
        {/* Hero */}
        <section className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,90,54,0.28),transparent_60%)]" />
          <div className="relative mx-auto max-w-4xl px-6 pt-20 text-center md:pt-28">
            <p className="eyebrow reveal inline-flex items-center gap-2 border border-primary/40 bg-primary/10 px-3 py-1.5">
              <span className="h-1.5 w-1.5 animate-pulse bg-primary" /> Built on BSV · Non-custodial
            </p>
            <h1 className="reveal mt-8 text-5xl font-semibold leading-[1.02] tracking-[-0.035em] sm:text-7xl" style={{ '--reveal-delay': '0.1s' }}>
              Buy together.<br />
              <span className="bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent">Pay your share.</span>
            </h1>
            <p className="reveal mx-auto mt-7 max-w-xl text-lg leading-relaxed text-base-content/70" style={{ '--reveal-delay': '0.2s' }}>
              Quorum is a group-buy marketplace for data and services. AI agents and people pool their bids on a
              listing, and once enough of them agree, each pays an equal share from their own wallet and every
              member gets the delivery.
            </p>
            <div className="reveal mt-10 flex flex-wrap justify-center gap-4" style={{ '--reveal-delay': '0.3s' }}>
              {primaryCta}
              <a href="#/market" className="btn btn-ghost btn-lg border-base-content/40 hover:border-base-content hover:bg-base-content/5">Explore listings</a>
            </div>
            <p className="reveal mt-6 font-mono text-xs text-base-content/45" style={{ '--reveal-delay': '0.4s' }}>
              {user ? `Signed in as ${displayName(user)}.` : 'No accounts, no passwords. Your wallet is your identity.'}
            </p>
          </div>
          <GlowBars />
        </section>

        {/* Facts */}
        <section className="border-b border-base-content/10 bg-base-200">
          <dl className="mx-auto grid max-w-6xl gap-y-8 px-6 py-10 sm:grid-cols-[auto_1fr_1fr_1fr] sm:items-center sm:gap-x-10">
            <p className="eyebrow">By design</p>
            {[['0', 'coins held by Quorum'], ['1', 'transaction pays the seller'], ['SHA-256', 'proof of every delivery']].map(([value, label], i) => (
              <div key={label} className="reveal flex items-baseline gap-3 sm:justify-center" style={{ '--reveal-delay': `${i * 0.1}s` }}>
                <dt className="sr-only">{label}</dt>
                <dd className="whitespace-nowrap text-3xl font-semibold tracking-tight">{value}</dd>
                <dd className="font-mono text-xs uppercase tracking-wider text-base-content/50">{label}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* The problem, on the light band */}
        <section className="bg-gradient-to-b from-[#d6cdc9] via-[#b9b0ac] to-[#4a413e] text-[#1b0d0a]">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
            <TechFrame className="reveal">
              <HeroArt />
            </TechFrame>
            <div className="reveal" style={{ '--reveal-delay': '0.15s' }}>
              <p className="eyebrow flex items-center gap-2 text-[#d8401f]!">
                <span className="inline-block h-2 w-2 rotate-45 border border-current" /> The problem
              </p>
              <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
                Good data is too expensive for one buyer
              </h2>
              <p className="mt-6 max-w-lg leading-relaxed text-[#1b0d0a]/75">
                A dataset worth 2,000 sats to a market is worth 500 to each agent that needs it. Alone, none of them
                buys, and the seller never sells. Quorum collects those small budgets, locks a group as soon as an
                equal split fits every bid, and settles the sale in a single transaction.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#/#how-it-works" className="btn border-[#1b0d0a]/30 bg-transparent text-[#1b0d0a]/80 hover:border-[#1b0d0a] hover:bg-[#1b0d0a]/5">See how it works ↓</a>
                <a href="#/market" className="btn border-[#1b0d0a]/30 bg-transparent text-[#1b0d0a]/80 hover:border-[#1b0d0a] hover:bg-[#1b0d0a]/5">Browse listings ↗</a>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24 md:py-32">
          <SectionHeading eyebrow="How it works" title="Demand that adds up">
            Data is often too expensive for one buyer and worth it for many. Quorum turns those many small budgets
            into one sale.
          </SectionHeading>
          <ol className="relative mt-16 grid border-t border-base-content/15 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="reveal group relative border-base-content/15 py-8 pr-6 sm:[&:not(:last-child)]:border-r lg:pl-6 lg:first:pl-0" style={{ '--reveal-delay': `${i * 0.1}s` }}>
                <span aria-hidden className="absolute -top-px left-0 h-px w-0 bg-primary transition-all duration-500 group-hover:w-full" />
                <span className="font-mono text-sm text-primary">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-6 text-xl font-semibold tracking-tight">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-base-content/65">{text}</p>
              </li>
            ))}
          </ol>

          {/* The matching rule, worked through */}
          <div className="reveal relative mt-16 overflow-hidden border border-base-content/10 bg-base-200">
            <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-primary/15 blur-3xl" />
            <div className="relative grid gap-10 p-8 md:grid-cols-2 md:items-center md:p-12">
              <div>
                <p className="eyebrow">Worked example</p>
                <h3 className="mt-3 text-3xl font-semibold tracking-tight">One dataset, 2,000 sats, three bidders</h3>
                <p className="mt-4 leading-relaxed text-base-content/70">
                  Quorum looks for the largest group whose equal share fits every member's bid. Three buyers would pay
                  667 each, more than Agent C offered. Two buyers pay 1,000 each, which both A and B accept. The group
                  locks, and Agent C's bid stays open for the next round.
                </p>
                <p className="mt-6 border-l-2 border-primary bg-base-300 px-4 py-3 font-mono text-sm text-secondary">
                  share = ⌈2,000 / 2⌉ = 1,000 sats
                </p>
              </div>
              <MatchChart />
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-y border-base-content/10 bg-base-200 py-24 md:py-32">
          <div className="mx-auto max-w-6xl px-6">
            <SectionHeading eyebrow="Why Quorum" title="Trust the math, not the middleman" />
            <div className="mt-16 grid gap-px border border-base-content/10 bg-base-content/10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(([title, text, icon], i) => (
                <div key={title} onMouseMove={trackPointer} className="reveal spotlight group bg-base-200 p-8 transition-colors hover:bg-base-100" style={{ '--reveal-delay': `${(i % 3) * 0.08}s` }}>
                  <span className="flex h-11 w-11 items-center justify-center border border-primary/40 bg-primary/10 text-primary transition-shadow group-hover:shadow-[0_0_24px_rgba(255,90,54,0.45)]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden>
                      <path d={icon} />
                    </svg>
                  </span>
                  <h3 className="mt-6 text-lg font-semibold tracking-tight">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-base-content/65">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* For agents */}
        <section id="agents" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-12 px-6 py-24 md:py-32 lg:grid-cols-2">
          <div className="reveal">
            <SectionHeading eyebrow="For agents" title="Your agent shops on its own" align="left">
              An agent keeps its own key on its own machine. It searches the market, bids within its budget, pays
              its share and decrypts the delivery, and it checks every payment before signing it. Everything it does
              shows up live in the web app.
            </SectionHeading>
            <button onClick={() => nav.openTab('activity')} className="btn btn-primary mt-8">Watch live activity →</button>
          </div>
          <div className="reveal relative" style={{ '--reveal-delay': '0.15s' }}>
            <div aria-hidden className="absolute -inset-6 bg-primary/20 blur-3xl" />
            <div className="relative border border-base-content/15 bg-base-300 shadow-2xl">
              <div className="flex items-center gap-2 border-b border-base-content/10 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                <span className="h-2.5 w-2.5 rounded-full bg-secondary/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-base-content/20" />
                <span className="ml-3 font-mono text-xs text-base-content/40">agent — zsh</span>
              </div>
              <div className="space-y-1.5 p-5 font-mono text-sm">
                {[
                  ['$', 'bun agent/cli.ts search --q "air quality"'],
                  ['$', 'bun agent/cli.ts bid <offerId> 1200'],
                  ['$', 'bun agent/cli.ts work'],
                  ['›', '{ "group": "locked", "share": 1000 }'],
                  ['›', '{ "delivered": true, "hashOk": true }'],
                ].map(([prefix, line], i) => (
                  <p key={i} className={`flex gap-3 ${prefix === '›' ? 'text-secondary' : 'text-base-content/85'}`}>
                    <span className={prefix === '$' ? 'text-primary' : 'text-base-content/30'}>{prefix}</span>
                    <code className="break-all">{line}</code>
                  </p>
                ))}
                <p className="flex gap-3"><span className="text-primary">$</span><span className="h-5 w-2 animate-pulse bg-primary" /></p>
              </div>
            </div>
          </div>
        </section>

        {/* Quotes */}
        <section className="border-t border-base-content/10 bg-base-200 py-24 md:py-32">
          <div className="mx-auto max-w-6xl px-6">
            <SectionHeading eyebrow="Customers" title="What buyers and sellers say" />
            <div className="mt-16 grid gap-6 md:grid-cols-3">
              {QUOTES.map(([quote, name, role], i) => (
                <figure key={name} onMouseMove={trackPointer} className="reveal spotlight flex flex-col border border-base-content/10 bg-base-100 p-8 transition-colors hover:border-primary/50" style={{ '--reveal-delay': `${i * 0.1}s` }}>
                  <span aria-hidden className="font-mono text-4xl leading-none text-primary">“</span>
                  <blockquote className="mt-4 flex-1 leading-relaxed text-base-content/85">{quote}</blockquote>
                  <figcaption className="mt-8 flex items-center gap-3 border-t border-base-content/10 pt-6">
                    <span className="flex h-10 w-10 items-center justify-center font-semibold text-primary-content" style={{ background: ['#ff5a36', '#ffb199', '#ff8a5c'][i] }}>
                      {name[0]}
                    </span>
                    <span>
                      <span className="block font-medium">{name}</span>
                      <span className="block font-mono text-xs text-base-content/50">{role}</span>
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
            <div className="reveal relative overflow-hidden border border-primary/40 bg-base-300 px-8 pb-40 pt-16 text-center">
              <GlowBars compact />
              <p className="eyebrow relative">Get started</p>
              <h2 className="relative mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
                Your wallet is your account
              </h2>
              <p className="relative mx-auto mt-4 max-w-xl text-base-content/70">
                Sign in with a BSV wallet. Your account is created the first time you sign a challenge, with no email or password.
              </p>
              <div className="relative mt-8 flex justify-center">{primaryCta}</div>
            </div>
          </section>
        )}

        {/* Contact */}
        <section id="contact" className={`mx-auto max-w-6xl scroll-mt-20 px-6 pb-24 ${user ? 'pt-24' : ''}`}>
          <div className="reveal grid gap-8 border border-base-content/10 bg-base-200 p-8 md:grid-cols-[1fr_auto] md:items-center md:p-10">
            <div>
              <p className="eyebrow">Contact</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">Questions? Talk to us.</h2>
              <p className="mt-2 text-base-content/65">
                Listing your data, connecting an agent or need help with a deal? Our team is happy to help.
              </p>
            </div>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="btn btn-lg border-base-content/40 bg-transparent hover:border-base-content hover:bg-base-content/5">
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

/** Fades `.reveal` elements in as they scroll into view. Returns the ref for their container. */
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -10% 0px' });
    ref.current.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });
  return ref;
}

/** Moves a `.spotlight` card's glow to the pointer. */
function trackPointer(e) {
  const box = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - box.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - box.top}px`);
}

function Ticker() {
  const items = [...TICKER, ...TICKER, ...TICKER];
  return (
    <div className="overflow-hidden bg-primary text-primary-content" aria-hidden>
      <div className="ticker flex w-max">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0">
            {items.map((item, i) => (
              <span key={i} className="flex items-center gap-3 px-6 py-2 font-mono text-xs font-medium uppercase tracking-wider">
                <span className="text-[10px]">◆</span> {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Pulsing bars of light, like the bids on a listing rising toward the price. */
function GlowBars({ compact = false }) {
  return (
    <div aria-hidden className={`pointer-events-none flex items-end ${compact ? 'absolute inset-x-0 bottom-0 h-36 opacity-70' : 'relative mt-16 h-56 sm:h-80'}`}>
      {BARS.map((h, i) => (
        <div
          key={i}
          className="glow-bar flex-1"
          style={{ height: `${h * 100}%`, '--lo': 0.55 + (i % 3) * 0.12, '--dur': `${3 + (i % 4) * 0.7}s`, '--delay': `${-i * 0.45}s` }}
        />
      ))}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-base-200 to-transparent" />
    </div>
  );
}

/** A blueprint-style frame with corner labels around an illustration. */
function TechFrame({ children, className = '' }) {
  return (
    <div className={`relative border border-[#1b0d0a]/40 bg-[#ece6e3]/50 p-8 backdrop-blur-sm ${className}`}>
      <span className="absolute left-3 top-2 font-mono text-[10px] uppercase tracking-wider text-[#1b0d0a]/70">Quorum<br /><span className="text-[#1b0d0a]/40">5 bids / 2,000 sats</span></span>
      <span className="absolute right-3 top-2 font-mono text-[10px] uppercase tracking-wider text-[#1b0d0a]/70">Locked</span>
      <span className="absolute bottom-2 left-3 font-mono text-[10px] uppercase tracking-wider text-[#1b0d0a]/70">Share ⊙ 500</span>
      <span className="absolute -left-6 top-1/2 hidden -translate-y-1/2 font-mono text-[10px] uppercase tracking-[0.4em] text-[#d8401f] [writing-mode:vertical-rl] sm:block">Target</span>
      <span className="absolute -right-6 top-1/2 hidden -translate-y-1/2 font-mono text-[10px] uppercase tracking-[0.4em] text-[#d8401f] [writing-mode:vertical-rl] sm:block">Group</span>
      <div className="relative mt-6 border border-[#1b0d0a]/25">
        <svg aria-hidden className="absolute inset-0 h-full w-full text-[#1b0d0a]/20" preserveAspectRatio="none" viewBox="0 0 100 100">
          <path d="M0 0L100 100M100 0L0 100" stroke="currentColor" strokeWidth="0.15" vectorEffect="non-scaling-stroke" />
        </svg>
        {children}
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, children, align = 'center' }) {
  return (
    <div className={`reveal ${align === 'center' ? 'mx-auto max-w-2xl text-center' : ''}`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">{title}</h2>
      {children && <p className="mt-5 leading-relaxed text-base-content/65">{children}</p>}
    </div>
  );
}

function MatchChart() {
  const shareAt = (1000 / SCALE) * 100;
  return (
    <figure aria-label="Bids of 1,200, 1,100 and 600 sats against a share of 1,000 sats">
      <div className="relative flex h-60 items-end justify-around gap-6 border-b border-base-content/20 px-4">
        <div className="absolute inset-x-0 border-t border-dashed border-secondary" style={{ bottom: `${shareAt}%` }}>
          <span className="absolute -top-6 right-0 font-mono text-xs text-secondary">share 1,000</span>
        </div>
        {BIDS.map(([name, bid, inGroup]) => (
          <div key={name} className="flex h-full w-16 flex-col justify-end">
            <span className={`mb-1 text-center text-xs tabular-nums ${inGroup ? 'text-base-content' : 'text-base-content/45'} font-mono`}>{bid.toLocaleString('en')}</span>
            <div
              className={inGroup ? 'bg-gradient-to-t from-primary/30 via-primary to-secondary shadow-[0_0_32px_rgba(255,90,54,0.5)]' : 'border border-dashed border-base-content/30 bg-base-content/5'}
              style={{ height: `${(bid / SCALE) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex justify-around px-4 font-mono text-xs text-base-content/55">
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
    <div className="relative mx-auto w-full max-w-md" aria-hidden>
      <svg viewBox="0 0 480 420" className="w-full">
        <defs>
          <radialGradient id="core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff5a36" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ff5a36" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hex" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ff8a5c" />
            <stop offset="100%" stopColor="#d8401f" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* stars */}
        {[[30, 40], [450, 60], [420, 380], [60, 390], [180, 20], [470, 250], [12, 260], [300, 400]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 ? 1.2 : 1.8} fill="#1b0d0a" className="landing-twinkle" style={{ animationDelay: `${i * 0.4}s` }} />
        ))}

        <circle cx={cx} cy={cy} r="120" fill="url(#core)" />
        <g className="landing-spin" style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <circle cx={cx} cy={cy} r="158" fill="none" stroke="#1b0d0a" strokeOpacity="0.35" strokeDasharray="2 10" />
          <circle cx={cx} cy={cy} r="96" fill="none" stroke="#d8401f" strokeOpacity="0.4" strokeDasharray="30 14" />
        </g>

        {NODES.map((n, i) => {
          const path = `M${n.x} ${n.y} L${cx} ${cy}`;
          return (
            <g key={i}>
              <path d={path} stroke={n.waiting ? '#1b0d0a' : '#d8401f'} strokeOpacity={n.waiting ? 0.25 : 0.8} strokeWidth="2" strokeDasharray="4 8" className={n.waiting ? '' : 'landing-flow'} />
              {!n.waiting && (
                <circle r="5" fill="#ff5a36" filter="url(#glow)">
                  <animateMotion dur="2.6s" begin={`${i * 0.5}s`} repeatCount="indefinite" path={path} keyPoints="0;1" keyTimes="0;1" />
                  <animate attributeName="opacity" values="0;1;1;0" dur="2.6s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}

        {/* the listing */}
        <g filter="url(#glow)">
          <polygon points="240,160 283,185 283,235 240,260 197,235 197,185" fill="url(#hex)" stroke="#1b0d0a" strokeOpacity="0.6" strokeWidth="1.5" />
        </g>
        <g fill="none" stroke="#1b0d0a" strokeWidth="2.5">
          <ellipse cx={cx} cy="194" rx="20" ry="7" />
          <path d="M220 194v28c0 4 9 7 20 7s20-3 20-7v-28 M220 208c0 4 9 7 20 7s20-3 20-7" />
        </g>
        <rect x="166" y="269" width="148" height="32" rx="2" fill="#1b0d0a" stroke="#1b0d0a" />
        <text x={cx} y="289" textAnchor="middle" fontSize="12" fontWeight="500" fontFamily="JetBrains Mono, monospace" fill="#ffb199">Dataset · 2,000 sats</text>

        {NODES.map((n, i) => (
          <g key={i} className="landing-float" style={{ animationDelay: `${i * 0.7}s` }} opacity={n.waiting ? 0.55 : 1}>
            <circle cx={n.x} cy={n.y} r="26" fill="#efe9e6" stroke={n.waiting ? '#1b0d0a' : '#d8401f'} strokeOpacity={n.waiting ? 0.45 : 1} strokeWidth="2" strokeDasharray={n.waiting ? '4 4' : undefined} />
            {n.bot ? (
              <g fill="none" stroke="#1b0d0a" strokeWidth="2" strokeLinecap="round">
                <rect x={n.x - 11} y={n.y - 8} width="22" height="17" rx="5" />
                <path d={`M${n.x} ${n.y - 8}v-5`} />
                <circle cx={n.x} cy={n.y - 14} r="1.5" fill="#1b0d0a" />
                <circle cx={n.x - 5} cy={n.y} r="1.5" fill="#1b0d0a" />
                <circle cx={n.x + 5} cy={n.y} r="1.5" fill="#1b0d0a" />
              </g>
            ) : (
              <g fill="none" stroke="#1b0d0a" strokeWidth="2" strokeLinecap="round">
                <circle cx={n.x} cy={n.y - 5} r="6" />
                <path d={`M${n.x - 11} ${n.y + 12}c1-6 5-9 11-9s10 3 11 9`} />
              </g>
            )}
            <text x={n.x} y={n.y + 44} textAnchor="middle" fontSize="11" fontWeight="500" fontFamily="JetBrains Mono, monospace" fill={n.waiting ? '#1b0d0a' : '#c2351a'}>{n.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
