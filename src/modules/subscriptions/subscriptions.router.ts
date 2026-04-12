import type { FastifyInstance, FastifyReply } from 'fastify';
import { subscriptionService, ServiceError } from './subscriptions.service.js';
import { RateLimitError } from '../github/github.client.js';

function handleError(err: unknown, reply: FastifyReply): void {
  if (err instanceof ServiceError) {
    reply.code(err.status).send({ error: err.message, code: err.code });
    return;
  }

  if (err instanceof RateLimitError) {
    reply
      .code(503)
      .header('Retry-After', String(err.retryAfter))
      .send({ error: 'GitHub API rate limit exceeded, try again later' });
    return;
  }

  reply.code(500).send({ error: 'Internal server error' });
}

export default async function subscriptionsRouter(fastify: FastifyInstance) {
  fastify.post<{ Body: { email: string; repo: string } }>(
    '/subscribe',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'repo'],
          properties: {
            email: { type: 'string' },
            repo: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        await subscriptionService.subscribe(request.body.email, request.body.repo);
        reply.code(200).send();
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  fastify.get<{ Params: { token: string } }>('/confirm/:token', async (request, reply) => {
    try {
      await subscriptionService.confirmSubscription(request.params.token);
      reply.code(200).send();
    } catch (err) {
      handleError(err, reply);
    }
  });

  fastify.get<{ Params: { token: string } }>('/unsubscribe/:token', async (request, reply) => {
    try {
      await subscriptionService.unsubscribe(request.params.token);
      reply.code(200).send();
    } catch (err) {
      handleError(err, reply);
    }
  });

  fastify.get<{ Querystring: { email: string } }>(
    '/subscriptions',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const subscriptions = await subscriptionService.getSubscriptions(request.query.email);
        reply.code(200).send(subscriptions);
      } catch (err) {
        handleError(err, reply);
      }
    },
  );
}
