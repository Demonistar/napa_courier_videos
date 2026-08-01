import { useState } from 'react';
import { Cloud, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AuthStatus } from '../../../electron/preload';

interface LoginScreenProps {
  onLoginSuccess: (status: AuthStatus) => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleLogin = async () => {
    setPhase('waiting');
    setErrorMessage('');

    try {
      const result = await window.electronAPI.auth.login();

      if (result.ok && result.user) {
        onLoginSuccess({
          authenticated: true,
          user: result.user,
          needsReauth: false,
          authAge: 0,
        });
      } else {
        setPhase('error');
        setErrorMessage(
          result.error ?? 'Sign-in failed. Please try again.',
        );
      }
    } catch (err: unknown) {
      setPhase('error');
      setErrorMessage((err as Error).message ?? 'Unexpected error during sign-in.');
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="w-full max-w-sm space-y-8 p-8">
        {/* Logo / brand */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-1.5 h-10 bg-primary rounded-full" />
            <h1 className="text-2xl font-semibold text-foreground">NAPA Courier Admin</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Location management for courier delivery staff
          </p>
        </div>

        {/* Sign-in card */}
        <div className="border rounded-xl p-6 bg-card space-y-5">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">Sign in to continue</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Your location data is stored in a shared Dropbox folder. Sign in with your
              Dropbox account to access and edit it.
            </p>
          </div>

          {phase === 'waiting' ? (
            <div className="space-y-3 text-center py-2">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
              <p className="text-sm font-medium text-foreground">
                Waiting for Dropbox sign-in…
              </p>
              <p className="text-xs text-muted-foreground">
                A browser window opened. Complete sign-in there, then return here.
              </p>
            </div>
          ) : (
            <Button
              onClick={handleLogin}
              className="w-full"
              size="lg"
            >
              <Cloud className="w-4 h-4 mr-2" />
              Sign in with Dropbox
            </Button>
          )}

          {phase === 'error' && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-xs text-destructive">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Your Dropbox password is never seen by this app.
          <br />
          Sign-in happens securely in your web browser.
        </p>
      </div>
    </div>
  );
}
