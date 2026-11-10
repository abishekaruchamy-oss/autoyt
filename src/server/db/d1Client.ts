/**
 * d1Client.ts
 *
 * Cloudflare D1 Serverless Database Client & Context Resolver for AutoShorts.
 * Bridges Next.js 16 App Router (via @opennextjs/cloudflare) and Cloudflare Worker
 * background cron executions to the same Cloudflare D1 SQLite database.
 */

export interface D1Response {
  success: boolean;
  meta: {
    duration?: number;
    changes?: number;
    last_row_id?: number;
    served_by?: string;
  };
  error?: string;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    duration?: number;
    changes?: number;
    last_row_id?: number;
    served_by?: string;
  };
  error?: string;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Response>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

let activeD1Database: D1Database | null = null;

/**
 * Manually injects or overrides the D1 database binding
 * (used in Cloudflare Workers, background cron jobs, or automated testing).
 */
export function setD1Database(db: D1Database | null): void {
  if (db && typeof (db as any).prepare !== 'function') {
    activeD1Database = null;
    return;
  }
  activeD1Database = db;
}

/**
 * Resolves the active D1 database instance.
 * Checks:
 * 1. Explicitly injected D1 database (worker entrypoint or test environment)
 * 2. OpenNext Cloudflare request context (Next.js Server Components & Route Handlers)
 * 3. Global worker execution environment bindings
 *
 * In production (NODE_ENV === 'production'), if D1 is not found, throws an explicit
 * exception to prevent silent fallback to in-memory state.
 */
export function getD1Database(): D1Database | null {
  // 1. Explicitly configured D1 database
  if (activeD1Database) {
    return activeD1Database;
  }

  // 2. OpenNext Cloudflare Request Context
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const opennext = require('@opennextjs/cloudflare');
    if (typeof opennext.getCloudflareContext === 'function') {
      const context = opennext.getCloudflareContext();
      if (context?.env?.DB) {
        return context.env.DB as D1Database;
      }
    }
  } catch {
    // Not running inside active OpenNext Cloudflare HTTP request context
  }

  // 3. Global worker environment bindings
  const g = globalThis as unknown as {
    DB?: D1Database;
    __env?: { DB?: D1Database };
  };
  if (g.DB) {
    return g.DB;
  }
  if (g.__env?.DB) {
    return g.__env.DB;
  }

  // 4. Production invariant check: Never silently fall back in production
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL CONFIGURATION ERROR: Cloudflare D1 database binding (env.DB) is not connected in production. Silent in-memory fallback is strictly prohibited.'
    );
  }

  return null;
}

/**
 * Checks if a real D1 database binding is currently available.
 */
export function isD1Connected(): boolean {
  try {
    return getD1Database() !== null;
  } catch {
    return false;
  }
}

/**
 * Creates a standard Cloudflare D1Database adapter wrapping a Node.js SQLite DatabaseSync instance.
 * Enables zero-dependency local verification against the exact SQLite schema.
 */
export function createSqliteD1Adapter(sqliteDb: any): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      let boundValues: unknown[] = [];

      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement {
          boundValues = values.map((v) => (v === undefined ? null : v));
          return stmt;
        },

        async first<T = unknown>(colName?: string): Promise<T | null> {
          const prepared = sqliteDb.prepare(query);
          const row = prepared.get(...boundValues) as any;
          if (!row) return null;
          if (colName) return row[colName] ?? null;
          // Return clone without null prototype
          return { ...row } as T;
        },

        async all<T = unknown>(): Promise<D1Result<T>> {
          const prepared = sqliteDb.prepare(query);
          const rows = prepared.all(...boundValues) as any[];
          return {
            results: rows.map((r) => ({ ...r })) as T[],
            success: true,
            meta: { changes: 0, duration: 0 },
          };
        },

        async run<T = unknown>(): Promise<D1Response> {
          const prepared = sqliteDb.prepare(query);
          const res = prepared.run(...boundValues);
          return {
            success: true,
            meta: {
              changes: res.changes,
              last_row_id: Number(res.lastInsertRowid),
              duration: 0,
            },
          };
        },

        async raw<T = unknown>(): Promise<T[]> {
          const prepared = sqliteDb.prepare(query);
          const rows = prepared.all(...boundValues) as any[];
          return rows.map((r) => Object.values(r)) as unknown as T[];
        },
      };

      return stmt;
    },

    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      sqliteDb.exec('BEGIN TRANSACTION;');
      try {
        for (const s of statements) {
          const r = await s.all<T>();
          results.push(r);
        }
        sqliteDb.exec('COMMIT;');
      } catch (e) {
        sqliteDb.exec('ROLLBACK;');
        throw e;
      }
      return results;
    },

    async exec(sql: string): Promise<{ count: number; duration: number }> {
      sqliteDb.exec(sql);
      return { count: 1, duration: 0 };
    },

    async dump(): Promise<ArrayBuffer> {
      throw new Error('D1 dump is not supported in SQLite adapter');
    },
  };
}
