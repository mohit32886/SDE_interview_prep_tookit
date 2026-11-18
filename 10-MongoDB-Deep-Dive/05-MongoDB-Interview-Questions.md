# MongoDB Interview Questions — FAANG Deep Dive

> 50+ questions with detailed answers. Organized by category, progressing from fundamentals to architecture to schema design scenarios.

---

## Table of Contents

1. [Fundamentals](#1-fundamentals)
2. [Querying & Aggregation](#2-querying--aggregation)
3. [Indexing & Performance](#3-indexing--performance)
4. [Architecture & Operations](#4-architecture--operations)
5. [Schema Design Scenarios](#5-schema-design-scenarios)
6. [MongoDB vs Other Databases](#6-mongodb-vs-other-databases)
7. [Java / Spring Data MongoDB](#7-java--spring-data-mongodb)
8. [Quick Revision Table](#quick-revision-table)

---

## 1. Fundamentals

![MongoDB Interview Decision Matrix](./assets/05-mongodb-interview-hub.svg)

```mermaid
flowchart TD
    Q["Data Modeling Decision"] --> A{"Accessed together &amp; bounded?"}
    A -->|Yes| E["Embed Document (16MB max)"]
    A -->|No / Unbounded| R["Reference in Separate Collection"]
    E --> S{"Exceeds 16MB?"}
    S -->|Files &gt; 16MB| G["GridFS (255KB chunks)"]
    S -->|Time-series / Logs| B["Bucket or Subset Pattern"]
    S -->|Within limit| OK["Atomic Single-Doc Updates"]

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    class Q,A,S blue
    class E,OK green
    class R,B amber
    class G purple
```

### Q1: What is MongoDB and how does it differ from relational databases?

MongoDB is a document-oriented NoSQL database that stores data as flexible JSON-like documents (BSON).

| Aspect | MongoDB | Relational (PostgreSQL/MySQL) |
|--------|---------|-------------------------------|
| Data Model | Documents (BSON) | Rows in tables |
| Schema | Flexible / dynamic | Rigid / predefined |
| Relationships | Embedded docs or references | Foreign keys + JOINs |
| Scaling | Horizontal (sharding built-in) | Primarily vertical |
| Transactions | Multi-doc transactions (4.0+) | Full ACID from day one |
| Query Language | MQL (MongoDB Query Language) | SQL |
| JOINs | `$lookup` (limited) | Full JOIN support |

- **Use MongoDB for:** High write throughput, flexible/evolving schemas, hierarchical data, rapid prototyping, event logging, CMS, real-time analytics.
- **Avoid MongoDB for:** Complex multi-table JOINs, strict ACID across many entities, mature relational data with deep relationships.

---

### Q2: What is BSON? How is it different from JSON?

BSON (Binary JSON) is the binary-encoded serialization format MongoDB uses internally.

| Feature | JSON | BSON |
|---------|------|------|
| Format | Text-based | Binary |
| Data Types | 6 (string, number, boolean, null, array, object) | 20+ (adds Date, ObjectId, Decimal128, Binary, etc.) |
| Traversal | Must parse entire document | Supports offset-based traversal |
| Size | Smaller for simple docs | Slightly larger (stores field lengths) |
| Speed | Slower to parse | Faster encode/decode |

BSON enables MongoDB to traverse documents via field offsets without parsing the entire structure — critical for query performance.

---

### Q3: Explain ObjectId. How is it generated? Can it collide?

ObjectId is a **12-byte** unique identifier:

| Segment | Size | Purpose |
|---------|------|---------|
| **Timestamp** | 4 bytes | Unix epoch in seconds — gives creation time for free |
| **Random value** | 5 bytes | Unique per machine + process |
| **Counter** | 3 bytes | Starts from random value, increments per process |

- **Collision probability:** Virtually zero. Requires the same second, same machine, same process, and exhausting $2^{24}$ (~16.7 million) counter values.

```java
// Extract creation time from ObjectId
ObjectId id = new ObjectId("507f1f77bcf86cd799439011");
Date created = id.getDate(); // Returns timestamp embedded in ID
```

> [!TIP]
> ObjectIds are roughly sortable by creation time (timestamp is the leading component), making them decent for range queries on insertion order — though NOT strictly ordered across distributed systems.

---

### Q4: Embedded documents vs References — how do you decide?

| Embed When | Reference When |
|------------|----------------|
| Data is accessed together (e.g., user + address) | Data is accessed independently |
| One-to-few relationship (2–3 addresses) | One-to-many with unbounded growth (10,000 orders) |
| Data doesn't change independently | Many-to-many relationships |
| Atomic single-document updates needed | Document would exceed 16MB limit |
| Read performance is priority | Data changes independently or deduplication needed |

```javascript
// Embedded (denormalized)
{
  _id: ObjectId("..."),
  name: "Mohit",
  addresses: [
    { type: "home", city: "Kolkata", zip: "700001" },
    { type: "work", city: "Mumbai", zip: "400001" }
  ]
}

// Referenced (normalized)
// users collection
{ _id: ObjectId("u1"), name: "Mohit", address_ids: [ObjectId("a1"), ObjectId("a2")] }
// addresses collection
{ _id: ObjectId("a1"), type: "home", city: "Kolkata", zip: "700001" }
```

> [!NOTE]
> **Rule of thumb:** When in doubt, embed. MongoDB is optimized for embedded reads; only reference when you have a compelling reason.

---

### Q5: What is the 16MB document size limit? How do you handle large data?

MongoDB enforces a **16MB BSON document size limit**. Strategies for large data:

1. **GridFS:** For files >16MB. Splits file into 255KB chunks in `fs.chunks` and metadata in `fs.files`.
2. **Subset pattern:** Store only the most recent/relevant subset in the document; archive the rest.
3. **Bucket pattern:** Group related data into time-based buckets (e.g., IoT readings per hour/day).
4. **Reference pattern:** Move large arrays to a separate collection and store references.

```javascript
// Bucket pattern for time-series data
{
  sensor_id: "temp-001",
  date: ISODate("2025-01-15"),
  readings: [
    { time: ISODate("2025-01-15T00:00:00Z"), value: 22.5 },
    { time: ISODate("2025-01-15T00:01:00Z"), value: 22.6 },
    // ... up to 1440 readings per day bucket
  ],
  count: 1440,
  sum: 32400,
  avg: 22.5
}
```

---

### Q6: What are MongoDB's write concerns and read concerns?

**Write Concern** — acknowledgment level for write operations:

| Write Concern | Meaning | Durability | Performance |
|---------------|---------|------------|-------------|
| `w: 0` | Fire and forget | None | Fastest |
| `w: 1` (default) | Acknowledged by primary | Primary only | Fast |
| `w: "majority"` | Acknowledged by majority of replica set | High | Slower |
| `j: true` | Written to journal on disk | Highest | Slowest |

**Read Concern** — consistency level for read operations:

| Read Concern | Meaning |
|--------------|---------|
| `local` (default) | Returns most recent data on the node (may be rolled back) |
| `available` | Like `local`, but for sharded clusters |
| `majority` | Returns data acknowledged by majority (won't be rolled back) |
| `linearizable` | Strongest — reflects all successful majority-committed writes before the read |
| `snapshot` | For multi-document transactions |

> [!IMPORTANT]
> **Interview answer:** "For financial systems like at Barclays, I'd use `w: majority` with `j: true` for critical writes (trade confirmations, settlements) to ensure durability, and `readConcern: majority` to avoid reading data that could be rolled back. For logging or analytics, `w: 1` is sufficient."

---

### Q7: Explain MongoDB's storage engine (WiredTiger).

WiredTiger (default since MongoDB 3.2):

- **Document-level concurrency control:** Optimistic concurrency with document-level locks (not collection or database level).
- **Compression:** `snappy` (default), `zlib`, `zstd` for data; prefix compression for indexes.
- **Cache:** Internal cache (default: `50% of RAM - 1GB`) keeps hot data in memory.
- **Journaling:** Write-ahead log (WAL) for crash recovery — writes go to journal first, then data files.
- **Checkpoints:** Creates consistent data snapshots every 60 seconds.

```mermaid
flowchart LR
    C["Client"] --> WTC["WiredTiger Cache (In-Memory)"]
    WTC -->|Write Path| J["Journal (WAL)"]
    J --> CP["Checkpoint (60s)"]
    CP --> D["Disk Data Files"]
    C -->|Read Hit| WTC
    WTC -->|Read Miss| D
    D -->|Populate| WTC

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    class C blue
    class WTC,J green
    class CP,D amber
```

> [!TIP]
> When asked "how does MongoDB handle concurrent writes," explain **document-level locking with WiredTiger** — not the legacy MMAPv1 collection-level locking.

---

### Q8: What happens when a document is updated? Does MongoDB update in-place?

WiredTiger uses a **no-overwrite** storage model:
1. The original document stays on disk.
2. A new version is written to a new location.
3. Internal data structures are updated to point to the new location.
4. Old versions are reclaimed during checkpoints.

**Benefits:**
- Growing documents don't require contiguous space reallocation (unlike MMAPv1).
- Sequential writes improve compression efficiency.
- Reads run concurrently with writes via **MVCC** (Multi-Version Concurrency Control).

---

## 2. Querying & Aggregation

```mermaid
flowchart LR
    M1["1. $match Early (Uses Index)"] --> G["2. $group (Aggregates Filtered Set)"]
    G --> SL["3. $sort + $limit (Top-K Coalesced)"]
    SL --> L["4. $lookup (Left Outer Join)"]
    L --> U["5. $unwind (Flatten Array)"]
    U --> P["6. $project (Shape Output)"]

    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    class M1 green
    class G,SL blue
    class L,U amber
    class P purple
```

### Q9: Write an aggregation pipeline to find the top 3 customers by total order amount.

```javascript
db.orders.aggregate([
  // Stage 1: Group by customer, sum their order amounts
  { $group: {
      _id: "$customer_id",
      totalSpent: { $sum: "$amount" },
      orderCount: { $sum: 1 }
  }},
  // Stage 2: Sort by totalSpent descending
  { $sort: { totalSpent: -1 } },
  // Stage 3: Take top 3
  { $limit: 3 },
  // Stage 4: Join with customers collection for names
  { $lookup: {
      from: "customers",
      localField: "_id",
      foreignField: "_id",
      as: "customerInfo"
  }},
  // Stage 5: Flatten the joined array
  { $unwind: "$customerInfo" },
  // Stage 6: Shape the output
  { $project: {
      _id: 0,
      customerName: "$customerInfo.name",
      totalSpent: 1,
      orderCount: 1
  }}
])
```

**Spring Data MongoDB equivalent:**

```java
Aggregation agg = Aggregation.newAggregation(
    group("customerId")
        .sum("amount").as("totalSpent")
        .count().as("orderCount"),
    sort(Sort.Direction.DESC, "totalSpent"),
    limit(3),
    lookup("customers", "_id", "_id", "customerInfo"),
    unwind("customerInfo"),
    project()
        .andExclude("_id")
        .and("customerInfo.name").as("customerName")
        .andInclude("totalSpent", "orderCount")
);

List<CustomerSpending> results = mongoTemplate
    .aggregate(agg, "orders", CustomerSpending.class)
    .getMappedResults();
```

---

### Q10: Explain $lookup. What are its limitations?

`$lookup` performs a left outer join between two collections.

```javascript
// Basic syntax
{ $lookup: {
    from: "inventory",        // Foreign collection
    localField: "item",       // Field from input documents
    foreignField: "sku",      // Field from foreign collection
    as: "inventoryDocs"       // Output array field
}}

// Correlated subquery (3.6+) — more powerful
{ $lookup: {
    from: "warehouses",
    let: { order_item: "$item", order_qty: "$quantity" },
    pipeline: [
      { $match: { $expr: {
          $and: [
            { $eq: ["$stock_item", "$$order_item"] },
            { $gte: ["$instock", "$$order_qty"] }
          ]
      }}}
    ],
    as: "stockData"
}}
```

**Limitations:**
- Foreign collection must be in the **same database** (cross-db supported in 5.1+).
- Foreign collection **cannot be sharded** (until 5.1).
- No index hint support on the foreign pipeline.
- Performance degrades with large foreign collections (no hash join optimization).
- Always returns an array (even for 1:1) — requires `$unwind` for flat results.
- Nested `$lookup` is possible but hard to optimize.

> [!TIP]
> "If I find myself using many `$lookup`s, it usually signals that my schema design needs rethinking. MongoDB works best with embedded documents that minimize cross-collection queries."

---

### Q11: How does $unwind work? What about empty arrays?

`$unwind` deconstructs an array field, outputting one document per array element.

```javascript
// Input
{ _id: 1, tags: ["java", "spring", "mongodb"] }

// After { $unwind: "$tags" }
{ _id: 1, tags: "java" }
{ _id: 1, tags: "spring" }
{ _id: 1, tags: "mongodb" }
```

| Case | Default Behavior | With `preserveNullAndEmptyArrays: true` |
|------|------------------|-----------------------------------------|
| `tags: []` | Document **dropped** | Document kept (`tags` omitted) |
| `tags` missing / `null` | Document **dropped** | Document kept |
| `tags` not an array | Passes through as-is | Passes through as-is |

```javascript
{ $unwind: {
    path: "$tags",
    preserveNullAndEmptyArrays: true,  // Keep docs with missing/empty arrays
    includeArrayIndex: "arrayIndex"     // Add index position field
}}
```

---

### Q12: How would you implement pagination in MongoDB? What are the pitfalls of skip/limit?

```mermaid
flowchart TD
    P["Pagination Request"] --> T{"Need arbitrary page jumps?"}
    T -->|"No (Infinite Scroll / Next)"| C["Cursor-Based: _id &gt; lastId + limit(20)"]
    T -->|"Yes (Page N)"| S["skip(N * 20).limit(20)"]
    C --> CO["O(log N) Index Seek — Constant Time"]
    S --> SO["Linear Scan — Discards Skipped Docs"]

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    class P,T blue
    class C,CO green
    class S,SO red
```

**Naive approach (`skip`/`limit`):**
```javascript
// Page 3, 20 items per page
db.products.find().sort({ _id: 1 }).skip(40).limit(20)
```
- **Pitfall:** `skip(100000)` still scans 100K documents and discards them — linear degradation.

**Better approach — Range-based (cursor) pagination:**
```javascript
// First page
db.products.find().sort({ _id: 1 }).limit(20)
// Remember the last _id: "abc123"

// Next page — seek directly using index
db.products.find({ _id: { $gt: ObjectId("abc123") } }).sort({ _id: 1 }).limit(20)
```
- **Trade-off:** Constant-time index seek regardless of page depth, but cannot jump directly to arbitrary page numbers (e.g., "page 50").

```java
// Spring Data MongoDB — cursor-based
@Query("{ '_id': { $gt: ?0 } }")
List<Product> findNextPage(ObjectId lastId, Pageable pageable);
```

---

### Q13: Explain the difference between $match before and after $group. Why does order matter?

```javascript
// GOOD: $match first (uses index, filters early)
[
  { $match: { status: "active", date: { $gte: ISODate("2025-01-01") } } },
  { $group: { _id: "$category", total: { $sum: "$amount" } } }
]

// BAD: $group first (processes ALL documents, then filters)
[
  { $group: { _id: "$category", total: { $sum: "$amount" } } },
  { $match: { total: { $gte: 1000 } } }
]
```

**Pipeline optimization rules:**
1. `$match` moves before `$project`/`$addFields` when independent of projected fields.
2. `$match` at the start **can use indexes**; after `$group` it **cannot**.
3. Adjacent `$match` stages are coalesced into one.
4. `$sort` + `$limit` are coalesced into a memory-efficient top-k sort.
5. `$project` moves after `$skip`/`$limit` to reduce work.

> [!IMPORTANT]
> "I always put `$match` as early as possible. The optimizer can move `$match` before `$project`, but never before `$group`. Filtering 1M documents down to 10K before grouping is orders of magnitude faster than grouping 1M first."

---

## 3. Indexing & Performance

```mermaid
flowchart LR
    E["1. Equality (status: 'shipped')"] --> S["2. Sort (date: -1)"]
    S --> R["3. Range (price: $gt 50)"]
    R --> G["Index Preserves Sort Order (No In-Memory SORT)"]

    E2["1. Equality"] --> R2["2. Range"]
    R2 --> S2["3. Sort"]
    S2 --> B["Range Breaks Sort Order → SORT_KEY_GENERATOR"]

    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    class E,S,R,G green
    class E2,R2,S2,B red
```

### Q14: Explain the ESR (Equality, Sort, Range) rule for compound indexes.

The ESR rule defines the optimal field order in a compound index:
1. **E (Equality):** Exact-match fields (`{ status: "active" }`)
2. **S (Sort):** Fields used in `.sort()` (`sort({ date: -1 })`)
3. **R (Range):** Range predicates (`{ price: { $gt: 100 } }`)

```javascript
// Query
db.orders.find({
  status: "shipped",           // Equality
  price: { $gt: 50, $lt: 200 } // Range
}).sort({ date: -1 })          // Sort

// OPTIMAL index (ESR order)
db.orders.createIndex({ status: 1, date: -1, price: 1 })
```

- **Why not E-R-S (`{ status: 1, price: 1, date: -1 }`)?** Within the `price` range, documents are NOT sorted by `date`, forcing MongoDB to perform an in-memory sort (`SORT_KEY_GENERATOR` in `explain()`).

> [!TIP]
> "Range predicates break sort order in a B-tree index. Putting Sort between Equality and Range preserves the index's sort order and eliminates in-memory sorts."

---

### Q15: What is a covered query? How do you achieve it?

A covered query is answered **entirely from the index** without fetching any documents from disk.

**Requirements:**
1. All fields in the query filter are in the index.
2. All fields in the projection are in the index.
3. No projected field is an array.
4. `_id` is excluded from projection (unless included in the index).

```javascript
// Index
db.users.createIndex({ email: 1, name: 1, status: 1 })

// Covered query — all fields in index
db.users.find(
  { email: "mohit@example.com" },   // Filter: email in index
  { name: 1, status: 1, _id: 0 }    // Projection: name, status in index, _id excluded
)
// explain(): totalDocsExamined: 0, totalKeysExamined: 1, stage: "IXSCAN" (no FETCH)

// NOT covered — 'age' is not in the index, so MongoDB must FETCH document
db.users.find(
  { email: "mohit@example.com" },
  { name: 1, age: 1, _id: 0 }
)
```

---

### Q16: How do you read and interpret an explain() plan?

```mermaid
flowchart TD
    EX["explain('executionStats')"] --> ST{"executionStages.stage"}
    ST -->|COLLSCAN| BAD1["Red Flag: Add Index"]
    ST -->|SORT| BAD2["Red Flag: Fix ESR Index Order"]
    ST -->|IXSCAN only| COV["Ideal: Covered Query (0 Docs Examined)"]
    ST -->|IXSCAN → FETCH| RAT{"totalDocsExamined ≈ nReturned?"}
    RAT -->|Yes| GOOD["Healthy Indexed Query"]
    RAT -->|"No (&gt;&gt; nReturned)"| SEL["Improve Index Selectivity"]

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    class EX,ST,RAT blue
    class COV,GOOD green
    class SEL amber
    class BAD1,BAD2 red
```

```javascript
db.orders.find({ status: "active", amount: { $gt: 100 } })
         .sort({ date: -1 })
         .explain("executionStats")
```

```
executionStats: {
  nReturned: 142,              // Documents returned to client
  executionTimeMillis: 23,     // Total time
  totalKeysExamined: 850,      // Index entries scanned
  totalDocsExamined: 850,      // Documents fetched from disk

  executionStages: {
    stage: "SORT",             // In-memory sort (bad for large sets)
    memUsage: 3245678,         // Memory used for sort
    inputStage: {
      stage: "FETCH",          // Fetching documents from disk
      inputStage: {
        stage: "IXSCAN",       // Index scan (good!)
        indexName: "status_1",
        direction: "forward",
        indexBounds: {
          status: ["active", "active"],
          amount: ["(100, inf]"]
        }
      }
    }
  }
}
```

| Red Flags | Ideal Plan |
|-----------|------------|
| `COLLSCAN` (full collection scan) | `IXSCAN` → `FETCH` (no `SORT`) |
| `SORT` stage / `memUsage > 32MB` (100MB cap) | Sort handled by index (no `SORT_KEY_GENERATOR`) |
| `totalDocsExamined >> nReturned` | `totalDocsExamined ≈ nReturned` |
| `totalKeysExamined >> nReturned` | Selective index bounds |

---

### Q17: What are TTL indexes? When would you use them?

TTL (Time-To-Live) indexes automatically delete documents after a specified duration.

```javascript
// Delete documents 30 days after 'createdAt'
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 2592000 })

// Delete documents at a specific time (set 'expiresAt' per document)
db.events.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
// Then set per-document: { expiresAt: ISODate("2025-06-15T00:00:00Z") }
```

- **Use cases:** Session management, temporary tokens, log rotation, GDPR auto-deletion, cache expiry.
- **Caveats:** Background thread runs every **60 seconds** (not instant), single-field date index only, cannot be compound.

---

### Q18: What are partial indexes? When are they useful?

Partial indexes only index documents matching a `partialFilterExpression`.

```javascript
// Only index active orders (most queries only care about active)
db.orders.createIndex(
  { customer_id: 1, date: -1 },
  { partialFilterExpression: { status: "active" } }
)
```

- **Benefits:** Smaller index footprint (less RAM), faster writes (inactive docs don't update the index).
- **Rule:** Queries must include the partial filter condition to use the index:

```javascript
// Will use partial index
db.orders.find({ customer_id: "c1", status: "active" })

// Will NOT use partial index (no status filter)
db.orders.find({ customer_id: "c1" })
```

---

## 4. Architecture & Operations

```mermaid
sequenceDiagram
    participant P as Primary
    participant S1 as Secondary 1 (Recent Oplog)
    participant S2 as Secondary 2
    participant D as Driver

    P->>S1: Oplog Replication + Heartbeat (2s)
    P->>S2: Oplog Replication + Heartbeat (2s)
    Note over P: Primary becomes unreachable
    S1--xP: Heartbeat Timeout (10s)
    S1->>S2: Call Election (Request Vote)
    S2-->>S1: Majority Vote Granted (2/3)
    Note over S1: S1 promoted to Primary (~10-12s total)
    D->>S1: Redirect Writes to New Primary
```

### Q19: Explain MongoDB replica set architecture. How does failover work?

A replica set consists of a **Primary** (all writes + default reads) and **Secondaries** (replicate via oplog; optional reads) connected by **2-second heartbeats**.

**Failover process (10–12s total):**
1. Primary becomes unreachable (default heartbeat timeout: **10s**).
2. Secondaries detect missing heartbeats and an eligible secondary calls an election.
3. Members vote (requires **majority**: 2 of 3 nodes).
4. Winning secondary becomes the new Primary; drivers automatically redirect writes.

**Election criteria & node roles:**
- Most recent oplog entry + higher `priority` preferred.
- `priority: 0` or **Hidden** members can vote but cannot become Primary.
- **Arbiters** vote without holding data (avoid in production when possible).

---

### Q20: How does sharding work? What makes a good shard key?

```mermaid
flowchart TD
    App["Client Application"] --> M["mongos (Query Router)"]
    M --> CS["Config Servers (3-Node RS: Chunk Metadata)"]
    M --> SH1["Shard 1 (Replica Set)"]
    M --> SH2["Shard 2 (Replica Set)"]
    M --> SH3["Shard 3 (Replica Set)"]

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    class App,M blue
    class CS purple
    class SH1,SH2,SH3 green
```

| Property | Good | Bad |
|----------|------|-----|
| High cardinality | `user_id` (millions of values) | `status` (3–4 values) |
| Even distribution | `hashed(user_id)` | `timestamp` (monotonic) |
| Query targeting | Queries include shard key | Scatter-gather across all shards |
| Not monotonic | Random or hashed | Auto-increment, `ObjectId`, `timestamp` |

```javascript
// BAD: monotonic, creates hotspot on last shard
sh.shardCollection("db.logs", { timestamp: 1 })

// BETTER: hashed for even distribution
sh.shardCollection("db.logs", { timestamp: "hashed" })

// BEST: compound key for both distribution and query targeting
sh.shardCollection("db.orders", { customer_id: 1, order_date: 1 })
```

> [!WARNING]
> **Critical interview point:** Shard keys are immutable (can be refined in 4.4+ or resharded in 5.0+ with overhead, but choosing wrong initially is costly). It is the single most important sharding decision.

---

### Q21: Explain MongoDB transactions. When should you avoid them?

**Single-document atomicity (always available, zero transaction overhead):**
```javascript
// Atomic without explicit transaction
db.accounts.updateOne(
  { _id: "acc1" },
  { $inc: { balance: -100 }, $push: { transactions: { amount: -100, date: new Date() } } }
)
```

**Multi-document transactions (4.0+ replica sets, 4.2+ sharded):**
```java
// Spring Data MongoDB transaction
@Transactional
public void transferFunds(String fromId, String toId, double amount) {
    Account from = accountRepository.findById(fromId)
        .orElseThrow(() -> new AccountNotFoundException(fromId));
    Account to = accountRepository.findById(toId)
        .orElseThrow(() -> new AccountNotFoundException(toId));

    if (from.getBalance() < amount) {
        throw new InsufficientFundsException();
    }

    from.setBalance(from.getBalance() - amount);
    to.setBalance(to.getBalance() + amount);

    accountRepository.save(from);
    accountRepository.save(to);
    // Both saves commit or both rollback
}
```

**When to AVOID transactions:**
- When schema redesign can achieve single-document atomicity.
- High-throughput paths (adds ~2x latency).
- Long-running operations (60s default timeout).
- Cross-shard transactions (high coordination overhead).

> [!IMPORTANT]
> "In MongoDB, the first question isn't 'how do I use transactions' but 'can I redesign my schema to avoid them?' Embedding related data gives atomicity for free."

---

### Q22: What are Change Streams? How would you use them?

Change Streams allow applications to subscribe to real-time changes on collections, databases, or entire deployments (requires replica set or sharded cluster).

```java
// Spring Data MongoDB — watch for changes
@Component
public class OrderChangeListener {

    @Autowired
    private MongoTemplate mongoTemplate;

    @PostConstruct
    public void watchOrders() {
        MessageListenerContainer container = new DefaultMessageListenerContainer(mongoTemplate);
        container.start();

        ChangeStreamRequest<Order> request = ChangeStreamRequest.builder()
            .collection("orders")
            .filter(Aggregation.newAggregation(
                Aggregation.match(Criteria.where("operationType").in("insert", "update"))
            ))
            .publishTo(message -> {
                ChangeStreamDocument<Order> change = message.getRaw();
                System.out.println("Operation: " + change.getOperationType());
                System.out.println("Document: " + change.getFullDocument());
            })
            .build();

        container.register(request, Order.class);
    }
}
```

- **Use cases:** Event-driven architectures, real-time sync between services, audit logging, cache invalidation, notifications.

---

### Q23: How do you back up and restore MongoDB?

| Method | Type | Impact | Point-in-Time |
|--------|------|--------|---------------|
| `mongodump` / `mongorestore` | Logical | Slow, high I/O | No |
| Filesystem snapshots (LVM/EBS) | Physical | Fast, low impact | Yes (with journal) |
| MongoDB Atlas continuous backup | Cloud | Zero impact | Yes (to the second) |
| Ops Manager / Cloud Manager | Enterprise | Low impact | Yes |

**Production best practices:** Use filesystem snapshots with journaling (`j: true`), back up from a **secondary**, store oplog for point-in-time recovery, and test restores regularly.

---

## 5. Schema Design Scenarios

```mermaid
erDiagram
    USERS ||--o{ ORDERS : places
    USERS ||--o{ REVIEWS : writes
    PRODUCTS ||--o{ REVIEWS : receives
    USERS {
        ObjectId _id
        string email
        array addresses_embedded
        array paymentMethods_tokens
    }
    PRODUCTS {
        ObjectId _id
        string slug
        object category_embedded
        array variants_embedded
        object ratings_summary
    }
    ORDERS {
        ObjectId _id
        ObjectId userId
        array items_snapshot
        array statusHistory_embedded
        string status
    }
    REVIEWS {
        ObjectId _id
        ObjectId productId
        ObjectId userId
        int rating
    }
```

### Q24: Design a MongoDB schema for an e-commerce platform.

```javascript
// 1. products — catalog items
{
  _id: ObjectId("..."),
  name: "MacBook Pro 16",
  slug: "macbook-pro-16",
  category: { _id: ObjectId("..."), name: "Laptops", path: "Electronics/Computers/Laptops" },
  brand: "Apple",
  price: { amount: 2499, currency: "USD" },
  variants: [
    { sku: "MBP16-M3-32", ram: "32GB", storage: "1TB", price: 2499 },
    { sku: "MBP16-M3-64", ram: "64GB", storage: "2TB", price: 3499 }
  ],
  specs: { processor: "M3 Max", display: "16.2 inch", weight: "2.14 kg" },
  ratings: { average: 4.7, count: 2341 },
  inventory: { total: 450, reserved: 23 },
  images: ["url1.jpg", "url2.jpg"],
  tags: ["laptop", "apple", "professional"],
  status: "active",
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}

// 2. users — customer accounts
{
  _id: ObjectId("..."),
  email: "mohit@example.com",
  name: { first: "Mohit", last: "Gupta" },
  addresses: [                              // Embedded — few addresses per user
    { label: "Home", street: "...", city: "Kolkata", zip: "700001", default: true }
  ],
  paymentMethods: [                         // Store tokens, NOT actual card numbers
    { type: "card", token: "tok_xxx", last4: "4242", brand: "Visa" }
  ],
  createdAt: ISODate("...")
}

// 3. orders — separate collection (grows unbounded, accessed independently)
{
  _id: ObjectId("..."),
  orderNumber: "ORD-2025-00001",
  userId: ObjectId("..."),                  // Reference to users
  items: [                                  // Snapshot at time of order
    { productId: ObjectId("..."), sku: "MBP16-M3-32", name: "MacBook Pro 16",
      price: 2499, quantity: 1 }
  ],
  shipping: { address: { /* embedded copy */ }, method: "express", cost: 15 },
  payment: { method: "card", last4: "4242", amount: 2514 },
  status: "shipped",
  statusHistory: [
    { status: "placed", at: ISODate("...") },
    { status: "paid", at: ISODate("...") },
    { status: "shipped", at: ISODate("..."), trackingNumber: "1Z999..." }
  ],
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}

// 4. reviews — separate collection (many per product, queried independently)
{
  _id: ObjectId("..."),
  productId: ObjectId("..."),
  userId: ObjectId("..."),
  userName: "Mohit G.",                     // Denormalized for display
  rating: 5,
  title: "Best laptop I've owned",
  body: "...",
  helpful: { up: 42, down: 3 },
  verified: true,
  createdAt: ISODate("...")
}
```

**Key indexes:**
```javascript
db.products.createIndex({ "category._id": 1, status: 1, "price.amount": 1 })
db.products.createIndex({ tags: 1 })           // Multikey index on array
db.products.createIndex({ name: "text", tags: "text" })  // Text search
db.orders.createIndex({ userId: 1, createdAt: -1 })
db.orders.createIndex({ status: 1, createdAt: -1 })
db.reviews.createIndex({ productId: 1, createdAt: -1 })
```

- **Design rationale:** Products embed bounded variants/specs; Orders snapshot item prices at purchase time; Reviews live in a separate collection (unbounded); Category path string enables tree queries (`/^Electronics/`).

---

### Q25: Design a schema for a social media feed (like Twitter).

```javascript
// posts collection
{
  _id: ObjectId("..."),
  authorId: ObjectId("..."),
  authorName: "Mohit Gupta",          // Denormalized (updated periodically)
  authorAvatar: "avatar_url",
  content: "Learning MongoDB schema design for FAANG interviews!",
  media: [{ type: "image", url: "...", thumbnail: "..." }],
  hashtags: ["mongodb", "faang", "interviews"],
  mentions: [ObjectId("user2"), ObjectId("user3")],
  stats: {                            // Approximate counts (updated periodically)
    likes: 142,
    comments: 23,
    shares: 7
  },
  createdAt: ISODate("...")
}

// feed — fan-out on write (precomputed feed per user)
{
  _id: ObjectId("..."),
  userId: ObjectId("user1"),
  postId: ObjectId("post1"),
  authorId: ObjectId("..."),
  score: 0.95,                        // Relevance score for ranking
  createdAt: ISODate("..."),
  seen: false
}

// followers collection
{
  _id: ObjectId("..."),
  userId: ObjectId("user1"),
  followerId: ObjectId("user2"),
  createdAt: ISODate("...")
}
```

**Hybrid fan-out strategy:**
- **Regular users (<10K followers):** Fan-out on write (pre-populate followers' feeds).
- **Celebrity users (>10K followers):** Fan-out on read (merge at query time) to avoid massive write amplification.

---

### Q26: How would you migrate from SQL Server to MongoDB?

```mermaid
flowchart LR
    P1["Phase 1: Analysis (2-4w)"] --> P2["Phase 2: Schema Design (1-2w)"]
    P2 --> P3["Phase 3: Dual-Write + Sync/Verify"]
    P3 --> P4["Phase 4: Cutover (SQL Read-Only 2-4w)"]

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    class P1,P2 blue
    class P3 amber
    class P4 green
```

1. **Phase 1 — Analysis (2–4 weeks):** Map SQL tables to collections, identify JOIN-heavy queries for embedding (1:1, 1:few) vs referencing (1:many unbounded), and map stored procedures to aggregation pipelines or app logic.
2. **Phase 2 — Schema Design (1–2 weeks):** Design target schema, validation rules, indexes from query patterns, and migration scripts.
3. **Phase 3 — Dual-Write Migration:** Application writes to both SQL Server and MongoDB; background job syncs historical data; verification script checks consistency; gradually shift reads to MongoDB.
4. **Phase 4 — Cutover:** Stop dual-writes, make MongoDB primary, keep SQL Server read-only for 2–4 weeks as rollback safety net, then decommission.

---

## 6. MongoDB vs Other Databases

```mermaid
flowchart TD
    W["Workload Requirements"] --> Q1{"Complex JOINs or Multi-Entity ACID?"}
    Q1 -->|Yes| PG["PostgreSQL"]
    Q1 -->|No| Q2{"Columnar BI / Data Warehouse?"}
    Q2 -->|Yes| DW["Redshift / BigQuery"]
    Q2 -->|No| MG["MongoDB (Flexible Schema + Horizontal Scale)"]

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    class W,Q1,Q2 blue
    class MG green
    class PG purple
    class DW amber
```

### Q27: MongoDB vs PostgreSQL — when would you choose each?

| Factor | MongoDB | PostgreSQL |
|--------|---------|------------|
| Schema | Flexible, evolving | Rigid, well-defined |
| Relationships | Few JOINs needed | Complex JOINs required |
| Scaling | Built-in horizontal sharding | Primarily vertical (Citus for horizontal) |
| Transactions | Single-doc atomic + multi-doc (4.0+) | Full ACID from day one |
| Query language | MQL + Aggregation | SQL (decades of optimization) |
| GeoSpatial | Native `2dsphere` indexes | PostGIS extension (more powerful) |
| Full-text search | Basic text indexes | Better (`ts_vector`, `ts_query`) |
| JSON support | Native (BSON) | `JSONB` (very good) |
| Best for | CMS, IoT, catalogs, real-time analytics | Financial systems, ERP, complex reporting |

- **Choose MongoDB:** Rapidly evolving schema, hierarchical/nested data, horizontal scaling, read-heavy denormalized workloads.
- **Choose PostgreSQL:** Highly relational data, complex multi-table JOINs and transactions, critical reporting, strict DB-level ACID.

---

### Q28: When would you NOT use MongoDB?

1. **Highly relational data** requiring frequent multi-collection lookups.
2. **Complex cross-entity transactions** (e.g., banking ledgers requiring strict multi-account ACID).
3. **Ad-hoc BI reporting** with complex JOINs.
4. **Strict DB-enforced schema** requirements.
5. **Small, simple datasets** where SQLite/PostgreSQL is simpler.
6. **Data warehousing** (use columnar DBs like Redshift or BigQuery).

---

## 7. Java / Spring Data MongoDB

```mermaid
flowchart TD
    SD["Spring Data MongoDB"] --> OP{"Operation Type"}
    OP -->|Simple CRUD / Derived Queries| MR["MongoRepository"]
    OP -->|Dynamic Criteria / Partial Update / Agg / Bulk| MT["MongoTemplate"]
    SD --> MIG{"Schema Migration"}
    MIG -->|Versioned Scripts| MK["Mongock (@ChangeUnit)"]
    MIG -->|Lazy On-Read| SV["schemaVersion Field"]

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    class SD,OP,MIG blue
    class MR,MK green
    class MT,SV amber
```

### Q29: MongoTemplate vs MongoRepository — when to use which?

| Feature | MongoRepository | MongoTemplate |
|---------|-----------------|---------------|
| Approach | Declarative (interface methods) | Programmatic (explicit queries) |
| Simple CRUD | Excellent | Verbose |
| Complex queries | Limited (custom `@Query`) | Full flexibility |
| Aggregation | Not supported | Full pipeline support |
| Bulk operations | Not supported | Supported |
| Update operations | Save entire document | Partial updates with operators |
| Learning curve | Low | Medium |

**Use `MongoRepository` when:**
```java
public interface UserRepository extends MongoRepository<User, String> {
    List<User> findByStatus(String status);
    List<User> findByAgeGreaterThan(int age);

    @Query("{ 'email': ?0 }")
    Optional<User> findByEmail(String email);

    @Query(value = "{ 'status': 'active' }", count = true)
    long countActiveUsers();
}
```

**Use `MongoTemplate` when:**
```java
@Service
public class UserService {
    @Autowired
    private MongoTemplate mongoTemplate;

    // Complex query with dynamic criteria
    public List<User> searchUsers(UserSearchCriteria criteria) {
        Query query = new Query();

        if (criteria.getStatus() != null) {
            query.addCriteria(Criteria.where("status").is(criteria.getStatus()));
        }
        if (criteria.getMinAge() != null) {
            query.addCriteria(Criteria.where("age").gte(criteria.getMinAge()));
        }

        query.with(Sort.by(Sort.Direction.DESC, "createdAt"));
        query.limit(20);

        return mongoTemplate.find(query, User.class);
    }

    // Partial update (without loading entire document)
    public void incrementLoginCount(String userId) {
        Query query = Query.query(Criteria.where("_id").is(userId));
        Update update = new Update()
            .inc("loginCount", 1)
            .set("lastLogin", Instant.now());
        mongoTemplate.updateFirst(query, update, User.class);
    }

    // Aggregation pipeline
    public List<CategoryStats> getCategoryStats() {
        Aggregation agg = Aggregation.newAggregation(
            match(Criteria.where("status").is("active")),
            group("category")
                .count().as("count")
                .avg("price").as("avgPrice"),
            sort(Sort.Direction.DESC, "count")
        );
        return mongoTemplate.aggregate(agg, "products", CategoryStats.class)
                           .getMappedResults();
    }
}
```

> [!TIP]
> Use both: `MongoRepository` for simple CRUD and `MongoTemplate` for dynamic queries, partial updates, aggregations, and bulk ops.

---

### Q30: How do you configure MongoDB with Spring Boot?

```yaml
# application.yml
spring:
  data:
    mongodb:
      uri: mongodb://user:pass@host1:27017,host2:27017,host3:27017/mydb?replicaSet=rs0&readPreference=secondaryPreferred
      # OR individual properties:
      host: localhost
      port: 27017
      database: mydb
      authentication-database: admin

      # Connection pool
      auto-index-creation: true  # Dev only! Disable in prod
```

```java
// Custom configuration
@Configuration
public class MongoConfig extends AbstractMongoClientConfiguration {

    @Override
    protected String getDatabaseName() {
        return "mydb";
    }

    @Override
    protected void configureClientSettings(MongoClientSettings.Builder builder) {
        builder
            .applyToConnectionPoolSettings(pool -> pool
                .maxSize(100)
                .minSize(10)
                .maxWaitTime(5, TimeUnit.SECONDS)
                .maxConnectionIdleTime(60, TimeUnit.SECONDS))
            .applyToSocketSettings(socket -> socket
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(10, TimeUnit.SECONDS))
            .readPreference(ReadPreference.secondaryPreferred())
            .writeConcern(WriteConcern.MAJORITY);
    }

    @Override
    protected boolean autoIndexCreation() {
        return false; // Always false in production
    }
}
```

---

### Q31: How do you handle schema migration in MongoDB with Spring Boot?

**Option 1: Mongock (recommended — Flyway-like for MongoDB)**
```java
@ChangeUnit(id = "add-email-index", order = "001", author = "mohit")
public class AddEmailIndexMigration {

    @Execution
    public void execution(MongoTemplate mongoTemplate) {
        mongoTemplate.indexOps("users")
            .ensureIndex(new Index().on("email", Sort.Direction.ASC).unique());
    }

    @RollbackExecution
    public void rollback(MongoTemplate mongoTemplate) {
        mongoTemplate.indexOps("users").dropIndex("email_1");
    }
}

@ChangeUnit(id = "migrate-address-format", order = "002", author = "mohit")
public class MigrateAddressFormat {

    @Execution
    public void execution(MongoTemplate mongoTemplate) {
        // Migrate flat address to embedded object
        Query query = Query.query(Criteria.where("city").exists(true));

        mongoTemplate.find(query, Document.class, "users").forEach(doc -> {
            Update update = new Update()
                .set("address", new Document()
                    .append("city", doc.getString("city"))
                    .append("state", doc.getString("state"))
                    .append("zip", doc.getString("zip")))
                .unset("city")
                .unset("state")
                .unset("zip");

            mongoTemplate.updateFirst(
                Query.query(Criteria.where("_id").is(doc.getObjectId("_id"))),
                update, "users");
        });
    }

    @RollbackExecution
    public void rollback(MongoTemplate mongoTemplate) { /* reverse migration */ }
}
```

**Option 2: Application-level versioning**
```java
// Store schema version in each document
{
  _id: ObjectId("..."),
  schemaVersion: 2,
  name: "Mohit",
  address: { city: "Kolkata", zip: "700001" }  // v2 format
}

// Read-time migration
@Component
public class UserMigrator {
    public User migrate(Document doc) {
        int version = doc.getInteger("schemaVersion", 1);
        if (version < 2) {
            // Migrate v1 → v2 format on read
            // Optionally write back the migrated version
        }
        return convertToUser(doc);
    }
}
```

---

### Q32–Q40: Rapid-Fire Questions

| # | Question | Concise Answer |
|---|----------|----------------|
| **Q32** | How does MongoDB handle concurrent writes to the same document? | WiredTiger uses optimistic concurrency control; one write wins and the other retries automatically. For app-level conflicts, use `findOneAndUpdate` with version fields. |
| **Q33** | What is the oplog and how big should it be? | A capped collection recording all write operations (default: 5% of disk). Size it for how long a secondary can be offline and still catch up; increase for write-heavy workloads. |
| **Q34** | Can you shard an existing collection? | Yes, with a supporting index on the shard key. Initial chunk migration is expensive on large collections — shard before data grows too large. |
| **Q35** | How do you handle MongoDB connection failures in Spring Boot? | Configure connection pool/socket timeouts, retry logic (`@Retryable`), and `WriteConcern.MAJORITY` with `wtimeout` to avoid hanging on partitions. |
| **Q36** | What's the maximum number of indexes per collection? | **64 indexes** max. Aim for 5–10 well-designed indexes since extra indexes slow down writes. |
| **Q37** | How do you monitor MongoDB performance? | `mongostat` (real-time metrics), `mongotop` (collection read/write times), `db.currentOp()` (active ops), `db.serverStatus()` (full stats), plus Prometheus + Grafana. |
| **Q38** | What is a capped collection? | Fixed-size collection that overwrites oldest documents in insertion order when full (logs, caches). Cannot be sharded or have individual docs deleted. |
| **Q39** | How does MongoDB handle network partitions? | Majority partition continues serving reads and writes; minority side steps down to secondary (read-only). **CP** for writes. |
| **Q40** | What is the aggregation pipeline memory limit? | **100MB RAM** per stage by default. Pass `{ allowDiskUse: true }` for larger sets (slower), or `$match` early to shrink data first. |

---

## Quick Revision Table

```mermaid
flowchart LR
    S["1. Schema (Embed First)"] --> I["2. Index (ESR Rule)"]
    I --> A["3. Aggregate ($match Early)"]
    A --> D["4. Durability (majority + j:true)"]
    D --> SH["5. Shard (High Card + Targeted)"]

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    class S blue
    class I green
    class A amber
    class D purple
    class SH red
```

| Topic | Key Concept | Remember This |
|-------|------------|---------------|
| Schema Design | Embed vs Reference | "If accessed together, embed; if unbounded, reference" |
| Indexing | ESR Rule | "Equality → Sort → Range for compound indexes" |
| Performance | `explain()` | "`COLLSCAN` = bad, `IXSCAN` = good, `SORT` stage = needs index" |
| Replication | Failover | "10–12 seconds, needs majority vote" |
| Sharding | Shard Key | "High cardinality + query targeting + non-monotonic" |
| Transactions | Prefer Schema Design | "Redesign schema to avoid transactions when possible" |
| WiredTiger | Document-level locking | "Not collection-level (that was MMAPv1)" |
| Aggregation | `$match` first | "Always filter early — only `$match` can use indexes" |
| Spring Data | Template vs Repository | "Repository for CRUD, Template for complex queries" |
| Migration | Mongock | "Like Flyway but for MongoDB" |

> [!IMPORTANT]
> **Final tip:** In FAANG interviews, always lead with your **schema design rationale**. The #1 thing interviewers want to hear is *why* you chose to embed vs reference, not just how to write queries.
