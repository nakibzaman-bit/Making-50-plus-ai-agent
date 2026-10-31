import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { createServices, type ServiceOptions, type Services } from './services.js';
import { registerRoutes } from './api/routes.js';
import { WsHub } from './events/wsHub.js';
import { HttpError } from './util.js';
import { GitError } from './git/gitService.js';
import { seedTestLab } from './projects/testLab.js';
import { PermissionError } from './security/sandbox.js';

export interface App {
  http: FastifyInstance;
  services: Services;
  ws: WsHub;
  url: string;
  close(): Promise<void>;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Build and start the HTTP + WebSocket server. */
export async function startApp(opts: ServiceOptions & { port?: number; host?: string; serveStatic?: boolean; seed?: boolean } = {}): Promise<App> {
  const services = createServices(opts);
  const { config } = services;
  const http = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  const authToken = process.env.NEXUS_AUTH_TOKEN?.trim() || null;

  http.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    // CSRF / DNS-rebinding guard: browsers must come from the same origin.
    const origin = req.headers.origin;
    if (origin && MUTATING.has(req.method)) {
      let ok = false;
      try {
        ok = new URL(origin).host === req.headers.host;
      } catch {
        ok = false;
      }
      if (!ok) return reply.code(403).send({ error: 'Cross-origin request rejected' });
    }
    if (authToken && req.url !== '/api/health') {
      const header = req.headers.authorization ?? '';
      if (header !== `Bearer ${authToken}`) return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  http.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof PermissionError) return reply.code(403).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: err.message });
    if (err instanceof GitError) return reply.code(409).send({ error: err.message, detail: err.stderr.slice(0, 2000) });
    const e = err as Error & { statusCode?: number; validation?: unknown };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    if (/escapes the workspace|outside the workspace|not allowed/.test(e.message)) return reply.code(400).send({ error: e.message });
    console.error('[api]', err);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  registerRoutes(http, services);

  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
  const altWebDir = path.resolve(process.cwd(), 'dist/web');
  const staticDir = fs.existsSync(path.join(webDir, 'index.html')) ? webDir : altWebDir;
  if ((opts.serveStatic ?? config.production) && fs.existsSync(path.join(staticDir, 'index.html'))) {
    await http.register(fastifyStatic, { root: staticDir, wildcard: false });
    http.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  if (opts.seed ?? config.seedTestLab) await seedTestLab(services);

  await http.listen({ port: opts.port ?? config.port, host: opts.host ?? config.host });
  const ws = new WsHub(http.server, services.core.bus, authToken);
  services.orchestrator.start();
  const address = http.server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  const url = `http://${opts.host ?? config.host}:${port}`;

  return {
    http,
    services,
    ws,
    url,
    async close() {
      ws.close();
      await services.close();
      await http.close();
    },
  };
}
