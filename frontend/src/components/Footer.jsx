export const SUPPORT_EMAIL = 'support@quorum.com';

export const LEGAL_PAGES = [
  ['impressum', 'Impressum'],
  ['terms', 'Terms and Conditions'],
  ['privacy', 'Privacy Policy'],
  ['cookies', 'Cookie Policy'],
];

const PRODUCT = [
  ['#/', 'Home'],
  ['#/market', 'Marketplace'],
  ['#/#how-it-works', 'How it works'],
  ['#/#agents', 'For agents'],
];

/** Site-wide footer with the legal links. */
export default function Footer() {
  return (
    <footer className="p-3 pt-12">
      <div className="panel overflow-hidden">
        <div className="grid gap-10 px-6 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:px-10">
          <div className="sm:col-span-2 lg:col-span-1">
            <img src="/logo.svg" alt="Quorum" className="wordmark h-8" />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-base-content/55">
              The group-buy marketplace for data and services. Pool demand, pay your share, settle on BSV.
            </p>
          </div>
          <FooterColumn title="Product" links={PRODUCT} />
          <FooterColumn title="Legal" links={LEGAL_PAGES.map(([key, label]) => [`#/legal/${key}`, label])} />
          <div>
            <h2 className="chip">Contact</h2>
            <ul className="mt-5 space-y-2 text-sm text-base-content/55">
              <li><a href={`mailto:${SUPPORT_EMAIL}`} className="transition hover:text-primary">{SUPPORT_EMAIL}</a></li>
              <li>Munich, Germany</li>
            </ul>
          </div>
        </div>
        <div aria-hidden className="select-none px-6 font-pixel text-[18vw] leading-[0.8] text-base-content/[0.03] lg:px-10 lg:text-[13vw]">QUORUM</div>
        <div className="border-t border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 text-xs uppercase tracking-[0.12em] text-base-content/40 lg:px-10">
            <span>© {new Date().getFullYear()} Quorum. All rights reserved.</span>
            <span className="flex items-center gap-2"><span className="dot text-primary" />Non-custodial · Your keys, your coins.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }) {
  return (
    <div>
      <h2 className="chip">{title}</h2>
      <ul className="mt-5 space-y-2 text-sm text-base-content/55">
        {links.map(([href, label]) => (
          <li key={href}><a href={href} className="transition hover:text-primary">{label}</a></li>
        ))}
      </ul>
    </div>
  );
}
