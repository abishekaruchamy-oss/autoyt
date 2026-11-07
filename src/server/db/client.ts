import { Pool } from 'pg';

let pool: Pool | null = null;
let isPostgresAvailable: boolean | null = null;

export function getPgPool(): Pool | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      console.warn('PostgreSQL pool error:', err.message);
      isPostgresAvailable = false;
    });
  }

  return pool;
}

export async function checkPostgresConnection(): Promise<boolean> {
  const p = getPgPool();
  if (!p) {
    isPostgresAvailable = false;
    return false;
  }

  try {
    const client = await p.connect();
    await client.query('SELECT 1');
    client.release();
    isPostgresAvailable = true;
    return true;
  } catch (error) {
    console.warn('PostgreSQL is not reachable, using in-memory store:', (error as Error).message);
    isPostgresAvailable = false;
    return false;
  }
}

export function isDbConnected(): boolean {
  return isPostgresAvailable === true;
}
