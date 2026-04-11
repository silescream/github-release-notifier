import type { FastifyInstance } from 'fastify';
import { config } from '../config/env.js';

const PROTECTED_ROUTES: Array<{ method: string; url: RegExp }> = [
  { method: 'GET', url: /^\/api\/subscriptions/ },
];

export default async function apiKeyAuth(fastify: FastifyInstance) {
  if (!config.apiKey) return;

  fastify.addHook('onRequest', async (request, reply) => {
    const isProtected = PROTECTED_ROUTES.some(
      (route) => route.method === request.method && route.url.test(request.url),
    );

    if (!isProtected) return;

    const key = request.headers['x-api-key'];
    if (key !== config.apiKey) {
      reply.code(401).send({ error: 'Invalid or missing API key' });
    }
  });
}
