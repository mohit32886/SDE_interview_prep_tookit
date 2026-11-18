-- Run inside psql:
-- docker exec -i prep-postgres psql -U prep -d interview_prep < labs/sql/01-explain-analyze-and-locks.sql

-- 1. Baseline: Sequential Scan (No Index on customer_id, status, created_at)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, amount_cents, created_at
FROM orders
WHERE customer_id = 42 AND status = 'PAID'
ORDER BY created_at DESC
LIMIT 10;

-- 2. Add ESR-style Composite Index (Equality -> Equality -> Sort)
CREATE INDEX IF NOT EXISTS idx_orders_cust_status_created
ON orders (customer_id, status, created_at DESC);

ANALYZE orders;

-- 3. Re-run: Index Scan with dramatically fewer shared buffers hit
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, amount_cents, created_at
FROM orders
WHERE customer_id = 42 AND status = 'PAID'
ORDER BY created_at DESC
LIMIT 10;

-- 4. Partial Index for hot PENDING queue workers
CREATE INDEX IF NOT EXISTS idx_orders_pending_created
ON orders (created_at)
WHERE status = 'PENDING';

-- 5. Job Queue Pattern with FOR UPDATE SKIP LOCKED
BEGIN;
SELECT id, customer_id, amount_cents
FROM orders
WHERE status = 'PENDING'
ORDER BY created_at
LIMIT 5
FOR UPDATE SKIP LOCKED;
ROLLBACK;
