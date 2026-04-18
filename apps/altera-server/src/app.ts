import type { JwtConfig } from '@altera/auth';
import type { AlteraDb } from '@altera/db';
import { Hono } from 'hono';
import type { ServerConfig } from './config.ts';
import { errorHandler } from './middleware/error.ts';
import { corsMiddleware, requestLogger } from './middleware/logging.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoutes } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';

export interface BuildAppDeps {
  db: AlteraDb;
  config: ServerConfig;
}

export function buildApp(deps: BuildAppDeps): Hono {
  const app = new Hono();

  const jwt: JwtConfig = {
    secret: deps.config.jwtSecret,
    accessTtlSec: deps.config.jwtAccessTtlSec,
    refreshTtlSec: deps.config.jwtRefreshTtlSec,
  };

  app.use('*', requestLogger());
  app.use('*', corsMiddleware(deps.config.corsOrigins));

  app.route('/api/health', healthRoutes());
  app.route('/api/auth', authRoutes({ db: deps.db, jwt }));
  app.route('/api/me', meRoutes({ db: deps.db, jwt }));

  app.notFound((c) =>
    c.json(
      { error: { code: 'NOT_FOUND', message: `No route ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );
  app.onError(errorHandler);

  return app;
}
