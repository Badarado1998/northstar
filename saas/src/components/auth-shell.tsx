import Link from 'next/link';
import type { ReactNode } from 'react';

export function AuthShell({ title, lead, backHref, backLabel, children, footer }: {
  title: string;
  lead?: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return <main className="px-6 py-12">
    {backHref ? <p className="mx-auto mb-6 max-w-md text-center text-sm"><Link className="text-ink/70 hover:text-pine" href={backHref}>← {backLabel ?? 'Back'}</Link></p> : null}
    <div className="mx-auto max-w-md text-center">
      <h1 className="font-serif text-4xl leading-tight">{title}</h1>
      {lead ? <p className="mt-3 text-sm leading-6 text-ink/70">{lead}</p> : null}
    </div>
    <div className="mt-8">{children}</div>
    {footer ? <div className="mx-auto mt-6 max-w-md text-center text-sm text-ink/70">{footer}</div> : null}
  </main>;
}
