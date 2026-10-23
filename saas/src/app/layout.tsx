import type { Metadata } from 'next';
import { Header, Footer } from '@/components/shell';
import { BRAND } from '@/lib/brand';
import './globals.css';

export const metadata: Metadata = { title: { default: BRAND.productName, template: `%s · ${BRAND.productName}` }, description: BRAND.tagline };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="font-sans antialiased"><Header />{children}<Footer /></body></html>;
}
