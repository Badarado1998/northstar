import Link from 'next/link';
import { BRAND } from '@/lib/brand';

export default function HomePage() {
  return <main>
    <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-[1.2fr_.8fr] md:items-end">
      <div>
        <p className="text-sm uppercase tracking-[0.18em] text-pine">Desktop coding workspace</p>
        <h1 className="mt-3 font-serif text-6xl leading-none">{BRAND.productName} keeps the project on your computer.</h1>
        <p className="mt-5 max-w-xl text-lg text-ink/75">Use the coding agents you already run locally. When you choose a platform model, the hosted gateway meters that request against your monthly allowance and stops when the allowance is gone.</p>
        <div className="mt-8 flex gap-3"><Link className="button button-pine" href="/download">Download</Link><Link className="button button-line" href="/pricing">See pricing</Link></div>
      </div>
      <div className="panel p-6">
        <p className="text-sm text-ink/60">Included allowance, not an unlimited meter</p>
        <p className="mt-2 font-serif text-4xl">$15 left of $15</p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-moss"><div className="h-full w-0 bg-pine" /></div>
        <p className="mt-4 text-sm">A subscription stays active after the allowance is used. Hosted model calls stop until you buy credits or the next period starts. Purchased credits are kept separately.</p>
      </div>
    </section>
    <section className="mx-auto grid max-w-6xl gap-4 px-6 md:grid-cols-3">
      {[['Local work', 'Files, Git, terminals, previews, and agent processes stay on the machine.'], ['Metered models', 'OpenAI and Anthropic calls go through the gateway. The desktop app never holds those provider keys.'], ['Your own agents', 'Claude Code, Codex, Copilot, and the other installed CLIs keep their own sign-in and are not billed to your allowance.']].map(([title, copy]) => <article key={title} className="panel p-5"><h2 className="font-serif text-2xl">{title}</h2><p className="mt-2 text-sm text-ink/75">{copy}</p></article>)}
    </section>
  </main>;
}
