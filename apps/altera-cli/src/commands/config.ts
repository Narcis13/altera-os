import {
  CONFIG_PATH,
  getActiveProfile,
  loadConfig,
  saveConfig,
  setActiveProfile,
} from '../config.ts';

export async function configShow(): Promise<number> {
  const cfg = loadConfig();
  const profile = getActiveProfile(cfg);
  // Redact tokens when printing.
  console.log(
    JSON.stringify(
      {
        path: CONFIG_PATH,
        activeProfile: cfg.activeProfile,
        profile: {
          ...profile,
          accessToken: profile.accessToken ? '<redacted>' : null,
          refreshToken: profile.refreshToken ? '<redacted>' : null,
        },
      },
      null,
      2,
    ),
  );
  return 0;
}

export async function configSet(argv: string[]): Promise<number> {
  if (argv.length < 2) {
    console.error('Usage: altera config set <key> <value>');
    console.error('Keys: api-url, tenant, username');
    return 2;
  }
  const [key, value] = argv;
  const cfg = loadConfig();
  const profile = getActiveProfile(cfg);

  switch (key) {
    case 'api-url':
      profile.apiUrl = value!;
      break;
    case 'tenant':
      profile.tenantSlug = value!;
      break;
    case 'username':
      profile.username = value!;
      break;
    default:
      console.error(`Unknown config key: ${key}`);
      return 2;
  }

  setActiveProfile(cfg, profile);
  saveConfig(cfg);
  console.log(`Set ${key}=${value}`);
  return 0;
}
