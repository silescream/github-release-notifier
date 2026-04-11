import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { prisma } from '../../db/client.js';

export const registry = new Registry();

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const scannerNotificationsTotal = new Counter({
  name: 'scanner_notifications_total',
  help: 'Total number of release notification emails sent',
  registers: [registry],
});

export const githubRateLimitHitsTotal = new Counter({
  name: 'github_rate_limit_hits_total',
  help: 'Total number of GitHub API rate limit errors encountered',
  registers: [registry],
});

export const activeSubscriptionsTotal = new Gauge({
  name: 'active_subscriptions_total',
  help: 'Number of confirmed active subscriptions',
  registers: [registry],
  async collect() {
    const count = await prisma.subscription.count({ where: { confirmed: true } });
    this.set(count);
  },
});
