import * as api from '../api-client.ts';
import { getActiveProfile, loadConfig, saveConfig, setActiveProfile } from '../config.ts';
import { prompt, promptHidden } from '../prompts.ts';

export async function authLogin(argv: string[]): Promise<number> {
  const cfg = loadConfig();
  const profile = getActiveProfile(cfg);

  const args = parseArgs(argv);
  const apiUrl = args.apiUrl ?? profile.apiUrl ?? 'http://127.0.0.1:4000';
  const tenantSlug =
    args.tenantSlug ?? profile.tenantSlug ?? (await prompt('Tenant slug: ')).trim();
  const username = args.username ?? profile.username ?? (await prompt('Username: ')).trim();
  const password = args.password ?? (await promptHidden('Password: '));

  try {
    const res = await api.login(apiUrl, {
      tenantSlug,
      usernameOrEmail: username,
      password,
    });

    setActiveProfile(cfg, {
      ...profile,
      apiUrl,
      tenantSlug,
      username: res.user.username,
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      accessExpiresAt: res.accessExpiresAt,
      refreshExpiresAt: res.refreshExpiresAt,
    });
    saveConfig(cfg);

    console.log(`Logged in as ${res.user.username} @ ${tenantSlug} (${apiUrl}).`);
    return 0;
  } catch (e) {
    console.error(`Login failed: ${(e as Error).message}`);
    return 1;
  }
}

export async function authLogout(): Promise<number> {
  const cfg = loadConfig();
  const profile = getActiveProfile(cfg);

  if (!profile.refreshToken) {
    console.log('Not logged in.');
    return 0;
  }
  try {
    await api.logout(profile.apiUrl, profile.refreshToken);
  } catch (e) {
    // Logout is best-effort; local state is cleared regardless.
    console.warn(`Server logout failed (cleared local state): ${(e as Error).message}`);
  }
  setActiveProfile(cfg, {
    ...profile,
    accessToken: null,
    refreshToken: null,
    accessExpiresAt: null,
    refreshExpiresAt: null,
  });
  saveConfig(cfg);
  console.log('Logged out.');
  return 0;
}

export async function authWhoAmI(): Promise<number> {
  const cfg = loadConfig();
  const profile = getActiveProfile(cfg);
  if (!profile.accessToken) {
    console.log('Not logged in.');
    return 1;
  }
  try {
    const res = await api.me(profile.apiUrl, profile.accessToken);
    console.log(
      JSON.stringify(
        {
          apiUrl: profile.apiUrl,
          tenantSlug: res.tenantSlug,
          user: res.user,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (e) {
    console.error(`whoami failed: ${(e as Error).message}`);
    return 1;
  }
}

interface ParsedArgs {
  apiUrl?: string;
  tenantSlug?: string;
  username?: string;
  password?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--api':
      case '--api-url':
        if (next) out.apiUrl = next;
        i++;
        break;
      case '--tenant':
        if (next) out.tenantSlug = next;
        i++;
        break;
      case '--user':
      case '--username':
        if (next) out.username = next;
        i++;
        break;
      case '--password':
        if (next) out.password = next;
        i++;
        break;
    }
  }
  return out;
}
