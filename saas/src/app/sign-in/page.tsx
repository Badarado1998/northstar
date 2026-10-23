import { AuthForm } from '@/components/auth-form';
import Link from 'next/link';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ registered?: string; verified?: string }> }) {
  const query = await searchParams;
  const banner = query.registered ? 'Account created. Check your email for the verification link, then sign in.'
    : query.verified ? 'Email verified. You can sign in now.'
      : null;
  return <main className="px-6 py-12">
    <h1 className="mb-6 text-center font-serif text-4xl">Sign in</h1>
    {banner ? <p className="mx-auto mb-4 max-w-md rounded-[14px] border border-pine/30 bg-pine/10 px-4 py-3 text-center text-sm text-pine" role="status">{banner}</p> : null}
    <AuthForm mode="sign-in" />
    <p className="mt-4 text-center text-sm"><Link href="/forgot-password">Forgot password</Link> · <Link href="/sign-up">Create account</Link></p>
  </main>;
}
