import Fastify from 'fastify';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

jest.mock('../config/env.js', () => ({
  config: { apiKey: 'test-secret' },
}));

import apiKeyAuth from './apiKeyAuth.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(fp(apiKeyAuth));
  app.get('/api/subscriptions', async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));
  app.post('/api/subscribe', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('apiKeyAuth plugin', () => {
  describe('when API_KEY is configured', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp();
    });

    afterAll(() => app.close());

    it('returns 200 on GET /api/subscriptions with valid API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/subscriptions',
        headers: { 'x-api-key': 'test-secret' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 401 on GET /api/subscriptions with invalid API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/subscriptions',
        headers: { 'x-api-key': 'wrong-key' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Invalid or missing API key' });
    });

    it('returns 401 on GET /api/subscriptions when API key header is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/subscriptions' });
      expect(res.statusCode).toBe(401);
    });

    it('does not protect GET /health', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    });

    it('does not protect POST /api/subscribe', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/subscribe' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('when API_KEY is not configured', () => {
    it('does not protect GET /api/subscriptions', async () => {
      jest.resetModules();
      jest.doMock('../config/env.js', () => ({ config: { apiKey: undefined } }));

      const { default: Fastify } = await import('fastify');
      const { default: fp } = await import('fastify-plugin');
      const { default: plugin } = await import('./apiKeyAuth.js');

      const app = Fastify({ logger: false });
      app.register(fp(plugin));
      app.get('/api/subscriptions', async () => ({ ok: true }));
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/api/subscriptions' });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });
});
