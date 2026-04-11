import { Client } from 'pg';
import * as dotenv from 'dotenv';

export default async function globalTeardown() {
  dotenv.config({ path: '.env.test' });

  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5433/postgres',
  });

  await client.connect();
  await client.query('DROP DATABASE IF EXISTS notifier_test WITH (FORCE)');
  await client.end();
}
