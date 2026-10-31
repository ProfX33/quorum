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
    <footer className="relative overflow-hidden bg-neutral text-neutral-content">
      <span aria-hidden className="halftone-dots absolute -bottom-24 -left-24 h-96 w-96 rounded-full text-primary/30 [mask-image:radial-gradient(circle,black,transparent_70%)]" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-16 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <img src="/logo.svg" alt="Quorum" className="h-7 invert" />
          <p className="mt-4 max-w-xs text-sm text-neutral-content/60">
            The group-buy marketplace for data and services. Pool demand, pay your share, settle on BSV.
          </p>
        </div>
        <FooterColumn title="Product" links={PRODUCT} />
        <FooterColumn title="Legal" links={LEGAL_PAGES.map(([key, label]) => [`#/legal/${key}`, label])} />
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-primary">Contact</h2>
          <ul className="mt-4 space-y-2 text-sm text-neutral-content/60">
            <li><a href={`mailto:${SUPPORT_EMAIL}`} className="link link-hover">{SUPPORT_EMAIL}</a></li>
            <li>Munich, Germany</li>
          </ul>
        </div>
      </div>
      <div className="relative border-t border-neutral-content/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-5 text-xs text-neutral-content/50">
          <span>© {new Date().getFullYear()} Quorum. All rights reserved.</span>
          <span>Non-custodial · Your keys, your coins.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-widest text-primary">{title}</h2>
      <ul className="mt-4 space-y-2 text-sm text-neutral-content/60">
        {links.map(([href, label]) => (
          <li key={href}><a href={href} className="link link-hover">{label}</a></li>
        ))}
      </ul>
    </div>
  );
}
