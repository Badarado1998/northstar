import { BRAND } from '@/lib/brand';
import { anyDownloadPublished, getPublishedDownloads } from '@/lib/downloads';
import { getDb } from '@/lib/db';
import Link from 'next/link';

const labels: Record<'macArm' | 'macIntel' | 'windowsX64' | 'windowsArm', string> = {
  macArm: 'macOS Apple silicon',
  macIntel: 'macOS Intel',
  windowsX64: 'Windows x64',
  windowsArm: 'Windows arm64',
};

export default async function DownloadPage() {
  const catalog = await getPublishedDownloads(await getDb());
  const anyPublished = anyDownloadPublished(catalog);
  const slots = (['macArm', 'macIntel', 'windowsX64', 'windowsArm'] as const).map(key => [labels[key], catalog[key]] as const);

  return <main className="mx-auto max-w-3xl px-6 py-12">
    <h1 className="font-serif text-5xl">Download {BRAND.productName}</h1>
    <p className="mt-3 text-ink/75">
      Install the desktop app, then sign in under <strong>Settings → Account &amp; billing</strong>. Your account device limit applies when you link this computer.
    </p>
    {catalog.version ? <p className="mt-2 text-sm text-ink/60">Current release: {catalog.version}</p> : null}
    <ul className="mt-6 grid gap-3">
      {slots.map(([label, href]) => (
        <li key={label} className="panel flex items-center justify-between gap-4 p-4">
          <span>{label}</span>
          {href ? <a className="button button-pine shrink-0" href={href} rel="noopener noreferrer">Download</a> : <span className="text-sm text-ink/60">Not published</span>}
        </li>
      ))}
    </ul>
    {catalog.releaseNotes ? <section className="panel mt-6 p-6 text-sm leading-7 text-ink/80"><h2 className="font-serif text-2xl text-ink">Release notes</h2><p className="mt-3 whitespace-pre-wrap">{catalog.releaseNotes}</p></section> : null}
    {!anyPublished ? <section className="panel mt-8 space-y-4 p-6 text-sm leading-7 text-ink/80">
      <h2 className="font-serif text-2xl text-ink">Installers not live yet</h2>
      <p>Platform administrators publish HTTPS installer links under <strong>Admin → Desktop downloads</strong> (or in <code className="text-sm">brand.json</code> before deploy). Until installers are published, build locally:</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li><code>npm ci</code> in the repository root</li>
        <li><code>npm run tauri build</code> — artifacts under <code>src-tauri/target/release/bundle/</code></li>
      </ol>
      <p><Link className="underline" href="/sign-up">Create an account</Link> on this site before linking the app.</p>
    </section> : null}
  </main>;
}
