# Indexing and Query Optimization

## B-Tree Index Internals

B-Tree (Balanced Tree) is PostgreSQL's default index type. Understanding internals is critical for interview prep.

### B-Tree Structure

```
Level 0 (Root)
    ┌─────────────────────────┐
    │ [10] [30] [50]          │
    └──────┬─────┬────┬───────┘
           │     │    │
    ┌──────▼──┐  │   ┌▼──────────┐
    │ Level 1 │  │   │ Level 1   │
    │[5][8]   │  │   │[35][45]   │
    └─────────┘  │   └───────────┘
         │       │       │
      ┌──▼────┬──▼──┬───▼──┐
      │Leaf   │Leaf │Leaf  │
      │[...]  │[...] │[...]│
      └───────┴─────┴─────┘
```

### B-Tree Properties

1. **All leaves at same depth** — Binary search guaranteed O(log n)
2. **Ordered** — Values in sorted order
3. **Balanced** — Maintained on INSERT/UPDATE via node splits

### Page Splits During Insert

```
Before INSERT: Page has 10 keys
┌─────────────────────────┐
│ [1][2][3][4][5][6][7][8][9][10] │
└─────────────────────────┘

After INSERT 5.5: Page full
┌────────────────────────────────┐
│ [1][2][3][4][5][5.5][6][7][8][9][10] │ (overflow)
└────────────────────────────────┘
        Page splits:
┌──────────────────┐  ┌──────────────────┐
│ [1][2][3][4][5]  │  │ [6][7][8][9][10] │
└──────────────────┘  └──────────────────┘
        │ promoted [5.5]
    ┌───┴───┐
    │ [5.5] │ (parent node adjusted)
```

### B-Tree Search Algorithm

```
SELECT * FROM employees WHERE id = 42;

1. Start at root: keys [10, 30, 50]
   42 > 30, 42 < 50
   Follow pointer to middle child

2. Middle node: keys [35, 45]
   42 > 35, 42 < 45
   Follow pointer to child

3. Leaf node: [35, 36, 37, ... 45]
   Scan leaf for 42 (sequential scan at leaf level)

4. Total I/Os: log_n(table_size) ≈ O(log n)
   For 1M rows, ~20 I/Os
```

### Interview Tip

"B-Tree indexes are ordered, so they support:
- Equality search: `WHERE id = 5` — O(log n)
- Range search: `WHERE id > 10 AND id < 50` — O(log n + k)
- Sorting: `ORDER BY id` — Can use index, no separate sort needed"

---

## Index Types in PostgreSQL

### 1. B-Tree (Default)

```sql
CREATE INDEX idx_name ON table_name(column_name);

-- Best for:
-- - Equality
-- - Range queries
-- - Sorting
```

**When Planner Uses B-Tree:**
- Index Scan: Sequential scan of matching entries
- Index Only Scan: All columns in index, no table access
- Bitmap Index Scan: Many matches, build bitmap before table scan

### 2. Hash Index

```sql
CREATE INDEX idx_hash ON users USING HASH (email);

-- Best for:
-- - Equality ONLY
-- - Not sorting
```

**Why rarely used:**
- Only supports `=` operator
- No range queries
- Hash collisions can degrade performance
- Not WAL-logged (historically) — lost on crash

### 3. GiST (Generalized Search Tree)

```sql
CREATE INDEX idx_geometry ON locations USING GiST (coordinates);

-- Best for:
-- - Geometric data
-- - Range queries
-- - Nearest neighbor (PostGIS)
```

### 4. SP-GiST (Space-Partitioned GiST)

```sql
CREATE INDEX idx_range ON data USING SPGIST (int_range_col);

-- Best for:
-- - IP ranges
-- - Geometric data
-- - Quad-tree/radix trees
```

### 5. GIN (Generalized Inverted Index)

```sql
CREATE INDEX idx_array ON events USING GIN (tags);
CREATE INDEX idx_jsonb ON documents USING GIN (data);

-- Best for:
-- - Array membership
-- - JSONB key search
-- - Full-text search
-- - Any data with multiple values
```

**GIN vs B-Tree for Arrays:**
```sql
-- Table: events(id, tags text[])

-- B-Tree: Slow for array membership
SELECT * FROM events WHERE 'postgresql' = ANY(tags);
-- Scans all rows, checks each array (O(n))

-- GIN Index: Fast for array membership
CREATE INDEX idx_tags ON events USING GIN (tags);
SELECT * FROM events WHERE 'postgresql' = ANY(tags);
-- O(log n + k) with inverted index

-- GIN stores: 'postgresql' → [event_id, event_id, ...]
```

### 6. BRIN (Block Range Index)

```sql
CREATE INDEX idx_date ON logs USING BRIN (created_at);

-- Best for:
-- - Very large tables with sorted/mostly-sorted columns
-- - Time-series data
-- - Minimal index size (1/1000th of B-Tree)
```

**When to use BRIN:**
- 100GB+ table sorted by date
- Index size critical
- Approximate answers acceptable
- Example: Immutable log tables

---

## Composite Indexes

Order matters for performance!

### Leftmost Prefix Rule

```sql
-- Index: (department_id, salary, name)
CREATE INDEX idx_composite ON employees(department_id, salary, name);

-- Usable for:
SELECT * FROM employees WHERE department_id = 5;
-- ✓ Uses index (leftmost prefix)

SELECT * FROM employees WHERE salary = 100000;
-- ✗ Cannot use index (missing leftmost column)

SELECT * FROM employees WHERE department_id = 5 AND salary = 100000;
-- ✓ Uses index (leftmost prefixes match)

SELECT * FROM employees
WHERE department_id = 5 AND salary = 100000 AND name LIKE 'A%';
-- ✓ Uses index (all columns)

SELECT * FROM employees WHERE salary = 100000 AND name = 'Alice';
-- ✗ Cannot use index (missing department_id)
```

### Index Column Order Strategy

```sql
-- Rule 1: Most selective column first (if equality)
-- Rule 2: Equality columns before range columns
-- Rule 3: Consider JOIN order

CREATE INDEX idx ON orders(customer_id, created_at DESC, status);
-- customer_id: equality, common in WHERE
-- created_at: range, after filtering by customer
-- status: range or filter

SELECT * FROM orders
WHERE customer_id = 123
AND created_at > '2024-01-01'
AND created_at < '2024-12-31'
AND status = 'shipped';
-- Uses all index columns efficiently
```

### Composite Index Performance Impact

```sql
-- Before index:
EXPLAIN SELECT * FROM employees
WHERE department_id = 5 AND salary > 100000;
-- Seq Scan (100,000 rows scanned, 20,000 matches)

-- After: CREATE INDEX idx ON employees(department_id, salary)
-- Index Scan (50 index entries → 20,000 rows)

-- Even better: CREATE INDEX idx ON employees(department_id)
-- WHERE salary > 100000
-- (partial index, fewer entries)
```

---

## Covering Indexes (INCLUDE Clause)

Avoid table lookups by storing extra columns in index.

```sql
-- Standard index
CREATE INDEX idx_orders ON orders(customer_id, created_at);

-- Query: SELECT customer_id, created_at, status FROM orders WHERE customer_id = 5
-- Problem: Need to fetch 'status' from table (extra I/O)

-- Covering index with INCLUDE
CREATE INDEX idx_orders_covering ON orders(customer_id, created_at)
INCLUDE (status, total_amount);

-- Now: All columns in index, no table access (Index Only Scan)
-- Downside: Larger index size
```

**Interview Tip:** "Covering indexes trade index size for query performance. They're valuable for frequently executed queries where avoiding table access is worth the extra storage."

---

## Partial Indexes and Expression Indexes

### Partial Indexes (Most Common Optimization)

```sql
-- Index only active employees (8x fewer entries)
CREATE INDEX idx_active_employees ON employees(id)
WHERE is_active = true;

SELECT * FROM employees WHERE id = 5 AND is_active = true;
-- Uses partial index (fast)

SELECT * FROM employees WHERE id = 5 AND is_active = false;
-- Cannot use index (condition doesn't match WHERE)

-- Real-world example: Orders shipped in last 90 days
CREATE INDEX idx_recent_orders ON orders(customer_id, created_at)
WHERE created_at > NOW() - INTERVAL '90 days';

-- Real-world example: NULL filtering
CREATE INDEX idx_orphan_rows ON table_name(id)
WHERE parent_id IS NULL;
```

### Expression Indexes

```sql
-- Index on computed expression
CREATE INDEX idx_lower_email ON users(LOWER(email));

SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';
-- Uses expression index

-- Date truncation
CREATE INDEX idx_month ON orders(DATE_TRUNC('month', created_at));

-- JSON extraction
CREATE INDEX idx_user_age ON users((data->>'age')::int);

-- Downside: Computed on every index write (slower inserts)
```

---

## Unique Indexes

```sql
-- Enforce uniqueness + provide fast lookup
CREATE UNIQUE INDEX idx_email ON users(email);

-- Multi-column uniqueness
CREATE UNIQUE INDEX idx_unique_combination ON accounts(customer_id, currency);

-- Partial unique index (unique only for active rows)
CREATE UNIQUE INDEX idx_unique_active ON users(email)
WHERE is_active = true;
-- Multiple inactive users with same email OK, but max 1 active per email
```

---

## EXPLAIN and EXPLAIN ANALYZE

### Query Plan Analysis

```sql
-- Estimate query plan (no actual execution)
EXPLAIN SELECT * FROM employees WHERE salary > 100000 ORDER BY name;

-- Output:
--  Sort (cost=XX..YY)
--    ->  Seq Scan on employees (cost=0..XX)
--              Filter: (salary > 100000)

-- Format: Cost = (startup_cost..total_cost)
-- Startup: Time to first row
-- Total: Time for all rows
```

### Key Node Types

| Node | Meaning | When Used |
|------|---------|-----------|
| **Seq Scan** | Sequential scan of all rows | No suitable index, small table |
| **Index Scan** | Use index, then fetch table rows | Indexed column with reasonable selectivity |
| **Index Only Scan** | All needed columns in index | Covering index or small result |
| **Bitmap Index Scan** | Use index, build bitmap, scan table | Many matches, indexes multiple columns |
| **Nested Loop Join** | For each outer row, scan inner | Small inner table, indexed join |
| **Hash Join** | Build hash table, probe with other table | Medium-large tables, inner table fits in memory |
| **Merge Join** | Merge pre-sorted inputs | Both inputs sorted (or indexes), medium-large |

### EXPLAIN ANALYZE (Actual Execution)

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM employees WHERE salary > 100000;

-- Output:
-- Seq Scan on employees (cost=0..1234)  (actual time=0.1..2.3ms)
--   Filter: (salary > 100000)
--   Rows: 234 (estimated 234)
--   Buffers: shared hit=100 read=2
-- Planning Time: 0.1 ms
-- Execution Time: 2.4 ms

-- Key metrics:
-- estimated vs actual rows: Large difference = bad plan
-- Buffers hit vs read: Hit ratio should be > 99%
```

### Query Plan Interpretation Example

```sql
-- Bad plan:
EXPLAIN SELECT COUNT(*) FROM orders WHERE status = 'shipped';
-- Seq Scan on orders  (cost=0..10000)  (actual time=50..500ms)

-- After index:
CREATE INDEX idx_status ON orders(status);
EXPLAIN SELECT COUNT(*) FROM orders WHERE status = 'shipped';
-- Index Only Scan using idx_status on orders  (cost=0..10)  (actual time=0.1..1ms)
-- 100x faster!
```

### Cost Model Understanding

```
Cost unit = 1 block read from disk
Assumptions (postgresql.conf):
  seq_page_cost = 1.0       (read one 8KB page sequentially)
  random_page_cost = 4.0    (read one 8KB page randomly)
  cpu_tuple_cost = 0.01     (process one row)
  cpu_operator_cost = 0.005 (evaluate one WHERE clause)

Example: Seq Scan 1M rows
  1000 blocks × seq_page_cost (1.0) = 1000
  + 1M rows × cpu_tuple_cost (0.01) = 10000
  Total: 11000 units

Example: Index Scan 100 matching rows
  log2(1M) = 20 random reads = 20 × 4.0 = 80
  + 100 rows × cpu_tuple_cost = 1
  Total: 81 units

Conclusion: Index scan wins for < 5000 rows (depends on selectivity)
```

---

## Query Optimization Strategies

### 1. Avoiding Full Table Scans

```sql
-- Problem: Seq Scan of 1M rows
SELECT * FROM products WHERE UPPER(name) = 'WIDGET';
-- Solution: Expression index
CREATE INDEX idx_product_name ON products(UPPER(name));

-- Problem: Substring search
SELECT * FROM customers WHERE email LIKE '%@gmail.com';
-- Solution: Full-text search or trigger-maintained column
ALTER TABLE customers ADD COLUMN email_domain text;
CREATE INDEX idx_domain ON customers(email_domain);

-- Problem: Function call on indexed column
SELECT * FROM users WHERE DATE(created_at) = '2024-01-15';
-- Solution: Range query
SELECT * FROM users WHERE created_at >= '2024-01-15'::date
  AND created_at < '2024-01-15'::date + '1 day'::interval;
```

### 2. Proper Indexing Strategy

```sql
-- Wrong: Index everything
CREATE INDEX idx1 ON big_table(col1);
CREATE INDEX idx2 ON big_table(col2);
CREATE INDEX idx3 ON big_table(col3);
-- Problem: Maintenance cost, memory bloat, slower writes

-- Right: Index common queries
-- Analyze slow_log → find most common WHERE clauses
-- Index those columns (in order of selectivity)
CREATE INDEX idx_main ON big_table(col1, col2, col3);

-- Check index usage
SELECT indexname, idx_scan FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

### 3. Statistics and ANALYZE

```sql
-- PostgreSQL needs up-to-date statistics for good plans
ANALYZE;  -- Update stats for all tables

ANALYZE table_name;  -- Specific table

-- Check stats
SELECT * FROM pg_stat_user_tables;

-- If stats are way off:
ALTER TABLE big_table SET (autovacuum_analyze_scale_factor = 0.001);

-- View table statistics
SELECT * FROM pg_stats WHERE tablename = 'employees';
```

### 4. Parameterized Queries and Plan Caching

```sql
-- Problem: Different plans for different values
SELECT * FROM orders WHERE customer_id = 1;  -- Index scan
SELECT * FROM orders WHERE customer_id = 999999;  -- Seq scan (1M rows)

-- Solution: Prepared statements (plans reused)
PREPARE fetch_orders (int) AS
SELECT * FROM orders WHERE customer_id = $1;

EXECUTE fetch_orders(1);
EXECUTE fetch_orders(999999);
-- Same plan reused (or adaptive plans)

-- In Java with Parameterized Query:
PreparedStatement ps = conn.prepareStatement(
    "SELECT * FROM orders WHERE customer_id = ?"
);
ps.setInt(1, customerId);
// Query plan cached after first execution
```

---

## N+1 Query Problem

### Anti-Pattern: N+1 Queries

```java
// BAD: N+1 queries
List<Customer> customers = fetchAllCustomers();  // 1 query
for (Customer customer : customers) {
    List<Order> orders = fetchOrdersByCustomer(customer.id);  // N queries
}
// Total: 1 + N queries

// Database traffic: 1001 queries for 1000 customers!
```

### Solution 1: JOIN Query

```java
// GOOD: Single query with JOIN
String query = """
    SELECT c.*, o.*
    FROM customers c
    LEFT JOIN orders o ON c.id = o.customer_id
    WHERE c.active = true
""";
List<CustomerOrderPair> results = executeQuery(query);

// Total: 1 query, all data fetched
// May need to deduplicate customers (one per order)
```

### Solution 2: Fetch Multiple in One Query

```java
// GOOD: Fetch orders for all customers
List<Customer> customers = fetchAllCustomers();  // 1 query
List<Long> customerIds = customers.stream()
    .map(Customer::getId)
    .collect(Collectors.toList());

Map<Long, List<Order>> ordersByCustomer =
    fetchOrdersByCustomerIds(customerIds);  // 1 query with IN clause
    // SELECT * FROM orders WHERE customer_id IN (...)

// Total: 2 queries, but N+1 avoided
```

### Solution 3: ORM Eager Loading

```java
// Using JPA/Hibernate with eager loading
@Entity
class Customer {
    @OneToMany(fetch = FetchType.EAGER)
    List<Order> orders;
}

// JPA: Eager loading fetches orders with customer in single query
// Hibernate: Uses JOIN or separate query (configurable)
```

**Interview Answer:** "Detect N+1 by enabling query logging and looking for repeated queries in loop. Fix with JOIN, IN clause, or ORM eager loading. Avoid in JPA with careful use of fetch strategies."

---

## Index Bloat and Maintenance

### Index Bloat Detection

```sql
-- Check index bloat percentage
SELECT
    schemaname, tablename, indexname,
    ROUND(100 * (pg_relation_size(indexrelid) - pg_relation_size(indexrelname::regclass)) /
        pg_relation_size(indexrelid), 2) AS bloat_percentage
FROM pg_stat_user_indexes
WHERE idx_scan > 0
ORDER BY bloat_percentage DESC;

-- Monitor pg_stat_user_indexes
SELECT indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE idx_scan > 0
ORDER BY idx_scan DESC;
```

### REINDEX

```sql
-- Rebuild index (locks table briefly)
REINDEX INDEX idx_name;

-- Rebuild all indexes on table
REINDEX TABLE table_name;

-- Rebuild all indexes in database (be careful on large DB)
REINDEX DATABASE mydb;

-- Online reindex (PostgreSQL 12+, doesn't lock)
REINDEX INDEX CONCURRENTLY idx_name;
```

---

## Slow Query Identification and Optimization Workflow

### Step 1: Enable Query Logging

```sql
-- postgresql.conf
log_min_duration_statement = 1000  -- Log queries > 1 second
log_statement = 'all'               -- Log all statements
log_duration = on

-- Reload config
SELECT pg_reload_conf();
```

### Step 2: Identify Slow Queries

```bash
# Tail log file
tail -f /var/log/postgresql/postgresql.log | grep "duration:"
```

### Step 3: EXPLAIN ANALYZE

```sql
-- Run problematic query with EXPLAIN ANALYZE
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT ...;

-- Look for:
-- 1. Seq Scan with large row count
-- 2. Nested Loop with large n_loops
-- 3. Estimated vs actual rows mismatch
```

### Step 4: Fix (Most Common Issues)

```sql
-- Issue 1: Missing index
EXPLAIN SELECT * FROM orders WHERE customer_id = 5;
-- Result: Seq Scan on orders  (cost=0..100000)
-- Fix: CREATE INDEX idx ON orders(customer_id);

-- Issue 2: Bad statistics
ANALYZE orders;
EXPLAIN SELECT * FROM orders WHERE customer_id = 5;
-- Now: Index Scan

-- Issue 3: N+1 query (check application logs)
-- Fix: Use JOIN instead of loop

-- Issue 4: Index not used due to function call
EXPLAIN SELECT * FROM users WHERE UPPER(email) = 'ALICE@EXAMPLE.COM';
-- Result: Seq Scan
-- Fix: CREATE INDEX idx ON users(UPPER(email));

-- Issue 5: Implicit type conversion
EXPLAIN SELECT * FROM users WHERE id = '5';  -- String '5' vs int 5
-- Fix: EXPLAIN SELECT * FROM users WHERE id = 5;  -- Proper type
```

---

## Partitioning

Splitting large table into smaller chunks for better performance.

### Range Partitioning (Most Common)

```sql
-- Create partitioned table (orders by year)
CREATE TABLE orders (
    id bigserial,
    customer_id int,
    amount numeric,
    created_at timestamp
) PARTITION BY RANGE (EXTRACT(YEAR FROM created_at));

-- Create partitions
CREATE TABLE orders_2022 PARTITION OF orders
    FOR VALUES FROM (2022) TO (2023);

CREATE TABLE orders_2023 PARTITION OF orders
    FOR VALUES FROM (2023) TO (2024);

CREATE TABLE orders_2024 PARTITION OF orders
    FOR VALUES FROM (2024) TO (2025);

-- Query automatically hits correct partition
SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2024-12-31';
-- Scans only orders_2024 partition (constraint exclusion)

-- Index partitions separately
CREATE INDEX idx_orders_2024_customer ON orders_2024(customer_id);
```

### List Partitioning

```sql
CREATE TABLE sales_by_region (
    id serial,
    region text,
    revenue numeric
) PARTITION BY LIST (region);

CREATE TABLE sales_americas PARTITION OF sales_by_region
    FOR VALUES IN ('USA', 'CANADA', 'MEXICO');

CREATE TABLE sales_europe PARTITION OF sales_by_region
    FOR VALUES IN ('UK', 'GERMANY', 'FRANCE');
```

### Hash Partitioning

```sql
-- Distribute load across N partitions (load balancing)
CREATE TABLE events (
    id bigserial,
    user_id int,
    data jsonb
) PARTITION BY HASH (user_id);

-- 8 partitions
CREATE TABLE events_0 PARTITION OF events FOR VALUES WITH (modulus 8, remainder 0);
CREATE TABLE events_1 PARTITION OF events FOR VALUES WITH (modulus 8, remainder 1);
...
```

### Partitioning Benefits

- **Constraint exclusion:** WHERE clause excludes partitions (faster scans)
- **Index size:** Smaller indexes per partition
- **Maintenance:** Drop partition instead of DELETE
- **Parallel query:** Can scan partitions in parallel (PostgreSQL 10+)

**Interview Tip:** "Partitioning trades management complexity for query performance on very large tables (100GB+). Not needed for smaller tables."

---

## Common Performance Anti-Patterns

### 1. SELECT * (Unnecessary Columns)

```sql
-- BAD: Fetch all columns
SELECT * FROM products;  -- Maybe 50 columns, 100MB data

-- GOOD: Fetch only needed
SELECT id, name, price FROM products;  -- 3 columns, 6MB data
-- Especially bad with covering indexes (forces table access)
```

### 2. Wildcard Search Without Full-Text Index

```sql
-- BAD: Inefficient LIKE with leading wildcard
SELECT * FROM users WHERE email LIKE '%@gmail.com';
-- Cannot use index on email

-- GOOD: Store domain separately
CREATE INDEX idx_domain ON users(email_domain);
SELECT * FROM users WHERE email_domain = 'gmail.com';

-- BETTER: Full-text search for arbitrary patterns
CREATE INDEX idx_email_fts ON users USING GIN(to_tsvector('english', email));
SELECT * FROM users WHERE to_tsvector('english', email) @@ 'gmail';
```

### 3. Correlated Subqueries

```sql
-- BAD: Correlated subquery (N+1 problem)
SELECT e.*, (
    SELECT COUNT(*)
    FROM assignments a
    WHERE a.employee_id = e.id
) AS assignment_count
FROM employees e;

-- GOOD: Aggregation with LEFT JOIN
SELECT e.*, COALESCE(a.count, 0) AS assignment_count
FROM employees e
LEFT JOIN (
    SELECT employee_id, COUNT(*) AS count
    FROM assignments
    GROUP BY employee_id
) a ON e.id = a.employee_id;
```

### 4. DISTINCT on Large Result Sets

```sql
-- BAD: DISTINCT is expensive (requires sort or hash)
SELECT DISTINCT column FROM large_table;

-- GOOD: Use GROUP BY with index
SELECT column FROM large_table GROUP BY column;

-- BEST: Fix query to not need deduplication
-- (Usually indicates N+1 or bad JOIN)
```

### 5. Sorting Without Index

```sql
-- BAD: No index on sort column
SELECT * FROM orders ORDER BY created_at DESC;
-- Seq scan + sort (expensive)

-- GOOD: Create index
CREATE INDEX idx_created_at ON orders(created_at DESC);
-- Index already sorted, no sort needed

-- BETTER: Covering index
CREATE INDEX idx_created_desc ON orders(created_at DESC)
INCLUDE (customer_id, amount);
-- Index Only Scan, no table access
```

---

## Interview Scenario: "Your Query is Slow"

### Response Template

1. **Gather information:**
   - "How slow? 1ms or 10s?"
   - "How often run? Interactive or batch?"
   - "Typical result size?"

2. **Get EXPLAIN ANALYZE:**
   ```sql
   EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
   ```

3. **Analyze plan:**
   - Look for Seq Scan on large table → missing index
   - Look for high nloops on Nested Loop → inefficient join
   - Look for large Sort → no index on ORDER BY

4. **Identify root cause:**
   - Missing index?
   - Bad statistics?
   - Wrong join type?
   - N+1 queries?

5. **Fix and verify:**
   ```sql
   -- Create index
   CREATE INDEX idx_name ON table(column);

   -- Analyze
   ANALYZE table;

   -- Re-run EXPLAIN ANALYZE
   EXPLAIN (ANALYZE, BUFFERS) SELECT ...;

   -- Verify improvement
   ```

**Example Interview Answer:**
"I'd start by running EXPLAIN ANALYZE to see the query plan. If I see a Seq Scan on a large table where I expect an Index Scan, the first check is whether the index exists. If it exists, I'd run ANALYZE to update statistics. If that doesn't help, I'd check the WHERE clause for things that prevent index use (functions, type conversions). Finally, I'd verify the fix with another EXPLAIN ANALYZE to confirm the plan changed and timing improved."

