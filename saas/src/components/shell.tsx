import Link from 'next/link';
import { AuthNav } from '@/components/auth-nav';
import { BRAND } from '@/lib/brand';

const links = [['Features', '/features'], ['Models', '/models'], ['Pricing', '/pricing'], ['Download', '/download'], ['Docs', '/docs']] as const;

export function Header() {
  return <header className="site-header relative z-50 mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/" className="font-serif text-xl no-underline sm:text-2xl">{BRAND.productName}</Link>
      <AuthNav />
    </div>
    <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink/80">{links.map(([label, href]) => <Link key={href} className="no-underline hover:text-pine" href={href}>{label}</Link>)}</nav>
  </header>;
}

export function Footer() {
  return <footer className="mx-auto mt-16 max-w-6xl border-t border-line px-6 py-8 text-sm text-ink/70">
    <p>{BRAND.attribution}. <a href={BRAND.attributionUrl}>{BRAND.attributionUrl.replace('https://', '')}</a></p>
    <div className="mt-3 flex flex-wrap gap-4">
      <Link href="/faq">FAQ</Link><Link href="/support">Support</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/licenses">Licenses</Link><Link href="/admin">Admin</Link>
    </div>
  </footer>;
}
