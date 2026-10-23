import Link from 'next/link';
import { BRAND } from '@/lib/brand';

const links = [['Features', '/features'], ['Models', '/models'], ['Pricing', '/pricing'], ['Download', '/download'], ['Docs', '/docs']] as const;

export function Header() {
  return <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
    <Link href="/" className="font-serif text-2xl no-underline">{BRAND.productName}</Link>
    <nav className="hidden gap-5 text-sm md:flex">{links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav>
    <div className="flex gap-2 text-sm"><Link className="button button-line" href="/sign-in">Sign in</Link><Link className="button button-dark" href="/sign-up">Create account</Link></div>
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
