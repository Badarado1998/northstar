import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  return <AuthShell
    title="Forgot password"
    lead="Enter the email you used for Northstar. We will send a link to choose a new password."
    backHref="/sign-in"
    backLabel="Back to sign in"
    footer={<><Link className="text-pine underline" href="/sign-up">Need an account?</Link></>}
  >
    <AuthForm mode="forgot" />
  </AuthShell>;
}
