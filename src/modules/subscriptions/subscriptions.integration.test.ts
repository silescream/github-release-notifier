import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

import { buildApp } from '../../app.js';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

const mockFetch = jest.fn();
const originalFetch = global.fetch;

function mockGitHub({ exists = true }: { exists?: boolean } = {}) {
  mockFetch.mockResolvedValue({
    status: exists ? 200 : 404,
    json: async () => ({}),
    headers: { get: () => null },
  });
}

const prisma = new PrismaClient();
let app: FastifyInstance;

beforeAll(async () => {
  global.fetch = mockFetch;
  await prisma.$connect();
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  global.fetch = originalFetch;
});

beforeEach(async () => {
  await prisma.subscription.deleteMany();
  mockGitHub({ exists: true });
});

async function inject(method: 'GET' | 'POST', url: string, options: { body?: Record<string, string>; query?: Record<string, string> } = {}) {
  return app.inject({
    method,
    url,
    ...(options.body
      ? {
          payload: new URLSearchParams(options.body).toString(),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        }
      : {}),
    ...(options.query ? { query: options.query } : {}),
  });
}

describe('POST /api/subscribe', () => {
  it('returns 200 and creates unconfirmed subscription', async () => {
    const res = await inject('POST', '/api/subscribe', { body: { email: 'user@example.com', repo: 'facebook/react' } });

    expect(res.statusCode).toBe(200);

    const sub = await prisma.subscription.findUnique({
      where: { email_repo: { email: 'user@example.com', repo: 'facebook/react' } },
    });
    expect(sub).not.toBeNull();
    expect(sub!.confirmed).toBe(false);
  });

  it('returns 400 on invalid email', async () => {
    const res = await inject('POST', '/api/subscribe', { body: { email: 'bad', repo: 'facebook/react' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on invalid repo format', async () => {
    const res = await inject('POST', '/api/subscribe', { body: { email: 'user@example.com', repo: 'nodotslash' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when repo does not exist on GitHub', async () => {
    mockGitHub({ exists: false });
    const res = await inject('POST', '/api/subscribe', { body: { email: 'user@example.com', repo: 'owner/missing-repo' } });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 on duplicate subscription', async () => {
    await inject('POST', '/api/subscribe', { body: { email: 'user@example.com', repo: 'facebook/react' } });
    const res = await inject('POST', '/api/subscribe', { body: { email: 'user@example.com', repo: 'facebook/react' } });
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /api/confirm/:token', () => {
  it('confirms subscription with valid token', async () => {
    await inject('POST', '/api/subscribe', { body: { email: 'user@example.com', repo: 'facebook/react' } });

    const sub = await prisma.subscription.findUnique({
      where: { email_repo: { email: 'user@example.com', repo: 'facebook/react' } },
    });

    const res = await inject('GET', `/api/confirm/${sub!.confirmToken}`);
    expect(res.statusCode).toBe(200);

    const updated = await prisma.subscription.findUnique({ where: { id: sub!.id } });
    expect(updated!.confirmed).toBe(true);
  });

  it('returns 400 on invalid token format', async () => {
    const res = await inject('GET', '/api/confirm/short');
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 on unknown token', async () => {
    const res = await inject('GET', `/api/confirm/${'a'.repeat(64)}`);
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/unsubscribe/:token', () => {
  it('deletes subscription with valid token', async () => {
    await inject('POST', '/api/subscribe', { body: { email: 'user@example.com', repo: 'facebook/react' } });

    const sub = await prisma.subscription.findUnique({
      where: { email_repo: { email: 'user@example.com', repo: 'facebook/react' } },
    });

    const res = await inject('GET', `/api/unsubscribe/${sub!.unsubscribeToken}`);
    expect(res.statusCode).toBe(200);

    const deleted = await prisma.subscription.findUnique({ where: { id: sub!.id } });
    expect(deleted).toBeNull();
  });

  it('returns 400 on invalid token format', async () => {
    const res = await inject('GET', '/api/unsubscribe/bad');
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 on unknown token', async () => {
    const res = await inject('GET', `/api/unsubscribe/${'b'.repeat(64)}`);
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/subscriptions', () => {
  it('returns confirmed subscriptions for email', async () => {
    await inject('POST', '/api/subscribe', { body: { email: 'user@example.com', repo: 'facebook/react' } });

    const sub = await prisma.subscription.findUnique({
      where: { email_repo: { email: 'user@example.com', repo: 'facebook/react' } },
    });
    await prisma.subscription.update({ where: { id: sub!.id }, data: { confirmed: true } });

    const res = await inject('GET', '/api/subscriptions', { query: { email: 'user@example.com' } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ email: 'user@example.com', repo: 'facebook/react', confirmed: true });
  });

  it('does not return unconfirmed subscriptions', async () => {
    await inject('POST', '/api/subscribe', { body: { email: 'user@example.com', repo: 'facebook/react' } });

    const res = await inject('GET', '/api/subscriptions', { query: { email: 'user@example.com' } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });

  it('returns 400 on invalid email', async () => {
    const res = await inject('GET', '/api/subscriptions', { query: { email: 'bad' } });
    expect(res.statusCode).toBe(400);
  });
});
