import { Router } from 'express';
import { readSettings, writeSettings } from '../lib/settings-store';

const router = Router();

/**
 * GET /settings
 * Returns current app settings (dropboxFolderUrl, etc.)
 */
router.get('/settings', async (_req, res): Promise<void> => {
  const settings = readSettings();
  res.json(settings);
});

/**
 * PATCH /settings
 * Updates one or more settings fields.
 */
router.patch('/settings', async (req, res): Promise<void> => {
  const { dropboxFolderUrl } = req.body as { dropboxFolderUrl?: unknown };

  if (dropboxFolderUrl !== undefined && typeof dropboxFolderUrl !== 'string') {
    res.status(400).json({ error: 'dropboxFolderUrl must be a string' });
    return;
  }

  const patch: Partial<Parameters<typeof writeSettings>[0]> = {};
  if (dropboxFolderUrl !== undefined) patch.dropboxFolderUrl = dropboxFolderUrl;

  const updated = writeSettings(patch);
  res.json(updated);
});

export default router;
