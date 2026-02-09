# MongoDB Deep Dive: Replication and Sharding

## Table of Contents
1. [Replica Sets](#replica-sets)
2. [Replication Internals](#replication-internals)
3. [Sharding](#sharding)
4. [Shard Key Selection](#shard-key-selection)
5. [Transactions](#transactions)
6. [Change Streams](#change-streams)
7. [Common Interview Questions](#common-interview-questions)

---

## Replica Sets

### Architecture

```
┌─────────────────────────────────────────────────┐
│            MongoDB Replica Set                   │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌──────────────────┐                          │
│  │   PRIMARY        │  (read/write)             │
│  │   (node 0)       │                          │
│  └──────────────────┘                          │
│          ↕ (oplog)                             │
│  ┌──────────────────┐  ┌──────────────────┐   │
│  │   SECONDARY      │  │   SECONDARY      │   │
│  │   (node 1)       │  │   (node 2)       │   │
│  │  (read only)     │  │  (read only)     │   │
│  └──────────────────┘  └──────────────────┘   │
│                                                 │
│  ┌──────────────────┐                          │
│  │   ARBITER       │  (election votes)          │
│  │   (node 3)       │  (no data)               │
│  └──────────────────┘                          │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Replica Set Roles

**Primary:**
- Accepts all write operations
- Logs changes to oplog (operation log)
- Replicates data to secondaries
- Only one primary per replica set
- If primary fails, election occurs

**Secondary:**
- Replicates data from primary via oplog
- Serves read-only operations (if read preference set)
- Can become primary if primary fails
- Multiple secondaries per replica set

**Arbiter:**
- Participates in elections only
- Does NOT replicate data (no disk space needed)
- Cannot become primary
- Lightweight for odd-numbered quorum

### Configuration

```javascript
// Initialize replica set
rs.initiate({
  _id: "myReplicaSet",
  members: [
    { _id: 0, host: "mongodb0:27017", priority: 3 },  // Primary
    { _id: 1, host: "mongodb1:27017", priority: 2 },  // Secondary
    { _id: 2, host: "mongodb2:27017", priority: 1 },  // Secondary
    { _id: 3, host: "mongodb3:27017", arbiterOnly: true }  // Arbiter
  ]
})

// Check replica set status
rs.status()

// Get configuration
rs.conf()

// Add secondary
rs.add("mongodb4:27017")

// Remove member
rs.remove("mongodb4:27017")

// Modify member priority
cfg = rs.conf()
cfg.members[1].priority = 10
rs.reconfig(cfg)
```

---

## Replication Internals

### Oplog (Operations Log)

The oplog is a capped collection that logs all write operations.

```javascript
// Oplog is in 'local' database (not replicated)
use local
db.oplog.rs.find().limit(5)

// Oplog entry structure:
{
  _id: Timestamp(1704067800, 1),
  ts: Timestamp(1704067800, 1),
  t: NumberLong(1),              // Term (for Raft)
  op: "i",                        // Operation: i=insert, u=update, d=delete
  ns: "database.collection",     // Namespace
  doc: { ... },                  // Full document (for insert)
  o2: { _id: ObjectId() },       // Original document _id (for update/delete)
  o: { $set: { field: value } }  // Operation details
}

// Oplog size
// MongoDB allocates oplog size as percentage of disk
// Default: 5% of disk space
// Or configured explicitly: --oplogSize 1024

// Replication lag = how far secondary is behind
// Check with rs.status()
// If lag is high, secondary is slow or falling behind
```

### Replication Process

```
PRIMARY (writes)
     ↓
[Operation] → [Oplog entry]
     ↓
SECONDARY (polls)
     ↓
[Fetch new oplog entries] → [Apply to data] → [Replicate]
     ↓
ARBITER (ignores, no data)
```

### Election Process (Raft Protocol)

```
1. Primary failure detected
2. Secondaries call for election
3. Replica set members vote
4. Member with highest priority + replication wins
5. Winner becomes new primary
6. Failed primary cannot rejoin without permission
```

**Priority-based:**
- Member with highest priority becomes primary
- If tied, most recent oplog wins
- Arbiter participates in voting only

```javascript
// Set priority to control election
cfg = rs.conf()
cfg.members[0].priority = 10  // Most likely primary
cfg.members[1].priority = 5
cfg.members[2].priority = 1   // Least likely
rs.reconfig(cfg)

// Priority 0 = cannot be primary
cfg.members[3].priority = 0
cfg.members[3].hidden = true  // Not visible to drivers
rs.reconfig(cfg)
```

### Read Preference with Replica Sets

```javascript
// primaryPreferred (default)
db.collection.find().readPreference("primaryPreferred")
// Read from primary if available, fall back to secondary

// secondary
db.collection.find().readPreference("secondary")
// Read only from secondaries (for analytics to not impact primary)

// secondaryPreferred
db.collection.find().readPreference("secondaryPreferred")
// Prefer secondary, fall back to primary

// nearest
db.collection.find().readPreference("nearest")
// Read from member with lowest latency
// Use case: Geographically distributed replica sets

// Reading from secondary = stale data risk
// Solution: Use read concern "majority" for consistency
```

**Spring Data MongoDB:**
```java
@Service
public class UserService {
    @Autowired
    private MongoTemplate mongoTemplate;

    // Read user (recent data from primary)
    public User getUser(String userId) {
        Query query = new Query(Criteria.where("_id").is(userId));
        return mongoTemplate.findOne(query, User.class);
    }

    // Analytics (ok with stale data from secondary)
    public List<UserStats> generateReport() {
        return mongoTemplate.withReadPreference(
            ReadPreference.secondary()
        ).find(new Query(), UserStats.class);
    }
}
```

### Failover and Durability

```javascript
// Automatic failover (configurable)
db.adminCommand({
  replSetFreeze: 60  // Freeze member for 60 seconds (won't be elected)
})

// Manual failover
rs.stepDown(60)  // Primary steps down for 60 seconds

// Write concern with replica sets
// w: 0 - Don't wait for acknowledgment (fast, risky)
// w: 1 - Wait for primary only (default, moderate)
// w: "majority" - Wait for majority (safer)
// j: true - Wait for journal write (durable)

db.users.insertOne(
  { name: "John" },
  { writeConcern: { w: "majority", j: true } }
)
```

### Delayed Replica Set Members

```javascript
// Replica set member that lags behind primary
// Use case: Protect against accidental deletions

cfg = rs.conf()
cfg.members[2].hidden = true      // Not visible to drivers
cfg.members[2].priority = 0        // Cannot be primary
cfg.members[2].slaveDelay = 3600   // 1 hour behind primary
rs.reconfig(cfg)

// If someone deletes data:
// 1. Detect deletion (within 1 hour)
// 2. Stop delayed member
// 3. Resync primary from delayed member
// 4. Recover data
```

---

## Sharding

### Why Shard?

When data exceeds single server capacity:
- **Storage**: Data larger than available disk
- **Memory**: Working set > available RAM
- **Throughput**: Queries/writes > single server capacity
- **Latency**: Geography requires local data

```
┌──────────────────────────────────────────┐
│        MongoDB Sharded Cluster           │
├──────────────────────────────────────────┤
│                                          │
│  ┌──────────────────────────┐            │
│  │   Mongos (Router)        │            │
│  │  (application connects)  │            │
│  └────────┬─────────────────┘            │
│           │                              │
│   ┌───────┼───────┬───────┐             │
│   ↓       ↓       ↓       ↓             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐│
│  │ Shard 1  │ │ Shard 2  │ │ Shard 3  ││
│  │ Primary  │ │ Primary  │ │ Primary  ││
│  │ +2ndary  │ │ +2ndary  │ │ +2ndary  ││
│  └──────────┘ └──────────┘ └──────────┘│
│                    ↑                    │
│  ┌────────────────────────────────┐    │
│  │ Config Servers (Replica Set)   │    │
│  │ Stores shard key ranges        │    │
│  └────────────────────────────────┘    │
│                                          │
└──────────────────────────────────────────┘
```

### Components

**Mongos:**
- Router between application and shards
- Queries shard keys from config servers
- Directs operations to correct shard(s)
- Stateless (can run multiple)

**Shard Servers:**
- Stores subset of data
- Each shard is replica set
- Contains primary + secondaries
- Data partitioned by shard key

**Config Servers:**
- Replica set storing cluster metadata
- Shard key ranges and their locations
- Used by mongos to route queries
- Must be up for cluster operations

### Setup

```javascript
// Step 1: Create config server replica set
mongod --configsvr --replSet configReplSet --port 27019

// Step 2: Initialize config servers
rs.initiate({
  _id: "configReplSet",
  members: [
    { _id: 0, host: "config-server-0:27019" },
    { _id: 1, host: "config-server-1:27019" },
    { _id: 2, host: "config-server-2:27019" }
  ]
})

// Step 3: Create shard replica sets
mongod --shardsvr --replSet shard1 --port 27018
mongod --shardsvr --replSet shard2 --port 27018

// Step 4: Start mongos
mongos --configdb configReplSet/config-server-0:27019,config-server-1:27019,config-server-2:27019

// Step 5: Connect to mongos and enable sharding
mongo --host localhost --port 27017

// Enable sharding on database
sh.enableSharding("mydb")

// Enable sharding on collection
sh.shardCollection("mydb.users", { email: 1 })
```

---

## Shard Key Selection

**THE MOST CRITICAL DECISION IN SHARDING**

A bad shard key causes:
- Uneven distribution (hot shards)
- Query routing to all shards
- Cannot be changed without resharding

```javascript
// Shard key characteristics:
// 1. High cardinality (many distinct values)
// 2. Immutable or changes infrequently
// 3. Distributed writes (not monotonically increasing)
// 4. Supports target queries (not scatter-gather)
```

### Good Shard Keys

```javascript
// ✅ GOOD: Unique user ID
db.users.createIndex({ userId: 1 })
sh.shardCollection("mydb.users", { userId: 1 })
// - High cardinality (millions of users)
// - Immutable
// - Supports: find by userId, find by range of IDs
// - Problem: Uneven distribution if IDs are sequential

// ✅ GOOD: Email (unique, random)
sh.shardCollection("mydb.users", { email: 1 })
// - High cardinality
// - Immutable
// - Good distribution (emails random)
// - Supports: find by email, find by domain range

// ✅ GOOD: Compound shard key
sh.shardCollection("mydb.orders", { customerId: 1, orderDate: 1 })
// - customerId (medium cardinality, frequent filter)
// - orderDate (high cardinality, temporal data)
// - Supports: find orders by customer, date range per customer

// ✅ GOOD: Hashed shard key (for monotonic keys)
sh.shardCollection("mydb.events", { "eventId": "hashed" })
// - Hashes eventId to distribute evenly
// - Solves monotonic key problem
// - Trade-off: Cannot do range queries
```

### Bad Shard Keys

```javascript
// ❌ BAD: Low cardinality
sh.shardCollection("mydb.users", { country: 1 })
// Only ~200 countries → uneven distribution
// Some shards hot, others cold

// ❌ BAD: Monotonically increasing
sh.shardCollection("mydb.events", { timestamp: 1 })
// All new writes go to same shard (current time range)
// Problem: One shard gets all traffic (hot shard)
// Solution: Use hashed: { timestamp: "hashed" }

// ❌ BAD: Field that changes frequently
sh.shardCollection("mydb.users", { status: 1 })
// User status changes from "pending" → "active"
// Chunk ranges become invalid, constant resharding

// ❌ BAD: Field with skewed distribution
sh.shardCollection("mydb.events", { userId: 1 })
// Popular user (e.g., celebrity) gets millions of events
// One shard becomes hot, others idle
// Solution: Compound key: { userId: 1, timestamp: 1 }
```

### Shard Key Range vs Hashed

```javascript
// RANGED shard key (default)
sh.shardCollection("mydb.products", { productId: 1 })
// Range boundaries: [0-1000], [1000-2000], [2000-3000]
// Chunks contain contiguous ranges
// Pros: Range queries efficient (single shard)
// Cons: If productId is monotonic → hot shard

// HASHED shard key
sh.shardCollection("mydb.products", { productId: "hashed" })
// Values hashed: 0x12A3F8 → shard 1, 0x45B6D2 → shard 2
// Chunks contain hash ranges (random distribution)
// Pros: Even distribution, prevents hot shards
// Cons: Range queries hit all shards (scatter-gather)

// Decision:
// - Even distribution needed? → Use hashed
// - Range queries common? → Use ranged
// - Hot spot risk? → Use hashed + compound key
```

### Data Distribution

```javascript
// Check shard distribution
sh.status()

// Output shows chunk distribution:
// {
//   database: "mydb",
//   collections: {
//     "mydb.users": {
//       shardKey: { email: 1 },
//       chunks: {
//         "shard1": 50,     // 50 chunks
//         "shard2": 48,     // 48 chunks
//         "shard3": 52      // 52 chunks (relatively even)
//       }
//     }
//   }
// }

// Chunk distribution should be even
// If skewed, data might not be distributed well
// Monitor with: sh.splitFind("mydb.users", { email: "middle@value" })
```

### Zones (Tag-aware Sharding)

```javascript
// Geo-partitioning example
sh.addShardToZone("shard1", "us-east")
sh.addShardToZone("shard2", "us-west")
sh.addShardToZone("shard3", "eu")

// Define zone ranges by shard key
sh.updateZoneKeyRange(
  "mydb.users",
  { email: "a@example.com" },
  { email: "g@example.com" },
  "us-east"
)

sh.updateZoneKeyRange(
  "mydb.users",
  { email: "g@example.com" },
  { email: "z@example.com" },
  "eu"
)

// Now writes to zone are routed to correct shard
// Supports regional compliance (GDPR, data residency)
```

---

## Chunks and Balancing

```javascript
// Chunks are ranges of shard key values
// Shard 1: email [a-g)
// Shard 2: email [g-m)
// Shard 3: email [m-z]

// When chunk exceeds threshold (64 MB default), it splits
db.config.settings.findOne()  // Check chunk size
// { _id: "chunksize", value: 64 }

// Balancer auto-moves chunks between shards to maintain balance
db.adminCommand({ balancerStatus: {} })

// Manual chunk management
sh.splitAt("mydb.users", { email: "k@example.com" })
sh.moveChunk("mydb.users", { email: "k@example.com" }, "shard2")
```

---

## Targeted vs Scatter-Gather Queries

```javascript
// Shard key: { customerId: 1 }

// ✅ TARGETED QUERY (single shard)
db.orders.find({ customerId: "C123" })
// Mongos routes to shard containing customerId: "C123"
// Only 1 shard queried

// ❌ SCATTER-GATHER QUERY (all shards)
db.orders.find({ total: { $gt: 1000 } })
// Mongos must query ALL shards
// Merges results, slower

// ❌ BROADCAST QUERY
db.orders.deleteMany({})
// Deletes from all shards (with no filter!)

// Solutions for scatter-gather:
// 1. Add shard key to filter: { customerId: "C123", total: { $gt: 1000 } }
// 2. Use compound shard key: { customerId: 1, total: 1 }
// 3. Accept performance cost for non-shard-key queries
```

---

## Transactions in MongoDB

### Single-Document Atomicity (Default)

All single-document updates are atomic.

```javascript
db.users.updateOne(
  { _id: ObjectId() },
  { $set: { age: 29, email: "new@example.com" } }
)
// Atomic: either both fields updated or neither
```

### Multi-Document Transactions

Available in replica sets and sharded clusters (4.0+).

```javascript
// Start transaction
const session = db.getMongo().startSession()

try {
  session.startTransaction()

  // Multiple operations (atomic)
  db.users.updateOne(
    { _id: userId },
    { $inc: { balance: -100 } },
    { session }
  )

  db.accounts.updateOne(
    { _id: accountId },
    { $inc: { balance: 100 } },
    { session }
  )

  session.commitTransaction()
} catch (error) {
  session.abortTransaction()
  throw error
}
```

**Spring Data MongoDB:**
```java
@Service
public class TransferService {
    @Autowired
    private MongoTemplate mongoTemplate;

    public void transferMoney(String fromUserId, String toUserId, BigDecimal amount) {
        ClientSession session = mongoTemplate.getDb().getClient()
            .startSession();

        try {
            session.startTransaction();

            // Debit from user
            mongoTemplate.withSession(session)
                .updateFirst(
                    new Query(Criteria.where("_id").is(fromUserId)),
                    new Update().inc("balance", amount.negate()),
                    User.class
                );

            // Credit to user
            mongoTemplate.withSession(session)
                .updateFirst(
                    new Query(Criteria.where("_id").is(toUserId)),
                    new Update().inc("balance", amount),
                    User.class
                );

            session.commitTransaction();
        } catch (Exception e) {
            session.abortTransaction();
            throw e;
        } finally {
            session.close();
        }
    }
}
```

### Multi-Document Transaction Limitations

```javascript
// ❌ Cannot span multiple databases
session.startTransaction()
db.database1.collection1.updateOne(...)
db.database2.collection2.updateOne(...)  // ERROR
session.commitTransaction()

// ❌ Cannot use certain operations
session.startTransaction()
db.collection.createIndex(...)  // ERROR
db.collection.updateOne(...)    // OK
session.commitTransaction()

// ✅ Cross-shard transactions (4.2+)
// But adds latency (must coordinate with config servers)
```

---

## Change Streams

Real-time notifications when data changes.

```javascript
// Watch for changes on collection
const changeStream = db.users.watch()

changeStream.on("change", (change) => {
  console.log(change)
  // {
  //   operationType: "insert",
  //   fullDocument: { _id: 1, name: "John" },
  //   ns: { db: "mydb", coll: "users" }
  // }
})

// Watch with filter
const changeStream = db.users.watch([
  { $match: { operationType: "insert" } }
])

// Watch for specific field changes
const changeStream = db.users.watch([
  {
    $match: {
      "operationType": "update",
      "updateDescription.updatedFields.age": { $exists: true }
    }
  }
])

// Possible operation types:
// - insert
// - update (includes updateDescription with updated fields)
// - replace
// - delete
// - invalidate (collection dropped, etc.)
```

**Spring Data MongoDB:**
```java
@Service
public class UserChangeListener {
    @Autowired
    private MongoTemplate mongoTemplate;

    @PostConstruct
    public void listenToChanges() {
        ChangeStreamOptions options = ChangeStreamOptions.empty();

        mongoTemplate.changeStream(User.class)
            .listen(event -> {
                System.out.println("User changed: " + event.getBody());
                handleUserChange(event.getBody());
            })
            .start();
    }

    private void handleUserChange(ChangeStreamEvent<User> event) {
        // Handle change in real-time
        // Update cache, send notifications, etc.
    }
}

// Or using listener
@Component
public class UserChangeListener extends AbstractMongoEventListener<User> {
    @Override
    public void onAfterSave(AfterSaveEvent<User> event) {
        User user = event.getSource();
        System.out.println("User saved: " + user);
    }

    @Override
    public void onAfterDelete(AfterDeleteEvent<User> event) {
        System.out.println("User deleted");
    }
}
```

---

## Common Interview Questions

### Q1: What's the difference between replica sets and sharding?

**Answer:**
- **Replica Set**: Copies of same data on multiple servers (for high availability)
- **Sharding**: Data partitioned across servers (for scalability)

```
Replica Set (HA):
Data = [A, B, C]
Server 1: [A, B, C]
Server 2: [A, B, C] (replica)
Server 3: [A, B, C] (replica)

Sharding (Scalability):
Data = [A, B, C, D, E, F]
Server 1: [A, B] (shard)
Server 2: [C, D] (shard)
Server 3: [E, F] (shard)
```

### Q2: How are writes replicated from primary to secondary?

**Answer:**
1. Write received by primary
2. Primary applies write to data
3. Primary writes operation to oplog
4. Secondaries poll oplog for new entries
5. Secondaries apply operations in order
6. Secondaries update their copy

```javascript
// Oplog guarantees:
// - Total order (sequential)
// - Idempotent (safe to apply multiple times)
// - Durable (survives crashes)
```

### Q3: What makes a bad shard key?

**Answer:**
- **Low cardinality**: Too few distinct values (status with 5 values)
- **Monotonically increasing**: All writes to same shard (timestamp)
- **Uneven distribution**: Some values more common (geographic location)
- **Frequently changing**: Chunk ranges become invalid

```javascript
// ❌ Bad shard keys:
// { timestamp: 1 }  // All new writes to current time range
// { status: 1 }     // Only 10 distinct statuses
// { country: 1 }    // Only ~200 values, some very popular

// ✅ Good shard keys:
// { userId: 1 }             // Millions of distinct values
// { email: "hashed" }       // Even distribution, high cardinality
// { userId: 1, timestamp: 1 } // Compound, supports range per user
```

### Q4: How do you handle a hot shard?

**Answer:**
A hot shard receives disproportionate traffic. Solutions:

```javascript
// 1. Improve shard key (if not already using hashed)
// Old: { userId: 1 }
// New: { userId: "hashed" } + { userId: 1, timestamp: 1 }

// 2. Use zones to isolate hot data
sh.addShardToZone("shard-hot", "hot-data")
sh.updateZoneKeyRange(
  "mydb.events",
  { userId: "celebrity-user" },
  { userId: "celebrity-user\0" },  // Range just this user
  "shard-hot"
)

// 3. Use read preference to distribute reads
db.events.find({ userId: "celebrity-user" })
  .readPreference("secondary")  // Read from secondary, not primary
```

### Q5: Explain oplog and why it's important.

**Answer:**
Oplog (operations log) is a capped collection that records all write operations.

**Why important:**
- **Replication**: Secondaries replicate by applying oplog entries
- **Recovery**: If server crashes, oplog replayed to recover
- **Point-in-time recovery**: Can restore to any point in oplog history

```javascript
// Oplog size:
// Default: 5% of disk
// Or configured: --oplogSize 5120 (MB)

// Larger oplog allows:
// - Longer replication lag recovery
// - More historical data retention
// - Point-in-time backups

// Monitor replication lag:
rs.status()
// Shows seconds_behind_primary for each secondary
```

### Q6: When would you choose multi-document transactions?

**Answer:**
Use when you need atomicity across multiple operations:

```javascript
// Good use cases:
// 1. Financial transfers (debit + credit must both succeed)
db.accounts.updateOne({ _id: 1 }, { $inc: { balance: -100 } })
db.accounts.updateOne({ _id: 2 }, { $inc: { balance: +100 } })

// 2. Inventory + order creation
db.products.updateOne({ _id: "PROD-001" }, { $inc: { stock: -5 } })
db.orders.insertOne({ customerId: 1, items: [...] })

// Poor use cases:
// 1. Simple single-document updates (already atomic)
db.users.updateOne({ _id: 1 }, { $set: { age: 29 } })  // No transaction needed

// 2. Large batches (kills performance)
for (let i = 0; i < 1000000; i++) {
  // Don't wrap in single transaction
}
```
