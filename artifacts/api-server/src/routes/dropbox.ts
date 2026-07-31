import { Router } from 'express';
import { ReplitConnectors } from '@replit/connectors-sdk';

const router = Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const WARN_WITHIN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /auth/dropbox/user
 * Returns the connected Dropbox account's display name + email.
 * Caches in the server-side session for up to 30 days, then requires reauth.
 */
router.get('/auth/dropbox/user', async (req, res): Promise<void> => {
  // Force-clear the session cache if caller wants a fresh fetch
  if (req.query.force === 'true') {
    delete req.session.dropboxUser;
    delete req.session.dropboxConnectedAt;
  }

  // Serve from session cache if still fresh
  if (req.session.dropboxUser && req.session.dropboxConnectedAt) {
    const connectedAt = new Date(req.session.dropboxConnectedAt).getTime();
    const now = Date.now();
    const age = now - connectedAt;

    if (age < THIRTY_DAYS_MS) {
      const expiresAt = new Date(connectedAt + THIRTY_DAYS_MS).toISOString();
      const needsReauth = now + WARN_WITHIN_DAYS_MS > connectedAt + THIRTY_DAYS_MS;
      res.json({
        connected: true,
        name: req.session.dropboxUser.displayName,
        email: req.session.dropboxUser.email,
        accountId: req.session.dropboxUser.accountId,
        connectedAt: req.session.dropboxConnectedAt,
        expiresAt,
        needsReauth,
      });
      return;
    }

    // Session older than 30 days — clear it and re-verify below
    delete req.session.dropboxUser;
    delete req.session.dropboxConnectedAt;
    req.log.info('Dropbox session expired after 30 days, clearing cache');
  }

  // No session — try to fetch live from Dropbox via the connector
  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy('dropbox', '/2/users/get_current_account', {
      method: 'POST',
    });

    if (!response.ok) {
      req.log.warn({ status: response.status }, 'Dropbox connector returned non-OK');
      res.json({ connected: false, reason: 'not_connected' });
      return;
    }

    const account = (await response.json()) as {
      account_id: string;
      name: { display_name: string };
      email: string;
    };

    req.session.dropboxUser = {
      accountId: account.account_id,
      displayName: account.name.display_name,
      email: account.email,
    };
    req.session.dropboxConnectedAt = new Date().toISOString();

    const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

    req.log.info({ email: account.email }, 'Dropbox user connected');
    res.json({
      connected: true,
      name: account.name.display_name,
      email: account.email,
      accountId: account.account_id,
      connectedAt: req.session.dropboxConnectedAt,
      expiresAt,
      needsReauth: false,
    });
  } catch (err) {
    req.log.warn({ err }, 'Dropbox connector unavailable or not authorized');
    res.json({ connected: false, reason: 'not_connected' });
  }
});

/**
 * POST /auth/dropbox/disconnect
 * Clears the cached Dropbox identity from the session.
 */
router.post('/auth/dropbox/disconnect', async (req, res): Promise<void> => {
  delete req.session.dropboxUser;
  delete req.session.dropboxConnectedAt;
  req.log.info('Dropbox session disconnected');
  res.json({ success: true });
});

export default router;
