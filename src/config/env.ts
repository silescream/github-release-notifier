import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(key: string): string | undefined {
  return process.env[key] || undefined;
}

function parseIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  if (isNaN(value))
    throw new Error(`Environment variable ${key} must be a valid number, got: "${raw}"`);
  return value;
}

export const config = {
  port: parseIntEnv('PORT', 3000),
  host: process.env['HOST'] ?? '0.0.0.0',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',

  databaseUrl: required('DATABASE_URL'),

  githubToken: optional('GITHUB_TOKEN'),

  smtp: {
    host: optional('SMTP_HOST'),
    port: parseIntEnv('SMTP_PORT', 587),
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
    from: process.env['SMTP_FROM'] ?? 'noreply@releases.app',
  },

  appBaseUrl: process.env['APP_BASE_URL'] ?? 'http://localhost:3000',

  apiKey: optional('API_KEY'),

  redisUrl: optional('REDIS_URL'),
} as const;
