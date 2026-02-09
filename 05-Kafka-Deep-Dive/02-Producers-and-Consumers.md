# Producers and Consumers - Deep Dive

## Table of Contents
1. [Producer Architecture](#producer-architecture)
2. [Producer Configuration](#producer-configuration)
3. [Idempotent Producer](#idempotent-producer)
4. [Transactional Producer](#transactional-producer)
5. [Custom Partitioners](#custom-partitioners)
6. [Consumer Architecture](#consumer-architecture)
7. [Consumer Groups](#consumer-groups)
8. [Consumer Configuration](#consumer-configuration)
9. [Offset Management](#offset-management)
10. [Consumer Rebalancing](#consumer-rebalancing)
11. [Code Examples](#code-examples)
12. [Interview Questions](#interview-questions)

---

## Producer Architecture

### ProducerRecord

The `ProducerRecord` is the primary data structure sent by producers:

```java
public class ProducerRecord<K, V> {
    private final String topic;           // Required
    private final Integer partition;      // Optional (calculated if null)
    private final Long timestamp;         // Optional
    private final K key;                  // Optional (can be null)
    private final V value;                // Required
    private final Iterable<Header> headers;  // Optional metadata
}

// Example:
ProducerRecord<String, String> record = new ProducerRecord<>(
    "orders",           // topic
    null,               // partition (Kafka will assign)
    System.currentTimeMillis(),  // timestamp
    "order-123",        // key
    "{order: data}"     // value
);
```

### Producer Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                 KafkaProducer<K, V>                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        1. send(ProducerRecord) API Entry             │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        2. Serialization                              │   │
│  │  ├─ Key serializer: K → byte[]                      │   │
│  │  └─ Value serializer: V → byte[]                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        3. Partitioner                                │   │
│  │  ├─ If partition specified: use it                  │   │
│  │  ├─ Else if key null: round-robin                   │   │
│  │  └─ Else: hash(key) % partition_count               │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        4. Accumulator Buffer                         │   │
│  │  ├─ Per-partition batch buffer (16KB default)       │   │
│  │  ├─ Compressed if compression enabled               │   │
│  │  └─ Callback registered here                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        5. Network I/O Thread                         │   │
│  │  ├─ Batch ready if: size >= batch.size              │   │
│  │  ├─ OR time >= linger.ms                            │   │
│  │  └─ Create batch request → broker                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        6. Broker Acknowledgment                      │   │
│  │  ├─ acks=0: No wait                                 │   │
│  │  ├─ acks=1: Wait for leader                         │   │
│  │  └─ acks=all: Wait for min.insync.replicas          │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        7. Callback Execution                         │   │
│  │  ├─ RecordMetadata: topic, partition, offset        │   │
│  │  ├─ Exception: if error occurred                    │   │
│  │  └─ User callback: onCompletion(metadata, exception)│   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Serialization

Kafka requires serialization of keys and values to bytes:

```java
// Key serializer interface
public interface Serializer<T> {
    byte[] serialize(String topic, T data);
    void close();
}

// Value serializer interface
public interface Serializer<T> {
    byte[] serialize(String topic, T data);
    void close();
}

// Built-in serializers
ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG:
├─ StringSerializer        → String to byte[]
├─ IntegerSerializer       → Integer to byte[]
├─ ByteArraySerializer     → byte[] to byte[] (identity)
└─ BytesSerializer         → Bytes to byte[]

// Custom serializer example
class OrderSerializer implements Serializer<Order> {
    @Override
    public byte[] serialize(String topic, Order order) {
        if (order == null) return null;
        return JsonUtils.toJson(order).getBytes(UTF_8);
    }
}
```

### Batching Mechanism

Kafka batches messages for efficiency:

```
Timeline visualization:

Producer.send(msg1)  → Buffer → Waiting
Producer.send(msg2)  → Buffer → Waiting
Producer.send(msg3)  → Buffer → Waiting [3 * 0.5KB = 1.5KB]
Producer.send(msg4)  → Buffer → SEND! (batch.size=16KB reached after msg1000)
...
Producer.send(msg1000) → Buffer → Send batch

Alternative timeline:

Producer.send(msg1)  → Buffer → Waiting
... wait 100ms (linger.ms) ...
Producer.send(msg2)  → Buffer → SEND! (timeout expires)
[2 messages, even if < 16KB]
```

Configuration impact:

```java
// Option 1: High throughput, high latency
batch.size = 32768        // 32KB
linger.ms = 200           // Wait 200ms
// Result: Large batches, delayed

// Option 2: Low latency, lower throughput
batch.size = 1024         // 1KB
linger.ms = 0             // Send immediately
// Result: Small batches, more overhead

// Option 3: Balanced
batch.size = 16384        // 16KB (default)
linger.ms = 10            // Wait 10ms
// Result: Good compromise
```

---

## Producer Configuration

### Essential Configurations

```java
Properties props = new Properties();

// Connection
props.put("bootstrap.servers", "broker1:9092,broker2:9092,broker3:9092");

// Serialization
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");

// Durability
props.put("acks", "all");  // or "1", "0"

// Retry
props.put("retries", Integer.MAX_VALUE);
props.put("max.in.flight.requests.per.connection", 5);

// Batching
props.put("batch.size", 16384);            // 16KB
props.put("linger.ms", 10);                // 10ms

// Compression
props.put("compression.type", "snappy");

// Buffering
props.put("buffer.memory", 33554432);      // 32MB

// Timeout
props.put("request.timeout.ms", 30000);    // 30s
props.put("delivery.timeout.ms", 120000);  // 2 min

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

### acks Configuration

The `acks` setting determines durability vs. latency:

```
acks = "0" (Fire and forget)
├─ Producer sends, returns immediately
├─ No broker acknowledgment
├─ Use case: Non-critical metrics, logs
├─ Data loss risk: HIGH (any broker failure → loss)
└─ Latency: Lowest

Example code:
producer.send(record);  // Returns immediately
// Don't wait for broker response
```

```
acks = "1" (Leader acknowledgment)
├─ Producer waits for leader to write to its log
├─ Doesn't wait for replicas
├─ Use case: Most applications
├─ Data loss risk: MEDIUM (leader crashes before replication)
└─ Latency: Medium

Timeline:
1. Producer sends ProducerRecord
2. Broker (leader) writes to log
3. Broker returns ack
4. Producer callback with success
5. (Asynchronously: replicas pull from leader)

Risk scenario:
T1. Message reaches leader, ack sent to producer
T2. Leader crashes before sending to replicas
T3. New leader elected (from followers)
T4. Message is gone (no replica had it)
```

```
acks = "all" (All replicas acknowledge)
├─ Producer waits for min.insync.replicas to ack
├─ Very durable, highest latency
├─ Use case: Critical data (financial, orders)
├─ Data loss risk: LOW (only if 2+ brokers fail simultaneously)
└─ Latency: Highest

Configuration must include:
├─ replication.factor ≥ 3
├─ min.insync.replicas = 2
└─ acks = "all"

Timeline:
1. Producer sends ProducerRecord
2. Leader writes to its log
3. Followers pull and write
4. min.insync.replicas brokers acknowledge
5. Producer callback with success

Durability guarantee:
├─ With replication.factor=3, min.insync.replicas=2
├─ Message acked when on leader + 1 follower
├─ Can lose leader, still safe (message on 1 follower)
└─ Only lose if leader + 1 follower fail (2 out of 3)
```

### retries and max.in.flight.requests

Retry behavior:

```java
// Configuration
props.put("retries", Integer.MAX_VALUE);  // Retry indefinitely
props.put("retry.backoff.ms", 100);       // Wait 100ms between retries

// Behavior
Retry loop:
├─ First attempt fails
├─ Wait 100ms
├─ Retry
├─ Fails again
├─ Wait 100ms
├─ Retry again
└─ Continue until success or timeout (delivery.timeout.ms)

Important: With retries, message ordering can be affected
```

To maintain message ordering with retries:

```java
props.put("max.in.flight.requests.per.connection", 1);
// Send only 1 message at a time
// Next message waits for ack

OR (Kafka 0.11+):
props.put("enable.idempotence", true);  // Handles ordering automatically
```

### enable.idempotence

Enables exactly-once semantics:

```java
props.put("enable.idempotence", true);

Automatically sets:
├─ max.in.flight.requests.per.connection = 5
├─ retries = Integer.MAX_VALUE
├─ acks = "all"
└─ Enables idempotent producer (sequence numbers)

Guarantees:
├─ No duplicate messages due to retries
├─ Message ordering preserved
└─ Cost: Slightly higher latency than acks=1
```

### Compression

```java
props.put("compression.type", "snappy");  // or "lz4", "gzip", "zstd"

Tradeoff:
┌──────────────┬──────────────┬────────────┬──────────────┐
│ Algorithm    │ Compression  │ CPU Usage  │ Best For     │
├──────────────┼──────────────┼────────────┼──────────────┤
│ snappy       │ 50-60%       │ 5-10%      │ Balanced     │
│ lz4          │ 40-50%       │ 2-3%       │ Speed        │
│ gzip         │ 70-80%       │ 30-40%     │ Max reduction│
│ zstd         │ 70-75%       │ 15-20%     │ Modern       │
└──────────────┴──────────────┴────────────┴──────────────┘

Recommendation:
├─ Default: snappy (good balance)
├─ High CPU available: gzip
├─ Low CPU required: lz4
└─ Always: better than no compression
```

---

## Idempotent Producer

### How It Works

Idempotent producers prevent duplicate messages by using sequence numbers:

```
Producer maintains:
├─ Producer ID (PID): Unique identifier for this producer instance
└─ Sequence number: Incremented with each message

Each message tagged with: (PID, Partition, Sequence#)

Broker validates:
├─ Expected sequence: Last sequence + 1
├─ If msg sequence == expected: Accept
├─ If msg sequence < expected: Duplicate (drop)
├─ If msg sequence > expected: Out of order (error)

Example:
Producer sends 3 messages to partition 0:
1. (PID=1, Seq=0, msg1) → Broker accepts, stores Seq=0
2. (PID=1, Seq=1, msg2) → Broker accepts, stores Seq=1
3. (PID=1, Seq=1, msg2 again - retry) → Broker rejects (duplicate)
4. (PID=1, Seq=2, msg3) → Broker accepts, stores Seq=2
```

### Implementation

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("key.serializer", StringSerializer.class);
props.put("value.serializer", StringSerializer.class);

// Enable idempotence
props.put("enable.idempotence", true);

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Producer can safely retry without duplicates
Future<RecordMetadata> future = producer.send(record);

// If future times out, can safely retry
// Broker will detect and drop duplicate
```

### Limitations

```
Idempotent guarantee:
├─ Applies WITHIN a single producer instance
├─ Partition level (sequence number per partition)
├─ Does NOT prevent duplicates across:
│  ├─ Multiple producer instances (different PIDs)
│  └─ After broker failure and log truncation
├─ Time-based: Default 5 minutes (transaction.state.log.min.isr)
└─ After 5 min: PID can be reused, can get duplicates
```

---

## Transactional Producer

### Exactly-Once Semantics

Transactional producers guarantee exactly-once delivery across partitions:

```
Without transactions (idempotent only):
├─ Each partition: at most once
├─ Across partitions: no guarantee
├─ Example: Send to 2 partitions, 1 fails → partial write

With transactions:
├─ All partitions: atomically updated
├─ All or nothing semantics
├─ Example: Send to 2 partitions, both succeed or both rollback
```

### Configuration

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("key.serializer", StringSerializer.class);
props.put("value.serializer", StringSerializer.class);

// Enable transactions
props.put("transactional.id", "order-producer-1");
props.put("enable.idempotence", true);              // Required
props.put("acks", "all");                           // Required

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Initialize transaction (must do once)
producer.initTransactions();
```

### Transaction API

```java
try {
    // Begin transaction
    producer.beginTransaction();

    // Send multiple messages atomically
    producer.send(record1);
    producer.send(record2);
    producer.send(record3);

    // Commit
    producer.commitTransaction();

} catch (Exception e) {
    // Rollback on any error
    producer.abortTransaction();
    throw e;
}
```

### Transaction Isolation Levels

Consumers read transactions based on `isolation.level`:

```
isolation.level = "read_uncommitted" (default)
├─ Read all messages, including uncommitted ones
├─ Higher throughput
├─ May see rolled-back transactions
└─ Use case: Non-critical data, analytics

isolation.level = "read_committed"
├─ Read only committed messages
├─ Skip rolled-back transactions
├─ Lower throughput (more processing)
└─ Use case: Critical data (financial, orders)

Example timeline:
T1. Producer sends msg1, msg2 (transaction)
T2. Consumer (read_uncommitted): sees msg1, msg2
T3. Producer rolls back transaction
T4. Consumer (read_uncommitted): still sees msg1, msg2 ✗
T5. Consumer (read_committed): never sees them ✓
```

---

## Custom Partitioners

### Default Partitioner

```java
public class DefaultPartitioner implements Partitioner {
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes,
                        Cluster metadata) {
        List<PartitionInfo> partitions = metadata.partitionsForTopic(topic);
        int numPartitions = partitions.size();

        if (keyBytes == null) {
            // No key: round-robin
            return nextInt(numPartitions);
        } else {
            // With key: hash(key) % numPartitions
            return Math.abs(Utils.murmur2(keyBytes)) % numPartitions;
        }
    }
}
```

### Custom Partitioner Example

Order routing by region:

```java
public class RegionalPartitioner implements Partitioner {
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes,
                        Cluster metadata) {

        Order order = (Order) value;
        String region = order.getRegion();

        List<PartitionInfo> partitions = metadata.partitionsForTopic(topic);

        // Region-based routing
        // Partition 0: North America
        // Partition 1: Europe
        // Partition 2: Asia

        switch (region) {
            case "NA":
                return 0;
            case "EU":
                return 1;
            case "ASIA":
                return 2;
            default:
                return new Random().nextInt(partitions.size());
        }
    }

    @Override
    public void close() {}

    @Override
    public void configure(Map<String, ?> configs) {}
}

// Usage
Properties props = new Properties();
props.put("partitioner.class", RegionalPartitioner.class.getName());
```

### Partitioner Best Practices

```
Choosing a partition key:
├─ Goal: Distribute load evenly
├─ Goal: Related messages same partition (if needed)
├─ Goal: Avoid hot partitions

Examples:
├─ user-events: Key = user_id (all user events together)
├─ order-events: Key = customer_id (per-customer ordering)
├─ payments: Key = merchant_id (fair distribution)
└─ logs: Key = null (round-robin, no ordering needed)

Avoid:
├─ Low cardinality keys (many duplicates → uneven distribution)
├─ Too high cardinality (no reuse of partition → inefficient)
└─ Time-based keys (may create hot partitions at certain times)
```

---

## Consumer Architecture

### Consumer Groups

Consumers are organized in **consumer groups**:

```
Topic with 4 partitions:
├─ Partition 0
├─ Partition 1
├─ Partition 2
└─ Partition 3

Consumer Group A (4 consumers):
├─ Consumer A1 → Partition 0
├─ Consumer A2 → Partition 1
├─ Consumer A3 → Partition 2
└─ Consumer A4 → Partition 3

Consumer Group B (2 consumers):
├─ Consumer B1 → Partitions 0, 1
└─ Consumer B2 → Partitions 2, 3

Key property:
└─ Each partition assigned to at most 1 consumer per group
   (multiple groups can read same partition)
```

### Consumer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 KafkaConsumer<K, V>                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        1. Join Consumer Group                        │   │
│  │  ├─ Connect to group coordinator (broker)            │   │
│  │  ├─ Register consumer with group.id                  │   │
│  │  └─ Rebalance triggered                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        2. Partition Assignment                       │   │
│  │  ├─ Assign strategy: Range / RoundRobin / Sticky    │   │
│  │  ├─ Group leader decides assignments                │   │
│  │  └─ Other consumers receive assignment              │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        3. Offset Commit                              │   │
│  │  ├─ Store processed offset to __consumer_offsets    │   │
│  │  ├─ Can be automatic or manual                      │   │
│  │  └─ Enables resume from last position              │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        4. Fetch Loop                                 │   │
│  │  ├─ poll(): Request records from assigned partitions │   │
│  │  ├─ Fetch up to max.poll.records                    │   │
│  │  ├─ Block up to max.poll.interval.ms               │   │
│  │  └─ Return ConsumerRecords batch                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        5. Deserialization                            │   │
│  │  ├─ Key deserializer: byte[] → K                    │   │
│  │  ├─ Value deserializer: byte[] → V                  │   │
│  │  └─ Convert to domain objects                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        6. Process and Commit                         │   │
│  │  ├─ Application processes record                     │   │
│  │  ├─ commitSync(): Blocking commit                   │   │
│  │  ├─ commitAsync(): Non-blocking commit              │   │
│  │  └─ Resume next poll() from committed offset        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Consumer Configuration

### Essential Configurations

```java
Properties props = new Properties();

// Connection
props.put("bootstrap.servers", "broker1:9092,broker2:9092");

// Consumer group (CRITICAL)
props.put("group.id", "order-processing-group");

// Serialization
props.put("key.deserializer", StringDeserializer.class);
props.put("value.deserializer", StringDeserializer.class);

// Offset management
props.put("auto.offset.reset", "earliest");  // or "latest"
props.put("enable.auto.commit", true);       // Auto-commit offsets
props.put("auto.commit.interval.ms", 5000);  // Every 5 seconds

// Session management
props.put("session.timeout.ms", 30000);      // 30 seconds
props.put("heartbeat.interval.ms", 10000);   // 10 seconds

// Polling behavior
props.put("max.poll.records", 500);          // Max records per poll
props.put("max.poll.interval.ms", 300000);   // 5 minute max

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
```

### auto.offset.reset

Controls behavior when no offset is committed:

```
auto.offset.reset = "earliest"
├─ Start from beginning of partition
├─ Processes all historical messages
├─ Use case: Initialize new consumer group
└─ Risk: Can be large backlog

auto.offset.reset = "latest"
├─ Start from end of partition
├─ Skip historical messages
├─ Use case: Don't care about backlog
└─ Risk: Miss messages from when consumer was offline

auto.offset.reset = "none"
├─ Throw NoOffsetForPartitionException
├─ Require explicit offset management
└─ Use case: Very specific offset requirements
```

### Session and Heartbeat

Kafka detects consumer failures through heartbeats:

```
Consumer session:
├─ session.timeout.ms = 30000 (default)
│  └─ If broker doesn't see heartbeat for 30s, consumer is dead
└─ heartbeat.interval.ms = 10000 (default)
   └─ Send heartbeat every 10 seconds

Best practice:
├─ heartbeat.interval.ms = 1/3 of session.timeout.ms
├─ Example: 10s heartbeat, 30s timeout
├─ Allows 2-3 heartbeat misses before detection
└─ Balanced: detect failures quickly, avoid false positives
```

### max.poll.interval.ms

Time allowed between poll() calls:

```
Configuration: max.poll.interval.ms = 300000 (5 minutes)

Valid timeline:
T=0s:   poll() returns 500 records
T=60s:  Process 300 records
T=120s: poll() again ✓ (within 5 min)

Invalid timeline:
T=0s:   poll() returns 500 records
T=60s:  Start processing (slow business logic)
T=301s: Still processing, call poll() ✗
        Consumer considered dead, expelled from group

Solution:
├─ Increase max.poll.interval.ms
├─ Reduce max.poll.records
├─ Process faster (async, parallelism)
└─ Use different thread for polling and processing
```

---

## Offset Management

### Automatic Offset Commit

```java
// Configuration
props.put("enable.auto.commit", true);
props.put("auto.commit.interval.ms", 5000);  // Every 5 sec

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("orders"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(1000));

    for (ConsumerRecord<String, String> record : records) {
        // Process message
        System.out.println("Offset: " + record.offset() + ", Value: " + record.value());
    }

    // Automatic commit happens here (every 5 seconds)
    // Even if processing fails! This is dangerous
}
```

Risks with automatic commit:
```
Timeline:
T=0s:   poll() returns offset 100-104
T=2s:   Offset 100 acked → Consumer restarts
T=3s:   Processing offset 101 fails (exception)
T=5s:   Auto-commit triggers, commits offset 104
T=6s:   Consumer restarts
T=7s:   Consumer resumes from offset 105
        Lost offset 101-104 (processed, but not saved)
```

### Manual Offset Commit

```java
// Configuration
props.put("enable.auto.commit", false);  // Manual commits only

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("orders"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(1000));

    try {
        for (ConsumerRecord<String, String> record : records) {
            // Process message
            processOrder(record.value());
        }

        // Only commit after successful processing
        consumer.commitSync();  // Blocking commit

    } catch (Exception e) {
        logger.error("Processing failed, not committing", e);
        // Consumer will retry from last committed offset
    }
}
```

### commitSync vs commitAsync

```java
// commitSync() - Blocking
consumer.commitSync();
// Waits until broker confirms
// Slower, but guaranteed commit
// Throws exception on failure

// commitAsync() - Non-blocking
consumer.commitAsync((offsets, exception) -> {
    if (exception != null) {
        logger.error("Commit failed", exception);
    } else {
        logger.info("Committed offsets: " + offsets);
    }
});
// Returns immediately
// Continues processing
// Exception handled in callback

// Combined approach (recommended)
try {
    consumer.commitAsync((offsets, exception) -> {
        if (exception != null) {
            logger.error("Async commit failed", exception);
        }
    });
} catch (CommitFailedException e) {
    logger.error("Commit failed", e);
}
```

### Delivery Semantics

```
At-most-once:
├─ Configuration: enable.auto.commit=true, auto.commit.interval.ms=1000
├─ Commit offset BEFORE processing
├─ If crash after commit, before processing: message lost
├─ Risk: Losing messages
└─ Use case: Non-critical data (logs, metrics)

Code:
consumer.commitSync();           // Commit first
processMessage(record);          // Process after
if (crash here): message lost ✗

At-least-once:
├─ Configuration: enable.auto.commit=false
├─ Process message, THEN commit offset
├─ If crash after processing, before commit: message reprocessed
├─ Risk: Duplicate processing
└─ Use case: Most applications

Code:
processMessage(record);          // Process first
consumer.commitSync();           // Commit after
if (crash here): message reprocessed ✗

Exactly-once:
├─ Configuration: isolation.level=read_committed
├─ Process message, commit atomic with side effect
├─ Requires idempotent processing
├─ If crash: transaction rolled back
└─ Use case: Critical data (financial, orders)

Code:
beginTransaction();
processMessage(record);
updateDatabase(record);
consumer.commitSync();           // Atomic with DB
commitTransaction();
```

---

## Consumer Rebalancing

### Rebalancing Process

When a consumer joins, fails, or changes subscriptions:

```
Timeline:
T=0s:   Consumer A joins group
├─ Join group request sent to coordinator
└─ Rebalancing triggered

T=1s:   Stop consuming, revoke partitions
├─ Consumer A stops fetching
├─ Commits current offsets
└─ onPartitionsRevoked() callback

T=2s:   Assign new partitions
├─ Group coordinator decides assignment
├─ Consumer A assigned partitions
└─ onPartitionsAssigned() callback

T=3s:   Resume consuming
└─ Consumer A resumes from committed offsets

Downtime: 2-3 seconds (no messages processed)
```

### Rebalancing Strategies

**Range Partitioner**:
```
Topic: orders, Partitions: [0, 1, 2, 3, 4, 5]
Consumer Group: [A, B, C]

Assignment:
├─ Consumer A → [0, 1]
├─ Consumer B → [2, 3]
└─ Consumer C → [4, 5]

Problem: If consumer dies
├─ New assignment: A → [0, 1, 2], B → [3, 4, 5]
├─ Partition 2 moves from B to A (reprocessing)
└─ Partition 2 reprocessed (duplicates possible)
```

**RoundRobin Partitioner**:
```
Topic: orders, Partitions: [0, 1, 2, 3, 4, 5]
Consumer Group: [A, B, C]

Assignment (round-robin):
├─ Consumer A → [0, 3]
├─ Consumer B → [1, 4]
└─ Consumer C → [2, 5]

Better distribution, but still suboptimal on rebalancing
```

**Sticky Partitioner**:
```
Goal: Minimize partition movement during rebalancing

Before rebalancing:
├─ Consumer A → [0, 1]
├─ Consumer B → [2, 3]
└─ Consumer C → [4, 5]

Consumer B dies, C takes over:
├─ Consumer A → [0, 1] (unchanged)
├─ Consumer C → [2, 3, 4, 5] (only gets B's partitions)
└─ Minimal movement, less reprocessing

Result:
├─ Only partition 2, 3 reprocessed
├─ Partitions 0, 1, 4, 5 not affected
└─ Reduced duplicate processing
```

**CooperativeSticky Partitioner** (Kafka 2.4+):
```
Cooperative rebalancing (no stop-the-world):

Before Consumer B failure:
├─ Consumer A → [0, 1]
├─ Consumer B → [2, 3]
└─ Consumer C → [4, 5]

During rebalancing (cooperative):
├─ Phase 1: Revoke only affected: B revokes [2,3]
├─ Phase 2: Consumer C assigned [2, 3] (no revoke)
├─ Phase 3: A stays on [0,1], B offline, C has [4,5,2,3]

Advantage:
├─ Consumers continue fetching unaffected partitions
├─ Only affected partitions stop briefly
└─ Less downtime than eager rebalancing
```

Configuration:
```java
props.put("partition.assignment.strategy",
    "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");

// Or multiple (tries in order):
props.put("partition.assignment.strategy",
    "CooperativeStickyAssignor,RangeAssignor");
```

### Static Group Membership

Avoid rebalancing on consumer restart:

```java
props.put("group.instance.id", "consumer-1");  // Unique per consumer

Behavior:
├─ Consumer leaves group → Wait for timeout (10min default)
├─ Consumer rejoins with same group.instance.id
├─ Same partitions assigned immediately (no rebalancing)
└─ Fast restart, no downtime

Configuration:
props.put("session.timeout.ms", 600000);  // 10 min timeout
```

---

## Code Examples

### Basic Producer

```java
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.common.serialization.StringSerializer;
import java.util.Properties;

public class BasicProducer {
    public static void main(String[] args) {
        // Configuration
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("key.serializer", StringSerializer.class.getName());
        props.put("value.serializer", StringSerializer.class.getName());
        props.put("acks", "all");
        props.put("retries", Integer.MAX_VALUE);
        props.put("linger.ms", 10);
        props.put("batch.size", 16384);
        props.put("compression.type", "snappy");

        // Create producer
        try (KafkaProducer<String, String> producer = new KafkaProducer<>(props)) {

            // Send messages
            for (int i = 0; i < 100; i++) {
                String key = "order-" + (i % 10);
                String value = "{\"id\": " + i + ", \"amount\": " + (100 + i * 10) + "}";

                ProducerRecord<String, String> record = new ProducerRecord<>(
                    "orders",      // topic
                    key,           // key
                    value          // value
                );

                // Send with callback
                producer.send(record, (metadata, exception) -> {
                    if (exception != null) {
                        System.err.println("Send failed: " + exception.getMessage());
                    } else {
                        System.out.println("Sent to partition " + metadata.partition() +
                                         " with offset " + metadata.offset());
                    }
                });
            }

            // Flush remaining messages
            producer.flush();

        } // Producer auto-closes
    }
}
```

### Transactional Producer

```java
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.StringSerializer;
import java.util.Properties;

public class TransactionalProducer {
    public static void main(String[] args) {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("key.serializer", StringSerializer.class.getName());
        props.put("value.serializer", StringSerializer.class.getName());

        // Transactional settings
        props.put("transactional.id", "order-producer-1");
        props.put("enable.idempotence", true);
        props.put("acks", "all");

        KafkaProducer<String, String> producer = new KafkaProducer<>(props);

        // Initialize transactions (once per producer)
        producer.initTransactions();

        try {
            // Begin transaction
            producer.beginTransaction();

            // Send order
            ProducerRecord<String, String> orderRecord = new ProducerRecord<>(
                "orders",
                "order-123",
                "{\"id\": \"order-123\", \"total\": 500.00}"
            );
            producer.send(orderRecord);

            // Send payment
            ProducerRecord<String, String> paymentRecord = new ProducerRecord<>(
                "payments",
                "order-123",
                "{\"id\": \"order-123\", \"amount\": 500.00, \"status\": \"completed\"}"
            );
            producer.send(paymentRecord);

            // Commit (atomic)
            producer.commitTransaction();
            System.out.println("Transaction committed");

        } catch (Exception e) {
            System.err.println("Transaction failed, rolling back");
            producer.abortTransaction();
        } finally {
            producer.close();
        }
    }
}
```

### Basic Consumer

```java
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.common.serialization.StringDeserializer;
import java.time.Duration;
import java.util.Arrays;
import java.util.Properties;

public class BasicConsumer {
    public static void main(String[] args) {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("group.id", "order-processing-group");
        props.put("key.deserializer", StringDeserializer.class.getName());
        props.put("value.deserializer", StringDeserializer.class.getName());
        props.put("auto.offset.reset", "earliest");
        props.put("enable.auto.commit", false);  // Manual commits

        KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

        // Subscribe to topics
        consumer.subscribe(Arrays.asList("orders", "payments"));

        int recordCount = 0;

        try {
            while (true) {
                // Poll for records
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofSeconds(1));

                for (ConsumerRecord<String, String> record : records) {
                    try {
                        // Process record
                        System.out.printf("Topic: %s, Partition: %d, Offset: %d, Key: %s, Value: %s%n",
                            record.topic(), record.partition(), record.offset(),
                            record.key(), record.value());

                        processOrder(record.value());

                        recordCount++;

                    } catch (Exception e) {
                        System.err.println("Processing failed: " + e.getMessage());
                        // Don't commit on error
                    }
                }

                // Commit after processing batch
                if (recordCount > 0) {
                    consumer.commitSync();
                    System.out.println("Committed " + recordCount + " records");
                    recordCount = 0;
                }
            }
        } finally {
            consumer.close();
        }
    }

    private static void processOrder(String orderJson) throws Exception {
        // Parse and process order
        // Simulate processing time
        Thread.sleep(100);
    }
}
```

### Consumer with Rebalance Listener

```java
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.TopicPartition;
import java.time.Duration;
import java.util.*;

public class ConsumerWithRebalanceListener {
    public static void main(String[] args) {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("group.id", "order-group");
        props.put("key.deserializer", StringDeserializer.class.getName());
        props.put("value.deserializer", StringDeserializer.class.getName());
        props.put("auto.offset.reset", "earliest");
        props.put("enable.auto.commit", false);
        props.put("partition.assignment.strategy", "CooperativeStickyAssignor");

        KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

        // Subscribe with rebalance listener
        consumer.subscribe(
            Arrays.asList("orders"),
            new ConsumerRebalanceListener() {
                @Override
                public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
                    System.out.println("Revoking partitions: " + partitions);
                    // Save offsets before losing partitions
                    consumer.commitSync();
                }

                @Override
                public void onPartitionsAssigned(Collection<TopicPartition> partitions) {
                    System.out.println("Assigned partitions: " + partitions);
                    // Setup state for new partitions if needed
                    partitions.forEach(partition -> {
                        System.out.println("Seeking to beginning of " + partition);
                        consumer.seekToBeginning(Arrays.asList(partition));
                    });
                }
            }
        );

        try {
            while (true) {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofSeconds(1));

                for (ConsumerRecord<String, String> record : records) {
                    System.out.println("Processing: " + record.value());
                }

                consumer.commitSync();
            }
        } finally {
            consumer.close();
        }
    }
}
```

---

## Interview Questions

### Question 1: Producer Batching Explanation

**Answer**:

Producer batching accumulates messages in memory before sending:

```
Flow:
1. send(msg1) → Buffer (1KB)
2. send(msg2) → Buffer (2KB)
3. send(msg3) → Buffer (3KB)
4. Buffer reaches 16KB (batch.size)
   OR
5. 100ms elapsed (linger.ms)
   → Send all messages in one request

Benefit: Reduced network overhead
├─ 1000 messages: 1 request (16KB batch)
├─ vs 1000 individual requests
└─ ~100x reduction in network syscalls
```

Configuration impact:

```java
// High throughput
props.put("batch.size", 32768);      // 32KB
props.put("linger.ms", 100);         // Wait up to 100ms
// Result: Larger batches, higher latency

// Low latency
props.put("batch.size", 1024);       // 1KB
props.put("linger.ms", 0);           // No waiting
// Result: Small batches, more overhead
```

### Question 2: Exactly-Once vs At-Least-Once

**Answer**:

At-least-once:
```
Process message → Save offset
└─ If crash after process, before offset: reprocess

Idempotent producer ensures:
├─ Duplicates from retries handled
├─ Message ordering preserved
└─ Still requires idempotent consumer
```

Exactly-once:
```
Transactional producer:
├─ Consume message
├─ Process message
├─ Send to multiple topics atomically
├─ Commit offset
└─ All or nothing

Guarantees:
└─ No duplicates, no message loss

Cost:
├─ Performance overhead
├─ Complexity
└─ Transactional ID requirement
```

### Question 3: Consumer Lag Calculation

**Answer**:

Consumer lag = LogEndOffset - CommittedOffset

```
Example:
Topic partition has 1000 messages (offset 0-999)
LogEndOffset = 1000

Consumer group committed offset 500
CommittedOffset = 500

Consumer lag = 1000 - 500 = 500 messages behind

Monitoring:
consumer-lag = max(0, highWatermark - committedOffset)

High lag indicates:
├─ Consumer is slow
├─ Consumer crashed and recovering
├─ Consumer misconfigured
└─ Topic has high throughput
```

### Question 4: Rebalancing Causes

**Answer**:

Rebalancing triggered by:

1. **Consumer joins group**:
   ```
   New consumer1 joins → Rebalancing
   └─ Existing partitions redistributed
   ```

2. **Consumer leaves/crashes**:
   ```
   Consumer2 dies (no heartbeat) → Rebalancing
   └─ Consumer2's partitions reassigned
   ```

3. **Topic subscription changes**:
   ```
   consumer.subscribe(["orders", "payments"])
   → Rebalancing
   ```

4. **Static group membership timeout**:
   ```
   Consumer has group.instance.id
   └─ If reboot < timeout: no rebalancing
   └─ If reboot > timeout: rebalancing
   ```

Downtime implications:
```
Rebalancing takes 2-5 seconds:
├─ No messages consumed during this time
├─ Processed offset committed
├─ Resume from committed offset
└─ No duplicates (if manual commit)
```

---

## Summary

**Producers**:
- Batching increases throughput
- acks setting determines durability
- Idempotence prevents retries-duplicates
- Transactions enable exactly-once

**Consumers**:
- Consumer groups enable parallel processing
- Offset commits track progress
- Rebalancing redistributes partitions
- Manual commits provide better control

Key interview topics:
- Durability vs latency tradeoffs
- Exactly-once semantics
- Consumer lag and monitoring
- Rebalancing behavior
- Partition assignment strategies
