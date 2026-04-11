import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

export default async function globalSetup() {
  dotenv.config({ path: '.env.test' });

  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5433/postgres',
  });

  await client.connect();
  const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'notifier_test'`);
  if (res.rowCount === 0) {
    await client.query('CREATE DATABASE notifier_test');
  }
  await client.end();

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env['DATABASE_URL'] },
    stdio: 'inherit',
  });
}
