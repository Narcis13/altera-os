# CLAUDE.md — Altera OS Developer Guide

Orientation for Claude Code agents (and humans) working in this repository.

## 1. What is this repo?

**Altera OS** is a Bun monorepo that unifies document ingest, EAV-backed knowledge,
agent runtime, and admin UI into a single deployable product. See the full spec in
`../alteramens/workshop/ideas/altera-os.md` (not checked in here — treat as external).

At this point (Sprint 1), only the foundation is in place:
- core infra packages (`@altera/core`, `@altera/db`, `@altera/auth`),
- HTTP server (`apps/altera-server`) with register/login/me routes,
- React 19 admin UI (`apps/altera-admin`) with login + dashboard,
- CLI (`apps/altera-cli`) with auth + config commands.

Subsequent sprints add events, ingest, sanitization, EAV, docraftr port, workflow engine,
and agent runtime.

## 2. Tech stack (do not deviate)

| Layer | Tool |
|---|---|
| Runtime | Bun ≥ 1.3 |
| Language | TypeScript strict (ESNext) |
| HTTP | Hono v4 |
| DB | SQLite (`bun:sqlite`) + Drizzle ORM |
| Validation | Zod |
| Frontend | React 19 + Vite + Tailwind v4 |
| Auth | `jose` (JWT) + `Bun.password` (argon2id) |
| Testing | `bun test`, co-located `*.test.ts` |
| Lint/format | Biome |

Do **not** introduce: npm/yarn/pnpm, Jest/Vitest (use `bun test`), bcrypt, axios, lodash.

## 3. Directory layout

```
altera-os/
├── apps/
│   ├── altera-server/          # Bun.serve + Hono API
│   ├── altera-admin/           # Vite + React 19 admin UI
│   └── altera-cli/             # `altera` CLI (bin.ts)
├── packages/@altera/
│   ├── core/                   # Shared Zod schemas, types, constants, errors
│   ├── db/                     # Drizzle schema, migrations, tenant scope
│   └── auth/                   # JWT, argon2, login/register, middleware
├── migrations/                 # *.sql files, applied in lexical order
├── data/                       # Dev SQLite lives here (gitignored)
├── scripts/                    # Dev orchestration
├── biome.json
├── bunfig.toml
├── tsconfig.base.json          # Extended by every package
├── tsconfig.json               # Root — only includes TS-server paths
├── package.json                # Bun workspaces root
└── .env.example
```

`apps/altera-admin` is **excluded** from the root tsconfig because Vite owns that
TS graph separately. Each workspace has its own `tsconfig.json` that extends
`tsconfig.base.json`.

## 4. First-time setup

```bash
git clone git@github.com:Narcis13/altera-os.git
cd altera-os
cp .env.example .env.local
bun install
bun run migrate          # apply migrations/*.sql to ./data/altera.db
bun run seed:dev         # create altera-dev tenant + admin user
bun run dev              # start altera-server on :4000
# In another terminal:
bun run admin:dev        # Vite dev server on :5173 (proxies /api to :4000)
```

Admin login: `tenant=altera-dev`, `user=admin`, `password=change-me-now-please`.

## 5. Daily workflow

### Run everything

```bash
bun run dev              # altera-server (:4000)
bun run admin:dev        # altera-admin (:5173, proxied)
bun run cli -- auth whoami
```

### Running the CLI locally

Without installing globally:
```bash
bun run apps/altera-cli/src/bin.ts auth login --api http://127.0.0.1:4000 --tenant altera-dev
```

Or compile a single binary:
```bash
bun run --filter 'altera-cli' build   # emits ./altera
./altera auth whoami
```

### Tests

```bash
bun test                             # all workspaces
bun test packages/@altera/auth       # one package
bun test --watch                     # watch mode
```

Tests are **co-located** (`*.test.ts` next to the code they cover). Keep them fast
and hermetic. For DB tests, use `mkdtempSync` + `runMigrations({ dbUrl, silent: true })`.

### Typecheck + lint

```bash
bunx tsc --noEmit        # root typecheck
bunx biome check .       # lint + format check
bunx biome check --write . # auto-fix
```

## 6. Adding a new package

1. Create `packages/@altera/<name>/` with:
   - `package.json` — `"name": "@altera/<name>"`, `"private": true`, `"type": "module"`, `"main": "./src/index.ts"`.
   - `tsconfig.json` — extend `../../../tsconfig.base.json`, `"include": ["src/**/*.ts"]`.
   - `src/index.ts` — barrel export.
2. Add the import path to `tsconfig.base.json`'s `paths` if you want short aliases.
3. Add it to dependencies of the consumer with `"@altera/<name>": "workspace:*"`.
4. Run `bun install` to link.
5. Add co-located `*.test.ts` files.

## 7. Commit conventions

Conventional Commits, aligned with takt/bunbase/docraftr history:

```
feat(auth): add refresh-token rotation
fix(db): cascade delete sessions when user removed
chore(deps): bump hono to 4.6.14
docs(claude): explain workspace layout
test(server): cover /api/me 401 shape
```

Scope = package or app short name (e.g., `core`, `db`, `auth`, `server`, `admin`, `cli`).

## 8. Multi-tenant rules (critical)

- Every domain table has `tenant_id`. No exceptions.
- Use `withTenant(db, tenantId)` from `@altera/db` to scope queries at dev-time.
- Hono middleware: `requireAuth` → `withTenant` populates `c.var.principal` and
  `c.var.tenantId`. Always use these — never trust a `tenant_id` from request body.
- Cross-tenant reads must fail loudly. Add tests for this as soon as a new resource
  is introduced.

## 9. Error shape

All JSON errors follow:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

Throw `AlteraError` subclasses (or helpers like `unauthorized()`, `notFound()`) from
`@altera/core`. The `errorHandler` middleware in `altera-server` converts them to
JSON responses with the right HTTP status.

## 10. What's NOT yet here (and why)

Tracked in the spec (`altera-os.md`), Sprint 2+:

| Missing | Coming in |
|---|---|
| `@altera/events` (EventBus, SSE, WS) | Sprint 2 |
| `@altera/ingest` (PDF/DOCX/XLSX/CSV parsers) | Sprint 3 |
| `@altera/sanitize` (PII detection) | Sprint 4 |
| `@altera/eav` (entities + attributes + FTS5) | Sprint 5 |
| `@altera/docs` (docraftr port) | Sprint 6 |
| `@altera/flows` (glyphrail workflow engine) | Sprint 6 |
| `@altera/agent` (robun port) | Sprint 7 |

Do not stub these in advance. Do not add speculative abstractions.

## 11. House style

- **No emojis** in code or commit messages.
- **No comments** that restate what code does. Only "why" comments for non-obvious
  invariants or workarounds.
- Prefer `type` imports (`import type { X } from ...`) when only used as types.
- Prefer Zod at boundaries (request bodies, env, external JSON). Don't re-validate
  trusted internal data.
- Password policy: min 12 chars, argon2id (via `Bun.password`).
- Never log passwords, tokens, or PII. The request logger redacts nothing currently —
  don't add log lines that include request bodies.

## 12. Links

- Full spec: `../alteramens/workshop/ideas/altera-os.md`
- Sprint plan: same doc, § 8 Phase 1 — Detailed Task Breakdown
- Upstream projects (for porting): docraftr, takt, bunbase, robun, glyphrail, faber.
  Fetch with `scripts/fetch-sources.sh` (see spec § 16) when needed; output is gitignored.
