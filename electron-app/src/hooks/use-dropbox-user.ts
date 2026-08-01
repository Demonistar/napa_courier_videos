/**
 * Electron version of use-dropbox-user.
 * Calls window.electronAPI.auth.getStatus() instead of an HTTP endpoint.
 * The interface matches the web app's version so TopBar + SettingsPanel work unchanged.
 */
import { useState, useEffect, useCallback } from 'react';

export interface DropboxUserInfo {
  connected: boolean;
  name?: string;
  email?: string;
  accountId?: string;
  connectedAt?: string;
  expiresAt?: string;
  needsReauth?: boolean;
  reason?: string;
}

export function useDropboxUser() {
  const [user, setUser] = useState<DropboxUserInfo>({ connected: false });
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const status = await window.electronAPI.auth.getStatus();
      if (status.authenticated && status.user) {
        setUser({
          connected: true,
          name: status.user.name,
          email: status.user.email,
          accountId: status.user.accountId,
          needsReauth: status.needsReauth ?? false,
        });
      } else {
        setUser({ connected: false });
      }
    } catch {
      setUser({ connected: false, reason: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await window.electronAPI.auth.logout();
    setUser({ connected: false });
  }, []);

  const refresh = useCallback(() => fetchUser(), [fetchUser]);

  useEffect(() => {
    fetchUser();
    // Re-check every 5 minutes
    const interval = setInterval(fetchUser, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchUser]);

  return { user, loading, disconnect, refresh };
}
