#!/usr/bin/env bun
/**
 * Dev seed: creates a demo tenant + admin user. Idempotent.
 */
import { and, eq } from 'drizzle-orm';
import { createDb } from './client.ts';
import { newId } from './ids.ts';
import { runMigrations } from './migrate.ts';
import { tenants, users } from './schema/index.ts';

async function main() {
  runMigrations({ silent: false });

  const { db, sqlite } = createDb();

  const { hashPassword } = ((await import('@altera/auth').catch(() => null)) as {
    hashPassword?: (p: string) => Promise<string>;
  } | null) ?? { hashPassword: undefined };

  const hasher =
    hashPassword ?? (async (p: string) => `PLAINTEXT:${p}`) /* @altera/auth not built yet */;

  const existing = db.select().from(tenants).where(eq(tenants.slug, 'altera-dev')).all();

  let tenantId: string;
  if (existing.length === 0) {
    tenantId = newId('tenant');
    db.insert(tenants)
      .values({
        id: tenantId,
        name: 'Altera Dev',
        slug: 'altera-dev',
        settingsJson: '{}',
        createdAt: new Date(),
      })
      .run();
    console.log(`[seed] Created tenant ${tenantId} (altera-dev)`);
  } else {
    tenantId = existing[0]!.id;
    console.log(`[seed] Tenant altera-dev exists: ${tenantId}`);
  }

  const admin = db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.username, 'admin')))
    .all();

  if (admin.length === 0) {
    const userId = newId('user');
    const passwordHash = await hasher('change-me-now-please');
    db.insert(users)
      .values({
        id: userId,
        tenantId,
        username: 'admin',
        email: 'admin@altera.local',
        passwordHash,
        role: 'admin',
        createdAt: new Date(),
      })
      .run();
    console.log(`[seed] Created admin user ${userId} (admin / change-me-now-please)`);
  } else {
    console.log('[seed] Admin user exists.');
  }

  sqlite.close();
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });
}
