# Kafka Architecture and Internals - Deep Dive

## Table of Contents
1. [Kafka Overview](#kafka-overview)
2. [Core Concepts](#core-concepts)
3. [Kafka Architecture](#kafka-architecture)
4. [Partition Internals](#partition-internals)
5. [Replication and Fault Tolerance](#replication-and-fault-tolerance)
6. [High Throughput Mechanisms](#high-throughput-mechanisms)
7. [Storage Internals](#storage-internals)
8. [Kafka vs Other Messaging Systems](#kafka-vs-other-messaging-systems)
9. [Topic Configuration](#topic-configuration)
10. [Cluster Sizing and Capacity Planning](#cluster-sizing-and-capacity-planning)
11. [Interview Questions](#interview-questions)

---

## Kafka Overview

### What is Apache Kafka?

Apache Kafka is a **distributed event streaming platform** designed to handle high-volume, high-throughput, low-latency data feeds. It's built for **durability**, **scalability**, and **fault tolerance**.

Key characteristics:
- **Pub/Sub Model**: Producers publish data, consumers subscribe to topics
- **Distributed**: Data is replicated across multiple brokers
- **Persistent**: Messages are stored on disk, not just in memory
- **Horizontal Scalability**: Add more brokers to handle more load
- **High Throughput**: Millions of messages per second
- **Low Latency**: Sub-millisecond message delivery

### Primary Use Cases

1. **Real-time Analytics**: Streaming data from applications for real-time dashboards
2. **Event Sourcing**: Store all state changes as immutable events
3. **Log Aggregation**: Centralized platform for collecting logs from services
4. **Stream Processing**: Transform and process data in real-time
5. **Microservices Communication**: Async communication between services
6. **Change Data Capture (CDC)**: Capture database changes to downstream systems
7. **Data Pipeline**: ETL/ELT operations at scale

---

## Core Concepts

### 1. Brokers

A Kafka **broker** is a single Kafka server. A cluster consists of multiple brokers working together.

```
┌─────────────────────────────────────────────────────────────┐
│                    Kafka Cluster                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Broker 0    │  │  Broker 1    │  │  Broker 2    │      │
│  │              │  │              │  │              │      │
│  │ Topic-0      │  │ Topic-0      │  │ Topic-0      │      │
│  │ Partition-1  │  │ Partition-2  │  │ Partition-0  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         |                   |                 |              │
│         └───────────────────┼─────────────────┘              │
│                             |                                │
│                    ZooKeeper/KRaft Metadata                  │
└─────────────────────────────────────────────────────────────┘
```

Each broker stores a portion of the data and serves read/write requests.

### 2. Topics

A **topic** is a logical grouping of related messages. Think of it as a category or feed.

Example topics: `user-events`, `order-processing`, `system-logs`

### 3. Partitions

Each topic is divided into **partitions**, which are the unit of parallelism. Partitions enable:
- **Parallel consumption**: Multiple consumers can read from different partitions simultaneously
- **Scalability**: Data is distributed across brokers
- **Ordering**: Messages within a partition maintain order

```
Topic: user-events
├─ Partition 0: [msg0] [msg1] [msg2] → Broker 0
├─ Partition 1: [msg0] [msg1] [msg2] → Broker 1
└─ Partition 2: [msg0] [msg1] [msg2] → Broker 2
```

### 4. Offsets

An **offset** is a unique identifier for a message within a partition. Consumers track which messages they've processed using offsets.

```
Partition 0: [offset=0] [offset=1] [offset=2] [offset=3] ...
             [msg]      [msg]      [msg]      [msg]

Consumer committed offset: 1 (has processed messages 0 and 1)
Next message to consume: offset 2
```

### 5. Brokers and Clusters

A **Kafka cluster** is a collection of brokers working together. Key metadata is managed by:

**Traditional (ZooKeeper-based)**:
- ZooKeeper maintains broker metadata, topic configs, partition leaders
- Uses `/config/topics`, `/brokers/ids`, `/controller` paths

**Modern (KRaft mode - Kafka 3.3+)**:
- Replaces ZooKeeper with KRaft consensus algorithm
- Controllers maintain all metadata internally
- Simpler deployment, better performance

---

## Kafka Architecture

### Broker Architecture

```
┌─────────────────────────────────────────────────────┐
│              Kafka Broker                            │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │          Request Handler (Thread Pool)        │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐    │   │
│  │  │ Produce  │ │ Fetch    │ │ Metadata │    │   │
│  │  │ Request  │ │ Request  │ │ Request  │    │   │
│  │  └──────────┘ └──────────┘ └──────────┘    │   │
│  └──────────────────────────────────────────────┘   │
│                       |                              │
│  ┌──────────────────────────────────────────────┐   │
│  │      Log Manager (Manages partitions)        │   │
│  │  Maintains segment files and indices         │   │
│  └──────────────────────────────────────────────┘   │
│                       |                              │
│  ┌──────────────────────────────────────────────┐   │
│  │      Disk Storage (Log Segments)             │   │
│  │  /var/kafka-logs/topic-0/partition-0/       │   │
│  │  ├─ 00000000000000000000.log                 │   │
│  │  ├─ 00000000000000000000.index               │   │
│  │  ├─ 00000000000000000000.timeindex           │   │
│  │  └─ leader-epoch-checkpoint                  │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │      Replication Manager                      │   │
│  │  Handles leader/follower replication          │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Kafka Controller

The **controller** is a special broker that manages:
- **Leader election**: When a broker fails, assigns new partition leaders
- **ISR management**: Maintains in-sync replicas list
- **Metadata propagation**: Distributes metadata to all brokers

Only one broker acts as controller at a time. If it fails, a new controller is elected.

### ZooKeeper vs KRaft

**ZooKeeper (Traditional)**:
- External consensus system manages Kafka metadata
- Separate deployment and operational complexity
- `/brokers/ids` - list of active brokers
- `/config/topics` - topic configurations
- `/controller` - current controller ID

**KRaft (Modern - Kafka 3.3+)**:
- Internal consensus mechanism
- Simpler: one deployment to manage
- Better performance and security
- Eliminates ZooKeeper dependency

---

## Partition Internals

### Log Structure

Each partition is stored as a sequence of **segments** on disk.

```
Partition 0 Directory: /var/kafka-logs/topic-0/0/

00000000000000000000.log         # Log segment file (1GB)
00000000000000000000.index       # Offset index
00000000000000000000.timeindex   # Timestamp index
leader-epoch-checkpoint          # Leader info

00000000001073741824.log         # Next segment (when previous fills up)
00000000001073741824.index
00000000001073741824.timeindex
```

### Log Segment Format

```
┌──────────────────────────────────────────────────────────┐
│                   Log Segment File                        │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Message 0: [offset] [timestamp] [key_len] [key] [value] │
│  Message 1: [offset] [timestamp] [key_len] [key] [value] │
│  Message 2: [offset] [timestamp] [key_len] [key] [value] │
│  ...                                                       │
│  Message N: [offset] [timestamp] [key_len] [key] [value] │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### Index Files

**Offset Index** (`*.index`):
- Maps offsets to byte positions in log
- Sparse index (not every message, e.g., every 4KB)
- Enables O(log n) lookup time

```
Offset   Position
0        0
10       2048
20       4096
30       6144
...
```

**Timestamp Index** (`*.timeindex`):
- Maps timestamps to offsets
- Enables seeking to messages by time

### Log Compaction

**Log compaction** (`cleanup.policy=compact`) keeps the latest value for each key, enabling event sourcing patterns.

Before compaction:
```
Key: user-123, Value: {name: "John"}
Key: user-456, Value: {name: "Jane"}
Key: user-123, Value: {name: "John Doe"} ← newer
Key: user-789, Value: {name: "Bob"}
Key: user-456, Value: {name: "Jane Doe"} ← newer
```

After compaction:
```
Key: user-123, Value: {name: "John Doe"}
Key: user-456, Value: {name: "Jane Doe"}
Key: user-789, Value: {name: "Bob"}
```

Only one value per key is retained, saving storage while maintaining the latest state.

---

## Replication and Fault Tolerance

### Leader and Follower

Each partition has:
- **1 leader**: Handles all reads and writes
- **N-1 followers (replicas)**: Replicate data from leader

```
Partition 0 of topic "orders":
├─ Leader (Broker 0)
│  └─ Receives all produce requests
│  └─ Serves all fetch requests
│
├─ Follower Replica (Broker 1)
│  └─ Pulls data from leader
│  └─ Cannot serve clients
│
└─ Follower Replica (Broker 2)
   └─ Pulls data from leader
   └─ Cannot serve clients
```

### In-Sync Replicas (ISR)

The **ISR** is a list of replicas that are up-to-date with the leader. A replica is "in sync" if:
- It's connected to the broker
- Fetch latency < `replica.lag.time.max.ms` (default: 30s)
- It has replicated all messages up to the leader's high watermark

Key property: **`min.insync.replicas`**

```
Configuration:
- replication.factor = 3        (total replicas: leader + 2 followers)
- min.insync.replicas = 2       (must have leader + 1 follower in sync)

Scenario:
ISR = [0, 1, 2]  → Leader can commit messages (2 replicas in sync)
ISR = [0, 1]     → Leader can still commit (2 replicas in sync)
ISR = [0]        → Leader CANNOT commit (only 1 replica, need 2)
ISR = []         → No replicas in sync (broker failure)
```

### Producer Acknowledgment Levels (acks)

Producers can request different levels of acknowledgment:

```java
ProducerConfig.ACKS_CONFIG:

"0" (no acks)
  ├─ Producer doesn't wait for acknowledgment
  ├─ Fire and forget
  ├─ Best throughput, no guarantee
  └─ Use case: Non-critical metrics

"1" (leader acks)
  ├─ Leader acknowledges after writing to its log
  ├─ Doesn't wait for replicas
  ├─ Risk: leader crashes before replicating
  └─ Use case: Acceptable loss tolerance

"all" (all replicas ack)
  ├─ Leader waits for min.insync.replicas to acknowledge
  ├─ Slowest, most durable
  ├─ Combined with min.insync.replicas = 2+
  └─ Use case: Critical data (financial, orders)
```

### Unclean Leader Election

When a leader fails and no replicas have all messages:

```
Original state:
Broker 0 (leader):   [0][1][2][3][4][5]  ← Latest
Broker 1 (replica):  [0][1][2][3][4]     ← Behind by 1
Broker 2 (replica):  [0][1][2]           ← Behind by 3

Broker 0 crashes, message 5 not replicated.

Option 1: Clean leader election (default)
├─ Only elect from ISR
├─ Broker 1 becomes leader (has [0][1][2][3][4])
├─ Message 5 is lost (durability)
└─ unclean.leader.election.enable = false

Option 2: Unclean leader election
├─ Allow election from out-of-sync replicas
├─ Broker 2 becomes leader (has [0][1][2])
├─ Data loss: messages 3,4,5 (less durable)
├─ Duplication: message 3,4 consumed twice
└─ unclean.leader.election.enable = true (dangerous!)
```

### Handling Broker Failures

```
Scenario: 3-broker cluster, replication.factor=3, broker 1 fails

Before:
Topic-0-Partition-0: [Leader: 0, ISR: [0,1,2]]
Topic-0-Partition-1: [Leader: 1, ISR: [1,0,2]]  ← Broker 1 is leader
Topic-0-Partition-2: [Leader: 2, ISR: [2,1,0]]

Broker 1 fails:
│
├─ Controller detects failure (heartbeat timeout)
├─ ISR becomes: [0], [2], [2] (broker 1 removed)
├─ New leaders elected:
│  ├─ Partition 0: 0 (unchanged)
│  ├─ Partition 1: 0 (Broker 1 was leader, elect from ISR)
│  └─ Partition 2: 2 (unchanged)
└─ All partitions remain available for reads/writes
```

---

## High Throughput Mechanisms

Kafka achieves 1M+ messages/second through:

### 1. Sequential I/O

Kafka writes messages sequentially to disk:
- Hard drives excel at sequential access (~500 MB/s)
- Random access is slow (~3-7 MB/s)
- Log structure achieves sequential throughput

```
Producer sends 100 messages
│
├─ Batch into single write operation
└─ Sequential write to disk (500 MB/s)
   vs
   100 individual random writes (3-7 MB/s each)
```

### 2. Zero-Copy Transfer

Kafka uses `sendfile()` system call (Linux):
- Data goes: Disk → Kernel buffer → Network
- Avoids copying to JVM heap
- Data transfer happens in kernel space

```java
// Traditional way (with copy)
byte[] buffer = new byte[1024];
fileInputStream.read(buffer);           // Disk → JVM heap
socketOutputStream.write(buffer);        // JVM heap → Network

// Zero-copy (Kafka approach)
fileInputStream.transferTo(0, size, socketChannel);
// Disk → Network (no JVM copy!)
```

### 3. Batching

Messages are batched before sending/writing:

```java
ProducerConfig:
- batch.size = 16KB        # batch size threshold
- linger.ms = 100          # wait time before sending

Logic:
Producer accumulates messages in buffer
├─ If buffer reaches 16KB: send batch
├─ If 100ms has passed: send batch
└─ If producer.flush(): send immediately
```

### 4. Compression

Kafka compresses batches of messages:

```
Compression algorithms: snappy, lz4, gzip, zstd

Tradeoff:
- snappy: Good compression, low CPU (10-20%)
- lz4: Excellent speed, decent compression
- gzip: Best compression, high CPU (50%+)
- zstd: Modern, balanced compression and speed

Example compression ratio:
1MB of JSON text
├─ No compression: 1MB
├─ LZ4: 250KB (4:1 ratio)
├─ gzip: 150KB (6:1 ratio)
└─ zstd: 140KB (7:1 ratio)
```

### 5. Page Cache

Kafka leverages OS page cache:

```
┌─────────────────────────────────────────┐
│         Kafka Broker Process             │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │     JVM Heap (Young/Old Gen)       │ │
│  │     (Kafka doesn't buffer here)    │ │
│  └────────────────────────────────────┘ │
│                   │                      │
│  ┌────────────────────────────────────┐ │
│  │   OS Page Cache (Kernel)           │ │
│  │   (Stores recent log segments)     │ │
│  └────────────────────────────────────┘ │
│                   │                      │
│  ┌────────────────────────────────────┐ │
│  │      Disk (Log Segment Files)      │ │
│  └────────────────────────────────────┘ │
│                                          │
└─────────────────────────────────────────┘

Consumer reads recent messages:
└─ Found in page cache (RAM speed)
   Serves from memory, not disk
```

Kafka delegates caching to OS, which is more efficient than application-level caching.

---

## Storage Internals

### Retention Policies

Kafka supports multiple retention strategies:

#### Time-based Retention
```
retention.ms = 604800000  # Keep messages for 7 days

Timeline:
Day 1: [messages] Kept in log
Day 7: [messages] About to expire
Day 8: [messages] ✗ Deleted by cleanup
```

#### Size-based Retention
```
retention.bytes = 1099511627776  # Keep 1TB of data

Disk usage:
1TB: Filled
└─ New messages arrive
   └─ Oldest messages deleted to make space
```

#### Log Compaction
```
cleanup.policy = "compact"

Keeps latest message per key indefinitely
(Topic must have keys, used for changelogs)
```

### Segment Rotation

Segments rotate when they exceed `log.segment.bytes`:

```
Configuration:
log.segment.bytes = 1073741824  # 1GB per segment

Disk layout over time:

Day 1: 00000000000000000000.log (0-1GB)
Day 2: 00000000001073741824.log (1GB-2GB) ← New segment created
Day 3: 00000000002147483648.log (2GB-3GB) ← Previous segment immutable
```

Benefits:
- Old segments can be deleted independently
- Log compaction works on individual segments
- Faster cleanup operations

### Disk Layout Example

```
/var/kafka-logs/
├── orders-0/                    # Partition 0
│   ├── 00000000000000000000.log
│   ├── 00000000000000000000.index
│   ├── 00000000000000000000.timeindex
│   ├── 00000000001073741824.log
│   ├── 00000000001073741824.index
│   ├── 00000000001073741824.timeindex
│   └── leader-epoch-checkpoint
├── orders-1/                    # Partition 1
│   └── ...
└── orders-2/                    # Partition 2
    └── ...
```

---

## Kafka vs Other Messaging Systems

| Feature | Kafka | RabbitMQ | ActiveMQ | SQS | Pulsar |
|---------|-------|----------|----------|-----|--------|
| **Throughput** | 1M+ msg/s | 50K msg/s | 100K msg/s | Throttled | 1M+ msg/s |
| **Latency** | 10-100ms | <1ms | 5-50ms | 100-500ms | 5-100ms |
| **Durability** | Replicated | Memory+Disk | Disk | 3+ copies | Replicated |
| **Message Retention** | Configurable (days/months) | Until consumed | Until consumed | 14 days max | Configurable |
| **Consumer Offset** | Broker managed | App managed | App managed | Broker managed | Broker managed |
| **Replayability** | ✓ Full history | ✗ Once consumed | ✗ Once consumed | ✗ Once consumed | ✓ Full history |
| **Scaling** | Horizontal (partitions) | Vertical | Vertical | Built-in | Horizontal |
| **Use Case** | Event streaming | Task queues | Legacy systems | Cloud queues | Cloud streaming |

### Detailed Comparison

#### Kafka vs RabbitMQ

**RabbitMQ**:
```
Strengths:
├─ Extremely low latency (<1ms)
├─ Complex routing (exchanges, bindings)
├─ Request/reply patterns built-in
└─ Smaller deployments

Weaknesses:
├─ Limited throughput (50K msg/s)
├─ Messages deleted after consumption
├─ No message replay capability
└─ Primarily in-memory
```

**Kafka**:
```
Strengths:
├─ Extreme throughput (1M+ msg/s)
├─ Persistent storage (replay messages)
├─ Simple pub/sub model
├─ Designed for distributed systems
└─ Stream processing built-in

Weaknesses:
├─ Higher latency (10-100ms)
├─ Complex setup (multi-broker cluster)
├─ Requires topic management
└─ Overkill for simple queues
```

#### Kafka vs Amazon SQS

**SQS**:
```
Strengths:
├─ Fully managed (no ops)
├─ AWS ecosystem integration
├─ Auto-scaling built-in
└─ Serverless

Weaknesses:
├─ Limited throughput
├─ 14-day retention max
├─ No message replay
├─ Higher costs at scale
└─ Vendor lock-in
```

**Kafka**:
```
Strengths:
├─ Unlimited throughput
├─ Unlimited retention
├─ Full message replay
├─ Cost-effective at scale
└─ Open source, vendor-neutral

Weaknesses:
├─ Requires operations
├─ Self-managed scaling
├─ Learning curve
└─ Upfront infrastructure cost
```

#### Kafka vs Apache Pulsar

**Pulsar** (newer alternative):
```
Architecture:
├─ Separate storage and compute layers
├─ Bookkeepers (storage) vs brokers (compute)
├─ More cloud-native

Features:
├─ Multi-tenancy built-in
├─ Geo-replication better integrated
├─ Lower latency than Kafka
└─ Better resource isolation

Adoption:
├─ Growing (Yahoo, Alibaba, Tencent)
├─ Less mature than Kafka
└─ Smaller community
```

Kafka still dominates, but Pulsar gaining traction for specific use cases.

---

## Topic Configuration

### Critical Configurations

```properties
# Topic creation
--topic orders \
--partitions 12 \
--replication-factor 3 \
--config retention.ms=604800000 \
--config compression.type=snappy \
--config min.insync.replicas=2 \
--config cleanup.policy=delete
```

### Key Parameters

```properties
# Retention
retention.ms=604800000          # Delete old messages after 7 days
retention.bytes=1099511627776   # Delete old messages after 1TB
log.retention.check.interval.ms=300000  # Check every 5 min

# Cleanup
cleanup.policy=delete           # Delete old messages (default)
cleanup.policy=compact          # Keep latest per key

# Replication
replication.factor=3            # Total copies (leader + 2 followers)
min.insync.replicas=2           # Required for acks=all
unclean.leader.election.enable=false  # Don't elect out-of-sync leader

# Compression
compression.type=snappy         # snappy, lz4, gzip, zstd

# Segments
log.segment.bytes=1073741824    # 1GB per segment
log.segment.ms=604800000        # Rotate every 7 days

# Performance
log.flush.interval.messages=10000  # Fsync every 10k messages
log.flush.interval.ms=1000      # Fsync every 1 second (whichever first)

# Timing
message.timestamp.type=CreateTime  # CreateTime or LogAppendTime
```

---

## Cluster Sizing and Capacity Planning

### Sizing Formula

```
Number of Brokers = (Max Daily GB / Retention Days + Peak Hourly MB/s * 3600 / 1000000) / Broker Capacity
```

### Example Calculation

```
Requirements:
├─ Peak throughput: 500,000 messages/second
├─ Message size: 1KB average
├─ Retention: 7 days
├─ Replication factor: 3
├─ One broker capacity: 100 MB/s (after network/disk limits)

Calculations:
├─ Throughput requirement: 500,000 msg/s * 1KB = 500 MB/s
├─ With replication (3x): 500 MB/s * 3 = 1,500 MB/s total
├─ Brokers needed: 1,500 MB/s / 100 MB/s = 15 brokers
│
├─ Storage requirement: 500 MB/s * 86400 sec = 43.2 TB/day
├─ 7-day retention: 43.2 TB * 7 = 302.4 TB
├─ With replication (3x): 302.4 TB * 3 = 907.2 TB total
├─ Per broker disk: 907.2 TB / 15 brokers = 60.5 TB/broker
│
└─ Recommended minimum 15 brokers with 64TB SSD each
```

### Resource Allocation

```
Per Broker:
├─ CPU: 8-16 cores (Kafka is I/O, not CPU intensive)
├─ Memory: 32-64GB
│  ├─ JVM heap: 8-16GB (page cache more important)
│  └─ OS page cache: Remainder of available memory
├─ Disk: NVMe SSD (for sequential I/O performance)
│  └─ Example: 64TB for 500MB/s sustained
└─ Network: 10Gbps NIC (or 2x 10Gbps bonded)

Example broker spec:
- AWS: i4i.4xlarge (16 vCPU, 128GB RAM, 15TB NVMe)
- On-prem: 16 cores, 64GB RAM, 4x 4TB NVMe SSD (RAID-10)
```

### Partition Count Strategy

```
Partition count affects:
├─ Parallelism
├─ Throughput potential
├─ Rebalancing time
└─ File descriptor usage

Formula:
Partitions = Max(target_throughput_MB/s / broker_throughput_MB/s,
                 target_consumer_parallelism)

Example:
├─ Target throughput: 1,000 MB/s
├─ Broker capacity: 100 MB/s
├─ Target 20 consumers: 20 partitions minimum
│
└─ Recommended: 20 partitions
   (can scale up later, but rebalancing is disruptive)
```

---

## Interview Questions

### Question 1: Explain Kafka's High Throughput

**Answer Framework**:

Kafka achieves 1M+ messages/second through:

1. **Sequential I/O**: Hard drives optimized for sequential access (500 MB/s vs 3-7 MB/s random)
2. **Batching**: Multiple messages combined into single write
3. **Compression**: Reduces network/disk I/O
4. **Zero-copy transfer**: Uses `sendfile()` syscall, avoiding JVM heap copies
5. **Page cache**: OS caches recent data in memory

```java
// Batching configuration
Properties props = new Properties();
props.put(ProducerConfig.BATCH_SIZE_CONFIG, 16384);  // 16KB
props.put(ProducerConfig.LINGER_MS_CONFIG, 100);     // Wait 100ms
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "snappy");
```

### Question 2: What Happens When a Broker Fails?

**Answer Framework**:

1. **Detection** (30+ seconds): Controller detects broker heartbeat timeout
2. **ISR Update**: Remove failed broker from all partition ISRs
3. **Leader Election**: For partitions where failed broker was leader:
   - If ISR is not empty: elect new leader from ISR
   - If ISR is empty: wait for broker recovery OR unclean election
4. **Metadata Propagation**: Distribute new metadata to all brokers
5. **Recovery**:
   - Clients retry with new leaders
   - Reassign partitions for rebalancing (optional)

```
Timeline:
T=0s:   Broker crashes
T=0-30s: Clients get errors, retry
T=30s:  Controller detects failure
T=30-35s: New leaders elected, metadata distributed
T=35s:  Clients get metadata update, resume normally
```

### Question 3: Explain min.insync.replicas

**Answer Framework**:

`min.insync.replicas` specifies minimum replicas that must acknowledge for `acks=all`.

```
Configuration: replication.factor=3, min.insync.replicas=2

ISR = [0, 1, 2]  ✓ Producer can send (2 in sync)
ISR = [0, 1]     ✓ Producer can send (2 in sync)
ISR = [0]        ✗ Producer fails (need 2, have 1)

This prevents data loss:
├─ If min.insync.replicas=1, losing leader loses data
├─ If min.insync.replicas=2, can lose one follower safely
└─ If min.insync.replicas=3, can only lose if 2 fail
```

Trade-offs:
- Higher value: More durable, slower writes
- Lower value: Faster writes, less durable
- Recommendation for critical data: min.insync.replicas = 2+, replication.factor >= 3

### Question 4: Topic Configuration for Order Processing

**Answer Framework**:

For a financial order processing system:

```properties
# Durability requirements
--config replication.factor=3          # 3 copies minimum
--config min.insync.replicas=2         # Require 2 acks for producer

# Retention for compliance
--config retention.ms=31536000000      # Keep 1 year (legal requirement)
--config cleanup.policy=delete         # Delete old messages

# Performance
--config compression.type=snappy       # Balance compression/CPU
--config log.segment.bytes=1073741824  # 1GB segments (easier cleanup)

# Reliability
--config unclean.leader.election.enable=false  # No out-of-sync leaders
```

Producer configuration:

```java
Properties props = new Properties();
props.put("acks", "all");                           // All replicas must ack
props.put("retries", Integer.MAX_VALUE);            // Infinite retries
props.put("max.in.flight.requests.per.connection", 5);
props.put("enable.idempotence", true);              // Exactly-once semantics
props.put("linger.ms", 50);                         // Small delay for batching
props.put("batch.size", 16384);                     // 16KB batches
```

### Question 5: Partition Count for Microservices

**Answer Framework**:

Partition count depends on:

```
Partitions = MAX(
    throughput_requirement / single_broker_capacity,
    max_consumer_parallelism
)
```

Example: User events service

```
Requirements:
├─ Peak: 100,000 user events/second
├─ Message size: 0.5KB = 50 MB/second throughput
├─ Broker capacity: 100 MB/s per broker
├─ Target consumer parallelism: 10 threads

Calculation:
├─ Throughput factor: 50 MB/s / 100 MB/s = 0.5 → min 1 partition
├─ Parallelism factor: 10 consumers → min 10 partitions
│
└─ Recommended: 12 partitions (some headroom)

Scaling strategy:
├─ Start with 12 partitions
├─ Monitor: Can we scale to 24? Yes → Do it preemptively
├─ Note: Shrinking partitions is not supported
└─ So oversizing initial count is better
```

### Question 6: Explain Log Compaction

**Answer Framework**:

Log compaction keeps the latest value for each key:

```
Before compaction:
Partition with cleanup.policy=compact

Offset 0: Key=user-123, Value={name: "John"}
Offset 1: Key=user-456, Value={name: "Jane"}
Offset 2: Key=user-123, Value={name: "John Doe"}     ← Update
Offset 3: Key=user-789, Value={name: "Bob"}
Offset 4: Key=user-456, Value={name: "Jane Doe"}     ← Update

After compaction (broker periodically compacts):

Offset 1: Key=user-456, Value={name: "Jane Doe"}     ← Latest
Offset 2: Key=user-123, Value={name: "John Doe"}     ← Latest
Offset 3: Key=user-789, Value={name: "Bob"}          ← Latest
```

Use cases:

```
1. Changelog topics: Store latest value of each entity
2. Event sourcing: Compact event history to current state
3. State stores: Kafka Streams uses compacted topics
4. Configuration: Store current config per key
```

### Question 7: ZooKeeper vs KRaft

**Answer Framework**:

ZooKeeper (Traditional):
```
Pros:
├─ Battle-tested, stable
├─ Separate coordination service (flexibility)
└─ Well-understood

Cons:
├─ Operational complexity (another system to manage)
├─ Higher latency (separate consensus)
├─ Scalability limits
├─ Security complexity
└─ Performance bottleneck for metadata
```

KRaft (Modern, Kafka 3.3+):
```
Pros:
├─ Simplified deployment (one system)
├─ Better performance (metadata in brokers)
├─ Improved security (no external ZK)
├─ Faster metadata propagation
└─ Path to simplified Kafka

Cons:
├─ Newer, less battle-tested
├─ Upgrade complexity from ZK
├─ Operational practices still evolving
└─ Smaller community experience
```

Migration path:
```
1. KRaft mode still evolving (3.3+ experimental)
2. New clusters: KRaft recommended
3. Existing clusters: ZooKeeper until KRaft stable
4. Eventually: All clusters will migrate to KRaft
```

---

## Summary

Kafka's architecture enables:
- **Extreme throughput** through sequential I/O, batching, and zero-copy
- **Durability** through replication and persistent storage
- **Scalability** through partitioning across brokers
- **Flexibility** through configurable retention and log compaction
- **Fault tolerance** through ISR and leader election

Understanding these internals is crucial for:
- Designing scalable systems
- Troubleshooting production issues
- Optimizing performance
- Making architectural decisions

Key takeaways for interviews:
- Kafka is optimized for throughput over latency
- Replication and ISR are the durability foundation
- Topic configuration must match use case requirements
- Cluster sizing requires understanding throughput and retention needs
