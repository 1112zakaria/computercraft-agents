# Database package

This package owns the PostgreSQL migration files and migration runner for the control plane.

Run migrations against a configured database with:

```text
DATABASE_URL=postgresql://... npm run db:migrate
```

The runner creates `schema_migrations`, applies migrations in numeric order, takes a PostgreSQL
advisory lock, and records a SHA-256 checksum. Changing an already-applied migration fails rather
than silently modifying the schema.

For local/CI verification, set `TEST_DATABASE_URL` and run `npm test`. Without that variable, the
database tests validate migration ordering, checks, indexes, and required table definitions
without opening a network connection.
