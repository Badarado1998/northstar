import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import Link from 'next/link';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ registered?: string; verified?: string; reset?: string }> }) {
  const query = await searchParams;
  const banner = query.registered ? 'Account created. Check your email for the verification link, then sign in below.'
    : query.verified ? 'Email verified. You can sign in now.'
      : query.reset ? 'Password updated. Sign in with your new password.'
        : null;
  return <AuthShell
    title="Welcome back"
    lead="Sign in to manage your plan, billing, and linked devices."
    footer={<><Link className="text-pine underline" href="/sign-up">Create an account</Link></>}
  >
    {banner ? <p className="mx-auto mb-4 max-w-md rounded-[14px] border border-pine/30 bg-pine/10 px-4 py-3 text-center text-sm text-pine" role="status">{banner}</p> : null}
    <AuthForm mode="sign-in" />
  </AuthShell>;
}
