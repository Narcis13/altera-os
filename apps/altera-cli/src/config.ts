import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CliProfile {
  apiUrl: string;
  tenantSlug: string | null;
  username: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
}

export interface CliConfig {
  activeProfile: string;
  profiles: Record<string, CliProfile>;
}

export const CONFIG_PATH = join(homedir(), '.altera', 'config.json');

export const DEFAULT_PROFILE: CliProfile = {
  apiUrl: 'http://127.0.0.1:4000',
  tenantSlug: null,
  username: null,
  accessToken: null,
  refreshToken: null,
  accessExpiresAt: null,
  refreshExpiresAt: null,
};

export function loadConfig(): CliConfig {
  if (!existsSync(CONFIG_PATH)) {
    return {
      activeProfile: 'default',
      profiles: { default: { ...DEFAULT_PROFILE } },
    };
  }
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as CliConfig;
    if (!parsed.profiles || !parsed.profiles[parsed.activeProfile]) {
      return {
        activeProfile: 'default',
        profiles: { default: { ...DEFAULT_PROFILE } },
      };
    }
    return parsed;
  } catch {
    return {
      activeProfile: 'default',
      profiles: { default: { ...DEFAULT_PROFILE } },
    };
  }
}

export function saveConfig(cfg: CliConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function getActiveProfile(cfg: CliConfig): CliProfile {
  return cfg.profiles[cfg.activeProfile] ?? { ...DEFAULT_PROFILE };
}

export function setActiveProfile(cfg: CliConfig, profile: CliProfile): void {
  cfg.profiles[cfg.activeProfile] = profile;
}
