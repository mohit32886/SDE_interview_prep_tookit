# PostgreSQL Internals

## PostgreSQL Architecture Overview

### Process Architecture

PostgreSQL uses a **multi-process architecture** (not multi-threaded).

```
┌─────────────────────────────────────────────────────────────┐
│                    Postmaster Process                        │
│  (Listens on port 5432, spawns backend processes)            │
└─────────────────────────────────────────────────────────────┘
            │              │              │
            ▼              ▼              ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │  Backend 1   │ │  Backend 2   │ │  Backend N   │
    │  (Client 1)  │ │  (Client 2)  │ │  (Client N)  │
    └──────────────┘ └──────────────┘ └──────────────┘
```

### Key Processes

**Postmaster:** Main server process
- Listens for client connections
- Forks backend processes for each client
- Manages crash recovery
- Coordinates background workers (autovacuum, WAL archiver, etc.)

**Backend Process:** One per client connection
- Executes queries from client
- Communicates via TCP/IP or Unix socket
- Isolated memory space (process-level isolation)
- Process crash doesn't affect other backends

**Auxiliary Processes:**
- **WAL Writer:** Flushes WAL buffer to disk
- **Autovacuum Launcher/Worker:** Initiates and performs vacuuming
- **Checkpointer:** Manages checkpoint operations
- **Background Writer:** Flushes dirty buffers to disk

### Shared Memory Structure

```
┌─────────────────────────────────────────────────┐
│           Shared Memory (RAM)                   │
├─────────────────────────────────────────────────┤
│  Shared Buffers                 (8MB-40GB)      │
│  - Cache for table/index pages                  │
│  - LRU replacement policy                       │
│                                                 │
│  WAL Buffers                    (1MB-16MB)      │
│  - Circular buffer for write-ahead log          │
│  - Flushed on transaction commit                │
│                                                 │
│  Lock Manager                                   │
│  - Row-level locks                              │
│  - Table-level locks                            │
│                                                 │
│  Clog (Commit Log)                              │
│  - Tracks transaction status (committed/abort)  │
│  - Recycled periodically with VACUUM            │
│                                                 │
│  Buffer Descriptors                             │
│  - Metadata for each shared buffer slot         │
│                                                 │
│  Process Array                                  │
│  - ProcArray: All active processes              │
│  - Used for visibility checks (MVCC)            │
└─────────────────────────────────────────────────┘
```

---

## MVCC (Multi-Version Concurrency Control)

PostgreSQL uses MVCC to provide high concurrency and isolation without heavy locking.

### Core Concepts

Every row has **invisible metadata:**
- `xmin` (Insert transaction ID): Which transaction inserted this row
- `xmax` (Delete transaction ID): Which transaction deleted this row (NULL if not deleted)
- `cmin` (Command ID): Which command in transaction inserted row
- `cmax` (Command ID): Which command in transaction deleted row

### How MVCC Works

```sql
-- Transaction 1 (xid = 100)
BEGIN;
INSERT INTO employees (name, salary) VALUES ('Alice', 50000);
COMMIT;

-- Transaction 2 (xid = 101)
BEGIN;
UPDATE employees SET salary = 55000 WHERE name = 'Alice';
COMMIT;

-- At this point, we have TWO row versions:
-- Version 1: xmin=100, xmax=101, salary=50000
-- Version 2: xmin=101, xmax=NULL, salary=55000

-- Transaction 3 (xid = 102)
SELECT * FROM employees;
-- Sees Version 2 (xmin=101 is committed before 102)

-- Transaction 4 (xid = 100, in a REPEATABLE READ snapshot taken at xid=100)
SELECT * FROM employees;
-- Sees Version 1 (Version 2's xmin=101 is after snapshot)
```

### Visibility Determination (Key Interview Topic)

PostgreSQL determines if a row is visible to a transaction based on:

1. **xmin status:** Is the inserting transaction committed before my snapshot?
2. **xmax status:** Is the deleting transaction visible to me?
3. **Isolation level:** REPEATABLE READ, READ COMMITTED, etc.

```c
// Pseudocode for visibility check
bool HeapTupleSatisfiesMVCC(HeapTuple tuple, Snapshot snapshot) {
    TransactionId xmin = tuple->xmin;
    TransactionId xmax = tuple->xmax;

    // Was this row inserted by a committed transaction?
    if (!TransactionIdIsFinished(xmin)) {
        return false;  // Inserting transaction still running
    }

    // Was this row deleted? If so, is deletion visible to me?
    if (TransactionIdIsValid(xmax)) {
        if (TransactionIdIsFinished(xmax)) {
            return false;  // Delete is committed, row is invisible
        }
    }

    return true;  // Row is visible
}
```

### Transaction ID Wraparound Problem

Transaction IDs are 32-bit (0 to 4 billion).

```
Transaction ID wraparound:
Xid 4,294,967,295 → 0 (wraps around)

This breaks visibility! A very old committed xid might be treated as
more recent than new transactions.

Solution: VACUUM regularly to "freeze" old rows
```

**Interview Answer:** "VACUUM marks rows as frozen when xid > `autovacuum_freeze_max_age`. This prevents xid wraparound anomalies. If you don't vacuum and reach xid 2 billion, database goes read-only!"

---

## WAL (Write-Ahead Logging)

PostgreSQL never writes dirty pages directly to disk. Instead:
1. Log entry written to WAL (sequential disk write, fast)
2. Entry written to memory buffer
3. Later, buffer flushed to disk (in background or on checkpoint)

### WAL Flush Rules (Critical!)

```
┌─────────────────────────────────────┐
│     Transaction Commit              │
│  (Client sends COMMIT)              │
└─────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Write WAL entry to WAL buffer      │
│  (still in memory)                  │
└─────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  SYNCHRONOUS_COMMIT = LOCAL?       │
│  Flush WAL to disk physically       │
│  (fsync to filesystem)              │
└─────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Return OK to Client                │
│  (COMMIT acknowledged)              │
└─────────────────────────────────────┘
```

### WAL Configuration Parameters

```sql
-- Check current WAL settings
SHOW wal_level;
SHOW wal_buffers;
SHOW checkpoint_timeout;
SHOW max_wal_size;

-- View in postgresql.conf
wal_level = replica  -- minimal, replica, or logical
wal_buffers = 16MB   -- Default is 1/32 of shared_buffers
checkpoint_timeout = 15min
max_wal_size = 4GB   -- Max WAL before forced checkpoint
```

### WAL Levels

| Level | Use Case | What's Logged |
|-------|----------|---------------|
| `minimal` | Single-server, no HA | Only critical for crash recovery |
| `replica` (default) | Streaming replication | Full WAL for replication |
| `logical` | Logical replication, CDC | Decoded WAL for logical subscribers |

### WAL Segments

WAL is divided into 16MB segments (default, `wal_segment_size`).

```
pg_wal/000000010000000000000001
pg_wal/000000010000000000000002
pg_wal/000000010000000000000003
...
pg_wal/0000000100000000FFFFFFFF  (4GB worth, then timeline increments)
```

### Crash Recovery

On startup, PostgreSQL:
1. Reads latest checkpoint location from `pg_control`
2. Replays WAL from checkpoint forward
3. Undoes incomplete transactions (rollback)
4. Commits completed transactions

---

## VACUUM and AUTOVACUUM

### Why VACUUM is Needed

MVCC leaves dead tuples (marked with xmax). These waste space and make queries slower.

**Dead Tuple Problem:**
```sql
-- Table: employees
-- Initial: 1 million rows, 1GB size

UPDATE employees SET salary = salary * 1.1;  -- Affects all rows
-- Now: 2 million versions (old + new), 2GB size!
-- Old versions have xmax set (dead tuples)

-- Without VACUUM:
SELECT * FROM employees;  -- Scans 1M new + 1M old tuples
-- Performance degrades over time
```

### VACUUM Process

```sql
-- Manual VACUUM
VACUUM;  -- Scans whole table, marks dead tuples as reusable

-- VACUUM with ANALYZE (updates statistics too)
VACUUM ANALYZE;

-- VACUUM FULL (rewrites table, slow, exclusive lock)
VACUUM FULL;  -- Compresses table, returns space to OS
```

**What VACUUM does:**
1. Scans all pages looking for dead tuples
2. Marks space as reusable (doesn't return to OS)
3. Updates `pg_stat_user_tables` visibility map
4. Removes old clog entries beyond `vacuum_freeze_min_age`

### AUTOVACUUM

PostgreSQL runs autovacuum daemon automatically.

```sql
-- Check autovacuum settings
SHOW autovacuum;  -- on/off
SHOW autovacuum_vacuum_threshold;  -- Base threshold (50 dead tuples)
SHOW autovacuum_vacuum_scale_factor;  -- 10% of table size
SHOW autovacuum_analyze_threshold;
SHOW autovacuum_naptime;  -- Check every 10 seconds

-- Check vacuum stats
SELECT * FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY last_vacuum DESC;
```

### Monitoring Dead Tuples

```sql
-- Count dead tuples in a table
SELECT
    schemaname, tablename,
    n_live_tup, n_dead_tup,
    ROUND(100 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_ratio,
    last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

### AUTOVACUUM Tuning

```sql
-- postgresql.conf or ALTER SYSTEM

-- Table-specific settings (for high-churn tables)
ALTER TABLE employees SET (
    autovacuum_vacuum_scale_factor = 0.05,    -- 5% instead of 10%
    autovacuum_vacuum_threshold = 100,        -- More aggressive
    autovacuum_naptime = '30s'                -- Check more often
);

-- For very large tables, increase parallelism
ALTER SYSTEM SET autovacuum_max_workers = 8;
SELECT pg_reload_conf();
```

---

## TOAST (The Oversized-Attribute Storage Technique)

PostgreSQL pages are 8KB. Large columns are stored separately.

### How TOAST Works

```
Table Page (8KB)
┌──────────────────────┐
│ row_id (4 bytes)     │
│ col1 (8 bytes)       │
│ col2_oid (4 bytes)   │ ← Points to TOAST table
│ col3 (100 bytes)     │
└──────────────────────┘
        │
        ▼
TOAST Table Page
┌──────────────────────────────┐
│ Chunk OID                    │
│ Chunk Sequence Number        │
│ Large data... (up to 2KB)    │
└──────────────────────────────┘
```

### TOAST Storage Strategies

| Strategy | When Used |
|----------|-----------|
| `PLAIN` | No compression, inline storage |
| `EXTENDED` (default) | Compress if helpful, store externally if > 2KB |
| `EXTERNAL` | Always store separately, never inline |
| `MAIN` | Compress, but inline if possible |

```sql
-- Set TOAST strategy for column
ALTER TABLE documents
  ALTER COLUMN content SET STORAGE EXTENDED;
```

**Interview Tip:** "Large text or bytea columns are TOASTed, stored separately from main table. This is why selecting a 10MB text column isn't too slow — main row is still small."

---

## Buffer Management and Shared Buffers

### Shared Buffer Pool

```sql
-- Check current setting
SHOW shared_buffers;  -- Default: 128MB, should be 25% of RAM for dedicated server

-- Formula for sizing:
-- Dedicated server: 25% of RAM
-- Shared server: 10% of RAM
-- Max practical: 40GB
```

### Buffer Eviction Policy

PostgreSQL uses a **variant of LRU (Least Recently Used)**:

1. All buffers are in a linked list
2. Accessed buffers move to head
3. Tail (least recently used) is evicted when space needed
4. Dirty buffers are flushed before eviction

### Buffer Descriptors and Locking

```c
struct BufferDescriptor {
    int    buf_id;           // Which buffer slot
    int    lock;             // Buffer lock (content_lock)
    uint16 usage_count;      // LRU counter (0-5)
    bool   dirty;            // Page modified since read from disk
    // ... other fields
};
```

### Impact on Query Performance

```sql
-- If shared_buffers is too small:
-- - More disk I/O
-- - More CPU spent on eviction
-- - EXPLAIN ANALYZE shows many buffer misses

-- Check buffer hit ratio (target: > 99%)
SELECT
    sum(heap_blks_read) as heap_read,
    sum(heap_blks_hit) as heap_hit,
    sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as hit_ratio
FROM pg_statio_user_tables;
```

---

## PostgreSQL Data Types

### Choosing the Right Type

| Type | Size | Use Case | Interview Note |
|------|------|----------|-----------------|
| `int` (int4) | 4 bytes | Small numbers, IDs | 2.1B range, default for serial |
| `bigint` (int8) | 8 bytes | Large counts, IDs | 9.2×10^18 range, use for `BIGSERIAL` |
| `numeric` / `decimal` | variable | Currency, exact decimals | No rounding errors, slower |
| `float8` | 8 bytes | Approximate values | Fast, less precise |
| `text` | variable | Strings, unlimited | No length limit unlike `varchar(n)` |
| `varchar(n)` | variable | Limited strings | Enforces max length |
| `char(n)` | fixed | Fixed-width | Pads with spaces, wasteful |
| `bytea` | variable | Binary data | TOASTed if > 2KB |
| `json` | variable | Tree structure, indexing | Slower, reparsed on each query |
| `jsonb` | variable | Binary JSON, indexing | Faster, pre-parsed, GIN indexing |
| `uuid` | 16 bytes | Globally unique IDs | No sequence/autoinc dependency |
| `array` | variable | Multiple values | GIN indexing support |
| `enum` | 4 bytes | Fixed options | Type-safe, efficient storage |
| `point`, `polygon` | variable | Geospatial | Requires PostGIS extension |

### JSON vs JSONB (Key Difference)

```sql
-- json: Plain text storage, stored as-is
-- Slower: Reparsed on every query
-- Cheaper storage if never queried
SELECT json_column->>'key' FROM table;  -- Must parse each time

-- jsonb: Binary format, pre-parsed
-- Faster: Parsed once, binary format cached
-- More storage (larger binary representation)
-- Supports GIN indexing
CREATE INDEX idx_jsonb ON table USING GIN (jsonb_column);

SELECT jsonb_column->>'key' FROM table;  -- Binary access, fast

-- Interview: "Use jsonb for dynamic data that's frequently queried"
```

### Arrays

```sql
CREATE TABLE events (
    id serial PRIMARY KEY,
    name text,
    tags text[] DEFAULT ARRAY[]::text[]
);

-- Insert
INSERT INTO events (name, tags) VALUES ('Event', ARRAY['tag1', 'tag2']);

-- Query
SELECT * FROM events WHERE 'tag1' = ANY(tags);

-- Index
CREATE INDEX idx_tags ON events USING GIN (tags);
```

### Enums

```sql
CREATE TYPE employment_status AS ENUM (
    'active',
    'inactive',
    'on_leave',
    'terminated'
);

CREATE TABLE employees (
    id serial PRIMARY KEY,
    name text,
    status employment_status DEFAULT 'active'
);

-- Efficient storage (4 bytes) + type safety
```

---

## Tablespaces

Distribute tables/indexes across multiple disks for performance and capacity.

```sql
-- Create tablespace on different disk
CREATE TABLESPACE fast_disk LOCATION '/mnt/nvme/pg_data';

-- Create table on specific tablespace
CREATE TABLE events (id serial PRIMARY KEY, data jsonb)
TABLESPACE fast_disk;

-- Create index on different tablespace (indexes on slower disk)
CREATE INDEX idx_events ON events USING GIN (data)
TABLESPACE slow_disk;

-- Move table
ALTER TABLE events SET TABLESPACE fast_disk;

-- List tablespaces
SELECT * FROM pg_tablespaces;
```

**Interview Use Case:** "High-frequency lookup tables → NVMe, less-used archives → HDD"

---

## PostgreSQL-Specific Features

### LISTEN/NOTIFY (Pub-Sub)

```sql
-- In one session (Subscriber)
LISTEN events_channel;
-- Now listening... (blocks until notification)

-- In another session (Publisher)
NOTIFY events_channel, 'Some data';

-- Listener receives: NOTIFY events_channel 'Some data'
```

**Use Case:** Application event notification without polling (chat messages, real-time updates).

### COPY (Bulk Load)

```sql
-- COPY FROM (into database)
COPY employees (name, salary) FROM STDIN;
Alice    50000
Bob      60000
\.

-- COPY TO (from database)
COPY employees TO STDOUT;

-- From CSV file
\COPY employees FROM '/path/to/file.csv' WITH (FORMAT csv, DELIMITER ',', HEADER);

-- Performance: 10x faster than INSERT for large datasets
```

### UPSERT (ON CONFLICT)

```sql
-- Insert or update if unique constraint violated
INSERT INTO users (email, name, updated_at)
VALUES ('user@example.com', 'Alice', NOW())
ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    updated_at = EXCLUDED.updated_at;

-- Update specific columns on conflict
INSERT INTO product_inventory (product_id, quantity)
VALUES (123, 100)
ON CONFLICT (product_id) DO UPDATE SET
    quantity = product_inventory.quantity + EXCLUDED.quantity;
```

### Lateral Joins

Subquery can reference columns from preceding tables (like SQL Server `CROSS APPLY`).

```sql
-- Find top 3 orders for each customer
SELECT c.customer_id, c.name, o.*
FROM customers c
CROSS JOIN LATERAL (
    SELECT order_id, amount
    FROM orders
    WHERE customer_id = c.customer_id
    ORDER BY amount DESC
    LIMIT 3
) o;

-- Without LATERAL, would need window function or subquery
```

### Materialized Views

View that's physically stored (not recomputed each time).

```sql
-- Create materialized view
CREATE MATERIALIZED VIEW customer_stats AS
SELECT
    customer_id,
    COUNT(*) AS total_orders,
    SUM(amount) AS total_spent
FROM orders
GROUP BY customer_id;

-- Refresh when stale
REFRESH MATERIALIZED VIEW customer_stats;

-- Concurrent refresh (doesn't lock, needs unique index)
CREATE UNIQUE INDEX idx_customer_stats ON customer_stats (customer_id);
REFRESH MATERIALIZED VIEW CONCURRENTLY customer_stats;
```

---

## Configuration Tuning

### Memory Parameters

```sql
SHOW shared_buffers;        -- Shared cache, 25% RAM
SHOW effective_cache_size;  -- Total memory available, 50-75% RAM
SHOW work_mem;              -- Per-operation memory (sorts, hash), 256MB default
SHOW maintenance_work_mem;  -- VACUUM, REINDEX, 64MB default
```

**Tuning Guidelines:**
```sql
-- For 16GB RAM server
shared_buffers = 4GB              -- 25% of RAM
effective_cache_size = 12GB       -- 75% of RAM
work_mem = 256MB                  -- For complex sorts/hash joins
maintenance_work_mem = 1GB        -- For vacuum/reindex

-- For 64GB RAM server
shared_buffers = 16GB
effective_cache_size = 48GB
work_mem = 512MB
maintenance_work_mem = 2GB
```

### Connection Pool Tuning

```sql
SHOW max_connections;      -- Default: 100, increase for many clients
SHOW superuser_reserved_connections;  -- Keep slots for admin

-- For application with 1000+ clients, use PgBouncer:
-- PgBouncer: 1000 client connections → 20 database connections
```

### Query Planning

```sql
SET enable_seqscan = off;      -- Force index use (for testing)
SET random_page_cost = 1.1;    -- SSD: lower, HDD: higher (default 4)
SET effective_io_concurrency = 200;  -- Number of concurrent I/O operations
```

---

## Connection Pooling with PgBouncer

### Problem: PostgreSQL Process Per Connection

Each connection = one process = ~6MB RAM

For 1000 clients: 6GB just for processes!

### PgBouncer Solution

```
1000 Client Connections
        │
        ▼
    PgBouncer
    Pool Manager
        │
        ├─ Connection 1 → PostgreSQL Backend 1
        ├─ Connection 2 → PostgreSQL Backend 2
        ├─ Connection 3 → PostgreSQL Backend 1 (reused)
        └─ ...

    20 Database Connections (configurable)
```

### PgBouncer Configuration

```ini
[databases]
mydb = host=localhost port=5432 dbname=mydb

[pgbouncer]
listen_port = 6432
max_client_conn = 1000
default_pool_size = 20      # Connections per database
min_pool_size = 5           # Keep alive
reserve_pool_size = 5       # Extra connections for spikes
reserve_pool_timeout = 10   # Timeout for reserve
```

### Connection Pooling Modes

| Mode | Behavior | Good For |
|------|----------|----------|
| `session` | Connection returned to pool after client disconnects | Long-lived connections |
| `transaction` | Connection returned after each transaction | Short queries, many clients |
| `statement` | Connection returned after each statement | Single queries (rare) |

**Interview Answer:** "With 5000 client connections, using PgBouncer with transaction pooling, we keep only 100 PostgreSQL connections. Each transaction borrows a connection from the pool, returns it when done. Reduces memory from 30GB to 600MB."

---

## Common Interview Questions and Answers

### Q1: What happens when you run a SELECT query?

**Answer:**
1. Parser checks syntax
2. Planner determines best execution plan (considers indexes, statistics)
3. Executor runs plan (fetch pages, filter rows, aggregate, sort)
4. Results returned to client
5. If no VACUUM recently, might scan many dead tuples

### Q2: How does PostgreSQL ensure durability?

**Answer:**
"WAL guarantees durability. Before returning OK to client on COMMIT:
1. WAL entry is written to WAL buffer
2. WAL buffer is fsync'd to disk
3. Client is told commit succeeded
4. Later (background), dirty pages are flushed to disk
Even if PostgreSQL crashes before step 4, we can replay WAL and recover the transaction."

### Q3: What's the difference between VACUUM and VACUUM FULL?

**Answer:**
"VACUUM marks dead tuples as reusable but doesn't shrink table size.
VACUUM FULL rewrites the entire table, reclaiming space and returning it to OS.
VACUUM takes longer on large tables and exclusive lock."

### Q4: What causes bloat?

**Answer:**
"Dead tuples not yet vacuumed, or indexes not maintained. Bloat means:
- Slower sequential scans (more pages to read)
- Slower index scans (more index pages)
- More disk space used
Solution: Autovacuum or manual VACUUM, REINDEX"

### Q5: Why use JSONB over regular columns?

**Answer:**
"JSONB for flexible schema (e.g., dynamic attributes). Regular columns for:
- Fixed schema (performance, integrity)
- Complex queries (SQL better than JSON path)
- Indexing specific columns (B-tree better than GIN)
Use JSONB when schema varies or rarely queried."

