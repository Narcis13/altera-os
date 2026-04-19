import { readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import * as api from '../api-client.ts';
import { getActiveProfile, loadConfig } from '../config.ts';

function requireAuth(): { apiUrl: string; accessToken: string } | null {
  const cfg = loadConfig();
  const profile = getActiveProfile(cfg);
  if (!profile.accessToken) {
    console.error('Not logged in. Run: altera auth login');
    return null;
  }
  return { apiUrl: profile.apiUrl, accessToken: profile.accessToken };
}

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.json': 'application/json',
};

function guessMime(path: string): string {
  const ext = extname(path).toLowerCase();
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

async function pollEntity(
  apiUrl: string,
  accessToken: string,
  fileId: string,
  timeoutMs: number,
): Promise<api.EntityListItem | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api.listEntities(apiUrl, accessToken, { limit: 50, offset: 0 });
    const match = res.entities.find((e) => e.sourceFileId === fileId);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

export async function ingestFile(argv: string[]): Promise<number> {
  const auth = requireAuth();
  if (!auth) return 1;

  const path = argv[0];
  if (!path) {
    console.error('Usage: altera ingest <file>');
    return 2;
  }
  const abs = resolve(path);
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(abs);
  } catch {
    console.error(`File not found: ${abs}`);
    return 1;
  }
  if (!stat.isFile()) {
    console.error(`Not a regular file: ${abs}`);
    return 1;
  }

  const data = new Uint8Array(readFileSync(abs));
  const filename = basename(abs);
  const mimeType = guessMime(abs);

  try {
    const uploaded = await api.uploadFile(auth.apiUrl, auth.accessToken, {
      filename,
      data,
      mimeType,
    });
    console.log(`Uploaded: ${uploaded.id} (${uploaded.mimeType}, ${uploaded.sizeBytes} bytes)`);

    const entity = await pollEntity(auth.apiUrl, auth.accessToken, uploaded.id, 5000);
    if (entity) {
      console.log(`Entity:   ${entity.id} (status=${entity.status})`);
    } else {
      console.log('Entity:   (not created yet — worker may still be running)');
    }
    return 0;
  } catch (e) {
    console.error(`Ingest failed: ${(e as Error).message}`);
    return 1;
  }
}

export async function entityList(argv: string[]): Promise<number> {
  const auth = requireAuth();
  if (!auth) return 1;

  const args = parseIntFlags(argv);
  try {
    const res = await api.listEntities(auth.apiUrl, auth.accessToken, args);
    if (res.entities.length === 0) {
      console.log('(no entities)');
      return 0;
    }
    for (const e of res.entities) {
      const name = e.name ?? '(unnamed)';
      console.log(
        `${e.id}  status=${e.status}  type=${e.entityType ?? '-'}  ${name}  ${e.ingestedAt}`,
      );
    }
    return 0;
  } catch (e) {
    console.error(`entity list failed: ${(e as Error).message}`);
    return 1;
  }
}

export async function entityShow(argv: string[]): Promise<number> {
  const auth = requireAuth();
  if (!auth) return 1;

  const id = argv[0];
  if (!id) {
    console.error('Usage: altera entity show <entity-id>');
    return 2;
  }

  try {
    const res = await api.getEntity(auth.apiUrl, auth.accessToken, id);
    console.log(JSON.stringify(res, null, 2));
    return 0;
  } catch (e) {
    console.error(`entity show failed: ${(e as Error).message}`);
    return 1;
  }
}

function parseIntFlags(argv: string[]): { limit?: number; offset?: number } {
  const out: { limit?: number; offset?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if ((a === '--limit' || a === '-n') && next) {
      out.limit = Number.parseInt(next, 10);
      i++;
    } else if (a === '--offset' && next) {
      out.offset = Number.parseInt(next, 10);
      i++;
    }
  }
  return out;
}
