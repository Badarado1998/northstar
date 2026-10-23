import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import Link from 'next/link';

export default function VerifyEmailPage() {
  return <AuthShell
    title="Verify your email"
    lead="Open the link we emailed you, or paste the verification code below."
    backHref="/sign-in"
    backLabel="Back to sign in"
    footer={<><Link className="text-pine underline" href="/forgot-password">Forgot password</Link></>}
  >
    <AuthForm mode="verify" />
  </AuthShell>;
}
