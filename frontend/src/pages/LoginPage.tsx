import { useState, type FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff, Info, Mail } from 'lucide-react';
import { useAuth } from '../auth';
import { ApiError, authApi } from '../lib/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/ToastContext';

type Step = 'credentials' | 'otp' | 'forgot' | 'reset';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function Logo() {
  return (
    <div className="mb-8 flex items-center justify-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-on-primary">R</span>
      <span className="text-lg font-semibold tracking-tight text-text">Rex Billing</span>
    </div>
  );
}

function DevCode({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-border bg-info-bg px-3 py-2 text-xs text-info">
      <Info size={14} className="mt-px shrink-0" aria-hidden="true" />
      <span>Email delivery is simulated on this server. Your code is <strong className="font-semibold tabular-nums">{code}</strong>.</span>
    </p>
  );
}

export function LoginPage() {
  const { startLogin, verifyOtp, resendOtp, signOutReason } = useAuth();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const go = (next: Step, initialOtp = '') => {
    setError('');
    setOtp(initialOtp);
    setStep(next);
  };

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const submitCredentials = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    run(async () => {
      const res = await startLogin(email.trim(), password);
      setDevCode(res.debug_otp);
      go('otp', res.debug_otp ?? '');
    }, 'Unable to sign in.');
  };

  const submitOtp = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    run(async () => {
      await verifyOtp(email.trim(), otp);
      setPassword('');
      showToast('Signed in successfully', 'success');
    }, 'Verification failed.');
  };

  const resend = () =>
    run(async () => {
      const code = await resendOtp(email.trim());
      setDevCode(code);
      if (code) setOtp(code);
      showToast('A new code has been sent', 'info');
    }, 'Could not resend the code.');

  const submitForgot = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await authApi.post<{ debug_otp: string | null }>('/api/auth/forgot-password', { email: email.trim() });
      setDevCode(res.debug_otp);
      go('reset');
    }, 'Could not send a reset code.');
  };

  const submitReset = (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('Use at least 8 characters for the new password.');
      return;
    }
    run(async () => {
      await authApi.post('/api/auth/reset-password', { email: email.trim(), otp, new_password: newPassword });
      setNewPassword('');
      setPassword('');
      go('credentials');
      showToast('Password updated. Sign in with your new password.', 'success');
    }, 'Could not reset the password.');
  };

  const notice =
    step === 'credentials' && signOutReason === 'timeout'
      ? 'You were signed out after a period of inactivity.'
      : step === 'credentials' && signOutReason === 'expired'
        ? 'Your session has ended. Please sign in again.'
        : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-[380px]">
        <Logo />
        <div className="rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-card)] sm:p-7">
          {step === 'credentials' && (
            <form onSubmit={submitCredentials} noValidate className="space-y-4">
              <div className="mb-2 text-center">
                <h1 className="text-lg font-semibold text-text">Welcome back</h1>
                <p className="mt-1 text-sm text-text-muted">Sign in with your Rex CRM account</p>
              </div>
              {notice && (
                <p role="status" className="rounded-md border border-border bg-warning-bg px-3 py-2 text-xs text-warning">{notice}</p>
              )}
              <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoFocus />
              <div className="relative">
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  inputClassName="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded text-text-muted hover:text-text"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={() => go('forgot')} className="text-xs font-medium text-primary hover:underline">
                  Forgot password?
                </button>
              </div>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <Button type="submit" loading={busy} className="w-full justify-center">Sign in</Button>
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-xs font-medium text-text-muted">Quick test accounts:</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setEmail('hr@rexera.co.in'); setPassword('password'); }}
                    className="rounded bg-primary-soft px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft/80"
                  >
                    Admin (hr@rexera.co.in)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEmail('acct@rexera.co.in'); setPassword('password'); }}
                    className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium text-text-muted hover:text-text"
                  >
                    Accountant
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEmail('sales@rexera.co.in'); setPassword('password'); }}
                    className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium text-text-muted hover:text-text"
                  >
                    Sales
                  </button>
                </div>
              </div>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={submitOtp} noValidate className="space-y-4">
              <div className="mb-2 text-center">
                <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Mail size={18} aria-hidden="true" />
                </span>
                <h1 className="text-lg font-semibold text-text">Check your email</h1>
                <p className="mt-1 text-sm text-text-muted">
                  We sent a 6-digit code to <span className="font-medium text-text">{email}</span>
                </p>
              </div>
              <Input
                label="Verification code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                inputClassName="text-center text-lg tracking-[0.4em] tabular-nums"
                required
                autoFocus
              />
              <DevCode code={devCode} />
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <Button type="submit" loading={busy} className="w-full justify-center">Verify and sign in</Button>
              <div className="flex items-center justify-between text-xs">
                <button type="button" onClick={() => go('credentials')} className="inline-flex items-center gap-1 font-medium text-text-muted hover:text-text">
                  <ArrowLeft size={13} /> Back
                </button>
                <button type="button" onClick={resend} disabled={busy} className="font-medium text-primary hover:underline disabled:opacity-50">
                  Resend code
                </button>
              </div>
            </form>
          )}

          {step === 'forgot' && (
            <form onSubmit={submitForgot} noValidate className="space-y-4">
              <div className="mb-2 text-center">
                <h1 className="text-lg font-semibold text-text">Reset your password</h1>
                <p className="mt-1 text-sm text-text-muted">We'll email you a code to set a new password.</p>
              </div>
              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <Button type="submit" loading={busy} className="w-full justify-center">Send reset code</Button>
              <button type="button" onClick={() => go('credentials')} className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text">
                <ArrowLeft size={13} /> Back to sign in
              </button>
            </form>
          )}

          {step === 'reset' && (
            <form onSubmit={submitReset} noValidate className="space-y-4">
              <div className="mb-2 text-center">
                <h1 className="text-lg font-semibold text-text">Set a new password</h1>
                <p className="mt-1 text-sm text-text-muted">Enter the code sent to {email}.</p>
              </div>
              <Input label="Reset code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" required autoFocus />
              <Input label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} hint="At least 8 characters" required />
              <DevCode code={devCode} />
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <Button type="submit" loading={busy} className="w-full justify-center">Update password</Button>
              <button type="button" onClick={() => go('credentials')} className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text">
                <ArrowLeft size={13} /> Back to sign in
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-text-muted">Protected by two-factor authentication</p>
      </div>
    </main>
  );
}
