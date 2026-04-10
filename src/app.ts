import Fastify from 'fastify';
import subscriptionsRouter from './modules/subscriptions/subscriptions.router.js';

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.register(subscriptionsRouter, { prefix: '/api' });

  return app;
}
