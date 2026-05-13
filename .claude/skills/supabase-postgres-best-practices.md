---
name: supabase-postgres-best-practices
description: Postgres performance optimization and best practices from Supabase. Use this skill when writing, reviewing, or optimizing Postgres queries, schema designs, or database configurations.
license: MIT
metadata:
  author: supabase
  version: "1.1.1"
  organization: Supabase
  date: January 2026
---

# Supabase Postgres Best Practices

Comprehensive performance optimization guide for Postgres, maintained by Supabase. Contains rules across 8 categories, prioritized by impact to guide automated query optimization and schema design.

## When to Apply

Reference these guidelines when:
- Writing SQL queries or designing schemas
- Implementing indexes or query optimization
- Reviewing database performance issues
- Configuring connection pooling or scaling
- Optimizing for Postgres-specific features
- Working with Row-Level Security (RLS)

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Query Performance | CRITICAL | `query-` |
| 2 | Connection Management | CRITICAL | `conn-` |
| 3 | Security & RLS | CRITICAL | `security-` |
| 4 | Schema Design | HIGH | `schema-` |
| 5 | Concurrency & Locking | MEDIUM-HIGH | `lock-` |
| 6 | Data Access Patterns | MEDIUM | `data-` |
| 7 | Monitoring & Diagnostics | LOW-MEDIUM | `monitor-` |
| 8 | Advanced Features | LOW | `advanced-` |

## Critical Rules (apply always)

### Query Performance

**query-missing-indexes**: Always index foreign keys and columns used in WHERE, JOIN ON, and ORDER BY clauses for large tables. Missing indexes cause sequential scans.

```sql
-- Bad: no index on user_id in orders table
SELECT * FROM orders WHERE user_id = 123;

-- Good: index exists
CREATE INDEX idx_orders_user_id ON orders(user_id);
```

**query-partial-indexes**: Use partial indexes for queries on subsets of data (e.g., active records, non-null values). Smaller, faster, lower write overhead.

```sql
-- Partial index for active users only
CREATE INDEX idx_users_active ON users(email) WHERE deleted_at IS NULL;
```

**query-select-star**: Never use `SELECT *` in production. Select only needed columns — reduces I/O, avoids breaking changes when schema changes.

**query-n-plus-one**: Avoid N+1 queries. Use JOINs or CTEs to batch fetch related data in one query.

### Connection Management

**conn-pooling**: Always use a connection pooler (PgBouncer/Supavisor) in production. Direct connections to Postgres exhaust `max_connections` under load.

**conn-transaction-mode**: Prefer transaction-mode pooling for serverless/edge functions. Session-mode for apps that use session-level features (temp tables, advisory locks).

### Security & RLS

**security-rls-enabled**: Enable Row Level Security on all tables that store user data. Default deny — only grant what's needed.

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own docs" ON documents
  FOR SELECT USING (auth.uid() = user_id);
```

**security-rls-performance**: RLS policies are evaluated per-row. Index the columns referenced in policy expressions (e.g., `user_id`) to avoid sequential scans under RLS.

**security-anon-key**: Never use the `service_role` key in client-side code. The `anon` key + RLS is the correct pattern for browser/mobile clients.

### Schema Design

**schema-uuid-primary-key**: Use `gen_random_uuid()` (or `uuid_generate_v4()`) for primary keys in distributed/multi-tenant schemas. Integer sequences are fine for single-instance.

**schema-timestamptz**: Always use `TIMESTAMPTZ` (not `TIMESTAMP`) for date/time columns. Stores in UTC, displays in session timezone — avoids DST bugs.

**schema-soft-delete**: For auditable data, prefer `deleted_at TIMESTAMPTZ` over hard deletes. Pair with a partial index: `WHERE deleted_at IS NULL`.

### Concurrency & Locking

**lock-avoid-long-transactions**: Long-running transactions hold locks and block autovacuum. Keep transactions short; avoid user interaction mid-transaction.

**lock-select-for-update**: Use `SELECT ... FOR UPDATE` to lock rows you intend to update, preventing concurrent modification.

### Monitoring & Diagnostics

**monitor-explain-analyze**: Use `EXPLAIN ANALYZE` to verify query plans. Look for sequential scans on large tables, high loop counts, and bad row estimates.

**monitor-pg-stat-statements**: Enable `pg_stat_statements` to track slow queries: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`

## References

- https://www.postgresql.org/docs/current/
- https://supabase.com/docs
- https://wiki.postgresql.org/wiki/Performance_Optimization
- https://supabase.com/docs/guides/database/overview
- https://supabase.com/docs/guides/auth/row-level-security
