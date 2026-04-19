#!/usr/bin/env bun
import { authLogin, authLogout, authWhoAmI } from './commands/auth.ts';
import { configSet, configShow } from './commands/config.ts';
import { entityList, entityShow, ingestFile } from './commands/ingest.ts';

const USAGE = `altera — Altera OS CLI

Usage:
  altera auth login [--api URL] [--tenant SLUG] [--user NAME] [--password PASS]
  altera auth logout
  altera auth whoami
  altera config show
  altera config set <key> <value>
  altera ingest <file>
  altera entity list [--limit N] [--offset N]
  altera entity show <entity-id>
  altera --help
  altera --version

Config is stored at ~/.altera/config.json (0600).
`;

const VERSION = '0.1.0';

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    console.log(VERSION);
    return 0;
  }

  const [cmd, sub, ...rest] = argv;

  switch (cmd) {
    case 'auth':
      switch (sub) {
        case 'login':
          return authLogin(rest);
        case 'logout':
          return authLogout();
        case 'whoami':
          return authWhoAmI();
        default:
          console.error(`Unknown auth subcommand: ${sub ?? '<none>'}`);
          console.error(USAGE);
          return 2;
      }
    case 'config':
      switch (sub) {
        case 'show':
          return configShow();
        case 'set':
          return configSet(rest);
        default:
          console.error(`Unknown config subcommand: ${sub ?? '<none>'}`);
          console.error(USAGE);
          return 2;
      }
    case 'ingest':
      return ingestFile(sub ? [sub, ...rest] : rest);
    case 'entity':
      switch (sub) {
        case 'list':
          return entityList(rest);
        case 'show':
          return entityShow(rest);
        default:
          console.error(`Unknown entity subcommand: ${sub ?? '<none>'}`);
          console.error(USAGE);
          return 2;
      }
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error(USAGE);
      return 2;
  }
}

const args = process.argv.slice(2);
main(args).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
