# PostgreSQL Internals

## Table of Contents

- [PostgreSQL Architecture Overview](#postgresql-architecture-overview)
- [MVCC (Multi-Version Concurrency Control)](#mvcc-multi-version-concurrency-control)
- [WAL (Write-Ahead Logging)](#wal-write-ahead-logging)
- [VACUUM and AUTOVACUUM](#vacuum-and-autovacuum)
- [TOAST (The Oversized-Attribute Storage Technique)](#toast-the-oversized-attribute-storage-technique)
- [Buffer Management and Shared Buffers](#buffer-management-and-shared-buffers)
- [PostgreSQL Data Types](#postgresql-data-types)
- [Tablespaces](#tablespaces)
- [PostgreSQL-Specific Features](#postgresql-specific-features)
- [Configuration Tuning](#configuration-tuning)
- [Connection Pooling with PgBouncer](#connection-pooling-with-pgbouncer)
- [Common Interview Questions and Answers](#common-interview-questions-and-answers)

---

## PostgreSQL Architecture Overview

### Process Architecture

PostgreSQL uses a **multi-process architecture** (not multi-threaded). A single master `Postmaster` process listens for incoming connections and forks a dedicated `Backend` OS process per client connection, alongside specialized auxiliary background processes.

```mermaid
flowchart TD
    PM["Postmaster Process (Port 5432)"] -->|"Forks per client"| B1["Backend 1 (Client 1)"]
    PM -->|"Forks per client"| B2["Backend 2 (Client 2)"]
    PM -->|"Forks per client"| BN["Backend N (Client N)"]
    PM -->|"Coordinates"| AUX["Auxiliary Background Processes"]
    AUX --> WW["WAL Writer (Flushes WAL buffer)"]
    AUX --> AV["Autovacuum Launcher & Workers"]
    AUX --> CP["Checkpointer (Manages checkpoints)"]
    AUX --> BGW["Background Writer (Flushes dirty buffers)"]

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef worker fill:#0f172a,stroke:#10b981,stroke-width:1.5px,color:#ecfdf5
    classDef aux fill:#1e293b,stroke:#a855f7,stroke-width:1.5px,color:#f8fafc

    class PM primary
    class B1,B2,BN worker
    class AUX,WW,AV,CP,BGW aux
```

### Key Processes

- **Postmaster:** Main server process
  - Listens for client connections on port `5432`
  - Forks backend processes for each client
  - Manages crash recovery
  - Coordinates background workers (autovacuum, WAL archiver, etc.)
- **Backend Process:** One per client connection
  - Executes queries from client
  - Communicates via TCP/IP or Unix socket
  - Isolated memory space (process-level isolation)
  - Process crash doesn't affect other backends
- **Auxiliary Processes:**
  - **WAL Writer:** Flushes WAL buffer to disk
  - **Autovacuum Launcher/Worker:** Initiates and performs vacuuming
  - **Checkpointer:** Manages checkpoint operations
  - **Background Writer:** Flushes dirty buffers to disk

### Shared Memory Structure

All backend and auxiliary processes attach to a shared memory segment allocated at startup in RAM.

```mermaid
flowchart LR
    SM["Shared Memory (RAM)"] --> SB["Shared Buffers (8MB - 40GB): Table & index page cache, LRU"]
    SM --> WB["WAL Buffers (1MB - 16MB): Circular buffer, flushed on COMMIT"]
    SM --> LM["Lock Manager: Row-level & table-level locks"]
    SM --> CL["Clog (Commit Log): Transaction status, recycled via VACUUM"]
    SM --> BD["Buffer Descriptors: Metadata per shared buffer slot"]
    SM --> PA["ProcArray (Process Array): Active processes for MVCC checks"]

    classDef mem fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef sub fill:#0f172a,stroke:#64748b,stroke-width:1.5px,color:#e2e8f0

    class SM mem
    class SB,WB,LM,CL,BD,PA sub
```

> [!IMPORTANT]
> Because each client connection spawns a separate OS process with its own private memory (~6 MB+ overhead plus `work_mem`), unbounded direct client connections can exhaust RAM rapidly—making connection poolers like PgBouncer essential at scale.

---

## MVCC (Multi-Version Concurrency Control)

PostgreSQL uses MVCC to provide high concurrency and isolation without heavy locking: **readers never block writers, and writers never block readers**.

![PostgreSQL MVCC Tuple Versioning and Snapshot Isolation](./assets/02-postgres-mvcc-tuples.svg)

### Core Concepts

Every row (tuple) has **invisible system metadata**:
- `xmin` (Insert transaction ID): Which transaction inserted this row
- `xmax` (Delete transaction ID): Which transaction deleted/updated this row (`0` / NULL if not deleted)
- `cmin` (Command ID): Which command in the transaction inserted the row
- `cmax` (Command ID): Which command in the transaction deleted the row
- `ctid`: Physical tuple location `(page, slot)` — updated rows form a version chain

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

```mermaid
sequenceDiagram
    participant Tx100 as Tx 100 (INSERT)
    participant Tx101 as Tx 101 (UPDATE)
    participant Heap as Heap Page (Tuples)
    participant Tx102 as Tx 102 (READ COMMITTED)
    participant Snap100 as Tx 100 Snapshot (REPEATABLE READ)

    Tx100->>Heap: INSERT ('Alice', 50000) -> v1 (xmin=100, xmax=NULL)
    Tx100->>Tx100: COMMIT
    Tx101->>Heap: UPDATE salary=55000 -> marks v1 xmax=101, inserts v2 (xmin=101)
    Tx101->>Tx101: COMMIT
    Tx102->>Heap: SELECT * FROM employees
    Heap-->>Tx102: Returns v2 (55000) — xmin=101 committed before 102
    Snap100->>Heap: SELECT * FROM employees
    Heap-->>Snap100: Returns v1 (50000) — v2 xmin=101 is after snapshot
```

### Visibility Determination (Key Interview Topic)

PostgreSQL determines if a row is visible to a transaction based on:
1. **`xmin` status:** Is the inserting transaction committed before my snapshot?
2. **`xmax` status:** Is the deleting transaction visible to me?
3. **Isolation level:** `REPEATABLE READ`, `READ COMMITTED`, `SERIALIZABLE`.

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

Transaction IDs are 32-bit unsigned integers (`0` to ~4.29 billion).

```mermaid
flowchart TD
    A["32-bit XID Counter (0 to 4,294,967,295)"] --> B{"XID Wraps Around (4.29B -&gt; 0)?"}
    B -->|"Without VACUUM Freeze"| C["Old committed XID looks newer than new XIDs (Visibility Breaks!)"]
    C --> D["Emergency Safeguard: DB enters Read-Only at ~2B XIDs"]
    B -->|"With Regular VACUUM"| E["XID &gt; autovacuum_freeze_max_age marked FrozenTransactionId"]
    E --> F["Always visible to all snapshots; Wraparound prevented"]

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef danger fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#fee2e2
    classDef success fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5

    class A,B primary
    class C,D danger
    class E,F success
```

> [!WARNING]
> **Interview Answer:** "VACUUM marks rows as frozen when `xid > autovacuum_freeze_max_age`. This prevents XID wraparound anomalies. If you don't vacuum and reach ~2 billion un-frozen XIDs, PostgreSQL forces the database into **read-only mode** to prevent data corruption!"

---

## WAL (Write-Ahead Logging)

PostgreSQL never writes dirty data pages directly to disk on commit. Instead:
1. Log entry is written to WAL (sequential disk write, fast).
2. Entry is written to memory buffer (`Shared Buffers`).
3. Later, dirty buffers are flushed to disk asynchronously in the background or on checkpoint.

![PostgreSQL Write-Ahead Logging and Checkpointer](./assets/02-postgres-wal-checkpoint.svg)

### WAL Flush Rules (Critical!)

```mermaid
flowchart TD
    C["Transaction COMMIT (Client sends COMMIT)"] --> WB["Write WAL entry to WAL Buffer (RAM)"]
    WB --> SC{"synchronous_commit = local / on?"}
    SC -->|"Yes (Default)"| FS["Physically flush WAL to pg_wal on disk (fsync)"]
    SC -->|"off (Async)"| OK["Return OK to Client immediately"]
    FS --> OK
    OK -.->|"Later (Background)"| CP["Checkpointer / BgWriter flushes dirty pages to base/"]

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef accent fill:#1e293b,stroke:#a855f7,stroke-width:2px,color:#f8fafc
    classDef success fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5

    class C,WB,SC primary
    class FS,CP accent
    class OK success
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
| `minimal` | Single-server, no HA | Only critical data for crash recovery |
| `replica` (default) | Streaming replication, PITR | Full WAL for physical replication & archiving |
| `logical` | Logical replication, CDC | Decoded WAL for logical subscribers |

### WAL Segments

WAL is divided into **16MB segments** (default, `wal_segment_size`):

```text
pg_wal/000000010000000000000001
pg_wal/000000010000000000000002
pg_wal/000000010000000000000003
...
pg_wal/0000000100000000FFFFFFFF  (4GB worth, then timeline increments)
```

### Crash Recovery

```mermaid
flowchart LR
    S["PostgreSQL Startup After Crash"] --> PC["1. Read latest checkpoint from pg_control"]
    PC --> RP["2. Replay WAL segments forward from checkpoint"]
    RP --> UN["3. Rollback incomplete transactions"]
    UN --> CM["4. Persist all committed transactions"]

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef success fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5

    class S,PC,RP,UN primary
    class CM success
```

> [!TIP]
> Sequential appends to `pg_wal` + `fsync()` are orders of magnitude faster than flushing scattered 8KB random heap pages on every `COMMIT`, giving PostgreSQL both high throughput and full ACID durability.

---

## VACUUM and AUTOVACUUM

### Why VACUUM is Needed

MVCC leaves dead tuples (marked with `xmax`). These waste disk/buffer space and make sequential and index scans slower.

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

```mermaid
stateDiagram-v2
    [*] --> LiveTuple : INSERT (xmin set, xmax=0)
    LiveTuple --> DeadTuple : UPDATE or DELETE (xmax set)
    DeadTuple --> ReusableSpace : VACUUM (space marked free in FSM)
    DeadTuple --> CompactedTable : VACUUM FULL (table rewritten, OS space freed)
    LiveTuple --> FrozenTuple : VACUUM Freeze (prevents XID wraparound)
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

**What `VACUUM` does:**
1. Scans all pages looking for dead tuples
2. Marks space as reusable in the Free Space Map (doesn't return space to OS)
3. Updates `pg_stat_user_tables` and Visibility Map (enables Index-Only Scans)
4. Removes old `clog` entries beyond `vacuum_freeze_min_age`

| Command | Table Lock | Returns Space to OS? | Rebuilds Indexes? | Use Case |
|---------|-----------|----------------------|-------------------|----------|
| `VACUUM` | Non-blocking (ShareUpdateExclusive) | No (reusable internally) | No | Routine bloat prevention |
| `VACUUM ANALYZE` | Non-blocking | No | No | Vacuum + refresh planner stats |
| `VACUUM FULL` | `ACCESS EXCLUSIVE` (blocks all reads/writes) | Yes | Yes | Severe bloat recovery |

### AUTOVACUUM

PostgreSQL runs the autovacuum daemon automatically. It triggers when:
`dead_tuples > autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * reltuples`

```mermaid
flowchart LR
    NAP["Autovacuum Launcher (Wakes every autovacuum_naptime)"] --> CHK{"n_dead_tup &gt; threshold + scale_factor * rows?"}
    CHK -->|"No"| NAP
    CHK -->|"Yes"| WRK["Spawn Autovacuum Worker"]
    WRK --> SCN["Scan dirty/unfrozen pages &amp; reclaim dead tuples"]
    SCN --> VM["Update Visibility Map &amp; pg_stat_user_tables"]
    VM --> CLG["Truncate old clog entries"]

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef warn fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#fef3c7
    classDef success fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5

    class NAP,WRK,SCN primary
    class CHK warn
    class VM,CLG success
```

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

### Monitoring Dead Tuples & Tuning

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

> [!TIP]
> On a 100M-row table, the default `autovacuum_vacuum_scale_factor = 0.1` waits for **10 million** dead tuples before triggering! Lower `scale_factor` (e.g., `0.01` or `0.02`) per-table on huge, high-churn tables.

---

## TOAST (The Oversized-Attribute Storage Technique)

PostgreSQL heap pages are fixed at **8KB**, and tuples cannot span multiple pages. Large variable-length columns are compressed and/or stored out-of-line in a companion TOAST table.

### How TOAST Works

```mermaid
flowchart LR
    subgraph Main["Main Heap Table Page (8KB)"]
        R1["row_id (4 bytes)"]
        R2["col1 (8 bytes)"]
        R3["col2_oid (4 bytes pointer)"]
        R4["col3 (100 bytes)"]
    end

    subgraph Toast["Companion TOAST Table"]
        T1["Chunk OID (Matches col2_oid)"]
        T2["Chunk Sequence Number (0, 1, 2...)"]
        T3["Large Data Chunks (Up to 2KB each)"]
    end

    R3 -->|"Out-of-line lookup"| T1

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef accent fill:#0f172a,stroke:#a855f7,stroke-width:2px,color:#f8fafc

    class R1,R2,R3,R4 primary
    class T1,T2,T3 accent
```

### TOAST Storage Strategies

```mermaid
flowchart TD
    IN["Column Value &gt; TOAST Threshold (~2KB)"] --> ST{"Column STORAGE Strategy?"}
    ST -->|"PLAIN"| PL["No compression, inline only (fixed-width types)"]
    ST -->|"EXTENDED (Default)"| EX["Compress first; if still &gt; 2KB, store out-of-line"]
    ST -->|"EXTERNAL"| ET["No compression; store out-of-line (fast substr)"]
    ST -->|"MAIN"| MN["Compress; keep inline if possible, else out-of-line"]

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef choice fill:#1e293b,stroke:#f59e0b,stroke-width:2px,color:#fef3c7
    classDef strat fill:#0f172a,stroke:#10b981,stroke-width:1.5px,color:#ecfdf5

    class IN primary
    class ST choice
    class PL,EX,ET,MN strat
```

| Strategy | Compression | Out-of-Line Storage | Best For |
|----------|-------------|---------------------|----------|
| `PLAIN` | No | Never (inline only) | Fixed-size types (`int`, `uuid`) |
| `EXTENDED` (default) | Yes | Yes, if still > 2KB | General `text`, `jsonb`, `bytea` |
| `EXTERNAL` | No | Yes, always if > 2KB | Pre-compressed media, fast `SUBSTRING()` |
| `MAIN` | Yes | Only as last resort | Columns you want kept inline when possible |

```sql
-- Set TOAST strategy for column
ALTER TABLE documents
  ALTER COLUMN content SET STORAGE EXTENDED;
```

> [!TIP]
> **Interview Tip:** "Large `text` or `bytea` columns are TOASTed and stored separately from the main table. If a `SELECT` query doesn't reference the TOASTed column, PostgreSQL never reads the TOAST table—keeping row scans fast!"

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

### Buffer Eviction Policy (Clock-Sweep / LRU Variant)

PostgreSQL uses a **clock-sweep variant of LRU (Least Recently Used)** tracked via `usage_count` (0–5) in `BufferDescriptor`:
1. Each buffer slot has a `usage_count` (incremented on access, capped at 5).
2. The clock hand sweeps slots when a free buffer is needed.
3. If `usage_count > 0`, it decrements `usage_count` and moves on.
4. When `usage_count == 0`, the slot is evicted (if `dirty`, flushed to disk first).

```mermaid
flowchart TD
    REQ["Backend Requests Page"] --> HIT{"Page in Shared Buffers?"}
    HIT -->|"Yes (Cache Hit)"| INC["Increment usage_count (max 5) &amp; Pin Buffer"]
    HIT -->|"No (Cache Miss)"| SWP["Clock Hand Sweeps BufferDescriptors"]
    SWP --> CHK{"usage_count == 0 and unpinned?"}
    CHK -->|"No"| DEC["Decrement usage_count; advance clock hand"]
    DEC --> SWP
    CHK -->|"Yes"| DRT{"Buffer dirty?"}
    DRT -->|"Yes"| FLS["Flush dirty page to disk (WAL first!)"]
    DRT -->|"No"| RD["Read new 8KB page from OS/Disk into slot"]
    FLS --> RD

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef success fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5
    classDef warn fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#fef3c7

    class REQ,SWP,DEC,RD primary
    class HIT,CHK,DRT warn
    class INC,FLS success
```

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

```mermaid
classDiagram
    class SharedBufferPool {
        +int NBuffers
        +Page[8KB] blocks
        +allocateBuffer()
        +evictClockSweep()
    }
    class BufferDescriptor {
        +int buf_id
        +int content_lock
        +uint16 usage_count
        +bool dirty
        +int refcount
    }
    SharedBufferPool "1" *-- "N" BufferDescriptor : manages
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

> [!IMPORTANT]
> Setting `shared_buffers` above 25–40% of RAM rarely helps and can hurt by starving the OS page cache (PostgreSQL relies on double-buffering with the OS kernel page cache).

---

## PostgreSQL Data Types

### Choosing the Right Type

```mermaid
flowchart TD
    DT["PostgreSQL Data Type Choice"] --> NUM["Numbers"]
    DT --> STR["Strings &amp; Binary"]
    DT --> SEMI["Semi-Structured"]
    DT --> COLL["Structured / IDs"]

    NUM --> N1["int (4B) / bigint (8B): IDs &amp; counts"]
    NUM --> N2["numeric: Exact currency (no float rounding)"]
    STR --> S1["text / varchar(n): Same storage; text has no limit"]
    STR --> S2["bytea: Binary blobs (TOASTed &gt; 2KB)"]
    SEMI --> J1["json: Plain text, reparsed every query"]
    SEMI --> J2["jsonb: Binary pre-parsed, supports GIN index"]
    COLL --> C1["uuid (16B) / enum (4B) / array (GIN indexed)"]

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef cat fill:#1e293b,stroke:#a855f7,stroke-width:1.5px,color:#f8fafc
    classDef leaf fill:#0f172a,stroke:#10b981,stroke-width:1.5px,color:#ecfdf5

    class DT primary
    class NUM,STR,SEMI,COLL cat
    class N1,N2,S1,S2,J1,J2,C1 leaf
```

| Type | Size | Use Case | Interview Note |
|------|------|----------|----------------|
| `int` (`int4`) | 4 bytes | Small numbers, IDs | 2.1B range, default for `SERIAL` |
| `bigint` (`int8`) | 8 bytes | Large counts, IDs | 9.2×10^18 range, use for `BIGSERIAL` |
| `numeric` / `decimal` | variable | Currency, exact decimals | No rounding errors, slower than float |
| `float8` | 8 bytes | Approximate values | Fast, IEEE 754 precision |
| `text` | variable | Strings, unlimited | No length limit unlike `varchar(n)` |
| `varchar(n)` | variable | Limited strings | Enforces max length |
| `char(n)` | fixed | Fixed-width | Pads with spaces, wasteful |
| `bytea` | variable | Binary data | TOASTed if > 2KB |
| `json` | variable | Tree structure, logging | Slower, reparsed on each query |
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
```

### Arrays & Enums

```sql
CREATE TABLE events (
    id serial PRIMARY KEY,
    name text,
    tags text[] DEFAULT ARRAY[]::text[]
);

-- Insert & Query & Index
INSERT INTO events (name, tags) VALUES ('Event', ARRAY['tag1', 'tag2']);
SELECT * FROM events WHERE 'tag1' = ANY(tags);
CREATE INDEX idx_tags ON events USING GIN (tags);

-- Enums (4 bytes + type safety)
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
```

> [!TIP]
> **Interview Note:** Use `jsonb` for dynamic attributes that are frequently queried or indexed with `GIN`, and `text` instead of `varchar(n)` when you don't need a hard character limit (their internal storage and performance are identical in PostgreSQL).

---

## Tablespaces

Tablespaces allow you to distribute tables and indexes across multiple physical disks or mount points for I/O isolation and capacity management.

```mermaid
flowchart LR
    TB["Hot Table: events"] -->|"TABLESPACE fast_disk"| NVME["/mnt/nvme/pg_data (NVMe SSD)"]
    IX["GIN Index: idx_events"] -->|"TABLESPACE slow_disk"| HDD["/mnt/hdd/pg_indexes (Archive / HDD)"]
    SYS["pg_default / pg_global"] -->|"Default cluster"| DEF["$PGDATA/base"]

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef fast fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5
    classDef slow fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#fef3c7

    class TB,IX,SYS primary
    class NVME fast
    class HDD,DEF slow
```

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

> [!TIP]
> **Interview Use Case:** Place high-frequency lookup tables or WAL on NVMe SSDs and cold archive partitions on cheaper HDDs.

---

## PostgreSQL-Specific Features

### LISTEN/NOTIFY (Pub-Sub)

```mermaid
sequenceDiagram
    participant Sub as Subscriber Session
    participant PG as PostgreSQL Server
    participant Pub as Publisher Session

    Sub->>PG: LISTEN events_channel
    Note over Sub,PG: Blocks / waits for async notifications
    Pub->>PG: NOTIFY events_channel, 'Some data'
    PG-->>Sub: Delivers: NOTIFY events_channel 'Some data'
```

```sql
-- In one session (Subscriber)
LISTEN events_channel;
-- Now listening... (blocks until notification)

-- In another session (Publisher)
NOTIFY events_channel, 'Some data';

-- Listener receives: NOTIFY events_channel 'Some data'
```

**Use Case:** Application event notification without polling (chat messages, cache invalidation, real-time updates).

### Bulk Load, Upsert, Lateral Joins & Materialized Views

```mermaid
flowchart LR
    F1["COPY: 10x faster bulk load via streaming"] --> PG["PostgreSQL Engine"]
    F2["ON CONFLICT: Atomic UPSERT"] --> PG
    F3["CROSS JOIN LATERAL: Correlated top-N per row"] --> PG
    F4["MATERIALIZED VIEW: Precomputed &amp; CONCURRENTLY refreshable"] --> PG

    classDef feat fill:#1e293b,stroke:#38bdf8,stroke-width:1.5px,color:#f8fafc
    classDef core fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5

    class F1,F2,F3,F4 feat
    class PG core
```

```sql
-- COPY (Bulk Load - 10x faster than INSERT for large datasets)
COPY employees (name, salary) FROM STDIN;
Alice    50000
Bob      60000
\.

COPY employees TO STDOUT;
\COPY employees FROM '/path/to/file.csv' WITH (FORMAT csv, DELIMITER ',', HEADER);

-- UPSERT (ON CONFLICT)
INSERT INTO users (email, name, updated_at)
VALUES ('user@example.com', 'Alice', NOW())
ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    updated_at = EXCLUDED.updated_at;

INSERT INTO product_inventory (product_id, quantity)
VALUES (123, 100)
ON CONFLICT (product_id) DO UPDATE SET
    quantity = product_inventory.quantity + EXCLUDED.quantity;

-- Lateral Joins (like SQL Server CROSS APPLY)
SELECT c.customer_id, c.name, o.*
FROM customers c
CROSS JOIN LATERAL (
    SELECT order_id, amount
    FROM orders
    WHERE customer_id = c.customer_id
    ORDER BY amount DESC
    LIMIT 3
) o;

-- Materialized Views
CREATE MATERIALIZED VIEW customer_stats AS
SELECT
    customer_id,
    COUNT(*) AS total_orders,
    SUM(amount) AS total_spent
FROM orders
GROUP BY customer_id;

REFRESH MATERIALIZED VIEW customer_stats;

-- Concurrent refresh (doesn't lock reads, requires unique index)
CREATE UNIQUE INDEX idx_customer_stats ON customer_stats (customer_id);
REFRESH MATERIALIZED VIEW CONCURRENTLY customer_stats;
```

> [!IMPORTANT]
> `REFRESH MATERIALIZED VIEW CONCURRENTLY` avoids blocking `SELECT` queries during refresh, but **requires** a `UNIQUE` index on the materialized view.

---

## Configuration Tuning

```mermaid
flowchart TD
    T["PostgreSQL Tuning Parameters"] --> MEM["Memory Allocation"]
    T --> CONN["Connection Limits"]
    T --> PLAN["Query Planner &amp; I/O"]

    MEM --> M1["shared_buffers: 25% RAM (max ~40GB)"]
    MEM --> M2["effective_cache_size: 50-75% RAM (planner hint)"]
    MEM --> M3["work_mem: Per sort/hash op (beware concurrency!)"]
    MEM --> M4["maintenance_work_mem: VACUUM, REINDEX, CREATE INDEX"]

    CONN --> C1["max_connections (100 default) + superuser_reserved_connections"]
    PLAN --> P1["random_page_cost (1.1 SSD vs 4.0 HDD) &amp; effective_io_concurrency (200)"]

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef cat fill:#1e293b,stroke:#a855f7,stroke-width:1.5px,color:#f8fafc
    classDef leaf fill:#0f172a,stroke:#10b981,stroke-width:1.5px,color:#ecfdf5

    class T primary
    class MEM,CONN,PLAN cat
    class M1,M2,M3,M4,C1,P1 leaf
```

### Memory Parameters

```sql
SHOW shared_buffers;        -- Shared cache, 25% RAM
SHOW effective_cache_size;  -- Total memory available, 50-75% RAM
SHOW work_mem;              -- Per-operation memory (sorts, hash), 4MB-256MB
SHOW maintenance_work_mem;  -- VACUUM, REINDEX, 64MB default
```

| Server RAM | `shared_buffers` | `effective_cache_size` | `work_mem` | `maintenance_work_mem` |
|------------|------------------|------------------------|------------|------------------------|
| **16 GB** | `4GB` (25%) | `12GB` (75%) | `256MB` | `1GB` |
| **64 GB** | `16GB` (25%) | `48GB` (75%) | `512MB` | `2GB` |

### Connection Pool & Query Planning

```sql
SHOW max_connections;                 -- Default: 100, increase for many clients
SHOW superuser_reserved_connections;  -- Keep slots for admin

-- For application with 1000+ clients, use PgBouncer:
-- PgBouncer: 1000 client connections -> 20 database connections

SET enable_seqscan = off;             -- Force index use (for testing only)
SET random_page_cost = 1.1;           -- SSD: lower, HDD: higher (default 4)
SET effective_io_concurrency = 200;   -- Number of concurrent I/O operations
```

> [!WARNING]
> `work_mem` is allocated **per sort or hash operation**, not per connection. A single complex query with 4 hash joins across 100 concurrent connections can allocate `4 × 100 × work_mem`!

---

## Connection Pooling with PgBouncer

### Problem: PostgreSQL Process Per Connection

Each connection = one OS process = ~6MB RAM. For 1,000 clients, that's **6GB just for idle processes** plus heavy context-switching overhead.

```mermaid
flowchart LR
    C1["1,000 Client Connections (App Servers)"] --> PGB["PgBouncer Pool Manager (Port 6432)"]
    PGB -->|"Multiplexed"| PG1["PostgreSQL Backend 1"]
    PGB -->|"Multiplexed"| PG2["PostgreSQL Backend 2"]
    PGB -->|"Reused"| PG20["PostgreSQL Backend 20"]

    classDef client fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef pool fill:#3b0764,stroke:#c084fc,stroke-width:2px,color:#f3e8ff
    classDef db fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5

    class C1 client
    class PGB pool
    class PG1,PG2,PG20 db
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

```mermaid
stateDiagram-v2
    [*] --> SessionMode : Client connects
    SessionMode --> [*] : Returned only on client disconnect

    [*] --> TransactionMode : BEGIN / Query
    TransactionMode --> [*] : Returned immediately on COMMIT / ROLLBACK

    [*] --> StatementMode : Single statement
    StatementMode --> [*] : Returned after each statement (no multi-stmt tx)
```

| Mode | Behavior | Good For | Caveats |
|------|----------|----------|---------|
| `session` | Connection returned after client disconnects | Long-lived connections, `PREPARE`, `LISTEN` | Lowest multiplexing |
| `transaction` | Connection returned after each transaction | Short queries, high concurrency (recommended) | No session-level `SET` / temp tables across tx |
| `statement` | Connection returned after each statement | Single auto-commit queries (rare) | Multi-statement transactions disallowed |

> [!TIP]
> **Interview Answer:** "With 5,000 client connections, using PgBouncer in `transaction` pooling mode lets us keep only 100 PostgreSQL backend connections. Each transaction borrows a backend and returns it on `COMMIT`—reducing connection memory from ~30GB to ~600MB."

---

## Common Interview Questions and Answers

```mermaid
flowchart LR
    Q["SQL Query"] --> P["1. Parser (Syntax &amp; Parse Tree)"]
    P --> PL["2. Planner / Optimizer (Stats &amp; Indexes)"]
    PL --> EX["3. Executor (Fetch Pages, Filter, Sort)"]
    EX --> RES["4. Return Results (Note: Dead tuples still scanned until VACUUM)"]

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef success fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5

    class Q,P,PL,EX primary
    class RES success
```

### Q1: What happens when you run a SELECT query?

**Answer:**
1. **Parser** checks syntax and builds a parse tree.
2. **Planner** determines the best execution plan (considers indexes, `pg_statistic` histograms, cost estimates).
3. **Executor** runs the plan (fetches 8KB pages via `Shared Buffers`, checks MVCC visibility, filters rows, aggregates, sorts).
4. **Results** are returned to the client.
5. If `VACUUM` hasn't run recently, the executor may scan many dead tuples, slowing down the query.

### Q2: How does PostgreSQL ensure durability?

**Answer:**
"WAL guarantees durability. Before returning OK to the client on `COMMIT`:
1. The WAL entry is written to the `WAL Buffer`.
2. The WAL buffer is `fsync`'d to `pg_wal` on disk.
3. The client is told the commit succeeded.
4. Later (in the background), dirty pages in `Shared Buffers` are flushed to data files by the `Checkpointer` or `Background Writer`.
Even if PostgreSQL crashes before step 4, it replays WAL from the last checkpoint and recovers the transaction."

### Q3: What's the difference between VACUUM and VACUUM FULL?

**Answer:**
"`VACUUM` marks dead tuples as reusable inside the table without shrinking the file size on disk, and runs concurrently without blocking reads/writes.
`VACUUM FULL` rewrites the entire table into a new file, reclaiming space and returning it to the OS—but it takes much longer on large tables and requires an `ACCESS EXCLUSIVE` lock."

### Q4: What causes bloat?

**Answer:**
"Dead tuples from `UPDATE`/`DELETE` not yet vacuumed, or B-tree indexes not maintained after heavy churn. Bloat causes:
- Slower sequential scans (more pages to read)
- Slower index scans (deeper/sparser index pages)
- Wasted disk space and lower `Shared Buffers` hit ratio
**Solution:** Tune `autovacuum` per-table, run manual `VACUUM`, or `REINDEX CONCURRENTLY`."

### Q5: Why use JSONB over regular columns?

**Answer:**
"Use `JSONB` for flexible schemas (e.g., dynamic user attributes) where GIN indexing is helpful. Use regular typed columns for:
- Fixed schemas (better performance, constraints, and type integrity)
- Complex relational queries and joins
- Specific column indexing (B-tree is smaller and faster than GIN)"

> [!TIP]
> In system design interviews, combine **MVCC** (non-blocking reads), **WAL** (`fsync` sequential durability), **Autovacuum** (bloat & XID wraparound prevention), and **PgBouncer** (transaction pooling) to explain why PostgreSQL scales cleanly under heavy OLTP workloads.
