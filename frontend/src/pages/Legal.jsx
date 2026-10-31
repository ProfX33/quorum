import Navbar from '../components/Navbar';
import { LEGAL_PAGES, SUPPORT_EMAIL } from '../components/Footer';

const Mail = () => <a href={`mailto:${SUPPORT_EMAIL}`} className="link">{SUPPORT_EMAIL}</a>;

// Bracketed values are placeholders for the operator's registered details.
const CONTENT = {
  impressum: {
    updated: '30 October 2026',
    sections: [
      ['Information according to § 5 DDG', <>
        <p>Quorum [legal form, e.g. GmbH]<br />[Street and number]<br />[Postcode] Munich<br />Germany</p>
        <p>Represented by: [managing director(s)]</p>
      </>],
      ['Contact', <p>Email: <Mail /></p>],
      ['Register entry', <p>Commercial register: [Amtsgericht München, HRB number]<br />VAT ID according to § 27a UStG: [DE…]</p>],
      ['Responsible for content according to § 18 (2) MStV', <p>[Name], address as above.</p>],
      ['Dispute resolution', <p>We are neither obliged nor willing to take part in dispute resolution proceedings before a consumer arbitration board.</p>],
      ['Liability for content and links', <p>
        We are responsible for our own content on these pages under the general laws. Listings are published by
        their sellers, who are responsible for them; we are not obliged to monitor third-party information but will
        remove unlawful content as soon as we become aware of it. Links to external sites such as block explorers are
        outside our control, and their operators are responsible for their content.
      </p>],
    ],
  },
  terms: {
    updated: '30 October 2026',
    sections: [
      ['1. Scope', <p>
        These terms govern the use of the Quorum marketplace, its web app, its API and its agent tools. By signing in
        with a wallet or using the API you accept them.
      </p>],
      ['2. What Quorum does', <p>
        Quorum matches sellers of data and services with groups of buyers. It runs the matching off-chain and records
        payments on the BSV blockchain. Quorum is not a party to the contract between seller and buyers, and it never
        holds users' funds or private keys.
      </p>],
      ['3. Accounts and wallets', <p>
        Your identity is your wallet's public key. You alone are responsible for your keys, your wallet and every
        transaction it signs. Lost keys cannot be recovered by us, and confirmed blockchain transactions cannot be
        reversed.
      </p>],
      ['4. Bids, groups and payment', <p>
        A bid is an offer to pay up to the maximum you stated, backed by a pledge from your wallet. You can change or
        withdraw it until the deadline. From the deadline it is binding: if a group forms, each member pays an equal
        share of the price, never more than their own bid, from their pledge. Unused pledges, and all pledges if no
        group completes, can be taken back less network fees.
      </p>],
      ['5. Sellers', <p>
        Sellers warrant that they may lawfully sell what they list, that the delivered data matches the hash they
        committed to, and that it does not infringe third-party rights or contain personal data without a legal basis.
      </p>],
      ['6. Prohibited use', <p>
        You may not list unlawful content, manipulate matching or reputation, attack the service or use it to launder
        money or evade sanctions.
      </p>],
      ['7. Liability', <p>
        We are liable without limitation for intent and gross negligence. For slight negligence we are liable only
        for breach of essential obligations, limited to the foreseeable damage typical for the contract. We are not
        liable for the quality of listed data, for blockchain network conditions, or for losses caused by
        compromised wallets.
      </p>],
      ['8. Changes and governing law', <p>
        We may change these terms with reasonable notice. German law applies, excluding the UN Convention on
        Contracts for the International Sale of Goods. Questions: <Mail />.
      </p>],
    ],
  },
  privacy: {
    updated: '30 October 2026',
    sections: [
      ['Controller', <p>Quorum, address as in the <a href="#/legal/impressum" className="link">Impressum</a>. Contact: <Mail />.</p>],
      ['What we process', <ul className="list-disc space-y-1 pl-5">
        <li>Your wallet's identity public key, used as your account.</li>
        <li>The display name and profile picture you choose to add.</li>
        <li>Your listings, bids, ratings and the transaction IDs of your payments.</li>
        <li>Server logs (IP address, time, request) kept for up to 14 days for security.</li>
      </ul>],
      ['Public by design', <p>
        Listings, bids, profiles and reputation are visible to everyone, and payments are recorded on the public BSV
        blockchain. Data written to the blockchain cannot be deleted by us or anyone else.
      </p>],
      ['Legal bases', <p>
        Art. 6(1)(b) GDPR for running the marketplace you use, and Art. 6(1)(f) GDPR for security and abuse prevention.
      </p>],
      ['Recipients', <p>
        Our hosting provider processes data on our behalf. Block explorers such as WhatsOnChain are only contacted
        when you follow a link to them. We do not sell personal data.
      </p>],
      ['Your rights', <p>
        You have the right to access, rectification, erasure, restriction, data portability and objection, and you may
        complain to a supervisory authority such as the Bavarian Data Protection Authority (BayLDA). Write to <Mail />.
      </p>],
    ],
  },
  cookies: {
    updated: '30 October 2026',
    sections: [
      ['One cookie, strictly necessary', <p>
        When you sign in we set a single <code>session</code> cookie (HttpOnly, SameSite=Lax) that keeps you signed in
        for the length of your session. It is required for the service to work, so it needs no consent under § 25 (2)
        TDDDG.
      </p>],
      ['No tracking', <p>We use no analytics, advertising or third-party cookies.</p>],
      ['Removing it', <p>Signing out deletes the cookie. You can also delete it in your browser settings at any time.</p>],
    ],
  },
};

export default function Legal({ page, user, onSignIn, onLogout, nav }) {
  const content = CONTENT[page];
  const title = LEGAL_PAGES.find(([key]) => key === page)?.[1];

  return (
    <>
      <Navbar user={user} onSignIn={onSignIn} onLogout={onLogout} nav={nav} />
      <main className="mx-auto grid max-w-5xl gap-10 px-6 py-12 md:grid-cols-[12rem_1fr]">
        <nav aria-label="Legal">
          <ul className="menu w-full rounded-box bg-base-200 p-2">
            {LEGAL_PAGES.map(([key, label]) => (
              <li key={key}><a href={`#/legal/${key}`} className={key === page ? 'menu-active' : ''}>{label}</a></li>
            ))}
          </ul>
        </nav>
        {content ? (
          <article className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-base-content/50">Last updated {content.updated}</p>
            <div className="mt-8 space-y-8">
              {content.sections.map(([heading, body]) => (
                <section key={heading}>
                  <h2 className="text-lg font-semibold text-secondary">{heading}</h2>
                  <div className="mt-2 space-y-2 leading-relaxed text-base-content/75">{body}</div>
                </section>
              ))}
            </div>
          </article>
        ) : (
          <p className="text-base-content/70">This page does not exist.</p>
        )}
      </main>
    </>
  );
}
