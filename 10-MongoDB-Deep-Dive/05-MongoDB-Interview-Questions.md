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

---

## 1. Fundamentals

### Q1: What is MongoDB and how does it differ from relational databases?

MongoDB is a document-oriented NoSQL database that stores data as flexible JSON-like documents (BSON). Key differences:

| Aspect | MongoDB | Relational (PostgreSQL/MySQL) |
|--------|---------|-------------------------------|
| Data Model | Documents (BSON) | Rows in tables |
| Schema | Flexible / dynamic | Rigid / predefined |
| Relationships | Embedded docs or references | Foreign keys + JOINs |
| Scaling | Horizontal (sharding built-in) | Primarily vertical |
| Transactions | Multi-doc transactions (4.0+) | Full ACID from day one |
| Query Language | MQL (MongoDB Query Language) | SQL |
| JOINs | $lookup (limited) | Full JOIN support |

**When to use MongoDB:** High write throughput, flexible/evolving schemas, hierarchical data, rapid prototyping, event logging, content management, real-time analytics.

**When NOT to use:** Complex multi-table JOINs, strict ACID across many entities, mature relational data with deep relationships.

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

BSON enables MongoDB to efficiently traverse documents without parsing the entire structure — critical for query performance.

---

### Q3: Explain ObjectId. How is it generated? Can it collide?

ObjectId is a 12-byte unique identifier:

```
|  4 bytes  |  5 bytes  |  3 bytes  |
| timestamp | random    | counter   |
| (seconds) | (per-process unique) | (incrementing) |
```

- **Timestamp (4 bytes):** Unix epoch in seconds — gives you creation time for free
- **Random value (5 bytes):** Unique per machine + process
- **Counter (3 bytes):** Starts from random value, increments per process

**Collision probability:** Virtually zero. You'd need the same second, same machine, same process, and exhaust the 16 million counter values (2^24).

```java
// Extract creation time from ObjectId
ObjectId id = new ObjectId("507f1f77bcf86cd799439011");
Date created = id.getDate(); // Returns timestamp embedded in ID
```

**Interview tip:** ObjectIds are roughly sortable by creation time (because timestamp is the first component), which makes them decent for range queries on insertion order — but NOT perfectly ordered across distributed systems.

---

### Q4: Embedded documents vs References — how do you decide?

**Embed when:**
- Data is accessed together (e.g., user + address)
- One-to-few relationship (user has 2-3 addresses)
- Data doesn't change independently
- You want atomic single-document updates
- Read performance is priority

**Reference when:**
- Data is accessed independently
- One-to-many with unbounded growth (user has 10,000 orders)
- Many-to-many relationships
- Document would exceed 16MB limit
- Data changes independently and frequently
- You need to avoid data duplication

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

**Rule of thumb:** If in doubt, embed. MongoDB is optimized for embedded reads. Only reference when you have a compelling reason.

---

### Q5: What is the 16MB document size limit? How do you handle large data?

MongoDB enforces a 16MB BSON document size limit. Strategies for large data:

1. **GridFS:** For files >16MB. Splits file into 255KB chunks stored in `fs.chunks`, metadata in `fs.files`
2. **Subset pattern:** Store only the most recent/relevant subset in the document, archive the rest
3. **Bucket pattern:** Group related data into time-based buckets (e.g., IoT readings per hour)
4. **Reference pattern:** Move large arrays to separate collection, store references

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
|-------------|---------|
| `local` (default) | Returns most recent data on the node (may be rolled back) |
| `available` | Like local, but for sharded clusters |
| `majority` | Returns data acknowledged by majority (won't be rolled back) |
| `linearizable` | Strongest — reflects all successful majority-committed writes before the read |
| `snapshot` | For multi-document transactions |

**Interview answer:** "For financial systems like at Barclays, I'd use `w: majority` with `j: true` for critical writes (trade confirmations, settlements) to ensure durability, and `readConcern: majority` to avoid reading data that could be rolled back. For logging or analytics, `w: 1` is sufficient."

---

### Q7: Explain MongoDB's storage engine (WiredTiger).

WiredTiger (default since MongoDB 3.2):

- **Document-level concurrency control:** Uses optimistic concurrency with document-level locks (not collection or database level)
- **Compression:** Supports snappy (default), zlib, zstd for data; prefix compression for indexes
- **Cache:** Internal cache (default: 50% of RAM - 1GB). Keeps frequently accessed data in memory
- **Journaling:** Write-ahead log (WAL) for crash recovery. Writes go to journal first, then to data files
- **Checkpoints:** Creates consistent snapshots of data every 60 seconds

```
Write Path:
Client → In-Memory (WiredTiger Cache) → Journal (WAL) → Checkpoint → Disk

Read Path:
Client → WiredTiger Cache (hit?) → Disk (miss) → Cache (populate)
```

**Interview tip:** When asked "how does MongoDB handle concurrent writes," explain document-level locking with WiredTiger — not the old MMAPv1 collection-level locking.

---

### Q8: What happens when a document is updated? Does MongoDB update in-place?

WiredTiger uses a **no-overwrite** storage model:
1. The original document stays on disk
2. A new version is written to a new location
3. Internal data structures are updated to point to the new location
4. Old versions are cleaned up during checkpoints

This means:
- Updates that grow the document DON'T need to find contiguous space (unlike MMAPv1)
- Compression works better because data is written sequentially
- Reads can happen concurrently with writes (MVCC - Multi-Version Concurrency Control)

---

## 2. Querying & Aggregation

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
- Foreign collection must be in the SAME database (until 5.1 which supports cross-db)
- Foreign collection CANNOT be sharded (until 5.1)
- No index hint support on the foreign pipeline
- Performance degrades with large foreign collections — no hash join optimization
- Returns an array (even for 1:1) — must $unwind for flat results
- Nested $lookup is possible but becomes hard to optimize

**Interview tip:** "If I find myself using many $lookups, it usually signals that my schema design needs rethinking. MongoDB works best with embedded documents that minimize cross-collection queries."

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

**Edge cases:**
- If `tags` is empty `[]` → document is **dropped** by default
- If `tags` is missing → document is **dropped** by default
- If `tags` is not an array → document passes through as-is

**Preserve null/empty:**
```javascript
{ $unwind: {
    path: "$tags",
    preserveNullAndEmptyArrays: true,  // Keep docs with missing/empty arrays
    includeArrayIndex: "arrayIndex"     // Add index position field
}}
```

---

### Q12: How would you implement pagination in MongoDB? What are the pitfalls of skip/limit?

**Naive approach (skip/limit):**
```javascript
// Page 3, 20 items per page
db.products.find().sort({ _id: 1 }).skip(40).limit(20)
```

**Problem:** `skip(40)` still scans 40 documents and discards them. At `skip(100000)`, it's scanning 100K docs. Performance degrades linearly.

**Better approach — Range-based pagination (cursor-based):**
```javascript
// First page
db.products.find().sort({ _id: 1 }).limit(20)
// Remember the last _id: "abc123"

// Next page — seek directly using index
db.products.find({ _id: { $gt: ObjectId("abc123") } }).sort({ _id: 1 }).limit(20)
```

**Benefits:** Uses index to seek directly. Constant time regardless of page number. No scanning of skipped documents.

**Trade-off:** Can't jump to "page 50" directly. Best for "infinite scroll" or "load more" UIs, not traditional page-numbered navigation.

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
1. **$match moves before $project/$addFields** when it doesn't depend on projected fields
2. **$match at the start** can use indexes; after $group it CANNOT
3. **Adjacent $match stages** are coalesced into one
4. **$sort + $limit** coalesced into a top-k sort (memory efficient)
5. **$project + $skip/$limit** — projection moves after skip/limit to reduce work

**Interview answer:** "I always put $match as early as possible in the pipeline. MongoDB's query optimizer will try to move $match before $project, but it can't move it before $group. So the order I write it in matters for performance — filtering 1 million documents down to 10,000 before grouping is dramatically different from grouping 1 million first."

---

## 3. Indexing & Performance

### Q14: Explain the ESR (Equality, Sort, Range) rule for compound indexes.

The ESR rule is the optimal order for fields in a compound index:

1. **E (Equality)** — Fields tested with exact match (`{ status: "active" }`)
2. **S (Sort)** — Fields used in sort (`sort({ date: -1 })`)
3. **R (Range)** — Fields tested with range (`{ price: { $gt: 100 } }`)

```javascript
// Query
db.orders.find({
  status: "shipped",           // Equality
  price: { $gt: 50, $lt: 200 } // Range
}).sort({ date: -1 })          // Sort

// OPTIMAL index (ESR order)
db.orders.createIndex({ status: 1, date: -1, price: 1 })

// WHY this order:
// 1. status = "shipped" → narrows to exact subset (E)
// 2. date: -1 → already sorted in index, no in-memory sort needed (S)
// 3. price range → scans within the sorted subset (R)
```

**Why not E-R-S?**
If you put Range before Sort: `{ status: 1, price: 1, date: -1 }`
- After equality match on status, MongoDB scans the price range
- But within that price range, documents are NOT sorted by date
- So MongoDB must do an in-memory sort → SORT_KEY_GENERATOR in explain plan

**Interview tip:** "The key insight is that range predicates break the sort order in the index. By putting sort between equality and range, we preserve the index's sort order and avoid an in-memory sort, which is critical for large result sets."

---

### Q15: What is a covered query? How do you achieve it?

A covered query is answered entirely from the index without accessing the actual documents.

**Requirements:**
1. All fields in the query filter are part of the index
2. All fields in the projection are part of the index
3. No field in the projection is an array (arrays need document access)
4. `_id` is excluded from projection (unless it's in the index)

```javascript
// Index
db.users.createIndex({ email: 1, name: 1, status: 1 })

// Covered query — all fields in index
db.users.find(
  { email: "mohit@example.com" },   // Filter: email in index ✓
  { name: 1, status: 1, _id: 0 }    // Projection: name, status in index ✓, _id excluded ✓
)

// explain() output for covered query:
// totalDocsExamined: 0        ← No documents accessed!
// totalKeysExamined: 1        ← Only index scanned
// executionStages: "IXSCAN"   ← Index scan only, no FETCH
```

**NOT covered (needs FETCH stage):**
```javascript
// This requires document access because 'age' is not in the index
db.users.find(
  { email: "mohit@example.com" },
  { name: 1, age: 1, _id: 0 }    // 'age' not in index → must FETCH document
)
```

---

### Q16: How do you read and interpret an explain() plan?

```javascript
db.orders.find({ status: "active", amount: { $gt: 100 } })
         .sort({ date: -1 })
         .explain("executionStats")
```

**Key fields to check:**

```
executionStats: {
  nReturned: 142,              // Documents returned to client
  executionTimeMillis: 23,     // Total time
  totalKeysExamined: 850,      // Index entries scanned
  totalDocsExamined: 850,      // Documents fetched from disk

  executionStages: {
    stage: "SORT",             // ⚠️ In-memory sort (bad for large sets)
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

**Red flags in explain:**
- `COLLSCAN` → Full collection scan, no index used
- `SORT` stage → In-memory sort, index not covering sort order
- `totalDocsExamined >> nReturned` → Scanning too many documents
- `totalKeysExamined >> nReturned` → Index not selective enough
- `memUsage > 33554432` → Sort exceeds 100MB limit, will fail

**Ideal plan:**
- `IXSCAN → FETCH → (no SORT)` — Index handles both filter and sort
- `totalDocsExamined ≈ nReturned` — Examined only what was returned
- No `SORT_KEY_GENERATOR` — Sort handled by index

---

### Q17: What are TTL indexes? When would you use them?

TTL (Time-To-Live) indexes automatically delete documents after a specified time.

```javascript
// Delete documents 30 days after 'createdAt'
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 2592000 })

// Delete documents at a specific time (set 'expiresAt' per document)
db.events.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
// Then set per-document: { expiresAt: ISODate("2025-06-15T00:00:00Z") }
```

**Use cases:** Session management, temporary tokens, log rotation, GDPR auto-deletion, cache expiry.

**Caveats:**
- Background thread runs every 60 seconds (not instant deletion)
- Only works on single-field indexes with date values
- Cannot be compound indexes
- Not suitable for precise time-based deletion (60s granularity)

---

### Q18: What are partial indexes? When are they useful?

Partial indexes only index documents that match a filter expression.

```javascript
// Only index active orders (most queries only care about active)
db.orders.createIndex(
  { customer_id: 1, date: -1 },
  { partialFilterExpression: { status: "active" } }
)
```

**Benefits:**
- Smaller index size (less RAM, faster operations)
- Faster writes (only active documents update the index)
- More focused query optimization

**Important:** The query must include the partial filter condition for MongoDB to use the index:
```javascript
// ✓ Will use partial index
db.orders.find({ customer_id: "c1", status: "active" })

// ✗ Will NOT use partial index (no status filter)
db.orders.find({ customer_id: "c1" })
```

---

## 4. Architecture & Operations

### Q19: Explain MongoDB replica set architecture. How does failover work?

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   PRIMARY    │────▶│  SECONDARY  │────▶│  SECONDARY  │
│  (reads +    │     │  (reads if  │     │  (reads if  │
│   writes)    │     │  configured)│     │  configured)│
└──────┬───────┘     └──────┬──────┘     └──────┬──────┘
       │                    │                    │
       │◀──── Oplog Replication ────▶│           │
       │                    │◀────────────────▶│ │
       └────────────────────┴────────────────────┘
                    Heartbeat (every 2s)
```

**Failover process:**
1. Primary becomes unreachable (heartbeat timeout: 10s default)
2. Secondaries notice missing heartbeats
3. Eligible secondary calls for election
4. Members vote (need majority: for 3-node set, need 2 votes)
5. Winning secondary becomes new primary (typically 10-12 seconds total)
6. Drivers detect new primary and redirect writes

**Election criteria:**
- Member with most recent oplog entry preferred
- Priority settings (higher = more likely to be elected)
- Members with `priority: 0` can never become primary
- Hidden members can vote but can't become primary
- Arbiters vote but hold no data

---

### Q20: How does sharding work? What makes a good shard key?

**Architecture:**
```
        Client Application
              │
        ┌─────▼─────┐
        │   mongos   │  ← Query router
        │  (router)  │
        └─────┬──────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌────────┐ ┌────────┐ ┌────────┐
│Config  │ │Config  │ │Config  │  ← Metadata (which chunks on which shard)
│Server 1│ │Server 2│ │Server 3│
└────────┘ └────────┘ └────────┘

    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌────────┐ ┌────────┐ ┌────────┐
│Shard 1 │ │Shard 2 │ │Shard 3 │  ← Each shard is a replica set
│(RS)    │ │(RS)    │ │(RS)    │
└────────┘ └────────┘ └────────┘
```

**Good shard key properties:**

| Property | Good | Bad |
|----------|------|-----|
| High cardinality | `user_id` (millions of values) | `status` (3-4 values) |
| Even distribution | `hashed(user_id)` | `timestamp` (monotonic) |
| Query targeting | Queries include shard key | Queries need scatter-gather |
| Not monotonic | Random or hashed | Auto-increment, ObjectId, timestamp |

**Shard key examples:**

```javascript
// BAD: monotonic, creates hotspot on last shard
sh.shardCollection("db.logs", { timestamp: 1 })

// BETTER: hashed for even distribution
sh.shardCollection("db.logs", { timestamp: "hashed" })

// BEST: compound key for both distribution and query targeting
sh.shardCollection("db.orders", { customer_id: 1, order_date: 1 })
```

**Critical interview point:** Shard key is IMMUTABLE after 4.4 (can refine but not change). Choosing wrong = resharding entire collection. This is the single most important decision in MongoDB sharding.

---

### Q21: Explain MongoDB transactions. When should you avoid them?

**Single-document atomicity (always available):**
```javascript
// This is atomic without explicit transaction
db.accounts.updateOne(
  { _id: "acc1" },
  { $inc: { balance: -100 }, $push: { transactions: { amount: -100, date: new Date() } } }
)
```

**Multi-document transactions (4.0+ for replica sets, 4.2+ for sharded):**
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
- If you can redesign schema to use single-document atomicity (preferred)
- High-throughput scenarios (transactions add ~2x latency)
- Long-running operations (60s default timeout)
- Cross-shard transactions (even higher overhead)

**Interview answer:** "In MongoDB, the first question isn't 'how do I use transactions' but 'can I redesign my schema to avoid them?' Embedding related data in a single document gives you atomicity for free. I'd only reach for multi-document transactions when the data genuinely belongs in separate collections and consistency is critical."

---

### Q22: What are Change Streams? How would you use them?

Change Streams allow applications to watch real-time changes on collections, databases, or entire deployments.

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

**Use cases:** Event-driven architectures, real-time sync between services, audit logging, cache invalidation, triggering notifications.

**Requires:** Replica set or sharded cluster (not standalone).

---

### Q23: How do you back up and restore MongoDB?

| Method | Type | Impact | Point-in-Time |
|--------|------|--------|---------------|
| `mongodump` / `mongorestore` | Logical | Slow, high I/O | No |
| Filesystem snapshots (LVM/EBS) | Physical | Fast, low impact | Yes (with journal) |
| MongoDB Atlas continuous backup | Cloud | Zero impact | Yes (to the second) |
| Ops Manager / Cloud Manager | Enterprise | Low impact | Yes |

**Best practice for production:**
1. Use filesystem snapshots for fast recovery
2. Enable journaling (`j: true`) for consistency
3. Back up from a secondary to avoid impacting primary
4. Test restores regularly (backup is useless if you can't restore)
5. Store oplog for point-in-time recovery

---

## 5. Schema Design Scenarios

### Q24: Design a MongoDB schema for an e-commerce platform.

**Collections:**

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

**Design decisions explained:**
- Products embed variants and specs (accessed together, bounded)
- Orders embed item snapshots (price at time of order must be preserved)
- Reviews are separate (unbounded per product, queried independently)
- Category path stored as string for tree queries (`/^Electronics/`)

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

**Fan-out strategy:**
- Regular users (<10K followers): Fan-out on write (pre-populate followers' feeds)
- Celebrity users (>10K followers): Fan-out on read (merge at query time)
- Hybrid approach handles the "celebrity problem"

---

### Q26: How would you migrate from SQL Server to MongoDB?

This is directly relevant to the Barclays experience. Strategy:

**Phase 1: Analysis (2-4 weeks)**
- Map SQL tables to MongoDB collections
- Identify JOIN-heavy queries → candidates for embedding
- Identify 1:1 and 1:few relationships → embed
- Identify 1:many unbounded → reference
- Map stored procedures to aggregation pipelines or application logic

**Phase 2: Schema Design (1-2 weeks)**
- Design target MongoDB schema
- Create validation rules
- Plan indexes based on query patterns
- Design migration scripts

**Phase 3: Dual-Write Migration**
```
SQL Server ──write──▶ Application ──write──▶ MongoDB
     │                                          │
     └──────── Sync/Verify Script ─────────────┘
```

- Application writes to both databases
- Background job syncs historical data
- Verify data consistency between both
- Gradually shift reads to MongoDB
- Once confident, cut over writes

**Phase 4: Cutover**
- Stop dual-write
- MongoDB becomes primary
- Keep SQL Server read-only for rollback (2-4 weeks)
- Decommission SQL Server

---

## 6. MongoDB vs Other Databases

### Q27: MongoDB vs PostgreSQL — when would you choose each?

| Factor | MongoDB | PostgreSQL |
|--------|---------|------------|
| Schema | Flexible, evolving | Rigid, well-defined |
| Relationships | Few JOINs needed | Complex JOINs required |
| Scaling | Built-in horizontal sharding | Primarily vertical (Citus for horizontal) |
| Transactions | Single-doc atomic + multi-doc (4.0+) | Full ACID from day one |
| Query language | MQL + Aggregation | SQL (decades of optimization) |
| GeoSpatial | Native 2dsphere indexes | PostGIS extension (more powerful) |
| Full-text search | Basic text indexes | Better (ts_vector, ts_query) |
| JSON support | Native (BSON) | JSONB (very good) |
| Best for | Content management, IoT, catalogs, real-time analytics | Financial systems, ERP, complex reporting |

**Choose MongoDB when:** Schema changes frequently, data is hierarchical/nested, you need horizontal scaling, read-heavy workloads with denormalized data.

**Choose PostgreSQL when:** Data is highly relational, you need complex JOINs and transactions across many tables, reporting is critical, ACID is non-negotiable across multiple entities.

---

### Q28: When would you NOT use MongoDB?

1. **Highly relational data:** If you're constantly doing multi-collection lookups, a relational DB is better
2. **Complex transactions across entities:** Banking ledger systems where every entry must be ACID across multiple accounts
3. **Complex reporting with ad-hoc JOINs:** Business intelligence workloads
4. **Strict schema enforcement is desired:** When you want the database (not application) to enforce data integrity
5. **Small dataset, simple needs:** SQLite or PostgreSQL is simpler and sufficient
6. **Data warehousing:** Column-oriented databases (Redshift, BigQuery) are better

---

## 7. Java / Spring Data MongoDB

### Q29: MongoTemplate vs MongoRepository — when to use which?

| Feature | MongoRepository | MongoTemplate |
|---------|----------------|---------------|
| Approach | Declarative (interface methods) | Programmatic (explicit queries) |
| Simple CRUD | Excellent | Verbose |
| Complex queries | Limited (custom @Query) | Full flexibility |
| Aggregation | Not supported | Full pipeline support |
| Bulk operations | Not supported | Supported |
| Update operations | Save entire document | Partial updates with operators |
| Learning curve | Low | Medium |

**Use MongoRepository when:**
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

**Use MongoTemplate when:**
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

**Best practice:** Use both. Repository for simple CRUD, Template for complex operations.

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

Unlike Flyway/Liquibase for SQL, MongoDB schema migrations are handled differently:

**Option 1: Mongock (recommended)**
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

### Q32-Q40: Rapid-Fire Questions

**Q32: How does MongoDB handle concurrent writes to the same document?**
WiredTiger uses optimistic concurrency control. If two writes target the same document, one wins and the other retries automatically. For application-level conflicts, use `findOneAndUpdate` with version fields.

**Q33: What is the oplog and how big should it be?**
The oplog (operations log) is a capped collection that records all write operations. Default size is 5% of disk. Size it based on: how long you want a secondary to be offline and still catch up. For high-write workloads, increase it.

**Q34: Can you shard an existing collection?**
Yes, but the shard key must have a supporting index. For large collections, this can take significant time due to initial chunk migration. Plan sharding BEFORE the collection grows too large.

**Q35: How do you handle MongoDB connection failures in Spring Boot?**
Configure retry logic, connection pool settings, and use `@Retryable`. Set appropriate timeouts. Use `WriteConcern.MAJORITY` with `wtimeout` to avoid hanging on network partitions.

**Q36: What's the maximum number of indexes per collection?**
64 indexes per collection. But more indexes = slower writes. Aim for 5-10 well-designed indexes covering your query patterns.

**Q37: How do you monitor MongoDB performance?**
`mongostat` for real-time metrics, `mongotop` for collection-level read/write times, `db.currentOp()` for running operations, `db.serverStatus()` for comprehensive stats, and Prometheus + Grafana for dashboards.

**Q38: What is a capped collection?**
Fixed-size collection that overwrites oldest documents when full. Maintains insertion order. Used for logs, cache. Cannot be sharded or have documents deleted individually.

**Q39: How does MongoDB handle network partitions?**
In a replica set, the partition with the majority of nodes continues serving reads and writes. The minority side steps down to secondary (read-only with appropriate read preference). This is a CP system for writes.

**Q40: What is the aggregation pipeline memory limit?**
Each pipeline stage has a 100MB RAM limit by default. Use `{ allowDiskUse: true }` for larger datasets, but this is slower. Better to $match early to reduce data before memory-intensive stages.

---

## Quick Revision Table

| Topic | Key Concept | Remember This |
|-------|------------|---------------|
| Schema Design | Embed vs Reference | "If accessed together, embed; if unbounded, reference" |
| Indexing | ESR Rule | "Equality → Sort → Range for compound indexes" |
| Performance | explain() | "COLLSCAN = bad, IXSCAN = good, SORT stage = needs index" |
| Replication | Failover | "10-12 seconds, needs majority vote" |
| Sharding | Shard Key | "High cardinality + query targeting + non-monotonic" |
| Transactions | Prefer Schema Design | "Redesign schema to avoid transactions when possible" |
| WiredTiger | Document-level locking | "Not collection-level (that was MMAPv1)" |
| Aggregation | $match first | "Always filter early — only $match can use indexes" |
| Spring Data | Template vs Repository | "Repository for CRUD, Template for complex queries" |
| Migration | Mongock | "Like Flyway but for MongoDB" |

---

> **Final tip:** In FAANG interviews, when discussing MongoDB, always lead with your schema design rationale. The #1 thing interviewers want to hear is *why* you chose to embed vs reference, not just how to write queries.
