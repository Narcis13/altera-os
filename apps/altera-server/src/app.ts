import { AnthropicProvider, ClassifySubscriber } from '@altera/agent';
import type { JwtConfig } from '@altera/auth';
import type { AlteraDb } from '@altera/db';
import {
  ActivitySubscriber,
  EventBus,
  SseManager,
  WsManager,
} from '@altera/events';
import { IngestWorker } from '@altera/ingest';
import { Hono } from 'hono';
import type { ServerConfig } from './config.ts';
import { errorHandler } from './middleware/error.ts';
import { corsMiddleware, requestLogger } from './middleware/logging.ts';
import { authRoutes } from './routes/auth.ts';
import { docsRoutes } from './routes/docs.ts';
import { entitiesRoutes } from './routes/entities.ts';
import { taxonomyRoutes } from './routes/taxonomy.ts';
import { eventsRoutes } from './routes/events.ts';
import { filesRoutes } from './routes/files.ts';
import { flowsRoutes } from './routes/flows.ts';
import { healthRoutes } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';

export interface BuildAppDeps {
  db: AlteraDb;
  config: ServerConfig;
}

export interface BuiltApp {
  app: Hono;
  bus: EventBus;
  activity: ActivitySubscriber;
  sse: SseManager;
  ws: WsManager;
  ingest: IngestWorker;
  classify: ClassifySubscriber | null;
}

export function buildApp(deps: BuildAppDeps): Hono {
  return buildAppWithBus(deps).app;
}

export function buildAppWithBus(deps: BuildAppDeps): BuiltApp {
  const app = new Hono();

  const jwt: JwtConfig = {
    secret: deps.config.jwtSecret,
    accessTtlSec: deps.config.jwtAccessTtlSec,
    refreshTtlSec: deps.config.jwtRefreshTtlSec,
  };

  const bus = new EventBus({ db: deps.db, persist: true });
  const activity = new ActivitySubscriber({ db: deps.db, bus });
  activity.start();
  const sse = new SseManager(bus);
  sse.start();
  const ws = new WsManager(bus);
  ws.start();
  const ingest = new IngestWorker({
    db: deps.db,
    bus,
    dataDir: deps.config.dataDir,
  });
  ingest.start();

  let classify: ClassifySubscriber | null = null;
  const anthropic = deps.config.anthropic;
  if (anthropic?.enabled && anthropic.apiKey) {
    const provider = new AnthropicProvider({
      apiKey: anthropic.apiKey,
      defaultModel: anthropic.model,
    });
    classify = new ClassifySubscriber({
      db: deps.db,
      bus,
      provider,
      model: anthropic.model,
    });
    classify.start();
  }

  app.use('*', requestLogger());
  app.use('*', corsMiddleware(deps.config.corsOrigins));

  app.route('/api/health', healthRoutes());
  app.route('/api/auth', authRoutes({ db: deps.db, jwt }));
  app.route('/api/me', meRoutes({ db: deps.db, jwt }));
  app.route('/api/events', eventsRoutes({ db: deps.db, jwt, bus, sse }));
  app.route(
    '/api/files',
    filesRoutes({
      db: deps.db,
      jwt,
      bus,
      dataDir: deps.config.dataDir,
      maxUploadBytes: deps.config.maxUploadBytes,
    }),
  );
  app.route('/api/entities', entitiesRoutes({ db: deps.db, jwt }));
  app.route('/api/taxonomy', taxonomyRoutes({ db: deps.db, jwt }));
  app.route('/api/docs', docsRoutes({ db: deps.db, jwt }));
  app.route('/api/flows', flowsRoutes({ db: deps.db, jwt, anthropic }));

  app.notFound((c) =>
    c.json(
      { error: { code: 'NOT_FOUND', message: `No route ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );
  app.onError(errorHandler);

  return { app, bus, activity, sse, ws, ingest, classify };
}
