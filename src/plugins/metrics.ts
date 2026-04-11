import type { FastifyInstance } from 'fastify';
import {
  httpRequestsTotal,
  httpRequestDurationSeconds,
  registry,
} from '../modules/metrics/metrics.registry.js';

export default async function metricsPlugin(app: FastifyInstance) {
  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions?.url ?? request.url;

    if (route !== '/metrics' && route !== '/favicon.ico') {
      const labels = {
        method: request.method,
        route,
        status_code: String(reply.statusCode),
      };

      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, reply.elapsedTime / 1000);
    }

    done();
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', registry.contentType);
    return reply.send(await registry.metrics());
  });
}
