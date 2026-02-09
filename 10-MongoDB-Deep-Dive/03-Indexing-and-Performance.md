# MongoDB Deep Dive: Indexing and Performance

## Table of Contents
1. [Index Types](#index-types)
2. [Compound Indexes and ESR Rule](#compound-indexes-and-esr-rule)
3. [Index Internals](#index-internals)
4. [Covered Queries](#covered-queries)
5. [explain() Deep Dive](#explain-deep-dive)
6. [Query Optimization](#query-optimization)
7. [Storage Engine](#storage-engine)
8. [Profiler](#profiler)
9. [Common Interview Questions](#common-interview-questions)

---

## Index Types

### 1. Single Field Index

```javascript
// Create ascending index on age field
db.users.createIndex({ age: 1 })

// Create descending index
db.users.createIndex({ email: -1 })

// Drop index
db.users.dropIndex({ age: 1 })

// Drop all indexes (except _id)
db.users.dropIndexes()
```

**Spring Data MongoDB:**
```java
@Document(collection = "users")
public class User {
    @Id
    private String id;

    @Indexed
    private String email;

    @Indexed(direction = IndexDirection.DESCENDING)
    private Integer age;

    private String name;
}

// Or explicit index creation
@Configuration
public class MongoConfig {
    @Bean
    public IndexOperationsSessionCallback indexCreation() {
        return session -> {
            IndexOperations indexOps = session.indexOps(User.class);
            indexOps.ensureIndex(new Index().on("email", Sort.Direction.ASC));
            return null;
        };
    }
}
```

### 2. Compound Index

Index on multiple fields.

```javascript
// Create compound index: age ascending, then name ascending
db.users.createIndex({ age: 1, name: 1 })

// Compound index with mixed directions
db.users.createIndex({ age: -1, createdAt: 1 })

// This index helps queries that:
// 1. Filter by age
// 2. Filter by age AND name
// 3. Filter by age, sort by name
// 4. Filter by age AND name, sort by createdAt

// BUT does NOT help queries that:
// db.users.find({ name: "John" })  // Missing first field (age)
// db.users.find({ createdAt: ... }) // Missing prefix fields
```

**Spring Data MongoDB:**
```java
@Document(collection = "orders")
public class Order {
    @Id
    private String id;

    @Indexed(name = "customer_status_idx")
    private String customerId;

    @Indexed(name = "customer_status_idx")
    private String status;

    private BigDecimal total;
    private LocalDateTime createdAt;
}

// This creates compound index on (customerId, status)
```

### 3. Multikey Index (Arrays)

Index on array fields - creates separate index entry for each array element.

```javascript
db.posts.insertOne({
  _id: 1,
  title: "MongoDB Guide",
  tags: ["mongodb", "database", "nosql"]
})

// Create index on tags array
db.posts.createIndex({ tags: 1 })

// Query benefits from index
db.posts.find({ tags: "mongodb" })      // Uses index
db.posts.find({ tags: { $in: ["mongodb", "java"] } })  // Uses index
```

### 4. Text Index

For full-text search capabilities.

```javascript
// Create text index on multiple fields
db.articles.createIndex({ title: "text", body: "text" })

// Query using text search
db.articles.find({ $text: { $search: "mongodb" } })

// Phrase search
db.articles.find({ $text: { $search: "\"mongodb tutorial\"" } })

// Exclude words
db.articles.find({ $text: { $search: "mongodb -advanced" } })

// Text index with weights (title more important than body)
db.articles.createIndex(
  { title: "text", body: "text" },
  { weights: { title: 10, body: 5 } }
)

// Include textScore in projection
db.articles.find(
  { $text: { $search: "mongodb" } },
  { score: { $meta: "textScore" } }
).sort({ score: { $meta: "textScore" } })
```

### 5. Geospatial Index

For geographic queries.

```javascript
// 2dsphere index for spherical (latitude/longitude) data
db.restaurants.createIndex({ location: "2dsphere" })

db.restaurants.insertOne({
  name: "Pizza Place",
  location: {
    type: "Point",
    coordinates: [-74.0059, 40.7128]  // [longitude, latitude]
  }
})

// Find restaurants within 5km
db.restaurants.find({
  location: {
    $near: {
      $geometry: {
        type: "Point",
        coordinates: [-74.0000, 40.7000]
      },
      $maxDistance: 5000  // 5km in meters
    }
  }
})

// Polygon query (restaurants in area)
db.restaurants.find({
  location: {
    $geoWithin: {
      $geometry: {
        type: "Polygon",
        coordinates: [[
          [-74.0100, 40.7100],
          [-74.0000, 40.7100],
          [-74.0000, 40.7000],
          [-74.0100, 40.7000],
          [-74.0100, 40.7100]
        ]]
      }
    }
  }
})
```

### 6. Hashed Index

For shard key hashing (creates evenly distributed buckets).

```javascript
db.users.createIndex({ email: "hashed" })

// Hashed indexes have limitations:
// - Cannot support range queries
// - Must be used alone (no compound with hashed)
// - Good for sharding with high-cardinality keys
```

### 7. Wildcard Index

Match all fields in a subdocument or all fields.

```javascript
// Index all fields in user_metadata
db.users.createIndex({ "user_metadata.$**": 1 })

// Helps queries like:
db.users.find({ "user_metadata.preferences.theme": "dark" })
db.users.find({ "user_metadata.profile.bio": { $regex: "engineer" } })

// Index ALL fields (less common)
db.users.createIndex({ "$**": 1 })
```

### 8. TTL Index

Automatically delete documents after specified time.

```javascript
// Delete documents 24 hours after createdAt
db.sessions.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 86400 }  // 24 hours in seconds
)

// MongoDB automatically removes documents where:
// ISODate("now") - ISODate(createdAt) > 24 hours

// Practical: Session storage that auto-expires
db.sessions.insertOne({
  _id: "session123",
  userId: "USER-001",
  sessionData: { ... },
  createdAt: ISODate()
})

// After 24 hours, document is automatically deleted
```

**Spring Data MongoDB:**
```java
@Document(collection = "sessions")
public class UserSession {
    @Id
    private String id;

    private String userId;

    private Map<String, Object> sessionData;

    @Indexed(expireAfterSeconds = 86400)  // Auto-delete after 24 hours
    private LocalDateTime createdAt;
}
```

---

## Compound Indexes and ESR Rule

ESR Rule = **Equality, Sort, Range**

This is the optimal order of fields in a compound index for best performance.

```javascript
// Query: Find active users, sort by age, filter by age range
// db.users.find({ status: "active", age: { $gt: 25, $lt: 65 } }).sort({ age: 1 })

// Optimal index order (ESR):
db.users.createIndex({
  status: 1,      // Equality: exact match, filters first
  age: 1,         // Sort: then sort by this
  age: 1          // Range: then range filter
})
// Simplified (age used for both sort and range):
db.users.createIndex({ status: 1, age: 1 })

// ❌ Wrong order (Range, Sort, Equality):
db.users.createIndex({ age: 1, status: 1 })
// MongoDB can use index for age but not status due to order

// More complex example:
// Query: Find orders by customer (equality), in date range (range), sort by total (sort)
db.orders.aggregate([
  {
    $match: {
      customerId: "C123",
      orderDate: { $gte: ISODate("2024-01-01"), $lt: ISODate("2024-02-01") }
    }
  },
  { $sort: { total: -1 } }
])

// ESR order:
db.orders.createIndex({
  customerId: 1,      // Equality
  total: -1,          // Sort (descending)
  orderDate: 1        // Range
})
```

### Compound Index Usage Rules

```javascript
// Index: { age: 1, name: 1, email: 1 }
// Helps queries using prefix:

db.users.find({ age: 25 })                    // ✅ Uses full index
db.users.find({ age: 25, name: "John" })      // ✅ Uses full index
db.users.find({ age: 25, name: "John", email: "john@example.com" }) // ✅ Uses full index

db.users.find({ age: 25, email: "john@example.com" })  // ⚠️ Uses only (age) part
db.users.find({ name: "John" })               // ❌ Cannot use index (missing prefix)
db.users.find({ email: "john@example.com" })  // ❌ Cannot use index

// Sort benefit:
db.users.find({ age: 25 }).sort({ name: 1 }) // ✅ No SORT stage (already sorted)
db.users.find({ age: 25, name: "John" }).sort({ email: 1 }) // ✅ No SORT stage
db.users.find({ age: 25 }).sort({ email: 1 }) // ❌ Requires SORT stage (can't skip to email)
```

---

## Index Internals

### B-Tree Structure

MongoDB indexes use B-Tree (Balanced Tree) structure for efficiency.

```
Level 0 (Root):
        [25, 50]
       /    |    \
      /     |     \
   L1     L2     L3
  [1-24] [25-49] [50-100]
   |       |       |
  Docs   Docs    Docs
```

**Why B-Tree?**
- Balanced: All leaf nodes at same depth
- Logarithmic lookup: O(log N) complexity
- Range queries: Can traverse range of keys
- Disk efficient: Minimizes I/O operations

```javascript
// Building an index takes time proportional to data size
db.users.createIndex({ email: 1 })
// Time: O(N log N) where N = number of documents

// BUT once built:
db.users.find({ email: "john@example.com" })
// Time: O(log N) instead of O(N) for collection scan

// Index size example:
db.users.stats()
// Shows totalIndexSize in bytes
// Indexes take disk space!
```

### Index Size Considerations

```javascript
// Check index size and usage
db.users.stats()
// Returns: { indexSizes: { _id_: 45000, email_1: 32000 } }

// Indexes can grow large:
// - Index size depends on indexed field values
// - MongoDB keeps index in memory (RAM) for hot queries
// - Large indexes can reduce available RAM for data

// Rule of thumb:
// Index size ≈ 0.1-0.2 × Indexed field size

// Monitor index usage:
db.users.aggregate([
  { $indexStats: {} }  // Which indexes are used
])
```

---

## Covered Queries

A **covered query** is answered entirely from the index without examining any documents.

```javascript
// Index: { email: 1, age: 1 }
db.users.createIndex({ email: 1, age: 1 })

// ✅ Covered query (only returns indexed fields)
db.users.find(
  { email: "john@example.com" },
  { email: 1, age: 1, _id: 0 }  // Only indexed fields + exclude _id
)
// MongoDB only scans index, never touches collection

// ❌ NOT covered (returns field not in index)
db.users.find(
  { email: "john@example.com" },
  { email: 1, age: 1, name: 1 }  // name not in index
)
// MongoDB must fetch document for 'name' field

// ❌ NOT covered (includes _id)
db.users.find(
  { email: "john@example.com" },
  { email: 1, age: 1 }  // _id included by default
)

// ✅ COVERED (explicit _id exclusion)
db.users.find(
  { email: "john@example.com" },
  { email: 1, age: 1, _id: 0 }
)

// Real-world scenario: Caching lookup
// Index on (customerId, status)
db.orders.createIndex({ customerId: 1, status: 1 })

// Check if customer has any pending orders (covered)
db.orders.findOne(
  { customerId: "C123", status: "pending" },
  { customerId: 1, status: 1, _id: 0 }
)
// Instant lookup from index, no document reads
```

**Performance benefit:**
```javascript
// Without covered query
db.users.find({ email: "john@example.com" })
// 1. Index lookup: O(log N)
// 2. Fetch document: O(1)
// Total: Index scan + Document read

// With covered query
db.users.find({ email: "john@example.com" }, { email: 1, _id: 0 })
// 1. Index lookup: O(log N)
// 2. Return from index: O(1)
// Total: Index scan only (2-10x faster for large documents)
```

---

## explain() Deep Dive

The `explain()` method reveals how MongoDB executes your query.

```javascript
db.users.find({ age: { $gt: 25 } }).explain("executionStats")

// Output structure:
{
  "executionStats": {
    "executionStages": {
      "stage": "COLLSCAN",  // or IXSCAN, FETCH, etc.
      "nReturned": 42,      // Documents returned
      "executionTimeMillis": 125,  // Time taken
      "totalDocsExamined": 10000,  // Documents scanned
      "totalKeysExamined": 0,      // Index entries scanned
      "executionStages": {
        // Detailed execution plan...
      }
    },
    "executionStats": {
      "nReturned": 42,
      "executionStages": {
        "stage": "IXSCAN",   // Using index
        "totalKeysExamined": 50,     // Index entries
        "totalDocsExamined": 42,     // Docs fetched
      }
    }
  }
}

// Key metrics:
// - totalDocsExamined / nReturned = SELECTIVITY
//   Lower is better. Ratio close to 1 is ideal.
```

### Execution Stages

```javascript
// COLLSCAN: Collection scan (worst case, no index)
db.users.find({ name: "John" })  // No index on name
// Explanation: O(N) - scans all documents

// IXSCAN: Index scan (good, uses index)
db.users.find({ email: "john@example.com" })  // Index on email
// Explanation: O(log N) - navigates B-tree

// FETCH: Retrieve document after index
db.users.find({ email: "john@example.com" })
// Stages: FETCH → IXSCAN

// PROJECT: Include/exclude fields
db.users.find({ email: "john@example.com" }, { name: 1 })
// Stages: PROJECT → FETCH → IXSCAN

// SORT: Sort results (can be in-memory or index)
db.users.find({ age: { $gt: 25 } }).sort({ age: -1 })
// If sorted by index: no separate SORT stage
// If not sorted by index: SORT stage added (expensive)

// MATCH: Filter documents (equivalent to WHERE in SQL)
db.users.aggregate([
  { $match: { age: { $gt: 25 } } }
])
// Stage: COLLSCAN or IXSCAN depending on index

// $group, $unwind, etc. have their own stages
```

### Analyzing explain() Output

```javascript
// Create indexes
db.users.createIndex({ age: 1 })
db.users.createIndex({ email: 1 })

// ✅ GOOD: Efficient query
db.users.find({ email: "john@example.com" }).explain("executionStats")
// {
//   "executionStats": {
//     "nReturned": 1,
//     "totalDocsExamined": 1,
//     "totalKeysExamined": 1,
//     "executionStages": {
//       "stage": "FETCH",
//       "nReturned": 1,
//       "executionStages": {
//         "stage": "IXSCAN",
//         "keyPattern": { "email": 1 }
//       }
//     }
//   }
// }

// ❌ BAD: Collection scan (no index used)
db.users.find({ name: "John" }).explain("executionStats")
// {
//   "executionStats": {
//     "nReturned": 10,
//     "totalDocsExamined": 10000,  // Scanned 10K to find 10
//     "executionStages": {
//       "stage": "COLLSCAN"  // Collection scan!
//     }
//   }
// }

// ❌ BAD: Inefficient sort
db.users.find({ age: { $gt: 25 } }).sort({ name: 1 }).explain("executionStats")
// Index on age, but sort by name (different field)
// MongoDB must sort in memory after filtering
```

**Spring Data MongoDB:**
```java
// Execute query and get explain
@Service
public class UserService {
    @Autowired
    private MongoTemplate mongoTemplate;

    public void analyzeQuery() {
        Query query = new Query(Criteria.where("email").is("john@example.com"));
        Document explanation = mongoTemplate.executeCommand(
            new Document("explain", query.getQueryObject())
        );
        System.out.println(explanation);
    }
}
```

---

## Query Optimization

### 1. Index Creation Strategy

```javascript
// Step 1: Analyze current queries
// Step 2: Identify missing indexes
// Step 3: Create indexes carefully (don't over-index)

// Common patterns to index:
// - Filter fields (WHERE clauses)
// - Sort fields
// - Fields used in lookups/joins

// Example: Order search page
// Users search by: status, customerId, date range
// Results sorted by: date (descending)

db.orders.createIndex({
  customerId: 1,  // Filter (equality)
  status: 1,      // Filter (equality)
  orderDate: -1   // Sort (descending)
})
// ESR violated? No - it's more like EES (two equalities, then sort)
// This is acceptable for common patterns

// Query:
db.orders.find({
  customerId: "C123",
  status: "completed",
  orderDate: { $gte: ISODate("2024-01-01"), $lt: ISODate("2024-02-01") }
}).sort({ orderDate: -1 })
```

### 2. Selectivity

**Selectivity** = nReturned / totalDocsExamined

Lower is better (ideally close to 1.0).

```javascript
// ✅ HIGH selectivity (efficient)
db.users.find({ email: "john@example.com" })
// Selectivity: 1/1 = 1.0 (perfect!)

// ⚠️ MEDIUM selectivity (acceptable)
db.users.find({ age: { $gt: 25 } })
// Selectivity: 8000/10000 = 0.8

// ❌ LOW selectivity (inefficient)
db.users.find({ active: true })
// Selectivity: 9000/10000 = 0.9
// Problem: Active = true is too broad, need more selective filter

// Solution: Filter by more selective field first
db.users.find({
  active: true,
  email: { $regex: "gmail.com$" }  // More selective
})
```

### 3. Avoid $regex Without Anchors

```javascript
// ❌ SLOW: Regex without anchor
db.users.find({ email: { $regex: "gmail" } })
// Must scan all values, cannot use index efficiently

// ✅ FASTER: Regex with anchor
db.users.find({ email: { $regex: "^john" } })
// Index can narrow search space

// ✅ BEST: Equality/range instead of regex
db.users.find({ email: { $in: ["john@gmail.com", "john@yahoo.com"] } })
// Much faster, uses index effectively
```

### 4. Avoid Large $in Lists

```javascript
// ❌ SLOW: Large $in list (100+ items)
db.users.find({
  userId: { $in: [id1, id2, id3, ..., id1000] }
})
// MongoDB creates large index union, degrades performance

// ✅ BETTER: Multiple OR conditions (up to 10)
db.users.find({
  $or: [
    { userId: { $in: [id1, id2, ..., id10] } },
    { userId: { $in: [id11, id12, ..., id20] } },
    // etc.
  ]
})

// ✅ BEST: Use $nin with exclusion if applicable
db.users.find({
  userId: { $nin: [excludedId1, excludedId2] }
})
```

### 5. Project Early to Limit Fields

```javascript
// ❌ Fetch all fields, filter in application
db.users.find({ age: { $gt: 25 } })
// Returns entire documents with all fields

// ✅ Fetch only needed fields
db.users.find(
  { age: { $gt: 25 } },
  { name: 1, email: 1 }
)
// Reduces network transfer and memory usage
```

### 6. Connection Pooling

```java
// Spring Data MongoDB configuration
@Configuration
public class MongoConfig {
    @Bean
    public MongoClient mongoClient() {
        return MongoClients.create(
            MongoClientSettings.builder()
                .applyConnectionString(new ConnectionString(
                    "mongodb://localhost:27017/" +
                    "?maxPoolSize=50&" +
                    "minPoolSize=10&" +
                    "waitQueueTimeoutMS=5000"
                ))
                .build()
        );
    }
}

// Connection pool settings:
// maxPoolSize: 50 (max concurrent connections)
// minPoolSize: 10 (maintain baseline connections)
// waitQueueTimeoutMS: 5000 (timeout waiting for connection)
```

---

## Read and Write Concerns

### Write Concern

Specifies level of acknowledgment for write operations.

```javascript
// MongoDB write concerns
// w: majority - Wait for majority of replica set (safest)
// w: 1 - Wait for primary only (faster, less safe)
// j: true - Wait for journal write (durability)

// Insert with write concern
db.users.insertOne(
  { name: "John" },
  { writeConcern: { w: "majority", j: true } }
)

// Update with write concern
db.users.updateOne(
  { _id: ObjectId() },
  { $set: { age: 29 } },
  { writeConcern: { w: "majority" } }
)
```

**Spring Data MongoDB:**
```java
@Configuration
public class MongoConfig {
    @Bean
    public MongoClientSettings mongoClientSettings() {
        return MongoClientSettings.builder()
            .writeConcern(WriteConcern.MAJORITY.withJournal(true))
            .build();
    }
}

// Or at method level
@Service
public class UserService {
    @Autowired
    private MongoTemplate mongoTemplate;

    public void createUser(User user) {
        mongoTemplate.withWriteConcern(WriteConcern.MAJORITY)
            .insert(user);
    }
}
```

### Read Concern

Specifies level of consistency for read operations.

```javascript
// Read concern levels
// local - Default, fastest (may see uncommitted writes)
// available - Like local (for replica sets)
// majority - Read only committed writes (slower, safer)
// linearizable - Sequential consistency (slowest, safest)

// Find with read concern
db.users.find({ age: { $gt: 25 } })
    .readConcern("majority")

// In transaction
db.session.startTransaction({
  readConcern: { level: "majority" }
})
```

### Read Preference

Specifies which replica set member to read from.

```javascript
// primary - Read from primary only (default, consistent)
// primaryPreferred - Primary, fall back to secondary
// secondary - Read from secondary only (may lag)
// secondaryPreferred - Secondary, fall back to primary
// nearest - Lowest latency (primary or secondary)

db.users.find({ age: { $gt: 25 } })
    .readPreference("secondary")  // Read from secondary

// Use case: Analytics queries on secondary (don't impact primary)
```

**Spring Data MongoDB:**
```java
@Service
public class AnalyticsService {
    @Autowired
    private MongoTemplate mongoTemplate;

    public List<UserStats> generateReport() {
        // Read from secondary for analytics
        return mongoTemplate.withReadPreference(ReadPreference.secondary())
            .find(new Query(), UserStats.class);
    }
}
```

---

## WiredTiger Storage Engine

MongoDB default storage engine (3.2+).

### Features

```javascript
// Document-level locking (not collection-level)
// Allows concurrent writes to different documents in same collection

// Compression (default: snappy)
// Reduces disk usage by 50-80%

// Cache management
// Configurable working set

// Point-in-time snapshots
// Enables backups without locks
```

### Configuration

```javascript
// Set cache size (percent of RAM)
db.adminCommand({
  setParameter: 1,
  wiredTigerEngineRuntimeConfig: "cache_size=5G"
})

// Compression level
db.adminCommand({
  setParameter: 1,
  wiredTigerCompressionLevel: 9  // 1-9, default 6
})
```

---

## Profiler

MongoDB profiler logs slow queries to `system.profile` collection.

```javascript
// Enable profiling
// Level 0: OFF
// Level 1: Log slow operations (> 100ms by default)
// Level 2: Log all operations

db.setProfilingLevel(1, { slowms: 100 })

// Query slow operations
db.system.profile.find({ millis: { $gt: 100 } })
    .sort({ ts: -1 })
    .limit(10)

// Find slowest queries
db.system.profile.aggregate([
  { $group: {
      _id: "$command",
      count: { $sum: 1 },
      avgTime: { $avg: "$millis" }
    }
  },
  { $sort: { avgTime: -1 } }
])

// Check profiling level
db.getProfilingLevel()

// Disable profiling
db.setProfilingLevel(0)
```

**Spring Data MongoDB:**
```java
@Component
public class ProfilerConfig {
    @Autowired
    private MongoTemplate mongoTemplate;

    @PostConstruct
    public void enableProfiling() {
        mongoTemplate.executeCommand(
            new Document("setParameter", 1)
                .append("slowms", 100)
                .append("profilingLevel", 1)
        );
    }
}
```

---

## Common Interview Questions

### Q1: Why is index order important in compound indexes?

**Answer:**
MongoDB uses the first field in a compound index to navigate the B-tree. Fields that follow must match the query pattern.

```javascript
// Index: { age: 1, name: 1 }

// ✅ Uses full index
db.users.find({ age: 25 })
db.users.find({ age: 25, name: "John" })

// ❌ Cannot use index (missing first field)
db.users.find({ name: "John" })

// ESR rule (Equality, Sort, Range):
db.users.find({ status: "active", age: { $gt: 25 } }).sort({ age: 1 })
// Best index: { status: 1, age: 1 }
// status (equality), then age (sort and range)
```

### Q2: How do you identify if a query is using an index?

**Answer:**
Use `explain("executionStats")`:

```javascript
db.users.find({ email: "john@example.com" }).explain("executionStats")
// If stage is IXSCAN → using index
// If stage is COLLSCAN → NOT using index

// Better metric: totalKeysExamined vs totalDocsExamined
// If totalKeysExamined << totalDocsExamined → index helping
// If totalKeysExamined ≈ totalDocsExamined → collection scan
```

### Q3: When should you NOT create an index?

**Answer:**
- Field queried rarely (low selectivity)
- Collection too small (< 100 documents)
- Index larger than available RAM
- Write-heavy operations (indexes slow writes)
- Complex index on low-cardinality field (e.g., status with 5 values)

```javascript
// ❌ Bad index (low cardinality)
db.users.createIndex({ status: 1 })
// Only 3 values: "active", "inactive", "pending"
// Not selective enough to justify index overhead

// ✅ Good index
db.users.createIndex({ email: 1 })
// High cardinality (unique), frequently queried
```

### Q4: Explain covered queries and when they're useful.

**Answer:**
Covered query returns results entirely from index without fetching documents.

```javascript
// Create index on fields you'll query
db.users.createIndex({ email: 1, age: 1 })

// ✅ Covered query (all fields in index)
db.users.find(
  { email: "john@example.com" },
  { email: 1, age: 1, _id: 0 }  // Must exclude _id
)
// Returns from index, no document fetches

// Use case: Frequent lookups of small fields
db.users.find(
  { userId: "USER-123" },
  { email: 1, _id: 0 }
)
// Million times/day: saves massive I/O
```

### Q5: How do you optimize aggregation pipelines?

**Answer:**
1. Place `$match` early to reduce documents
2. Use indexed fields in `$match`
3. Project fields early to limit data
4. Avoid `$lookup` before `$match`
5. Use `$limit` to stop processing early

```javascript
// ❌ Inefficient
db.orders.aggregate([
  { $lookup: { ... } },           // Join first (expensive)
  { $match: { status: "completed" } },  // Filter late
  { $sort: { total: -1 } }
])

// ✅ Efficient
db.orders.aggregate([
  { $match: { status: "completed" } },  // Filter early (uses index)
  { $lookup: { ... } },            // Join smaller result set
  { $sort: { total: -1 } },
  { $limit: 10 }                   // Stop early
])
```
