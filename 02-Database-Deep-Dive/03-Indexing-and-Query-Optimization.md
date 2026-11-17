# Indexing and Query Optimization

## Table of Contents

- [B-Tree Index Internals](#b-tree-index-internals)
- [Index Types in PostgreSQL](#index-types-in-postgresql)
- [Composite Indexes](#composite-indexes)
- [Covering Indexes (INCLUDE Clause)](#covering-indexes-include-clause)
- [Partial Indexes and Expression Indexes](#partial-indexes-and-expression-indexes)
- [Unique Indexes](#unique-indexes)
- [EXPLAIN and EXPLAIN ANALYZE](#explain-and-explain-analyze)
- [Physical Join Algorithms](#physical-join-algorithms)
- [Query Optimization Strategies](#query-optimization-strategies)
- [N+1 Query Problem](#n1-query-problem)
- [Index Bloat and Maintenance](#index-bloat-and-maintenance)
- [Slow Query Identification and Optimization Workflow](#slow-query-identification-and-optimization-workflow)
- [Partitioning](#partitioning)
- [Common Performance Anti-Patterns](#common-performance-anti-patterns)
- [Interview Scenario: "Your Query is Slow"](#interview-scenario-your-query-is-slow)

---

## B-Tree Index Internals

**B-Tree (Balanced Tree)** is PostgreSQL's default index type. Understanding how 8KB index pages, `ctid` pointers, and page splits work is critical for database engineering interviews.

![B-Tree Index Lookup: Index Scan vs. Index-Only Scan](./assets/03-btree-index-lookup.svg)

### B-Tree Structure & Traversal (`WHERE id = 42`)

```mermaid
flowchart TD
    R["Level 0: Root Page [10, 30, 50]"] --> B1["Level 1: Branch [5, 8]"]
    R -->|"30 &lt; 42 &lt; 50"| B2["Level 1: Branch [35, 45]"]
    R --> B3["Level 1: Branch [55, 70]"]
    B2 -->|"35 &lt; 42 &lt; 45"| L2["Level 2: Leaf [40, 42, 44] → ctid(14,3)"]
    B1 --> L1["Level 2: Leaf [...]"]
    B3 --> L3["Level 2: Leaf [...]"]
    L2 -->|"Random I/O (Index Scan)"| H["Heap Page 14 (MVCC Check)"]
    L2 -->|"All-Visible VM Hit"| IO["Index-Only Scan (Zero Heap I/O)"]

    classDef root fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef branch fill:#0f172a,stroke:#38bdf8,color:#e2e8f0
    classDef leaf fill:#064e3b,stroke:#10b981,color:#ecfdf5
    classDef heap fill:#451a03,stroke:#f59e0b,color:#fef3c7
    class R root
    class B1,B2,B3 branch
    class L1,L2,L3,IO leaf
    class H heap
```

### B-Tree Properties & Complexity

- **All leaves at the same depth** — Binary search within each page guarantees $O(\log n)$ lookup.
- **Ordered** — Keys are stored in sorted order, enabling range scans and `ORDER BY` without a separate sort.
- **Balanced** — Maintained on `INSERT` / `UPDATE` via **page splits** when an 8KB leaf page overflows.
- **Doubly-linked leaves** — Sibling pointers between leaf pages allow fast forward/backward range scans (`O(log n + k)`).

### Page Splits During Insert

When inserting `5.5` into a full 8KB leaf page `[1..10]`, PostgreSQL splits the page and promotes the median key to the parent branch:

```mermaid
flowchart LR
    P1["Full Leaf Page: [1,2,3,4,5,6,7,8,9,10]"] -->|"INSERT 5.5 (Overflow)"| S1["Left Leaf: [1,2,3,4,5]"]
    P1 -->|"Split 50/50"| S2["Right Leaf: [6,7,8,9,10]"]
    S1 -->|"Promote [5.5]"| PAR["Parent Branch Adjusted: [..., 5.5, ...]"]
    S2 --> PAR

    classDef full fill:#7f1d1d,stroke:#f87171,color:#fef2f2
    classDef split fill:#1e293b,stroke:#38bdf8,color:#f8fafc
    classDef parent fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    class P1 full
    class S1,S2 split
    class PAR parent
```

### B-Tree Search Algorithm Walkthrough

```sql
SELECT * FROM employees WHERE id = 42;
-- 1. Start at root: keys [10, 30, 50] -> 42 > 30 and 42 < 50 -> follow middle pointer
-- 2. Branch node: keys [35, 45] -> 42 > 35 and 42 < 45 -> follow child pointer
-- 3. Leaf node: [35, 36, 37, ... 45] -> binary search leaf for 42 -> get ctid
-- 4. Total I/Os: log_B(table_size) ≈ O(log n) -> For 1M rows, ~3-4 page reads (~20 binary comparisons)
```

> [!TIP]
> **Interview Tip:** B-Tree indexes are ordered, so a single index supports **equality** (`WHERE id = 5` in $O(\log n)$), **range** (`WHERE id > 10 AND id < 50` in $O(\log n + k)$), and **sorting** (`ORDER BY id` with zero extra sort).

---

## Index Types in PostgreSQL

PostgreSQL provides six specialized index access methods. Choosing the wrong one leads to bloated indexes or ignored plans.

```mermaid
flowchart TD
    Q["Query Predicate Type?"] --> EQ["Equality (=) Only, High-Cardinality"]
    Q --> RNG["Equality, Range (&lt;, &gt;, BETWEEN), ORDER BY"]
    Q --> ARR["Arrays, JSONB, Full-Text (tsvector)"]
    Q --> GEO["2D Geometry, PostGIS, Nearest-Neighbor"]
    Q --> SP["IP Ranges, Radix / Quad-Tree"]
    Q --> TS["100GB+ Append-Only Time-Series"]

    EQ -->|"O(1) Lookup"| H["Hash Index"]
    RNG -->|"O(log n)"| B["B-Tree (Default)"]
    ARR -->|"Inverted Index"| GIN["GIN"]
    GEO -->|"Balanced Tree"| GIST["GiST"]
    SP -->|"Space-Partitioned"| SPG["SP-GiST"]
    TS -->|"Min/Max per Block Range"| BRIN["BRIN (1/1000th Size)"]

    classDef q fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef cond fill:#1e293b,stroke:#94a3b8,color:#e2e8f0
    classDef idx fill:#064e3b,stroke:#10b981,color:#ecfdf5
    class Q q
    class EQ,RNG,ARR,GEO,SP,TS cond
    class H,B,GIN,GIST,SPG,BRIN idx
```

### Index Type Comparison

| Index Type | Best For | Supported Operators | Relative Size | Trade-Offs |
| :--- | :--- | :--- | :--- | :--- |
| **B-Tree** (Default) | Equality, ranges, sorting, `LIKE 'abc%'` | `=`, `<`, `<=`, `>`, `>=`, `BETWEEN`, `IN`, `IS NULL` | Medium | Slower for multi-value columns (arrays/JSONB) |
| **Hash** | Equality-only lookups | `=` only | Medium | No range/sort; historically not WAL-logged (fixed in PG 10+) |
| **GiST** | Geometry (PostGIS), ranges, nearest-neighbor | `&&`, `@>`, `<@`, `<->` | Medium–Large | Lossy; requires Heap recheck |
| **SP-GiST** | IP/inet ranges, quad-trees, radix trees | `=`, `<`, `>`, `@>`, `<@` | Medium | Best for non-balanced / skewed spaces |
| **GIN** | Arrays, `JSONB`, Full-Text Search (`tsvector`) | `@>`, `<@`, `?`, `?&`, `?|`, `@@` | Large | Expensive writes (use `fastupdate` pending list) |
| **BRIN** | 100GB+ naturally ordered / append-only tables | `=`, `<`, `>`, `BETWEEN` | Tiny (1/1000th) | Lossy; useless if physical row order is random |

### SQL Examples by Index Type

```sql
-- 1. B-Tree (Default): Index Scan, Index-Only Scan, or Bitmap Index Scan
CREATE INDEX idx_name ON table_name(column_name);

-- 2. Hash Index: Equality (=) ONLY, no sorting
CREATE INDEX idx_hash ON users USING HASH (email);

-- 3. GiST (Generalized Search Tree): Geometric & PostGIS nearest-neighbor
CREATE INDEX idx_geometry ON locations USING GiST (coordinates);

-- 4. SP-GiST (Space-Partitioned GiST): IP ranges, quad-trees, radix trees
CREATE INDEX idx_range ON data USING SPGIST (int_range_col);

-- 5. GIN (Generalized Inverted Index): Stores 'postgresql' -> [event_id_1, event_id_2, ...]
CREATE INDEX idx_array ON events USING GIN (tags);
CREATE INDEX idx_jsonb ON documents USING GIN (data);
-- Fast array membership: O(log n + k) vs O(n) Seq Scan with B-Tree
SELECT * FROM events WHERE 'postgresql' = ANY(tags);

-- 6. BRIN (Block Range Index): 100GB+ immutable logs sorted by created_at
CREATE INDEX idx_date ON logs USING BRIN (created_at);
```

> [!WARNING]
> Never use **BRIN** on columns with random physical distribution (e.g., `user_id` UUIDs) or heavy `UPDATE` churn — every 128-page block range will span `[min, max]` covering the whole domain, forcing PostgreSQL to scan the entire table.

---

## Composite Indexes

Column order in a multi-column B-Tree determines which queries can use the index. PostgreSQL sorts by the **first** column, then breaks ties by the **second**, then the **third**.

```mermaid
flowchart LR
    IDX["Composite Index: (department_id, salary, name)"] --> Q1["WHERE department_id = 5"]
    IDX --> Q2["WHERE department_id = 5 AND salary = 100000"]
    IDX --> Q3["WHERE department_id = 5 AND salary = 100000 AND name LIKE 'A%'"]
    IDX -.->|"Missing Leftmost Column!"| Q4["WHERE salary = 100000"]
    IDX -.->|"Missing Leftmost Column!"| Q5["WHERE salary = 100000 AND name = 'Alice'"]

    Q1 --> OK1["Index Used"]
    Q2 --> OK2["Index Used"]
    Q3 --> OK3["Index Used (All 3 Columns)"]
    Q4 --> NO1["Seq Scan (Cannot Use Index)"]
    Q5 --> NO2["Seq Scan (Cannot Use Index)"]

    classDef idx fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef ok fill:#064e3b,stroke:#10b981,color:#ecfdf5
    classDef no fill:#7f1d1d,stroke:#f87171,color:#fef2f2
    class IDX idx
    class OK1,OK2,OK3 ok
    class NO1,NO2 no
```

### Leftmost Prefix Rule & Column Order Strategy

1. **Equality columns before range columns** — A range predicate (`>`, `<`, `BETWEEN`) stops further exact B-Tree narrowing on subsequent columns.
2. **Most selective equality column first** — Prunes the search space fastest.
3. **Consider `JOIN` and `ORDER BY` alignment** — Matching `ORDER BY` direction avoids an explicit `Sort` node.

```sql
-- Leftmost Prefix Rule: (department_id, salary, name)
CREATE INDEX idx_composite ON employees(department_id, salary, name);

SELECT * FROM employees WHERE department_id = 5;                              -- ✓ Uses index
SELECT * FROM employees WHERE department_id = 5 AND salary = 100000;          -- ✓ Uses index
SELECT * FROM employees WHERE department_id = 5 AND salary = 100000 AND name LIKE 'A%'; -- ✓ Uses all 3
SELECT * FROM employees WHERE salary = 100000;                                -- ✗ Seq Scan
SELECT * FROM employees WHERE salary = 100000 AND name = 'Alice';             -- ✗ Seq Scan

-- Column Order Strategy: Equality -> Range -> Filter
CREATE INDEX idx ON orders(customer_id, created_at DESC, status);
SELECT * FROM orders
WHERE customer_id = 123
  AND created_at > '2024-01-01' AND created_at < '2024-12-31'
  AND status = 'shipped';
```

### Composite Index Performance Impact

```sql
-- Before index: Seq Scan (100,000 rows scanned, 20,000 matches)
EXPLAIN SELECT * FROM employees WHERE department_id = 5 AND salary > 100000;

-- After composite index: Index Scan (50 index entries -> 20,000 rows)
CREATE INDEX idx ON employees(department_id, salary);

-- Even better (partial index, fewer entries):
CREATE INDEX idx_partial ON employees(department_id) WHERE salary > 100000;
```

> [!IMPORTANT]
> Put **equality (`=`)** columns before **range (`>`, `<`, `BETWEEN`)** columns in a composite index. Once PostgreSQL hits a range condition on column 2, column 3 can only be filtered, not binary-searched.

---

## Covering Indexes (INCLUDE Clause)

A **Covering Index** stores non-key payload columns directly in the B-Tree leaf pages using `INCLUDE`, enabling an **Index-Only Scan** with zero Heap table fetches (when Visibility Map bits are set).

```mermaid
flowchart LR
    Q["SELECT customer_id, created_at, status FROM orders WHERE customer_id = 5"] --> STD["Standard Index (customer_id, created_at)"]
    Q --> COV["Covering Index (customer_id, created_at) INCLUDE (status, total_amount)"]

    STD -->|"Missing 'status' in Leaf"| HEAP["Index Scan + Random Heap Fetch"]
    COV -->|"All Columns in Leaf + VM Hit"| IOS["Index-Only Scan (Zero Heap I/O)"]

    classDef q fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef warn fill:#451a03,stroke:#f59e0b,color:#fef3c7
    classDef ok fill:#064e3b,stroke:#10b981,color:#ecfdf5
    class Q q
    class STD,HEAP warn
    class COV,IOS ok
```

```sql
-- Standard index: must fetch 'status' from Heap table (extra random I/O)
CREATE INDEX idx_orders ON orders(customer_id, created_at);

-- Covering index with INCLUDE: 'status' and 'total_amount' live in leaf pages only
CREATE INDEX idx_orders_covering ON orders(customer_id, created_at)
INCLUDE (status, total_amount);

-- Query satisfied completely from index (Index Only Scan)
SELECT customer_id, created_at, status
FROM orders
WHERE customer_id = 5;
```

| Aspect | Key Columns `(a, b)` | `INCLUDE (c, d)` Columns |
| :--- | :--- | :--- |
| **Stored in** | Root, Branch, and Leaf pages | **Leaf pages only** |
| **Searchable / Sortable** | Yes | No (payload only) |
| **Enforces Uniqueness** | Yes (if `UNIQUE`) | No |
| **Best Use Case** | `WHERE`, `JOIN`, `ORDER BY` predicates | `SELECT` list columns for Index-Only Scans |

> [!TIP]
> **Interview Tip:** Covering indexes trade index storage size and write overhead for read latency. Use `INCLUDE` for hot queries where avoiding random Heap fetches is worth the extra disk/RAM footprint.

---

## Partial Indexes and Expression Indexes

**Partial Indexes** index only a subset of rows matching a `WHERE` predicate, while **Expression Indexes** precompute and index the result of a function or expression.

```mermaid
flowchart TD
    T["Table: employees / users"] --> PI["Partial Index: WHERE is_active = true"]
    T --> EI["Expression Index: LOWER(email)"]

    PI -->|"8x Smaller Index"| P1["Query includes AND is_active = true → Index Scan"]
    PI -.->|"Predicate Mismatch"| P2["Query has AND is_active = false → Seq Scan"]

    EI -->|"Precomputed Keys"| E1["WHERE LOWER(email) = 'alice@example.com' → Index Scan"]
    EI -.->|"Raw Column Query"| E2["WHERE email = 'alice@example.com' → Cannot Use"]

    classDef tbl fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef ok fill:#064e3b,stroke:#10b981,color:#ecfdf5
    classDef no fill:#7f1d1d,stroke:#f87171,color:#fef2f2
    class T,PI,EI tbl
    class P1,E1 ok
    class P2,E2 no
```

### Partial Indexes (Most Common Optimization)

```sql
-- Index only active employees (e.g., 8x fewer entries)
CREATE INDEX idx_active_employees ON employees(id)
WHERE is_active = true;

SELECT * FROM employees WHERE id = 5 AND is_active = true;   -- ✓ Uses partial index
SELECT * FROM employees WHERE id = 5 AND is_active = false;  -- ✗ Cannot use index

-- Recent 90-day orders (note: predicate must be immutable or explicit cutoff)
CREATE INDEX idx_recent_orders ON orders(customer_id, created_at)
WHERE created_at > '2024-01-01';

-- NULL filtering for sparse orphan rows
CREATE INDEX idx_orphan_rows ON table_name(id)
WHERE parent_id IS NULL;
```

### Expression Indexes

```sql
-- Case-insensitive email lookup
CREATE INDEX idx_lower_email ON users(LOWER(email));
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';

-- Date truncation & JSONB field extraction
CREATE INDEX idx_month ON orders(DATE_TRUNC('month', created_at));
CREATE INDEX idx_user_age ON users(((data->>'age')::int));
```

> [!WARNING]
> Expression indexes are recomputed on **every `INSERT` and `UPDATE`** of the underlying columns, and the query's `WHERE` clause must match the indexed expression **identically** for the planner to use it.

---

## Unique Indexes

Unique indexes enforce data integrity at the storage layer while simultaneously serving as fast lookup structures.

```mermaid
flowchart LR
    INS["INSERT / UPDATE Row"] --> CHK{"Unique Index Check"}
    CHK -->|"Partial Predicate False (is_active = false)"| ALLOW["Allowed (Not Indexed)"]
    CHK -->|"Key Not Present"| WRITE["Insert Key + Allow Write"]
    CHK -->|"Duplicate Key Found"| ERR["ERROR: duplicate key value violates unique constraint"]

    classDef start fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef ok fill:#064e3b,stroke:#10b981,color:#ecfdf5
    classDef err fill:#7f1d1d,stroke:#f87171,color:#fef2f2
    class INS,CHK start
    class ALLOW,WRITE ok
    class ERR err
```

```sql
-- Enforce single-column uniqueness + fast lookup
CREATE UNIQUE INDEX idx_email ON users(email);

-- Multi-column uniqueness (one account per currency per customer)
CREATE UNIQUE INDEX idx_unique_combination ON accounts(customer_id, currency);

-- Partial unique index: max 1 active user per email, multiple soft-deleted/inactive OK
CREATE UNIQUE INDEX idx_unique_active ON users(email)
WHERE is_active = true;
```

> [!TIP]
> A **partial unique index** (`WHERE deleted_at IS NULL` or `WHERE is_active = true`) is the cleanest PostgreSQL pattern for soft-delete uniqueness without application-level race conditions.

---

## EXPLAIN and EXPLAIN ANALYZE

`EXPLAIN` shows the planner's **estimated** execution tree, whereas `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` actually **executes** the query and reports real timings, row counts, and buffer hits.

```mermaid
flowchart TD
    SQL["SQL Query"] --> P["Planner / Optimizer (Cost Model)"]
    P -->|"EXPLAIN (Estimate Only)"| EST["Estimated Plan: cost=startup..total, rows=est"]
    P -->|"EXPLAIN (ANALYZE, BUFFERS)"| EXEC["Executor Runs Plan"]
    EXEC --> ACT["Actual Plan: actual time=.., rows=act, Buffers: shared hit/read"]
    ACT --> DIFF{"Estimated vs Actual Rows Mismatch?"}
    DIFF -->|"Large Mismatch"| STATS["Stale Stats → Run ANALYZE"]
    DIFF -->|"Accurate Estimate"| CHECK["Check Seq Scan / High Loops / Disk Spill"]

    classDef start fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef warn fill:#451a03,stroke:#f59e0b,color:#fef3c7
    classDef ok fill:#064e3b,stroke:#10b981,color:#ecfdf5
    class SQL,P,EXEC,DIFF start
    class STATS,CHECK warn
    class EST,ACT ok
```

### Key Plan Node Types

| Node | Meaning | When Used |
| :--- | :--- | :--- |
| **Seq Scan** | Sequential scan of all Heap pages | No suitable index, small table, or low selectivity (>10–15% rows) |
| **Index Scan** | Traverse B-Tree, then fetch Heap rows | Indexed column with good selectivity |
| **Index Only Scan** | All needed columns in index + VM hit | Covering index (`INCLUDE`) or `COUNT(*)` |
| **Bitmap Index Scan** | Build page bitmap from index(es), then sequential Heap read | Moderate/many matches, or combining multiple indexes (`AND`/`OR`) |
| **Nested Loop Join** | For each outer row, probe inner table/index | Small outer input, indexed inner join |
| **Hash Join** | Build hash table on smaller input, probe with larger | Medium–large unsorted tables, inner fits in `work_mem` |
| **Merge Join** | Lockstep merge of two pre-sorted inputs | Both inputs pre-sorted (e.g., B-Tree) or very large tables |

### Reading `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)`

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM employees WHERE salary > 100000;

-- Seq Scan on employees  (cost=0.00..1234.00 rows=234 width=64) (actual time=0.10..2.30 rows=234 loops=1)
--   Filter: (salary > 100000)
--   Buffers: shared hit=100 read=2
-- Planning Time: 0.1 ms
-- Execution Time: 2.4 ms
```

### PostgreSQL Cost Model Constants

- **Cost unit** = `1.0` sequential 8KB page read (`seq_page_cost = 1.0`).
- **Random page read**: `random_page_cost = 4.0` (often tuned to `1.1`–`1.5` on NVMe SSDs).
- **CPU costs**: `cpu_tuple_cost = 0.01` per row, `cpu_operator_cost = 0.005` per `WHERE` clause evaluation.
- **Example**: Scanning 1M rows across 1,000 blocks sequentially costs `1000 * 1.0 + 1,000,000 * 0.01 = 11,000` units, whereas an Index Scan for 100 rows costs `~20 * 4.0 + 100 * 0.01 = 81` units.

> [!IMPORTANT]
> Always check **estimated vs. actual rows** and **Buffers: `shared hit` vs. `read`**. A 10x+ row estimate mismatch indicates stale statistics (`ANALYZE`), and a buffer cache hit ratio should typically exceed **99%** in OLTP workloads.

---

## Physical Join Algorithms

PostgreSQL implements joins using three physical strategies: **Nested Loop**, **Hash Join**, and **Merge Join**.

![PostgreSQL Physical Join Algorithms](./assets/03-join-algorithms-anim.svg)

```mermaid
flowchart TD
    J["Join Two Relations R and S"] --> EQ{"Equijoin (=)?"}
    EQ -->|"No (&lt;, &gt;, BETWEEN)"| NL["Nested Loop Join"]
    EQ -->|"Yes (=)"| SZ{"Outer Input Small (&lt; 1k) + Inner Indexed?"}
    SZ -->|"Yes"| NL
    SZ -->|"No"| SRT{"Both Inputs Pre-Sorted (B-Tree) or &gt; work_mem?"}
    SRT -->|"Yes"| MJ["Merge Join: O(N + M)"]
    SRT -->|"No (Fits in work_mem)"| HJ["Hash Join: Build + Probe O(N + M)"]

    classDef q fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef algo fill:#064e3b,stroke:#10b981,color:#ecfdf5
    class J,EQ,SZ,SRT q
    class NL,MJ,HJ algo
```

### Physical Join Comparison

| Algorithm | Complexity | Memory Usage | Startup Cost | Best Scenario |
| :--- | :--- | :--- | :--- | :--- |
| **Nested Loop** | $O(N \cdot \log M)$ w/ index | Minimal | Very Low | Small outer table + indexed inner; fast with `LIMIT` |
| **Hash Join** | $O(N + M)$ | `work_mem` (spills if exceeded) | High (Build phase) | Unsorted medium/large tables with `=` join |
| **Merge Join** | $O(N + M)$ if pre-sorted | Low (unless sorting) | Low if indexed | Pre-sorted B-Tree inputs, huge tables, or `ORDER BY` on join key |

> [!WARNING]
> A **Nested Loop** with `loops=50000` in `EXPLAIN ANALYZE` is a classic symptom of stale statistics underestimating the outer table's row count (e.g., estimating `rows=1` when actual `rows=50000`). Run `ANALYZE` so the planner switches to a **Hash Join** or **Merge Join**.

---

## Query Optimization Strategies

```mermaid
flowchart LR
    Q["Slow Query"] --> S1["1. Make Predicates SARGable (No Functions on Indexed Cols)"]
    Q --> S2["2. Composite Index Order (Selectivity + Equality First)"]
    Q --> S3["3. Keep Statistics Fresh (ANALYZE / autovacuum)"]
    Q --> S4["4. Parameterized Queries (Prepared Statements)"]

    classDef q fill:#7f1d1d,stroke:#f87171,color:#fef2f2
    classDef s fill:#064e3b,stroke:#10b981,color:#ecfdf5
    class Q q
    class S1,S2,S3,S4 s
```

### 1. Avoiding Full Table Scans (SARGable Predicates)

```sql
-- Problem: Function call on indexed column prevents B-Tree use
SELECT * FROM users WHERE DATE(created_at) = '2024-01-15';
-- Solution: Rewrite as sargable range query
SELECT * FROM users
WHERE created_at >= '2024-01-15'::date
  AND created_at < '2024-01-15'::date + '1 day'::interval;

-- Problem: UPPER(name) = 'WIDGET' -> Solution: Expression index
CREATE INDEX idx_product_name ON products(UPPER(name));

-- Problem: Leading wildcard LIKE '%@gmail.com' -> Solution: Dedicated column or GIN FTS
ALTER TABLE customers ADD COLUMN email_domain text;
CREATE INDEX idx_domain ON customers(email_domain);
```

### 2. Proper Indexing Strategy & Usage Monitoring

```sql
-- Avoid indexing every column independently (hurts writes & memory)
-- Instead, create targeted composite indexes for common WHERE clauses:
CREATE INDEX idx_main ON big_table(col1, col2, col3);

-- Audit unused or high-scan indexes
SELECT indexname, idx_scan FROM pg_stat_user_indexes ORDER BY idx_scan DESC;
```

### 3. Statistics and `ANALYZE`

```sql
ANALYZE;              -- Update stats for all tables
ANALYZE table_name;   -- Update stats for a specific table

-- Tune autovacuum analyze frequency for huge tables
ALTER TABLE big_table SET (autovacuum_analyze_scale_factor = 0.001);

-- Inspect planner histograms & most-common values
SELECT * FROM pg_stats WHERE tablename = 'employees';
```

### 4. Parameterized Queries and Plan Caching

```sql
-- Prepared statements reuse cached plans and prevent SQL injection
PREPARE fetch_orders (int) AS
SELECT * FROM orders WHERE customer_id = $1;
EXECUTE fetch_orders(1);
```

```java
PreparedStatement ps = conn.prepareStatement(
    "SELECT * FROM orders WHERE customer_id = ?"
);
ps.setInt(1, customerId); // Plan cached after initial executions
```

> [!TIP]
> Keep predicates **SARGable** (Search ARGument-able): never wrap an indexed column in a function (`DATE(col)`, `LOWER(col)`, `col + 1 = 5`) unless you have a matching **expression index**.

---

## N+1 Query Problem

The **N+1 problem** occurs when an application executes `1` query to fetch `N` parent records, followed by `N` separate queries in a loop to fetch each parent's children.

```mermaid
sequenceDiagram
    participant App as Application
    participant DB as PostgreSQL

    Note over App,DB: Anti-Pattern: 1 + N Queries (1001 Round-Trips)
    App->>DB: SELECT * FROM customers (1 query)
    DB-->>App: 1000 customers
    loop For each customer (1..1000)
        App->>DB: SELECT * FROM orders WHERE customer_id = ?
        DB-->>App: orders
    end

    Note over App,DB: Fix: Single JOIN or Batched IN Clause (1-2 Queries)
    App->>DB: SELECT * FROM orders WHERE customer_id IN (1..1000)
    DB-->>App: All orders in 1 round-trip
```

### Anti-Pattern vs. Fixes (Java / SQL)

```java
// BAD: 1 + N queries (1,001 round-trips for 1,000 customers)
List<Customer> customers = fetchAllCustomers();
for (Customer customer : customers) {
    List<Order> orders = fetchOrdersByCustomer(customer.id);
}
```

- **Solution 1: Single `LEFT JOIN` Query**
  ```sql
  SELECT c.*, o.*
  FROM customers c
  LEFT JOIN orders o ON c.id = o.customer_id
  WHERE c.active = true;
  ```
- **Solution 2: Batched `IN (...)` Query (2 Queries Total)**
  ```java
  List<Long> customerIds = customers.stream().map(Customer::getId).collect(Collectors.toList());
  Map<Long, List<Order>> ordersByCustomer = fetchOrdersByCustomerIds(customerIds);
  // Executes: SELECT * FROM orders WHERE customer_id IN (...)
  ```
- **Solution 3: ORM Eager Loading (`FetchType.EAGER` / `JOIN FETCH`)**
  ```java
  @Entity
  class Customer {
      @OneToMany(fetch = FetchType.EAGER)
      List<Order> orders;
  }
  ```

> [!IMPORTANT]
> Detect N+1 queries by enabling query logging or APM tracing and looking for identical parameterized queries firing inside a loop. Fix with `JOIN FETCH`, a batched `IN (...)` / `ANY($1)` query, or DataLoader batching.

---

## Index Bloat and Maintenance

Heavy `UPDATE` and `DELETE` workloads leave dead tuples and half-empty B-Tree pages, degrading cache efficiency and inflating I/O.

```mermaid
flowchart LR
    UPD["Heavy UPDATE / DELETE Churn"] --> DEAD["Dead Tuples + Sparse Leaf Pages"]
    DEAD --> BLT["Index Bloat (More Pages Read per Scan)"]
    BLT --> MON["Monitor pg_stat_user_indexes"]
    MON --> FIX1["REINDEX INDEX idx_name (Locks Table)"]
    MON --> FIX2["REINDEX INDEX CONCURRENTLY idx_name (Online, PG 12+)"]

    classDef bad fill:#7f1d1d,stroke:#f87171,color:#fef2f2
    classDef mon fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef ok fill:#064e3b,stroke:#10b981,color:#ecfdf5
    class UPD,DEAD,BLT bad
    class MON mon
    class FIX1,FIX2 ok
```

```sql
-- Check index usage & size
SELECT indexname, idx_scan, idx_tup_read, idx_tup_fetch,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE idx_scan > 0
ORDER BY idx_scan DESC;

-- Rebuild options
REINDEX INDEX idx_name;               -- Brief exclusive lock
REINDEX TABLE table_name;             -- Rebuilds all indexes on table
REINDEX DATABASE mydb;                -- Rebuilds all DB indexes (caution on prod)
REINDEX INDEX CONCURRENTLY idx_name;  -- Online rebuild (PostgreSQL 12+, no write lock)
```

> [!WARNING]
> Standard `REINDEX INDEX` blocks writes on the table. In production, always use `REINDEX INDEX CONCURRENTLY` (PostgreSQL 12+) or `CREATE INDEX CONCURRENTLY` + swap + `DROP INDEX CONCURRENTLY`.

---

## Slow Query Identification and Optimization Workflow

```mermaid
flowchart TD
    S1["Step 1: Enable Slow Query Logging (log_min_duration_statement = 1000)"] --> S2["Step 2: Tail Logs / pg_stat_statements"]
    S2 --> S3["Step 3: Run EXPLAIN (ANALYZE, BUFFERS, VERBOSE)"]
    S3 --> S4{"Step 4: Identify Bottleneck"}
    S4 -->|"Seq Scan on Large Table"| F1["Add Index or Fix Function/Type Mismatch"]
    S4 -->|"Estimated vs Actual Mismatch"| F2["Run ANALYZE"]
    S4 -->|"High nloops in Nested Loop"| F3["Update Stats / Add Index"]
    S4 -->|"Repeated Loop Queries"| F4["Fix N+1 in App"]

    classDef step fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef fix fill:#064e3b,stroke:#10b981,color:#ecfdf5
    class S1,S2,S3,S4 step
    class F1,F2,F3,F4 fix
```

### 4-Step Workflow

1. **Enable Query Logging (`postgresql.conf`):**
   ```sql
   log_min_duration_statement = 1000  -- Log queries > 1s
   log_duration = on
   SELECT pg_reload_conf();
   ```
2. **Identify Slow Queries:**
   ```bash
   tail -f /var/log/postgresql/postgresql.log | grep "duration:"
   ```
3. **Run `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)`:** Inspect for large `Seq Scan`, high `nloops` on `Nested Loop`, or estimated vs. actual row mismatches.
4. **Fix Common Root Causes:**
   ```sql
   -- 1. Missing index -> CREATE INDEX idx ON orders(customer_id);
   -- 2. Bad statistics -> ANALYZE orders;
   -- 3. N+1 query -> Use JOIN or IN clause
   -- 4. Function on column -> CREATE INDEX idx ON users(UPPER(email));
   -- 5. Implicit type conversion: id = '5' (text) vs id = 5 (int) -> Match column type!
   ```

> [!TIP]
> Implicit type conversions (e.g., passing `'5'` as text for an `int` or `bigint` column) can silently disable index usage. Always match parameter types to schema types.

---

## Partitioning

**Partitioning** splits a large logical table (100GB+) into smaller physical child tables, enabling **partition pruning** (scanning only relevant partitions), smaller per-partition indexes, and instant `DROP TABLE` archival instead of expensive `DELETE`.

```mermaid
flowchart TD
    P["Logical Table: orders (PARTITION BY RANGE created_at)"] --> P22["orders_2022 (2022..2023)"]
    P --> P23["orders_2023 (2023..2024)"]
    P --> P24["orders_2024 (2024..2025)"]
    Q["WHERE created_at &gt;= '2024-01-01'"] -->|"Partition Pruning"| P24
    Q -.->|"Pruned (Skipped)"| P22
    Q -.->|"Pruned (Skipped)"| P23

    classDef parent fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef hit fill:#064e3b,stroke:#10b981,color:#ecfdf5
    classDef skip fill:#1e293b,stroke:#475569,color:#94a3b8
    class P,Q parent
    class P24 hit
    class P22,P23 skip
```

### Partitioning Strategies

| Strategy | Partition Key Example | Best For |
| :--- | :--- | :--- |
| **Range** (Most Common) | `created_at` (by month/year) | Time-series data, easy `DROP` retention |
| **List** | `region` (`'USA'`, `'UK'`, ...) | Discrete categories, tenant/geo isolation |
| **Hash** | `HASH (user_id)` (`modulus 8`) | Uniform load distribution across N shards/partitions |

```sql
-- Range Partitioning
CREATE TABLE orders (
    id bigserial, customer_id int, amount numeric, created_at timestamp
) PARTITION BY RANGE (EXTRACT(YEAR FROM created_at));

CREATE TABLE orders_2024 PARTITION OF orders FOR VALUES FROM (2024) TO (2025);
CREATE INDEX idx_orders_2024_customer ON orders_2024(customer_id);

-- List Partitioning
CREATE TABLE sales_by_region (id serial, region text, revenue numeric) PARTITION BY LIST (region);
CREATE TABLE sales_americas PARTITION OF sales_by_region FOR VALUES IN ('USA', 'CANADA', 'MEXICO');

-- Hash Partitioning
CREATE TABLE events (id bigserial, user_id int, data jsonb) PARTITION BY HASH (user_id);
CREATE TABLE events_0 PARTITION OF events FOR VALUES WITH (modulus 8, remainder 0);
```

> [!IMPORTANT]
> **Interview Tip:** Partitioning adds DDL and maintenance complexity and is **not** a silver bullet for small tables. Reserve it for **100GB+ tables** where partition pruning, smaller indexes, and fast retention (`DROP PARTITION`) deliver clear wins.

---

## Common Performance Anti-Patterns

```mermaid
flowchart LR
    A1["SELECT *"] -->|"Defeats Covering Index"| R1["Select Needed Columns Only"]
    A2["LIKE '%@gmail.com'"] -->|"Cannot Use B-Tree"| R2["GIN Full-Text or Domain Column"]
    A3["Correlated Subquery"] -->|"N+1 Execution per Row"| R3["LEFT JOIN + GROUP BY"]
    A4["Expensive DISTINCT"] -->|"Sort / Hash Overhead"| R4["Fix JOIN or GROUP BY"]
    A5["ORDER BY Without Index"] -->|"Seq Scan + Disk Sort"| R5["Index (col DESC) INCLUDE (...)"]

    classDef bad fill:#7f1d1d,stroke:#f87171,color:#fef2f2
    classDef good fill:#064e3b,stroke:#10b981,color:#ecfdf5
    class A1,A2,A3,A4,A5 bad
    class R1,R2,R3,R4,R5 good
```

```sql
-- 1. Avoid SELECT * (breaks Index-Only Scans and wastes network/memory)
SELECT id, name, price FROM products;

-- 2. Wildcard Search: Use GIN Full-Text Search instead of LIKE '%...'
CREATE INDEX idx_email_fts ON users USING GIN(to_tsvector('english', email));
SELECT * FROM users WHERE to_tsvector('english', email) @@ 'gmail';

-- 3. Correlated Subquery -> Rewrite as LEFT JOIN + GROUP BY
SELECT e.*, COALESCE(a.count, 0) AS assignment_count
FROM employees e
LEFT JOIN (
    SELECT employee_id, COUNT(*) AS count FROM assignments GROUP BY employee_id
) a ON e.id = a.employee_id;

-- 4. DISTINCT on large sets -> Fix underlying JOIN duplication or use indexed GROUP BY

-- 5. Sorting without index -> Add matching ordered covering index
CREATE INDEX idx_created_desc ON orders(created_at DESC) INCLUDE (customer_id, amount);
```

> [!WARNING]
> `SELECT *` is the #1 silent killer of **Index-Only Scans** — even if you build a covering index for your hot columns, `SELECT *` forces PostgreSQL back to the Heap table for every single row.

---

## Interview Scenario: "Your Query is Slow"

```mermaid
flowchart TD
    Q["Interviewer: Your query is slow. What do you do?"] --> G["1. Clarify Scope (Latency, Frequency, Result Size)"]
    G --> E["2. Run EXPLAIN (ANALYZE, BUFFERS)"]
    E --> I["3. Inspect Plan: Seq Scan? High nloops? Sort? Row Mismatch?"]
    I --> R["4. Root Cause: Missing Index / Stale Stats / Non-SARGable / N+1"]
    R --> V["5. Fix + ANALYZE + Re-run EXPLAIN (ANALYZE, BUFFERS) to Verify"]

    classDef step fill:#1e3a8a,stroke:#60a5fa,color:#f8fafc
    classDef verify fill:#064e3b,stroke:#10b981,color:#ecfdf5
    class Q,G,E,I,R step
    class V verify
```

### Structured 5-Step Response

1. **Gather context:** Current vs. target latency, execution frequency, and expected result size.
2. **Capture the actual plan:** `EXPLAIN (ANALYZE, BUFFERS) SELECT ...;`
3. **Spot bottlenecks:** `Seq Scan` on large tables, high `nloops` on `Nested Loop`, large `Sort` spilling to disk, or large `estimated` vs. `actual` row mismatches.
4. **Diagnose root cause:** Missing/unused index, stale statistics, non-SARGable predicate (function or implicit cast), wrong join type, or application N+1 loop.
5. **Apply fix & verify:** Create index (use `CONCURRENTLY` in prod), run `ANALYZE`, and re-run `EXPLAIN (ANALYZE, BUFFERS)` to confirm plan and buffer/time improvements.

> [!TIP]
> **Example Interview Answer:** *"I'd start with `EXPLAIN (ANALYZE, BUFFERS)`. If I see a `Seq Scan` where I expect an `Index Scan`, I'd check whether the index exists, run `ANALYZE` for fresh stats, and inspect the `WHERE` clause for non-SARGable functions or implicit type casts. After applying the fix, I'd re-run `EXPLAIN ANALYZE` to verify the plan and execution time."*
