import { AuthForm } from '@/components/auth-form';
import Link from 'next/link';

export default function SignInPage() {
  return <main className="px-6 py-12"><h1 className="mb-6 text-center font-serif text-4xl">Sign in</h1><AuthForm mode="sign-in" /><p className="mt-4 text-center text-sm"><Link href="/forgot-password">Forgot password</Link> · <Link href="/sign-up">Create account</Link></p></main>;
}
