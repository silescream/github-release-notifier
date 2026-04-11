import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

export default async function globalSetup() {
  dotenv.config({ path: '.env.test' });

  const testDbUrl = new URL(process.env['DATABASE_URL']!);
  const adminUrl = new URL(testDbUrl.toString());
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  const dbName = testDbUrl.pathname.slice(1);
  const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
  if (res.rowCount === 0) {
    await client.query(`CREATE DATABASE "${dbName}"`);
  }
  await client.end();

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env['DATABASE_URL'] },
    stdio: 'inherit',
  });
}
