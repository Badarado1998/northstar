'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DashboardScripts } from '@/components/dashboard-scripts';
import { BRAND } from '@/lib/brand';

const siteLinks = [['Features', '/features'], ['Models', '/models'], ['Pricing', '/pricing'], ['Download', '/download'], ['Docs', '/docs']] as const;

const sidebar = [
  { label: 'Overview', href: '/account', icon: 'fa-gauge-high' },
  { label: 'Billing', href: '/account/billing', icon: 'fa-credit-card' },
] as const;

type Session = { signedIn: boolean; email?: string; emailVerified?: boolean; platformAdmin?: boolean };

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(response => response.json() as Promise<Session>)
      .then(setSession)
      .catch(() => setSession({ signedIn: false }));
  }, []);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    window.location.href = '/';
  }

  const email = session?.email ?? '';
  const onAdmin = pathname.startsWith('/admin');
  const showAdmin = Boolean(session?.platformAdmin);

  return <>
    <DashboardScripts />
    <div className="app-wrapper">
      <nav className="app-header navbar navbar-expand bg-body border-bottom">
        <div className="container-fluid">
          <ul className="navbar-nav">
            <li className="nav-item">
              <a className="nav-link" data-lte-toggle="sidebar" href="#" role="button" aria-label="Toggle sidebar">
                <i className="fas fa-bars" />
              </a>
            </li>
            <li className="nav-item d-none d-md-block">
              <Link className="nav-link fw-semibold" href="/">{BRAND.productName}</Link>
            </li>
          </ul>
          <ul className="navbar-nav ms-auto align-items-center gap-1">
            {siteLinks.map(([label, href]) => (
              <li key={href} className="nav-item d-none d-lg-block">
                <Link className="nav-link" href={href}>{label}</Link>
              </li>
            ))}
            {showAdmin ? (
              <li className="nav-item d-none d-md-block">
                <Link className={`nav-link${onAdmin ? ' fw-bold' : ''}`} href="/admin">Admin</Link>
              </li>
            ) : null}
            <li className="nav-item dropdown">
              <a className="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                <i className="far fa-user me-1" />
                <span className="d-none d-sm-inline">{email || 'Account'}</span>
              </a>
              <ul className="dropdown-menu dropdown-menu-end">
                <li><Link className="dropdown-item" href="/account"><i className="fas fa-gauge-high me-2" />Dashboard</Link></li>
                <li><Link className="dropdown-item" href="/account/billing"><i className="fas fa-credit-card me-2" />Billing</Link></li>
                <li><hr className="dropdown-divider" /></li>
                <li><button type="button" className="dropdown-item" onClick={() => void signOut()}><i className="fas fa-right-from-bracket me-2" />Sign out</button></li>
              </ul>
            </li>
          </ul>
        </div>
      </nav>

      <aside className="app-sidebar bg-body-secondary shadow" data-bs-theme="dark">
        <div className="sidebar-brand">
          <Link href="/account" className="brand-link">
            <span className="brand-text fw-light">{BRAND.productName}</span>
          </Link>
        </div>
        <div className="sidebar-wrapper">
          <nav className="mt-2">
            <ul className="nav sidebar-menu flex-column" role="menu">
              {sidebar.map(item => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return <li key={item.href} className="nav-item">
                  <Link href={item.href} className={`nav-link${active ? ' active' : ''}`}>
                    <i className={`nav-icon fas ${item.icon}`} />
                    <p>{item.label}</p>
                  </Link>
                </li>;
              })}
              {showAdmin ? (
                <li className="nav-item">
                  <Link href="/admin" className={`nav-link${onAdmin ? ' active' : ''}`}>
                    <i className="nav-icon fas fa-user-shield" />
                    <p>Admin</p>
                  </Link>
                </li>
              ) : null}
            </ul>
          </nav>
        </div>
      </aside>

      <main className="app-main">
        <div className="app-content">
          <div className="container-fluid pt-3 pb-4">
            {children}
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <div className="float-end d-none d-sm-inline">Account</div>
        <strong>{BRAND.productName}</strong> · <Link href="/privacy">Privacy</Link> · <Link href="/support">Support</Link>
      </footer>
    </div>
  </>;
}
