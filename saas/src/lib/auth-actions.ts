'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ServiceError, loginUser, registerUser, requestPasswordReset, resetPassword, verifyEmail,
} from './auth';
import { getDb } from './db';
import { appUrl } from './http';
import { mailerFromEnv } from './mailer';

export interface AuthState {
  error?: string;
  message?: string;
}

const WEB_SECONDS = 14 * 24 * 60 * 60;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function submitAuth(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const mode = field(formData, 'mode');
  try {
    const db = await getDb();
    if (mode === 'sign-up') {
      const result = await registerUser(db, mailerFromEnv(), appUrl(), {
        email: field(formData, 'email'),
        password: field(formData, 'password'),
        name: field(formData, 'name'),
      });
      const devUrl = process.env.NODE_ENV === 'production' ? '' : `${appUrl()}/verify-email?token=${result.verificationToken}`;
      return { message: devUrl ? `Account created. Development verification link: ${devUrl}` : 'Account created. Check your email to verify it.' };
    }
    if (mode === 'sign-in') {
      const result = await loginUser(db, field(formData, 'email'), field(formData, 'password'));
      const jar = await cookies();
      jar.set('ns_session', result.sessionToken, {
        httpOnly: true,
        path: '/',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: WEB_SECONDS,
      });
      redirect('/account');
    }
    if (mode === 'forgot') {
      await requestPasswordReset(db, mailerFromEnv(), appUrl(), field(formData, 'email'));
      return { message: 'If that email can receive mail, a reset link is on its way.' };
    }
    if (mode === 'reset') {
      await resetPassword(db, field(formData, 'token'), field(formData, 'password'));
      return { message: 'Password updated. Sign in with the new password.' };
    }
    if (mode === 'verify') {
      await verifyEmail(db, field(formData, 'token'));
      return { message: 'Email verified. You can sign in.' };
    }
    return { error: 'Unknown form.' };
  } catch (error) {
    if (typeof error === 'object' && error && 'digest' in error && String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')) throw error;
    if (error instanceof ServiceError) return { error: error.message };
    console.error(error);
    return { error: 'Something went wrong.' };
  }
}
