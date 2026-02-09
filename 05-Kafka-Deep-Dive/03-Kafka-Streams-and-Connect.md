# Kafka Streams and Connect - Deep Dive

## Table of Contents
1. [Kafka Streams Overview](#kafka-streams-overview)
2. [Stateless vs Stateful Operations](#stateless-vs-stateful-operations)
3. [KStream, KTable, GlobalKTable](#kstream-ktable-globalkta

)
4. [Stream Processing Operations](#stream-processing-operations)
5. [Windowing](#windowing)
6. [State Stores](#state-stores)
7. [Exactly-Once Processing](#exactly-once-processing)
8. [Interactive Queries](#interactive-queries)
9. [Kafka Connect](#kafka-connect)
10. [Schema Registry](#schema-registry)
11. [Stream Processing Comparisons](#stream-processing-comparisons)
12. [Interview Questions](#interview-questions)

---

## Kafka Streams Overview

### What is Kafka Streams?

Kafka Streams is a **client library** for building stream processing applications:

```
Traditional architecture:
Producer → [Kafka Topic] → Consumer ← External system
                            (poll, process)

Kafka Streams:
Producer → [Kafka Topic] → KafkaStreams → Output topics
                            (embedded)    (state stores)
```

Key features:
- **Embeds in application**: No separate cluster needed
- **Stateful**: Maintains state stores for aggregations
- **Exactly-once semantics**: Strong processing guarantees
- **Scalable**: Partitions enable horizontal scaling
- **Interactive queries**: Query state stores from outside

### Architecture

```
┌──────────────────────────────────────────────────────┐
│           Kafka Streams Application                   │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌───────────────────────────────────────────────┐   │
│  │      Topology (DAG of operations)             │   │
│  │  Source → Filter → Map → Window → Sink       │   │
│  └───────────────────────────────────────────────┘   │
│                      │                                 │
│  ┌───────────────────────────────────────────────┐   │
│  │      State Store (RocksDB)                    │   │
│  │  Maintains aggregation state                  │   │
│  │  Changelog backed by Kafka topic              │   │
│  └───────────────────────────────────────────────┘   │
│                      │                                 │
│  ┌───────────────────────────────────────────────┐   │
│  │      Consumer Group                           │   │
│  │  One instance per stream partition            │   │
│  │  Parallelism = partitions                     │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### Topology Example

```java
StreamsBuilder builder = new StreamsBuilder();

// Source
KStream<String, String> orders = builder.stream("orders");

// Transform
KStream<String, Order> parsedOrders = orders
    .mapValues(jsonValue -> parseOrder(jsonValue));

// Filter
KStream<String, Order> largeOrders = parsedOrders
    .filter((key, order) -> order.getAmount() > 1000);

// Sink
largeOrders.to("large-orders");

// Build topology
Topology topology = builder.build();
```

---

## Stateless vs Stateful Operations

### Stateless Operations

No state needed, just transform each record:

```java
// Filter: Pass records matching condition
stream.filter((key, value) -> value.getAmount() > 100);

// Map: Transform each record
stream.map((key, value) -> new KeyValue<>(key, value.upper()));

// FlatMap: One input → zero or more outputs
stream.flatMap((key, value) -> {
    List<KeyValue<String, String>> results = new ArrayList<>();
    for (String word : value.split(" ")) {
        results.add(new KeyValue<>(word, word));
    }
    return results.iterator();
});

// MapValues: Transform value only
stream.mapValues(value -> value * 2);

// Peek: Debug, no transformation
stream.peek((key, value) -> System.out.println(key + ": " + value));

// Branch: Split into multiple streams
KStream<String, Order>[] branches = stream.branch(
    (key, order) -> order.getAmount() > 1000,  // Branch 0: large orders
    (key, order) -> order.getAmount() > 100,   // Branch 1: medium orders
    (key, order) -> true                       // Branch 2: small orders
);
```

Stateless characteristics:
- No state store needed
- Memory efficient
- Can be parallelized easily
- Same record → same output always

### Stateful Operations

Maintain state across multiple records:

```java
// Aggregate: Combine records by key
KTable<String, Long> orderCounts = stream
    .groupByKey()
    .count();  // Maintains count per key in state store

// Reduce: Combine records with associative function
KTable<String, Order> totalOrders = stream
    .groupByKey()
    .reduce((order1, order2) -> {
        order1.setTotal(order1.getTotal() + order2.getAmount());
        return order1;
    });

// Aggregate with custom initializer
KTable<String, OrderStats> stats = stream
    .groupByKey()
    .aggregate(
        () -> new OrderStats(0, 0.0),  // Initializer
        (key, order, stats) -> {        // Aggregator
            stats.count++;
            stats.total += order.getAmount();
            return stats;
        }
    );

// Join: Combine records from multiple streams
stream1.join(stream2,
    (order, payment) -> {
        order.setPaymentId(payment.getId());
        return order;
    },
    JoinWindows.of(Duration.ofMinutes(5))
);
```

Stateful characteristics:
- State store required (RocksDB)
- Changelog topic for recovery
- More resource intensive
- Same record key → same state reference

---

## KStream, KTable, GlobalKTable

### KStream (Event Stream)

```
KStream: Series of immutable events
├─ Append-only
├─ New value doesn't replace old
├─ Each record is independent

Example: Order events
Offset 0: User 123 ordered $50
Offset 1: User 456 ordered $100
Offset 2: User 123 ordered $75  ← New order, doesn't replace first

KStream read:
├─ First order: $50
├─ Second order: $100
├─ Third order: $75
└─ Total of 3 events processed
```

```java
KStream<String, Order> orders = builder.stream("orders");

// Processing receives each event
orders.foreach((key, value) -> {
    System.out.println("Order: " + key + " → " + value);
});

// Output (each new order):
// Order: user-123 → {amount: 50}
// Order: user-456 → {amount: 100}
// Order: user-123 → {amount: 75}
```

### KTable (Changelog)

```
KTable: Change log with latest value per key
├─ Mutable
├─ New value REPLACES old with same key
├─ Represents current state

Example: User balances
Offset 0: User 123 balance: $1000
Offset 1: User 456 balance: $500
Offset 2: User 123 balance: $950  ← Update replaces previous

KTable read:
├─ User 123: $950     (latest)
└─ User 456: $500     (latest)
```

```java
KTable<String, UserBalance> balances = builder.table("user-balances");

// Processing receives (key, newValue, oldValue)
balances.foreach((key, newValue) -> {
    System.out.println("User " + key + " balance: " + newValue);
});

// Output (only latest per key):
// User user-123 balance: 950
// User user-456 balance: 500
```

### GlobalKTable (Replicated KTable)

```
GlobalKTable: Full copy on every instance
├─ Same as KTable, but fully replicated
├─ No join window needed
├─ Higher memory cost

Example: Reference data (state, country codes)
All instances get complete copy:
├─ Instance 1: [CA, US, MX, ...]
├─ Instance 2: [CA, US, MX, ...]
└─ Instance 3: [CA, US, MX, ...]

Benefits:
├─ Direct lookup: state="CA" → "California"
├─ No window matching needed
└─ Can join KStream to GlobalKTable with any key
```

```java
// Small reference data (doesn't change often)
GlobalKTable<String, StateCode> stateCodes =
    builder.globalTable("state-codes");

// Orders (large, frequent stream)
KStream<String, Order> orders = builder.stream("orders");

// Enrich orders with state names
KStream<String, OrderWithState> enriched = orders.join(
    stateCodes,
    (orderId, order) -> order.getStateCode(),  // Key to lookup
    (order, stateCode) -> new OrderWithState(order, stateCode)
);
```

### KStream vs KTable vs GlobalKTable

| Feature | KStream | KTable | GlobalKTable |
|---------|---------|--------|--------------|
| **Semantics** | Event log | Latest state | Replicated state |
| **Duplication** | Each event | Latest only | Latest, full copy |
| **Join Window** | Required | Optional | Not needed |
| **Memory** | Low | Medium | High |
| **Use case** | Events | Aggregations | Reference data |

---

## Stream Processing Operations

### Filtering and Mapping

```java
KStream<String, Order> orders = builder.stream("orders");

// Filter
orders.filter((key, order) -> order.getAmount() > 100)
      .to("high-value-orders");

// Map (change key)
orders.map((key, order) ->
    new KeyValue<>(order.getCustomerId(), order))
    .to("orders-by-customer");

// MapValues (transform value, keep key)
orders.mapValues(order -> {
    order.setProcessed(true);
    return order;
})
.to("processed-orders");

// FlatMap (one to many)
orders.flatMapValues(order -> {
    // Split order items into separate records
    return order.getItems();
})
.to("order-items");
```

### Grouping

```java
// GroupByKey: Key-based grouping
KGroupedStream<String, Order> byKey = orders.groupByKey();

// GroupBy: Custom key function
KGroupedStream<String, Order> byCustomer = orders.groupBy(
    (key, order) -> order.getCustomerId()
);

// GroupBy with value change
KGroupedStream<String, Double> byRegion = orders.groupBy(
    (key, order) -> order.getRegion(),
    Grouped.with(
        Serdes.String(),
        Serdes.Double()
    )
);
```

### Aggregations

```java
// Count (count per key)
KTable<String, Long> orderCounts = orders
    .groupByKey()
    .count();  // Long

// Sum
KTable<String, Double> totalAmount = orders
    .groupByKey()
    .aggregate(
        () -> 0.0,
        (key, order, sum) -> sum + order.getAmount(),
        Materialized.as("order-totals")
    );

// Custom aggregation
KTable<String, OrderStats> stats = orders
    .groupByKey()
    .aggregate(
        OrderStats::new,
        (key, order, stats) -> {
            stats.count++;
            stats.sum += order.getAmount();
            stats.avg = stats.sum / stats.count;
            return stats;
        },
        Materialized.as("order-stats")
    );

// Reduce (simpler than aggregate, binary operation)
KTable<String, Order> maxOrder = orders
    .groupByKey()
    .reduce((order1, order2) ->
        order1.getAmount() > order2.getAmount() ? order1 : order2
    );
```

### Joins

**Stream-Stream Join**:
```java
KStream<String, Order> orders = builder.stream("orders");
KStream<String, Payment> payments = builder.stream("payments");

// Inner join with 5-minute window
KStream<String, OrderPayment> joined = orders.join(
    payments,
    (order, payment) -> new OrderPayment(order, payment),
    JoinWindows.of(Duration.ofMinutes(5))
);

// Left join (keep unmatched orders)
KStream<String, OrderPayment> leftJoined = orders.leftJoin(
    payments,
    (order, payment) -> new OrderPayment(order, payment),
    JoinWindows.of(Duration.ofMinutes(5))
);

// Outer join (keep unmatched from both)
KStream<String, OrderPayment> outerJoined = orders.outerJoin(
    payments,
    (order, payment) -> new OrderPayment(order, payment),
    JoinWindows.of(Duration.ofMinutes(5))
);
```

**Stream-Table Join**:
```java
KStream<String, Order> orders = builder.stream("orders");
KTable<String, UserProfile> users = builder.table("users");

// Enrich stream with table data (latest snapshot)
KStream<String, EnrichedOrder> enriched = orders.join(
    users,
    (order, user) -> {
        order.setCustomerName(user.getName());
        return order;
    }
);

// Stream-GlobalKTable (no window needed)
GlobalKTable<String, StateCode> states = builder.globalTable("states");

KStream<String, EnrichedOrder> withState = orders.join(
    states,
    (orderId, order) -> order.getStateCode(),
    (order, state) -> {
        order.setStateName(state.getName());
        return order;
    }
);
```

---

## Windowing

Windowing groups events into time buckets:

### Tumbling Window (Fixed-size, non-overlapping)

```
Timeline:
[Window 0] [Window 1] [Window 2] [Window 3]
T:0-5min  T:5-10min T:10-15min T:15-20min

Events:
T=2min: Order A → Window 0
T=7min: Order B → Window 1
T=9min: Order C → Window 1
T=13min: Order D → Window 2

Result per window:
Window 0: [A]
Window 1: [B, C]
Window 2: [D]
```

```java
KTable<Windowed<String>, Long> tumbled = orders
    .groupByKey()
    .windowedBy(TimeWindows.of(Duration.ofMinutes(5)))
    .count();

// Accessing results:
tumbled.suppress(Suppressed.untilWindowCloses(Grace.period(Duration.ZERO)))
       .foreach((window, count) -> {
           System.out.println("Window: " + window.window() +
                            " Orders: " + count);
       });
```

### Hopping Window (Sliding, overlapping)

```
Timeline (5min window, 2min advance):
[Window A(0-5)] [Window B(2-7)] [Window C(4-9)] [Window D(6-11)]
     |    overlap: [2-5]    |

Events:
T=1min: Order A → Windows A
T=3min: Order B → Windows A, B
T=7min: Order C → Windows B, C
T=9min: Order D → Windows C, D

Windows overlap, events counted in multiple windows
```

```java
KTable<Windowed<String>, Long> hopping = orders
    .groupByKey()
    .windowedBy(TimeWindows
        .of(Duration.ofMinutes(5))        // Window size
        .advanceBy(Duration.ofMinutes(2)) // Advance interval
    )
    .count();
```

### Sliding Window (Event-time based)

```
Sliding window: 5-minute before → 5-minute after
For event at T=10: [T=5 to T=15]

Events:
T=5: Order A → Triggers window [0-10]
T=10: Order B → Triggers windows [5-15]
T=13: Order C → Triggers windows [8-18]

Always keeps events within window duration of each other
```

```java
KStream<String, OrderTotal> totals = orders
    .groupByKey()
    .windowedBy(SlidingWindows.of(Duration.ofMinutes(5)))
    .aggregate(/* ... */)
    .toStream()
    .map((windowedKey, value) ->
        new KeyValue<>(windowedKey.key() + "@" + windowedKey.window().start(),
                       value)
    );
```

### Session Window (Gap-based)

```
Session: Group events separated by gap < timeout
Gap timeout: 5 minutes

Events:
T=1min: Order A → Start session [1]
T=3min: Order B → Same session [1-3]
T=9min: Order C → New session [9] (gap > 5min)
T=10min: Order D → Same session [9-10]

Sessions:
Session 1: [A, B] (gap within 5 min)
Session 2: [C, D] (gap within 5 min, but separate from Session 1)
```

```java
KTable<Windowed<String>, Long> sessions = orders
    .groupByKey()
    .windowedBy(SessionWindows.with(Duration.ofMinutes(5)))
    .count();

// Output:
// Session [user-123 @ 1000-3000]: 2 orders
// Session [user-123 @ 9000-10000]: 2 orders (new session, gap > 5min)
```

### Window Retention and Grace Period

```java
// Grace period: Allow late-arriving events
TimeWindows.of(Duration.ofMinutes(5))
    .grace(Duration.ofSeconds(30))  // Accept events 30s after window close

// Window retention: How long to keep state
TimeWindows.of(Duration.ofMinutes(5))
    .until(Duration.ofMinutes(15))   // Keep state for 15 minutes
```

---

## State Stores

### RocksDB State Store

Kafka Streams uses **RocksDB** (embedded key-value store) by default:

```
Advantages:
├─ Embedded: No external database needed
├─ Persistent: Survives restarts
├─ Fast: Optimized for sequential access
└─ Changelog backed: Recovery from Kafka

Architecture:
┌────────────────────────────────────┐
│    Kafka Streams Application        │
├────────────────────────────────────┤
│                                     │
│  ┌──────────────────────────────┐  │
│  │   In-Memory Cache (LRU)      │  │
│  │   Hot data, faster access    │  │
│  └──────────────────────────────┘  │
│              ↓                       │
│  ┌──────────────────────────────┐  │
│  │   RocksDB on Disk            │  │
│  │   Persistent state store     │  │
│  └──────────────────────────────┘  │
│              ↓                       │
│  ┌──────────────────────────────┐  │
│  │   Changelog Topic (Kafka)    │  │
│  │   Recovery and replication   │  │
│  └──────────────────────────────┘  │
│                                     │
└────────────────────────────────────┘
```

### Changelog Topics

Every state store backed by internal Kafka topic:

```
State store: order-totals-store
Changelog topic: order-totals-store-changelog

Write to state store:
├─ Update RocksDB locally
├─ Append to changelog topic
└─ Other instances see update (for recovery)

Restart scenario:
T1. Instance crashes
T2. New instance starts with same app-id
T3. Consumes changelog topic from beginning
T4. Rebuilds state store to current position
T5. Ready to process new events
```

### Interactive Queries

Query state stores from outside the topology:

```java
// Define interactive store
KTable<String, OrderStats> stats = orders
    .groupByKey()
    .aggregate(
        OrderStats::new,
        (key, order, agg) -> {
            agg.count++;
            agg.total += order.getAmount();
            return agg;
        },
        Materialized.as("order-stats-store")
    );

// Later, query the store
KafkaStreams streams = new KafkaStreams(topology, config);
streams.start();

// Wait for store to be available
while (!streams.metadataForLocalThreads().isReady()) {
    Thread.sleep(100);
}

// Query store
ReadOnlyKeyValueStore<String, OrderStats> store =
    streams.getQueryableStore("order-stats-store",
                             QueryableStoreTypes.keyValueStore());

// Get specific key
OrderStats stats = store.get("user-123");
System.out.println("User 123 stats: " + stats);

// Range query
try (KeyValueIterator<String, OrderStats> range =
     store.range("user-100", "user-200")) {
    range.forEachRemaining(kv ->
        System.out.println(kv.key + ": " + kv.value)
    );
}

// All entries
try (KeyValueIterator<String, OrderStats> all = store.all()) {
    all.forEachRemaining(kv ->
        System.out.println(kv.key + ": " + kv.value)
    );
}
```

### Custom State Stores

```java
// Custom initializer for in-memory store
class CustomStoreSupplier implements StoreSupplier<KeyValueStore<String, OrderStats>> {
    @Override
    public KeyValueStore<String, OrderStats> get() {
        return Stores.inMemoryKeyValueStore("custom-store");
    }
}

// Use custom store
KTable<String, OrderStats> stats = orders
    .groupByKey()
    .aggregate(
        OrderStats::new,
        (key, order, agg) -> { /* ... */ return agg; },
        Materialized.as(new CustomStoreSupplier())
    );
```

---

## Exactly-Once Processing

Kafka Streams guarantees exactly-once with proper configuration:

### Configuration

```java
StreamsConfig config = new StreamsConfig(props);

props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG,
          StreamsConfig.EXACTLY_ONCE_V2);  // or EXACTLY_ONCE

props.put(StreamsConfig.CACHE_MAX_BYTES_BUFFERING_CONFIG,
          10000000);  // 10MB cache
```

### Semantics

```
At-most-once:
├─ Commit offset BEFORE processing
├─ Crash after commit, before processing: message lost
└─ Processing guarantee: NONE

At-least-once:
├─ Process, THEN commit offset
├─ Crash after processing, before commit: reprocess
├─ Consumer idempotence required (detect duplicates)
└─ Processing guarantee: AT_LEAST_ONCE

Exactly-once:
├─ Atomic: process + commit state + output together
├─ Crash at any point: atomic rollback
├─ All outputs: transactional, at-most-once visible
└─ Processing guarantee: EXACTLY_ONCE_V2
```

### Transactional Writes

```
Exactly-once requires:
├─ Input offset commit
├─ State store update
├─ Output record write
└─ All ATOMIC

Kafka Streams handles via:
├─ Producer transactions (for outputs)
├─ State store changelog (for state)
├─ Offset commit (single transaction)
```

---

## Kafka Connect

### Architecture

Kafka Connect moves data between Kafka and external systems:

```
Source Connector:
External System → [Task] → [Worker] → Kafka

Sink Connector:
Kafka → [Worker] → [Task] → External System

Kafka Connect Cluster:
┌────────────────────────────────────┐
│         Connect Cluster             │
├────────────────────────────────────┤
│                                     │
│  ┌──────────────┐ ┌──────────────┐ │
│  │ Worker 1     │ │ Worker 2     │ │
│  │              │ │              │ │
│  │ [Task] [Task]│ │ [Task] [Task]│ │
│  └──────────────┘ └──────────────┘ │
│                                     │
│     Distributed, Scalable           │
│     Fault-tolerant                  │
└────────────────────────────────────┘
         ↓              ↓
    [Kafka Broker] [External DB]
```

### Source Connector Example (JDBC)

```java
// Configuration
{
  "name": "postgres-source",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.source.JdbcSourceConnector",
    "connection.url": "jdbc:postgresql://localhost:5432/orders",
    "connection.user": "admin",
    "connection.password": "secret",
    "table.whitelist": "orders",
    "mode": "incrementing",
    "incrementing.column.name": "id",
    "topic.prefix": "postgres-"
  }
}

// Result: Table "orders" → Topic "postgres-orders"
```

### Sink Connector Example (Elasticsearch)

```java
{
  "name": "es-sink",
  "config": {
    "connector.class": "com.github.dariobalinzo.elasticsearch.ElasticsearchSinkConnector",
    "topics": "orders",
    "connection.url": "http://localhost:9200",
    "type.name": "_doc",
    "key.ignore": true,
    "schema.ignore": false
  }
}

// Result: Topic "orders" → Elasticsearch index "orders"
```

### Single Message Transform (SMT)

Transform messages during Kafka Connect:

```java
// Add timestamp to every message
{
  "transforms": "AddTimestamp",
  "transforms.AddTimestamp.type": "org.apache.kafka.connect.transforms.InsertField$Value",
  "transforms.AddTimestamp.static.field": "timestamp",
  "transforms.AddTimestamp.static.value": "1970-01-01T00:00:00Z"
}

// Rename fields
{
  "transforms": "RenameFields",
  "transforms.RenameFields.type": "org.apache.kafka.connect.transforms.ReplaceField$Value",
  "transforms.RenameFields.renames": "source_id:id,source_name:name"
}

// Extract fields from JSON
{
  "transforms": "Extract",
  "transforms.Extract.type": "org.apache.kafka.connect.transforms.ExtractField$Value",
  "transforms.Extract.field": "payload"
}
```

---

## Schema Registry

### Purpose

Schema Registry manages schemas for Kafka data:

```
Without Schema Registry:
Producer: Sends JSON
  → Consumer: What schema is this?
  → Breaks on schema change
  → No validation

With Schema Registry:
Schema Registry: Central schema store
Producer: Register schema, send serialized data with schema ID
Consumer: Look up schema ID, deserialize correctly
```

### Supported Formats

```
Avro:
├─ Compact binary format
├─ Strong schema definition
├─ Language-agnostic
└─ Best for high-throughput

JSON Schema:
├─ Human-readable
├─ JSON schema language
├─ Good for web services

Protobuf:
├─ Binary format
├─ Google's format (gRPC)
├─ Compact and fast
```

### Schema Evolution

**Backward Compatibility** (consumers can read new schemas):
```
Old schema: {name: string, age: int}
New schema: {name: string, age: int, email: string}
                                    └─ Optional field

Old consumer reads new data:
├─ Can read: name, age
├─ Ignores: email (optional)
└─ Works ✓
```

**Forward Compatibility** (old consumers can read new data):
```
Old schema: {name: string, age: int, email: string}
New schema: {name: string, age: int}
                            └─ Removed field

Old consumer reads new data:
├─ Expects: email field
├─ Not present: uses default
└─ Works ✓
```

**Full Compatibility** (both backward + forward):
```
Old and new consumers work with both schemas
└─ Most restrictive, best for rolling updates
```

### Example: Avro with Confluent Schema Registry

```java
// Dependency
<dependency>
    <groupId>io.confluent</groupId>
    <artifactId>kafka-avro-serializer</artifactId>
    <version>7.0.0</version>
</dependency>

// Configuration
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("schema.registry.url", "http://localhost:8081");
props.put("key.serializer", StringSerializer.class);
props.put("value.serializer", KafkaAvroSerializer.class);

KafkaProducer<String, Order> producer = new KafkaProducer<>(props);

// Schema (AVSC)
{
  "type": "record",
  "name": "Order",
  "fields": [
    {"name": "id", "type": "string"},
    {"name": "amount", "type": "double"},
    {"name": "timestamp", "type": "long"}
  ]
}

// Producer
Order order = new Order("order-123", 500.0, System.currentTimeMillis());
producer.send(new ProducerRecord<>("orders", "key", order));

// Consumer
Properties consumerProps = new Properties();
consumerProps.put("bootstrap.servers", "localhost:9092");
consumerProps.put("schema.registry.url", "http://localhost:8081");
consumerProps.put("group.id", "order-group");
consumerProps.put("key.deserializer", StringDeserializer.class);
consumerProps.put("value.deserializer", KafkaAvroDeserializer.class);

KafkaConsumer<String, Order> consumer = new KafkaConsumer<>(consumerProps);
```

---

## Stream Processing Comparisons

| Feature | Kafka Streams | Apache Flink | Spark Streaming |
|---------|---------------|-------------|-----------------|
| **Model** | Stream | Stream | Micro-batch |
| **Latency** | 10-100ms | 10-100ms | 500ms-2s |
| **Architecture** | Embedded | Distributed | Distributed |
| **Exactly-once** | ✓ | ✓ | ✓ |
| **Stateful** | ✓ (RocksDB) | ✓ | ✓ |
| **Setup** | Simple | Complex | Medium |
| **Scalability** | High (partitions) | Very High | High |
| **Learning Curve** | Low | High | Medium |

### Kafka Streams Advantages

```
- Simplest: Embedded in app, no cluster ops
- No data leaving Kafka: Lower latency
- Stream-native: Optimized for stream processing
- Interactive queries: Real-time state access
- DSL: Easy to use API
```

### When to Use Each

```
Kafka Streams:
├─ Real-time dashboards
├─ Event filtering/routing
├─ Windowed aggregations
├─ Simple to medium complexity
└─ Team has Kafka ops expertise

Flink:
├─ Complex business logic
├─ Advanced windowing
├─ Multiple data sources
├─ Machine learning pipelines
└─ High throughput (10M+ events/sec)

Spark:
├─ Batch + Stream hybrid
├─ SQL queries (SparkSQL)
├─ Heavy compute
├─ Existing Spark infrastructure
└─ Historical + Real-time analysis
```

---

## Interview Questions

### Question 1: KStream vs KTable

**Answer**:

KStream:
```
- Append-only event log
- New value doesn't replace old
- Each record processed independently
- "All orders ever placed"

Use: Order stream processing
KStream<String, Order> orders = builder.stream("orders");
orders.foreach((key, order) -> processOrder(order));
```

KTable:
```
- Changelog table (latest value per key)
- New value replaces old with same key
- Represents current state
- "Latest balance per account"

Use: Current state
KTable<String, Balance> balances = builder.table("account-balances");
balances.foreach((key, balance) -> updateUI(key, balance));
```

Key difference:
```
Same data source:
Offset 0: Key=A, Value=100
Offset 1: Key=B, Value=200
Offset 2: Key=A, Value=150

KStream read:
├─ Process: A=100
├─ Process: B=200
├─ Process: A=150
└─ Total: 3 events

KTable read:
├─ State: A=150 (latest)
├─ State: B=200 (latest)
└─ Total: 2 states
```

### Question 2: Windowing Types

**Answer**:

Tumbling:
```
Fixed size, no overlap
[0-5min] [5-10min] [10-15min]

Use: Hourly reports, periodic aggregations
```

Hopping:
```
Fixed size, overlapping
[0-5] [2-7] [4-9]

Use: Multiple time windows, trending
```

Sliding:
```
Event-based, relative to event
For event at T=10: window [5-15]

Use: Real-time alerting, time-series
```

Session:
```
Gap-based grouping
[A, B] (gap<5min) [C, D] (gap<5min)

Use: User sessions, activity bursts
```

### Question 3: State Store Recovery

**Answer**:

```
Scenario: Application with state store crashes

State architecture:
├─ RocksDB local (in-memory + disk)
├─ Changelog topic (persistent)
└─ Consumer offset tracking

Recovery process:
T1. App crashes
T2. New instance starts (same app-id)
T3. Reads changelog topic from beginning
T4. Rebuilds RocksDB to current position
T5. Resumes processing

Recovery guarantee:
├─ Exactly-once: All state reconstructed
├─ No message loss
├─ Automatic (no manual intervention)

Example:
changelog-topic:
Offset 0: Key=user-123, Value=100 (initial)
Offset 1: Key=user-456, Value=200 (initial)
Offset 2: Key=user-123, Value=150 (update)

Recovered state:
├─ user-123: 150
└─ user-456: 200
```

### Question 4: Join Window Semantics

**Answer**:

```
Stream-Stream join requires window (grace period)

Timeline:
T=0s:   Order A arrives
T=2s:   Payment A arrives → Join: (A, A) ✓
T=5s:   Payment B arrives (too late) → Join skipped ✗

Configuration:
JoinWindows.of(Duration.ofSeconds(5))
    .grace(Duration.ofSeconds(2))

Window behavior:
├─ Messages must arrive within window
├─ Grace period: Allow late arrivals
├─ After grace: drop late messages

Exactly-once guarantee:
├─ Joined records: Emitted once
├─ State suppression: No duplicates
└─ Timestamp ordering: Preserved
```

---

## Summary

**Kafka Streams**:
- DSL for stream processing
- Embedded, no separate cluster
- Stateful processing with state stores
- Exactly-once semantics

**Kafka Connect**:
- Scalable data movement
- Source/Sink connectors
- SMT for transformations
- Distributed, fault-tolerant

**Schema Registry**:
- Central schema management
- Schema evolution support
- Multiple formats (Avro, Protobuf, JSON)

Key takeaways:
- Choose between KStream (events) and KTable (state)
- Window type depends on use case
- State stores enable complex aggregations
- Interactive queries for real-time access
