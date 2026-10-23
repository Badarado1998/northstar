import { BRAND } from '@/lib/brand';
import Link from 'next/link';

const files = [
  ['macOS Apple silicon', BRAND.downloads.macArm],
  ['macOS Intel', BRAND.downloads.macIntel],
  ['Windows x64', BRAND.downloads.windowsX64],
  ['Windows arm64', BRAND.downloads.windowsArm],
] as const;

const anyPublished = files.some(([, href]) => Boolean(href));

export default function DownloadPage() {
  return <main className="mx-auto max-w-3xl px-6 py-12">
    <h1 className="font-serif text-5xl">Download {BRAND.productName}</h1>
    <p className="mt-3 text-ink/75">
      Public installers appear here only after you host signed builds and paste HTTPS links into <code className="text-sm">brand.json</code> (root and <code className="text-sm">saas/brand.json</code>, kept identical). Empty fields mean nothing is published yet — not a bug.
    </p>
    <ul className="mt-6 grid gap-3">
      {files.map(([label, href]) => (
        <li key={label} className="panel flex items-center justify-between gap-4 p-4">
          <span>{label}</span>
          {href ? <a className="button button-pine shrink-0" href={href} rel="noopener noreferrer">Download</a> : <span className="text-sm text-ink/60">Not published</span>}
        </li>
      ))}
    </ul>
    {!anyPublished ? <section className="panel mt-8 space-y-4 p-6 text-sm leading-7 text-ink/80">
      <h2 className="font-serif text-2xl text-ink">Run from source (now)</h2>
      <p>Until you ship installers, run the desktop app from this repo. It is still built as Tauri; the window title is {BRAND.productName}. Keep <code>apiBaseUrl</code> in <code>brand.json</code> pointed at your account service ({BRAND.apiBaseUrl} while you develop locally).</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li><code>npm ci</code> in the repository root</li>
        <li><code>npm run tauri dev</code> — live desktop app with hot reload</li>
        <li>Or <code>npm run tauri build</code> — installer under <code>src-tauri/target/release/bundle/</code> (macOS .dmg, Windows setup, etc.)</li>
      </ol>
      <p>Sign in under <strong>Settings → Account &amp; billing</strong> after the SaaS app is running (<Link className="underline" href="/sign-up">create an account</Link> if needed).</p>
      <p className="text-ink/70">Do not link upstream PandaCode GitHub installers here as {BRAND.productName}; they are a different product build. See <code>DESKTOP_RELEASE_GUIDE.md</code> in the repo for publishing your own signed artifacts.</p>
    </section> : null}
    <section className="panel mt-6 p-6 text-sm leading-7 text-ink/80">
      <h2 className="font-serif text-2xl text-ink">When you have a release</h2>
      <p>Set each platform URL in both brand files, for example:</p>
      <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-paper p-4 text-xs">{`"downloads": {
  "macArm": "https://cdn.example.com/northstar/Northstar-macOS-arm64.dmg",
  "macIntel": "",
  "windowsX64": "https://cdn.example.com/northstar/Northstar-Windows-x64-setup.exe",
  "windowsArm": ""
}`}</pre>
      <p className="mt-3">Redeploy the website (or restart <code>npm run dev</code>). Download buttons appear automatically. CI today builds macOS Apple silicon and Windows x64; leave Intel/arm64 empty until you add those builds.</p>
    </section>
  </main>;
}
