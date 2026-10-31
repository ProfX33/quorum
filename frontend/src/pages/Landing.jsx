import Navbar from '../components/Navbar';
import Halftone from '../components/Halftone';
import Reveal from '../components/Reveal';
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

const FACTS = [
  ['Coins held by Quorum', '0'],
  ['Transaction pays the seller', '1'],
  ['Ways to trade', '2'],
  ['Proof of every delivery', 'SHA-256'],
];

const STACK = ['BSV', 'SHA-256', 'OP_RETURN', 'REST API', 'TypeScript', 'JSON CLI'];

const TICKER = ['Buy together', 'Pay your share', 'Non-custodial', 'Built for agents', 'Verifiable delivery', 'Settled on BSV'];

const QUOTES = [
  ['Our research agent used to skip datasets it could not justify on its own. Now it bids what the data is worth to us, and Quorum finds the other buyers.', 'BlockchainFan007', 'ML engineer, mobility startup'],
  ['We sold the same air-quality dataset to eleven agents in one afternoon. Buyers who would never pay the full price became customers.', 'Very frequent user', 'Environmental data provider'],
  ['No custody and no API keys to leak. The agent holds its own key and checks every payment before it signs. That is the only way I let software spend money.', 'Harry Potter', 'Defending the muggels'],
];
const QUOTE_COLORS = ['bg-primary', 'bg-secondary', 'bg-neutral'];

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
        <Hero user={user} onSignIn={onSignIn} />

        {/* Statement, facts and stack */}
        <section className="mx-auto max-w-6xl px-4 pt-28 pb-24 sm:px-6">
          <Reveal className="text-center">
            <h2 className="font-display mx-auto max-w-3xl text-4xl leading-[0.95] sm:text-6xl">
              Many small budgets. One fair sale.
            </h2>
            <a href="#/#how-it-works" className="btn btn-outline btn-sm mt-8 border-base-content/40 px-5">See how it works</a>
          </Reveal>

          <dl className="mt-16 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {FACTS.map(([label, value], i) => (
              <Reveal
                key={label}
                delay={i * 90}
                className="group relative flex min-h-44 flex-col justify-between overflow-hidden rounded-box bg-primary p-5 text-primary-content transition-colors duration-300 hover:bg-secondary sm:min-h-52 sm:p-6"
              >
                <span aria-hidden className="halftone-dots absolute inset-0 text-white/0 transition-colors duration-500 group-hover:text-white/15" />
                <TabNotches />
                <dt className="relative text-sm text-primary-content/85">{label}</dt>
                <dd className="font-display relative transition-transform duration-300 group-hover:-translate-y-1 sm:text-5xl text-[clamp(1.6rem,7vw,3rem)]">{value}</dd>
              </Reveal>
            ))}
          </dl>

          <Reveal delay={200}>
            <ul className="mt-4 flex flex-wrap items-center justify-center gap-y-3 rounded-box bg-base-200 px-4 py-6 sm:justify-between sm:px-10">
              {STACK.map((item, i) => (
                <li key={item} className="flex items-center">
                  {i > 0 && <span aria-hidden className="mx-5 hidden h-6 w-px bg-base-content/20 sm:block" />}
                  <span className="font-display px-3 text-lg text-base-content/80 sm:px-0">{item}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        <Ticker />

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-28 sm:px-6">
          <SectionHeading eyebrow="How it works" title="Demand that adds up">
            Data is often too expensive for one buyer and worth it for many. Quorum turns those many small budgets
            into one sale.
          </SectionHeading>
          <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, text], i) => (
              <Reveal
                as="li"
                key={title}
                delay={i * 90}
                className="group flex flex-col rounded-box bg-base-200 p-6 transition-colors duration-300 hover:bg-secondary hover:text-secondary-content"
              >
                <span className="font-display text-6xl text-secondary transition-colors duration-300 group-hover:text-secondary-content">
                  0{i + 1}
                </span>
                <h3 className="mt-10 text-xl font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-base-content/70 transition-colors duration-300 group-hover:text-secondary-content/85">{text}</p>
              </Reveal>
            ))}
          </ol>

          {/* The matching rule, worked through */}
          <Reveal className="relative mt-4 overflow-hidden rounded-box bg-neutral text-neutral-content">
            <span aria-hidden className="halftone-dots absolute -top-10 -right-10 h-72 w-72 rounded-full text-primary/25 [mask-image:radial-gradient(circle,black,transparent_70%)]" />
            <div className="relative grid gap-10 p-8 sm:p-10 md:grid-cols-2 md:items-center">
              <div>
                <h3 className="font-display text-3xl leading-tight">One dataset, 2,000 sats, three bidders</h3>
                <p className="mt-4 leading-relaxed text-neutral-content/70">
                  Quorum looks for the largest group whose equal share fits every member's bid. Three buyers would pay
                  667 each, more than Agent C offered. Two buyers pay 1,000 each, which both A and B accept. The group
                  locks, and Agent C's bid stays open for the next round.
                </p>
                <p className="mt-6 inline-block rounded-full bg-secondary px-5 py-2.5 font-mono text-sm text-secondary-content">
                  share = ⌈2,000 / 2⌉ = 1,000 sats
                </p>
              </div>
              <MatchChart />
            </div>
          </Reveal>
        </section>

        {/* Features */}
        <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-28 sm:px-6 lg:grid-cols-[1fr_2fr]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading eyebrow="Why Quorum" title="Trust the math, not the middleman" align="left" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map(([title, text, icon], i) => (
              <Reveal
                key={title}
                delay={(i % 2) * 90}
                className="group rounded-box border border-base-content/10 bg-base-200 p-6 transition duration-300 hover:-translate-y-1 hover:border-primary hover:shadow-[0_18px_40px_-20px_rgba(229,80,14,0.6)]"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-content transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden>
                    <path d={icon} />
                  </svg>
                </span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-base-content/70">{text}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* For agents */}
        <section id="agents" className="mx-auto max-w-6xl scroll-mt-20 px-4 sm:px-6">
          <Reveal className="relative overflow-hidden rounded-box bg-secondary text-secondary-content">
            <span aria-hidden className="halftone-dots absolute inset-0 text-primary/40 [mask-image:linear-gradient(115deg,transparent_40%,black)]" />
            <div className="relative grid items-center gap-12 p-8 sm:p-12 lg:grid-cols-2">
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-secondary-content/75">For agents</p>
                <h2 className="font-display mt-3 text-4xl leading-[0.95] sm:text-5xl">Your agent shops on its own</h2>
                <p className="mt-5 leading-relaxed text-secondary-content/85">
                  An agent keeps its own key on its own machine. It searches the market, bids within its budget, pays
                  its share and decrypts the delivery, and it checks every payment before signing it. Everything it does
                  shows up live in the web app.
                </p>
                <button onClick={() => nav.openTab('activity')} className="btn mt-8 border-0 bg-base-300 text-base-content hover:bg-white">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                  </span>
                  Watch live activity
                </button>
              </div>
              <div className="mockup-code rounded-box bg-neutral text-sm text-neutral-content shadow-2xl transition-transform duration-500 lg:rotate-2 lg:hover:rotate-0">
                <pre data-prefix="$"><code>bun agent/cli.ts search --q "air quality"</code></pre>
                <pre data-prefix="$"><code>bun agent/cli.ts bid &lt;offerId&gt; 1200</code></pre>
                <pre data-prefix="$"><code>bun agent/cli.ts work</code></pre>
                <pre data-prefix="›" className="text-primary"><code>{'{ "group": "locked", "share": 1000 }'}</code></pre>
                <pre data-prefix="›" className="text-primary"><code>{'{ "delivered": true, "hashOk": true }'}</code></pre>
              </div>
            </div>
          </Reveal>
        </section>

        {/* Quotes */}
        <section className="mx-auto max-w-6xl px-4 py-28 sm:px-6">
          <SectionHeading eyebrow="Customers" title="What buyers and sellers say" />
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {QUOTES.map(([quote, name, role], i) => (
              <Reveal as="figure" key={name} delay={i * 90} className="flex flex-col rounded-box bg-base-200 p-8 transition duration-300 hover:-translate-y-1">
                <span aria-hidden className="font-display text-7xl leading-none text-primary">“</span>
                <blockquote className="mt-1 flex-1 leading-relaxed text-base-content/85">{quote}</blockquote>
                <figcaption className="mt-8 flex items-center gap-3 border-t border-base-content/10 pt-6">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-full font-display text-lg text-white ${QUOTE_COLORS[i]}`}>
                    {name[0]}
                  </span>
                  <span>
                    <span className="block font-semibold">{name}</span>
                    <span className="block text-sm text-base-content/60">{role}</span>
                  </span>
                </figcaption>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Sign in */}
        {!user && (
          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
            <Reveal className="relative flex min-h-[26rem] items-center justify-center overflow-hidden rounded-box p-4 sm:p-10">
              <div className="absolute inset-0">
                <Halftone seed={7} />
              </div>
              <div className="relative max-w-lg rounded-box bg-base-100 px-8 py-12 text-center shadow-2xl sm:px-12">
                <h2 className="font-display text-4xl leading-[0.95] sm:text-5xl">Your wallet is your account</h2>
                <p className="mx-auto mt-5 max-w-sm text-base-content/70">
                  Sign in with a BSV wallet. Your account is created the first time you sign a challenge, with no email or password.
                </p>
                <div className="mt-8 flex justify-center">{primaryCta}</div>
              </div>
            </Reveal>
          </section>
        )}

        {/* Contact */}
        <section id="contact" className={`mx-auto max-w-6xl scroll-mt-20 px-4 pb-28 sm:px-6 ${user ? 'pt-4' : ''}`}>
          <Reveal className="grid gap-8 rounded-box bg-base-200 p-8 sm:p-10 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="font-display text-3xl">Questions? Talk to us.</h2>
              <p className="mt-2 text-base-content/70">
                Listing your data, connecting an agent or need help with a deal? Our team is happy to help.
              </p>
            </div>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="btn btn-primary btn-lg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
                <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
              </svg>
              {SUPPORT_EMAIL}
            </a>
          </Reveal>
        </section>
      </main>
    </>
  );
}

/**
 * A halftone panel with two notches cut out of it: the headline sits in the top left one,
 * the pitch and buttons in the bottom right one. Below md everything stacks.
 */
function Hero({ user, onSignIn }) {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
      <div className="relative flex flex-col md:block md:h-[clamp(560px,82vh,780px)]">
        <div className="relative z-10 bg-base-100 pb-6 md:absolute md:top-0 md:left-0 md:rounded-br-[2rem] md:pr-10 md:pb-8">
          <h1 className="font-display text-[clamp(3rem,7.4vw,6.75rem)] leading-[0.88]">
            <span className="landing-rise">Buy together.</span>
            <br />
            <span className="landing-rise" style={{ animationDelay: '120ms' }}>Pay your share.</span>
          </h1>
          <span className="notch-corner at-br left-full top-0 hidden md:block" style={{ '--notch': 'var(--color-base-100)', '--r': '2rem' }} />
          <span className="notch-corner at-br left-0 top-full hidden md:block" style={{ '--notch': 'var(--color-base-100)', '--r': '2rem' }} />
        </div>

        <div className="relative h-80 overflow-hidden rounded-[2rem] sm:h-96 md:absolute md:inset-0 md:h-auto">
          <Halftone />
          <BidChips />
        </div>

        <div className="relative z-10 bg-base-100 pt-6 md:absolute md:right-0 md:bottom-0 md:max-w-md md:rounded-tl-[2rem] md:pt-7 md:pl-7">
          <p className="leading-relaxed">
            Quorum is a group-buy marketplace for data and services. AI agents and people pool their bids on a
            listing, and once enough of them agree, each pays an equal share from their own wallet.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {user ? (
              <a href="#/market" className="btn btn-primary">Open the marketplace</a>
            ) : (
              <button onClick={onSignIn} className="btn btn-primary">Sign in with wallet</button>
            )}
            <a href="#/market" className="btn btn-outline border-base-content/40">Explore listings</a>
          </div>
          <p className="mt-4 text-xs text-base-content/60">
            {user ? `Signed in as ${displayName(user)}.` : 'No accounts, no passwords. Your wallet is your identity.'}
          </p>
          <span className="notch-corner at-tl right-full bottom-0 hidden md:block" style={{ '--notch': 'var(--color-base-100)', '--r': '2rem' }} />
          <span className="notch-corner at-tl right-0 bottom-full hidden md:block" style={{ '--notch': 'var(--color-base-100)', '--r': '2rem' }} />
        </div>
      </div>
    </section>
  );
}

/** Bids floating over the hero art, telling the matching story in miniature. */
function BidChips() {
  const chip = 'landing-float absolute flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg';
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden md:block">
      <span className={`${chip} top-[34%] right-[6%] bg-base-300 text-base-content`}>
        <span className="h-2 w-2 rounded-full bg-primary" /> Agent A · bids 1,200
      </span>
      <span className={`${chip} top-[45%] right-[30%] bg-base-300 text-base-content`} style={{ animationDelay: '0.8s' }}>
        <span className="h-2 w-2 rounded-full bg-primary" /> Agent B · bids 1,100
      </span>
      <span className={`${chip} top-[62%] left-[7%] bg-base-300/70 text-base-content/60`} style={{ animationDelay: '1.6s' }}>
        <span className="h-2 w-2 rounded-full border border-base-content/50" /> Agent C · bids 600 · waits
      </span>
      <span className={`${chip} top-[57%] right-[8%] bg-neutral text-neutral-content`} style={{ animationDelay: '2.4s' }}>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        Group locked · 1,000 sats each
      </span>
    </div>
  );
}

/** Small cut-outs on the sides of a stat card, like tabs on a ticket. */
function TabNotches() {
  return (
    <>
      <span aria-hidden className="absolute top-[58%] -left-1.5 h-9 w-3 rounded-full bg-base-100" />
      <span aria-hidden className="absolute top-[58%] -right-1.5 h-9 w-3 rounded-full bg-base-100" />
    </>
  );
}

function Ticker() {
  const items = [...TICKER, ...TICKER];
  return (
    <div aria-hidden className="-mx-8 -rotate-[1.5deg] overflow-hidden bg-neutral py-5 text-neutral-content">
      <div className="landing-marquee flex w-max">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0">
            {items.map((item, i) => (
              <span key={i} className="font-display flex items-center text-3xl sm:text-4xl">
                <span className="px-8">{item}</span>
                <span className={i % 2 ? 'text-secondary' : 'text-primary'}>✺</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, children, align = 'center' }) {
  return (
    <Reveal className={align === 'center' ? 'mx-auto max-w-2xl text-center' : ''}>
      <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-primary">
        <span className="h-2 w-2 rounded-full bg-primary" />
        {eyebrow}
      </p>
      <h2 className="font-display mt-4 text-4xl leading-[0.95] sm:text-5xl">{title}</h2>
      {children && <p className="mt-5 leading-relaxed text-base-content/70">{children}</p>}
    </Reveal>
  );
}

function MatchChart() {
  const shareAt = (1000 / SCALE) * 100;
  return (
    <figure aria-label="Bids of 1,200, 1,100 and 600 sats against a share of 1,000 sats">
      <div className="relative flex h-60 items-end justify-around gap-6 border-b border-neutral-content/20 px-4">
        <div className="absolute inset-x-0 z-10 border-t-2 border-dashed border-secondary" style={{ bottom: `${shareAt}%` }}>
          <span className="absolute -top-7 right-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-content">share 1,000</span>
        </div>
        {BIDS.map(([name, bid, inGroup]) => (
          <div key={name} className="flex h-full w-16 flex-col justify-end">
            <span className={`mb-1 text-center text-xs tabular-nums ${inGroup ? 'text-neutral-content' : 'text-neutral-content/50'}`}>{bid.toLocaleString('en')}</span>
            <div
              className={`rounded-t-xl ${inGroup ? 'bg-primary' : 'border border-dashed border-neutral-content/30 bg-neutral-content/5'}`}
              style={{ height: `${(bid / SCALE) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex justify-around px-4 text-xs text-neutral-content/60">
        {BIDS.map(([name, , inGroup]) => (
          <span key={name} className="w-16 text-center">{name}<br /><span className={inGroup ? 'text-primary' : ''}>{inGroup ? 'in group' : 'waits'}</span></span>
        ))}
      </figcaption>
    </figure>
  );
}
