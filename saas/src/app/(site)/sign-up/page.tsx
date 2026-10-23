import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import Link from 'next/link';

export default function SignUpPage() {
  return <AuthShell
    title="Create your account"
    lead="One account for billing on the web and signing in from the Northstar desktop app."
    backHref="/sign-in"
    backLabel="Sign in instead"
    footer={<><Link className="text-pine underline" href="/sign-in">Already have an account?</Link></>}
  >
    <AuthForm mode="sign-up" />
  </AuthShell>;
}
