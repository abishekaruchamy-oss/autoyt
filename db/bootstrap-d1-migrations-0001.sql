-- One-time D1 migration tracking bootstrap script for existing remote database
-- Stored outside db/migrations so Wrangler does not treat it as a numbered migration.
-- Exact table schema matches Wrangler 4.159.0 (getCreateMigrationsTableQuery).
-- Records manually-applied 0001_atomic_deduplication.sql without modifying application tables or data.

CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT OR IGNORE INTO "d1_migrations" (name)
VALUES ('0001_atomic_deduplication.sql');
