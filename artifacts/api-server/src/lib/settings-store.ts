import fs from 'fs';
import path from 'path';
import { logger } from './logger';

export interface Settings {
  dropboxFolderUrl: string;
  // Future fields can be added here without restructuring
}

const defaultSettings: Settings = {
  dropboxFolderUrl: '',
};

const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readSettings(): Settings {
  try {
    ensureDataDir();
    if (!fs.existsSync(SETTINGS_FILE)) {
      return { ...defaultSettings };
    }
    const content = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return { ...defaultSettings, ...JSON.parse(content) };
  } catch (err) {
    logger.warn({ err }, 'Failed to read settings file, using defaults');
    return { ...defaultSettings };
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  try {
    ensureDataDir();
    const current = readSettings();
    const updated: Settings = { ...current, ...patch };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  } catch (err) {
    logger.warn({ err }, 'Failed to write settings file');
    return readSettings();
  }
}
