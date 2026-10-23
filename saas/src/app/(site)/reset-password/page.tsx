import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import Link from 'next/link';

export default function ResetPasswordPage() {
  return <AuthShell
    title="Choose a new password"
    lead="Pick a strong password you have not used here before. The link from your email expires in 30 minutes."
    backHref="/forgot-password"
    backLabel="Request a new link"
    footer={<><Link className="text-pine underline" href="/sign-in">Back to sign in</Link></>}
  >
    <AuthForm mode="reset" />
  </AuthShell>;
}
