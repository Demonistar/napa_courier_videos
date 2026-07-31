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

  const fetchUser = useCallback(async (force = false) => {
    try {
      const url = force ? '/api/auth/dropbox/user?force=true' : '/api/auth/dropbox/user';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        setUser({ connected: false, reason: 'error' });
        return;
      }
      const data: DropboxUserInfo = await res.json();
      setUser(data);
    } catch {
      setUser({ connected: false, reason: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await fetch('/api/auth/dropbox/disconnect', {
        method: 'POST',
        credentials: 'include',
      });
      setUser({ connected: false });
    } catch {
      // ignore
    }
  }, []);

  const refresh = useCallback(() => fetchUser(true), [fetchUser]);

  useEffect(() => {
    fetchUser();
    // Re-check every 5 minutes in case the session changed server-side
    const interval = setInterval(() => fetchUser(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchUser]);

  return { user, loading, disconnect, refresh };
}
