import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fp from 'fastify-plugin';
import subscriptionsRouter from './modules/subscriptions/subscriptions.router.js';
import apiKeyAuth from './plugins/apiKeyAuth.js';

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(formbody);
  app.register(fp(apiKeyAuth));

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.register(subscriptionsRouter, { prefix: '/api' });

  return app;
}
