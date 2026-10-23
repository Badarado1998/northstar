import { Footer, Header } from '@/components/shell';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <>
    <Header />
    {children}
    <Footer />
  </>;
}
