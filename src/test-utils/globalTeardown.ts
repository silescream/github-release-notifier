import { Client } from 'pg';
import * as dotenv from 'dotenv';

export default async function globalTeardown() {
  dotenv.config({ path: '.env.test' });

  const testDbUrl = new URL(process.env['DATABASE_URL']!);
  const adminUrl = new URL(testDbUrl.toString());
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  const dbName = testDbUrl.pathname.slice(1);
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.end();
}
