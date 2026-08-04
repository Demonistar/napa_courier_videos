import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import AdminDashboard from '@/pages/AdminDashboard';
import { LoginScreen } from '@/components/auth/LoginScreen';
import type { AuthStatus } from '../electron/preload';

type AppPhase = 'checking' | 'login' | 'app';

// Apply saved theme to <html> before first render to avoid flash.
// Also handles 'system' by reading the OS media query.
function applyThemeClass(theme: 'light' | 'dark' | 'system' = 'light') {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle(
    'dark',
    theme === 'dark' || (theme === 'system' && prefersDark),
  );
}

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('checking');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  // Load and apply the saved theme on first mount so the correct
  // colour scheme is in place before any content renders.
  useEffect(() => {
    window.electronAPI.settings.get().then((s) => applyThemeClass(s.theme));
  }, []);

  const checkAuth = async () => {
    try {
      const status = await window.electronAPI.auth.getStatus();
      setAuthStatus(status);
      setPhase(status.authenticated ? 'app' : 'login');
    } catch {
      setPhase('login');
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const handleLoginSuccess = (status: AuthStatus) => {
    setAuthStatus(status);
    setPhase('app');
  };

  const handleLogout = async () => {
    await window.electronAPI.auth.logout();
    setAuthStatus(null);
    setPhase('login');
  };

  if (phase === 'checking') {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Starting NAPA Courier Admin…</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      {phase === 'login' && (
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
      )}
      {phase === 'app' && (
        <AdminDashboard onLogout={handleLogout} initialUser={authStatus?.user?.name} />
      )}
      <Toaster />
    </TooltipProvider>
  );
}
