# GitHub Release Notifier

A REST API service that lets users subscribe to email notifications when a GitHub repository publishes a new release. Users confirm their subscription via email (double opt-in), and a background scanner periodically checks for new releases and sends notifications.

## How it works

1. A user sends `POST /api/subscribe` with an email and a GitHub repository (e.g. `facebook/react`)
2. The service validates the repository exists on GitHub, then sends a confirmation email
3. The user clicks the confirmation link — subscription becomes active
4. A background job runs every 10 minutes, checks each subscribed repository for new releases, and sends email notifications when something new is published
5. Every notification email includes an unsubscribe link

## Tech stack

- Node.js 22, TypeScript, Fastify 5
- PostgreSQL via Prisma 6
- nodemailer for emails (falls back to console logging if SMTP is not configured)
- node-cron for the background scanner
- Jest for unit and integration tests
- Docker + Docker Compose

## Running with Docker

This is the quickest way to get the backend stack running locally.

```bash
git clone <repo-url>
cd github-release-notifier
cp .env.example .env
```

Edit `.env` and set at minimum `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`. The `DATABASE_URL` inside the container is constructed automatically from those values, so it does not need to match the one in `.env`. Then:

```bash
docker-compose up --build
```

The API will be available at `http://localhost:3000`. Database migrations run automatically on startup.

To stop:

```bash
docker-compose down
```

To stop and remove all data (including the database volume):

```bash
docker-compose down -v
```

## Local development

For development you run the app directly with Node and only the database in Docker.

**Prerequisites:** Node.js 22, Docker

```bash
cp .env.example .env   # edit DATABASE_URL to point to localhost:5433
docker-compose up -d postgres
npm install
npx prisma migrate dev
npm run dev
```

`npm run dev` uses `tsx watch` — the server restarts automatically on file changes.

To apply schema changes during development:

```bash
npx prisma migrate dev --name describe-your-change
```

**Note on the frontend:** the static pages in `public/` (subscription form, confirmation, unsubscribe) are served by nginx in production and are not served by the application itself. In local development the API is fully functional — all endpoints can be exercised via curl or Postman. This is a deliberate trade-off: keeping the application backend-only avoids pulling in a static file dependency that adds no value in production where nginx handles it more efficiently.

## Building for production

```bash
npm run build   # compiles TypeScript to dist/
npm start       # runs dist/server.js
```

Migrations must be applied before starting the server in production:

```bash
npx prisma migrate deploy && npm start
```

In Docker this is handled automatically by the `CMD` in the Dockerfile.

## Running tests

**Unit tests** (no database required, all external dependencies are mocked):

```bash
npm run test:unit
```

**Integration tests** (require a test database):

```bash
npm run docker:test:up        # start isolated test database on port 5434
npm run test:integration
npm run docker:test:down      # tear it down when done
```

Integration tests use a separate database (`notifier_test`) defined in `.env.test`. The test setup creates this database automatically and runs migrations before the suite starts. The database is dropped after the suite finishes.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| POST | /api/subscribe | Subscribe email to a repository |
| GET | /api/confirm/:token | Confirm subscription |
| GET | /api/unsubscribe/:token | Unsubscribe |
| GET | /api/subscriptions?email= | List active subscriptions for an email |
| GET | /metrics | Prometheus metrics |

`POST /api/subscribe` accepts both `application/json` and `application/x-www-form-urlencoded`.

**Subscribe request:**
```json
{ "email": "user@example.com", "repo": "facebook/react" }
```

**Subscriptions response:**
```json
[
  {
    "email": "user@example.com",
    "repo": "facebook/react",
    "confirmed": true,
    "last_seen_tag": "v19.1.0"
  }
]
```

**Error responses** always have the shape `{ "error": "message" }`.

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` to get started.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `POSTGRES_USER` | yes (Docker) | PostgreSQL user for docker-compose |
| `POSTGRES_PASSWORD` | yes (Docker) | PostgreSQL password for docker-compose |
| `POSTGRES_DB` | yes (Docker) | PostgreSQL database name for docker-compose |
| `PORT` | no | HTTP port, default `3000` |
| `HOST` | no | Bind address, default `0.0.0.0` |
| `GITHUB_TOKEN` | no | GitHub personal access token — increases rate limit from 60 to 5000 req/hr |
| `APP_BASE_URL` | no | Base URL used in email links, default `http://localhost:3000` |
| `SMTP_HOST` | no | SMTP server host — if not set, emails are printed to console |
| `SMTP_PORT` | no | SMTP port, default `587` |
| `SMTP_USER` | no | SMTP username |
| `SMTP_PASS` | no | SMTP password |
| `SMTP_FROM` | no | From address, default `noreply@releases.app` |
| `API_KEY` | no | If set, `GET /api/subscriptions` requires `X-API-Key` header |
| `REDIS_URL` | no | Redis connection string for GitHub API response caching — falls back to in-memory cache if not set |

## Project structure

```
src/
  modules/
    subscriptions/   — HTTP routes and business logic for subscriptions
    github/          — GitHub API client
    email/           — email sending via nodemailer
    scanner/         — background cron job that checks for new releases
  db/
    client.ts        — Prisma client singleton
  config/
    env.ts           — typed environment config
  test-utils/        — Jest helpers (Prisma mock factory, global test setup)
  app.ts             — Fastify app factory
  server.ts          — entry point
prisma/
  schema.prisma      — database schema
  migrations/        — migration files (committed to git)
```

## Redis caching

By default the service uses an in-memory Map for caching GitHub API responses. To use Redis instead, set `REDIS_URL` in your `.env`:

```
REDIS_URL=redis://localhost:6379
```

To start Redis alongside the app and database:

```bash
docker-compose --profile full up --build
```

The cache stores positive results of `checkRepoExists` (i.e. repository exists) with a TTL of 10 minutes. Only 200 responses are cached — 404 is not cached since a repository can be created at any time and negative caching would cause false "not found" responses for up to 10 minutes. Rate limit errors (429) are never cached. If Redis becomes unavailable after startup, the service automatically falls back to in-memory cache.

`getLatestRelease` is intentionally not cached. The scanner runs every 10 minutes — caching release lookups with the same TTL would provide no benefit since the cached value would expire by the time the scanner runs again. The only real gain from caching is on `checkRepoExists`, which is called on every `POST /api/subscribe` and benefits from avoiding repeated GitHub API calls for the same repository.

## Prometheus metrics

The service exposes a `GET /metrics` endpoint in Prometheus text format. The following metrics are available:

| Metric | Type | Description |
|--------|------|-------------|
| `http_requests_total` | Counter | Total HTTP requests, labelled by `method`, `route`, `status_code` |
| `http_request_duration_seconds` | Histogram | Request duration in seconds, same labels |
| `scanner_notifications_total` | Counter | Release notification emails sent successfully |
| `github_rate_limit_hits_total` | Counter | GitHub API 429 rate limit errors encountered |
| `active_subscriptions_total` | Gauge | Number of confirmed subscriptions — queried from the database on each scrape |

Route labels use the Fastify route pattern (e.g. `/api/confirm/:token`) rather than the actual URL, so high-cardinality token values do not pollute the label space.

## Design decisions

**Fastify over Express** — built-in JSON schema validation via ajv, better TypeScript support, and faster request handling out of the box.

**Prisma over raw SQL** — schema-first migrations, type-safe queries, and straightforward migration workflow (`migrate dev` locally, `migrate deploy` in production).

**No repositories table** — each subscription stores `last_seen_tag` directly. A separate repositories table would only make sense if we needed to share cached release state across subscribers, which overlaps with the Redis caching bonus. Keeping it simple avoids premature abstraction.

**`last_seen_tag` initialized at subscription time** — when a user subscribes, the service immediately fetches the latest release tag and stores it alongside the subscription record. This means the scanner will only notify about releases published after the subscription was created. If the GitHub API call fails at subscription time, `last_seen_tag` remains `null` and the scanner will send a notification on its first run — a safe fallback that slightly over-notifies rather than silently dropping the subscription.

**Scanner groups by repository** — if 50 users are subscribed to `facebook/react`, the scanner makes one GitHub API call for that repository, not 50. This keeps GitHub API usage proportional to the number of unique repositories, not subscribers.

**Rollback on email failure** — the subscription record is created first, then the confirmation email is sent. If sending fails, the record is deleted and a 503 is returned so the user can try again. This avoids the opposite problem: sending an email with a confirmation token that was never saved to the database.

**Optional API key authentication** — if `API_KEY` is set, `GET /api/subscriptions` requires an `X-API-Key` header. All other endpoints remain open. This is intentional: `/api/confirm/:token` and `/api/unsubscribe/:token` are clicked from emails in a browser — there is no way to attach a header to those requests. Protecting only the subscriptions listing is the only design that works in practice.

**Docker Compose includes PostgreSQL** — this is a deliberate trade-off for the purposes of this assignment. In a real production setup the database would be a managed service (RDS, Supabase, etc.) running independently of the application deployment. The `docker-compose.yml` in production would only contain the application service, with `DATABASE_URL` pointing to the external database.
