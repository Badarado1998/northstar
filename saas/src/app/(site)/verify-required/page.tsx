import { AuthShell } from '@/components/auth-shell';
import { VerifyRequiredPanel } from '@/components/verify-required-panel';

export default function VerifyRequiredPage() {
  return <AuthShell
    title="Verify your email"
    lead="We sent a link when you signed up. Confirm your address to unlock your account, billing, and the desktop app."
  >
    <VerifyRequiredPanel />
  </AuthShell>;
}
