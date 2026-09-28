import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { api, ApiError, authApi, setUnauthorizedHandler, tokenStore } from './lib/api';
import { useToast } from './ui/ToastContext';

/**
 * Sign-in is the main application's (same accounts, same emailed 6-digit code). What the
 * signed-in person may do in billing comes from the billing API's /me, which the billing
 * backend also enforces on every request.
 */
export interface BillingUser {
  email: string;
  name: string;
  role: string;
  role_label: string;
  branch_key: string | null;
  permissions: string[];
}

type Status = 'checking' | 'authenticated' | 'unauthenticated' | 'no-access';
type SignOutReason = 'manual' | 'timeout' | 'expired';

interface AuthValue {
  status: Status;
  user: BillingUser | null;
  signOutReason: SignOutReason | null;
  can: (p: string) => boolean;
  startLogin: (email: string, password: string) => Promise<{ debug_otp: string | null }>;
  verifyOtp: (email: string, otp: string) => Promise<void>;
  resendOtp: (email: string) => Promise<string | null>;
  logout: (reason?: SignOutReason) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<Status>(() => (tokenStore.get() ? 'checking' : 'unauthenticated'));
  const [user, setUser] = useState<BillingUser | null>(null);
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(null);

  const endSession = useCallback((reason: SignOutReason) => {
    tokenStore.set(null);
    setUser(null);
    setSignOutReason(reason);
    setStatus('unauthenticated');
  }, []);

  const loadMe = useCallback(async () => {
    try {
      setUser(await api.get<BillingUser>('/me'));
      setStatus('authenticated');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setStatus('no-access');
      else throw err;
    }
  }, []);

  useEffect(() => {
    if (tokenStore.get()) loadMe().catch(() => endSession('expired'));
  }, [loadMe, endSession]);

  useEffect(() => {
    setUnauthorizedHandler(() => endSession('expired'));
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== tokenStore.key) return;
      if (!e.newValue) endSession('manual');
      else loadMe().catch(() => endSession('expired'));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [endSession, loadMe]);

  const logout = useCallback(async (reason: SignOutReason = 'manual') => {
    if (tokenStore.get() && reason !== 'expired') {
      await authApi.post(reason === 'timeout' ? '/api/auth/session-timeout' : '/api/auth/logout').catch(() => undefined);
    }
    endSession(reason);
  }, [endSession]);

  // Inactivity timeout, using the main application's configured window.
  useEffect(() => {
    if (status !== 'authenticated') return;
    let timeoutMs = 60 * 60_000;
    let warnTimer: number | undefined;
    let logoutTimer: number | undefined;
    let warned = false;
    let active = true;
    const schedule = () => {
      if (!active) return;
      window.clearTimeout(warnTimer);
      window.clearTimeout(logoutTimer);
      warned = false;
      warnTimer = window.setTimeout(() => {
        warned = true;
        showToast('You will be signed out in 1 minute due to inactivity.', 'warning', {
          duration: 60_000,
          action: { label: 'Stay signed in', onClick: schedule },
        });
      }, Math.max(0, timeoutMs - 60_000));
      logoutTimer = window.setTimeout(() => logout('timeout'), timeoutMs);
    };
    const onActivity = () => {
      if (!warned) schedule();
    };
    authApi.get<{ session_timeout_minutes: number }>('/api/auth/session-config')
      .then((cfg) => {
        if (cfg.session_timeout_minutes > 0) timeoutMs = cfg.session_timeout_minutes * 60_000;
      })
      .catch(() => undefined)
      .finally(schedule);
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      active = false;
      window.clearTimeout(warnTimer);
      window.clearTimeout(logoutTimer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [status, logout, showToast]);

  const value = useMemo<AuthValue>(() => {
    const granted = new Set(user?.permissions ?? []);
    return {
      status,
      user,
      signOutReason,
      can: (p) => granted.has(p),
      startLogin: (email, password) => authApi.post('/api/auth/login', { email, password }),
      verifyOtp: async (email, otp) => {
        const res = await authApi.post<{ access_token: string }>('/api/auth/verify-2fa', { email, otp });
        tokenStore.set(res.access_token);
        setSignOutReason(null);
        await loadMe();
      },
      resendOtp: async (email) => (await authApi.post<{ debug_otp: string | null }>('/api/auth/resend-2fa-otp', { email })).debug_otp,
      logout,
    };
  }, [status, user, signOutReason, loadMe, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}

function NoAccess() {
  const { logout } = useAuth();
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[420px] rounded-xl border border-border bg-surface p-7 text-center shadow-[var(--shadow-card)]">
        <h1 className="text-lg font-semibold text-text">No billing access</h1>
        <p className="mt-2 text-sm text-text-muted">
          You are signed in, but your account has not been given a billing role. Ask a billing admin to add you.
        </p>
        <button onClick={() => logout('manual')} className="mt-5 text-sm font-medium text-primary hover:underline">
          Sign in with a different account
        </button>
      </div>
    </main>
  );
}

export function RequireAuth() {
  const { status, signOutReason } = useAuth();
  const location = useLocation();
  if (status === 'checking') return <FullPageSpinner />;
  if (status === 'no-access') return <NoAccess />;
  if (status === 'unauthenticated') {
    const state = signOutReason === 'manual' ? undefined : { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'checking') return <FullPageSpinner />;
  if (status === 'authenticated' || status === 'no-access') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/dashboard'} replace />;
  }
  return <>{children}</>;
}

/** Route guard: shows the access-denied page when the permission is missing. */
export function RequirePermission({ permission, children }: { permission: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  const needed = Array.isArray(permission) ? permission : [permission];
  if (!needed.some(can)) return <AccessDenied />;
  return <>{children}</>;
}

export function AccessDenied() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-text-muted">403</p>
      <h1 className="mt-2 text-xl font-semibold text-text">Access denied</h1>
      <p className="mt-2 text-sm text-text-muted">Your billing role does not include this area.</p>
    </div>
  );
}
