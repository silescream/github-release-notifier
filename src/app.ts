import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import subscriptionsRouter from './modules/subscriptions/subscriptions.router.js';

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(formbody);

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.register(subscriptionsRouter, { prefix: '/api' });

  return app;
}
