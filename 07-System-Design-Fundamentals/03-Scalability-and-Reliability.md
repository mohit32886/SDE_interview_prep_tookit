# Scalability and Reliability

## Table of Contents
1. [Scaling Strategies](#scaling-strategies)
2. [Stateless vs Stateful Services](#stateless-vs-stateful-services)
3. [Database Replication](#database-replication)
4. [Database Partitioning (Sharding)](#database-partitioning-sharding)
5. [Fault Tolerance and Failover](#fault-tolerance-and-failover)
6. [Recovery and Durability](#recovery-and-durability)
7. [Distributed Consensus](#distributed-consensus)
8. [Backpressure and Load Shedding](#backpressure-and-load-shedding)
9. [Key Takeaways](#key-takeaways)

---

## Scaling Strategies

Scaling increases a system's capacity to handle growing traffic, data volume, and compute demands while maintaining target latency and availability.

```mermaid
flowchart LR
    subgraph V["Vertical Scaling (Scale Up)"]
        V1["Single Server: 8 CPUs, 32GB RAM"] -->|"Upgrade Hardware"| V2["Single Server: 128 CPUs, 512GB RAM"]
    end

    subgraph H["Horizontal Scaling (Scale Out)"]
        LB["Load Balancer"] --> H1["Server 1 (33% Load)"]
        LB --> H2["Server 2 (33% Load)"]
        LB --> H3["Server 3 (33% Load)"]
    end

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef upgraded fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    classDef lb fill:#312e81,stroke:#818cf8,stroke-width:2px,color:#f8fafc
    class V1,H1,H2,H3 primary
    class V2 upgraded
    class LB lb
```

### Vertical Scaling (Scale Up)
Adding more CPU, memory, or disk to a single machine (e.g., upgrading from `8 CPUs, 32GB RAM, 1TB disk` to `128 CPUs, 512GB RAM, 50TB disk`).

- **Pros:** Simple (no distributed logic), no sharding complexity, transactions remain ACID, and well-suited for stateful services.
- **Cons:** Hard hardware limits (max ~1000s of CPUs per machine), downtime during upgrades, high cost (`$100k+` for massive servers), single point of failure (SPOF), and diminishing returns.
- **When to use:** Early-stage products, stateful services (databases, caches), and until hitting hardware limits (typically scale vertically up to ~50K QPS, then horizontally).

### Horizontal Scaling (Scale Out)
Adding more commodity servers/machines behind a Load Balancer so each node handles a fraction of total traffic.

- **Pros:** Virtually unlimited scaling, zero-downtime capacity additions, built-in redundancy (if one server fails, others continue), and cost-effective commodity hardware.
- **Cons:** Higher complexity (load balancing, sharding, consensus), eventual consistency across replicas, network overhead for distributed calls, and harder debugging.
- **When to use:** High-traffic systems (100K–millions of QPS), high-availability workloads requiring redundancy, stateless web/API tiers, and most modern cloud architectures.

> [!TIP]
> Start with vertical scaling to ship fast and avoid premature distributed-systems complexity, then transition to horizontal scaling before hitting single-machine hardware or SPOF limits.

### Traffic Scale Progression

```mermaid
flowchart TD
    T0["t=0: 1 Server (8 core, 32GB) → 500 QPS"] -->|"Scale Up"| T1["t=1yr: 1 Server (128 core, 512GB) → 50K QPS"]
    T1 -->|"Vertical Limit Reached: Scale Out"| T2["t=2yr: 10 Servers (128 core, 512GB) → 500K QPS"]
    T2 -->|"Multi-Region + Sharding"| T3["t=3yr: 100 Servers (128 core, 512GB) → 5M QPS"]

    classDef step fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef limit fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#f8fafc
    classDef scale fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    class T0 step
    class T1 limit
    class T2,T3 scale
```

| Traffic Scale | Recommended Approach | Primary Characteristics |
| :--- | :--- | :--- |
| **1–10K QPS** | Vertical scaling | Single node, simple ACID transactions, minimal ops overhead |
| **10–100K QPS** | Hybrid (Vertical + Horizontal) | Scale app tier horizontally; scale DB vertically + read replicas |
| **100K+ QPS** | Horizontal scaling | Stateless app clusters, DB sharding, distributed caching |
| **1M+ QPS** | Horizontal + Advanced | Multi-region active-active, edge CDN, consistent hashing, async queues |

> [!IMPORTANT]
> Scaling the application tier horizontally is straightforward only if services are **stateless**; otherwise, local state traps requests on specific nodes and breaks elastic scaling.

---

## Stateless vs Stateful Services

```mermaid
flowchart LR
    subgraph SL["Stateless Architecture"]
        C1["Client"] --> LB1["Load Balancer (Round-Robin)"]
        LB1 --> S1["App Server A"]
        LB1 --> S2["App Server B"]
        S1 --> DB1["Shared Database"]
        S2 --> DB1
    end

    subgraph SF["Externalized State (Stateless App + Redis)"]
        C2["Client (user_123)"] --> LB2["Load Balancer"]
        LB2 --> A1["Server 1"]
        LB2 --> A2["Server 2"]
        LB2 --> A3["Server 3"]
        A1 --> R["Redis Session Store"]
        A2 --> R
        A3 --> R
    end

    classDef client fill:#312e81,stroke:#818cf8,stroke-width:2px,color:#f8fafc
    classDef node fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef store fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    class C1,C2,LB1,LB2 client
    class S1,S2,A1,A2,A3 node
    class DB1,R store
```

### Stateless Services
A service is stateless when it stores **no local client session data** between requests. Each request is independent (e.g., `POST /users` followed by `GET /users/1` can hit any server).

- **Properties:** Symmetric servers, simple load balancing (round-robin), trivial horizontal scaling (add/remove nodes anytime).
- **Best for:** Web API servers, microservices, and frontend-facing tiers.

> [!TIP]
> Keep compute tiers stateless and push state down into purpose-built data stores (PostgreSQL, Redis, S3) that natively handle replication and durability.

### Stateful Services
A service is stateful when it stores **client data locally** between requests (e.g., `Server A` holds `{user_123: {cart: [item1, item2]}}` in memory).

- **Sticky Sessions:** The load balancer must route `user_123` back to `Server A` using IP hashing or cookies.
- **Scaling Problem:** Adding `Server C` leaves existing sessions on `Server A` and `Server B`, causing uneven distribution. If `Server A` crashes, all its active sessions are lost.
- **Solutions:**
  1. **Replication:** Replicate session state across multiple servers so a replica survives primary failure.
  2. **External Session Store (Redis):** Move session state out of application servers into a shared store like Redis, effectively converting the app tier into a stateless service.

```mermaid
flowchart TD
    Req["Request from user_123"] --> LB["Sticky LB (Cookie / IP Hash)"]
    LB -->|"Pinned to Server A"| SA["Server A (Local Session)"]
    SA -->|"Node Crash"| Loss["Session Lost!"]
    Req2["Request from user_123"] --> LB2["Stateless LB (Any Node)"]
    LB2 -->|"Routed to Any Server"| SB["Server B or C"]
    SB -->|"Read/Write"| Redis["Centralized Redis Cluster"]

    classDef req fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef warn fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#f8fafc
    classDef ok fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    class Req,Req2,LB,LB2,SA,SB req
    class Loss warn
    class Redis ok
```

| Dimension | Stateless Service | Stateful Service (Local) | Externalized State (App + Redis) |
| :--- | :--- | :--- | :--- |
| **Routing** | Any node (Round-Robin) | Sticky sessions (IP/Cookie hash) | Any node (Round-Robin) |
| **Node Failure** | Zero session loss | Active local sessions lost | Zero session loss (if Redis replicated) |
| **Auto-Scaling** | Instant, symmetric | Uneven load on new nodes | Instant, symmetric |
| **Best Use Case** | REST/gRPC APIs, workers | Databases, caches, brokers | Authenticated web apps |

> [!WARNING]
> Relying on sticky sessions for application servers creates hotspots and causes user session loss during deployments or node crashes. Always externalize ephemeral session state to Redis or JWTs.

---

## Database Replication

Database replication maintains copies of data across multiple nodes to improve read scalability, fault tolerance, and geographic locality.

```mermaid
flowchart LR
    subgraph MS["Master-Replica (Single Leader)"]
        M["Master (Reads + Writes)"] -->|"Replication Stream"| S1["Replica 1 (Read-Only)"]
        M -->|"Replication Stream"| S2["Replica 2 (Read-Only)"]
        M -->|"Replication Stream"| S3["Replica 3 (Read-Only)"]
    end

    subgraph MM["Master-Master (Active-Active)"]
        M1["Master 1 (Reads + Writes)"] <-->|"Bi-Directional Sync"| M2["Master 2 (Reads + Writes)"]
    end

    classDef leader fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    classDef replica fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    class M,M1,M2 leader
    class S1,S2,S3 replica
```

### Master-Slave (Master-Replica)
- **Write Flow:** Client writes to Master → Master updates local disk → Master streams updates to Replicas → Replicas apply updates.
- **Read Flow:** Clients read from Replicas (faster, horizontally scaled) or from Master (always latest).
- **Replication Lag:** If Master executes `INSERT user WHERE id=1001` at `t=0ms`, Replica 1 may apply at `t=6ms` while Replica 2 applies at `t=10ms`. A read on Replica 2 at `t=7ms` returns stale data.
- **Pros:** Simple single source of truth, strong write consistency on Master, high read scalability, replica failure has minimal impact.
- **Cons:** Master is a write bottleneck and SPOF requiring failover, replicas see stale data, and cascading replication (`Master → Replica → Replica`) increases lag.
- **Failover & Data Loss:** When Master dies (missed heartbeats), a Replica is promoted and clients redirect. If Master died before replicating a committed write, that write is lost unless quorum ACKs are required.

> [!IMPORTANT]
> Semi-synchronous replication balances durability and latency: waiting for at least **one** replica ACK guarantees the write survives a single-node crash without blocking on every distant replica.

### Master-Master (Active-Active)
Both nodes accept reads and writes and replicate bi-directionally.

- **Pros:** Higher write availability, no single point of failure, and geographic distribution (local writes per region).
- **Cons:** Conflict resolution complexity when both masters update the same key, higher write latency if synchronized, and **split-brain** risk during network partitions (e.g., Master-1 writes `A=1` while Master-2 writes `A=2`).
- **Conflict Resolution Strategies:**
  1. **Last-Write-Wins (LWW):** Attach timestamps; higher timestamp wins (e.g., `t=100` overwrites `t=95`). Risky if system clocks drift.
  2. **Application-Level Merge:** Store both conflicting versions and let application logic merge fields.
  3. **Quorum-Based:** Require a majority of masters to ACK writes; minority partition cannot accept writes, preventing split-brain.

### Synchronous vs Asynchronous vs Semi-Synchronous Replication

```mermaid
sequenceDiagram
    participant C as Client
    participant M as Master
    participant S1 as Replica 1
    participant S2 as Replica 2

    Note over C,S2: Synchronous Replication (Strong Consistency, Higher Latency)
    C->>M: WRITE (t=0ms)
    M->>S1: Replicate (t=0ms)
    S1-->>M: ACK after disk flush (t=15ms)
    M-->>C: Success (t=15ms)

    Note over C,S2: Asynchronous Replication (Low Latency, Lag & Loss Risk)
    C->>M: WRITE (t=0ms)
    M->>M: Write disk & queue (t=1.5ms)
    M-->>C: Success (t=2ms)
    M-)S2: Async stream in background (t=100ms)
```

| Replication Mode | Write Latency | Data Loss Risk | Consistency | Best Used For |
| :--- | :--- | :--- | :--- | :--- |
| **Synchronous** | High (waits for replica disk + network ACK) | Zero (replica always has latest) | Strong | Banking, financial ledgers, critical state |
| **Asynchronous** | Very low (ACKs after local Master write) | High if Master crashes before streaming | Eventual (replication lag) | Social feeds, logs, analytics, most web apps |
| **Semi-Synchronous** | Moderate (waits for 1 replica ACK, others async) | Low (tolerates 1 node loss) | Tunable | Production MySQL/PostgreSQL HA clusters |

> [!WARNING]
> In Master-Master replication without quorum enforcement, a network partition creates a **split-brain** state where both masters accept conflicting writes (`A=1` vs `A=2`), causing silent data corruption upon recovery.

---

## Database Partitioning (Sharding)

Sharding distributes a large dataset (e.g., `100M users`) across multiple independent databases (**shards**), where each shard stores a subset of records (e.g., `10M users` per shard across 10 shards).

```mermaid
flowchart TD
    Req["Client Request: Get user_id = 5123456"] --> Router{"Shard Router"}
    Router -->|"Range: ID / 1M + 1"| R["Shard 6 (Range-Based)"]
    Router -->|"Hash: hash(id) % 10"| H["Shard 9 (Hash-Based)"]
    Router -->|"Lookup Table"| D["Shard 4 (Directory-Based)"]

    classDef req fill:#312e81,stroke:#818cf8,stroke-width:2px,color:#f8fafc
    classDef router fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#f8fafc
    classDef shard fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    class Req req
    class Router router
    class R,H,D shard
```

- **Benefits:** Linear capacity scaling (`10 shards = 10x capacity`), parallel query execution, and smaller per-shard indexes for faster lookups.
- **Challenges:** Shard key selection, cross-shard queries/joins, complex rebalancing when adding shards, hotspots, and single-shard transaction boundaries.

### Sharding Strategies

| Strategy | Routing Logic | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **Range-Based** | Partition by value ranges (e.g., `1–1M → Shard 1`) | Simple, efficient range scans | Hotspots on newest/active ranges; uneven distribution |
| **Hash-Based** | `shard = hash(key) % num_shards` | Uniform distribution, avoids hotspots | Rebalancing nightmare (`% 10` vs `% 11` moves ~90% of keys) |
| **Consistent Hashing** | Hash ring with virtual nodes | Minimal key movement (`1/N`) on scale-out | Slightly more complex routing metadata |
| **Directory-Based** | Lookup table (`key range → shard`) | Flexible custom distributions, easy partial rebalancing (e.g., move 25%) | Extra lookup hop, directory can become a bottleneck/SPOF |

> [!WARNING]
> Modulo hashing (`hash(key) % N`) causes a massive data migration storm whenever `N` changes (e.g., `hash("alice") % 10 = 3` shifts to `% 11 = 2`). Always use **consistent hashing** or **directory-based** partitioning for elastic clusters.

### Handling Cross-Shard Operations & Hotspots

```mermaid
flowchart LR
    subgraph Cross["Cross-Shard Solutions"]
        CS1["Denormalization (Store Follower Posts Locally)"]
        CS2["Parallel Fan-Out + App Merge"]
        CS3["Aggregate Microservice + Materialized View"]
    end

    subgraph Hot["Hotspot Mitigation (Celebrity user_id)"]
        HK["Hot Key: 1B Followers"] --> HS1["Split Key (v1..vN across Shards)"]
        HK --> HS2["Aggressive Read Caching (Redis)"]
        HK --> HS3["Dedicated High-Capacity Shard"]
    end

    classDef cs fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef hot fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#f8fafc
    classDef fix fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    class CS1,CS2,CS3 cs
    class HK hot
    class HS1,HS2,HS3 fix
```

1. **Cross-Shard Operations** (e.g., *"Get all posts from users I follow"*):
   - **Denormalization:** Pre-store follower posts with the user (single-shard read, higher write/storage cost).
   - **Fan-Out Query:** Query all shards in parallel and merge in the application tier.
   - **Aggregate Microservice:** Dedicated service maintaining an eventually consistent materialized view.
   - **Schema Design:** Design shard keys to co-locate related entities and avoid cross-shard joins.
2. **Hotspot Problem** (e.g., celebrity `user_id = 1000000001` with `1B` followers overloading `Shard 1`):
   - **Split Hot Key:** Replicate `user:1000000001:v1` to Shard 1 and `:v2` to Shard 2; reads pick randomly, writes update all versions.
   - **Aggressive Caching:** Serve celebrity reads from Redis/CDN so the shard only handles cache misses.
   - **Dedicated Shard:** Isolate hot keys onto a high-capacity shard.
   - **Application-Tier Handling:** Bypass standard user-ID sharding for known celebrity accounts.

> [!TIP]
> Pick a shard key with high cardinality and uniform access frequency (e.g., `tenant_id` or `user_id` paired with hot-key caching) to avoid hotspots and cross-shard scatter-gather queries.

---

## Fault Tolerance and Failover

Fault tolerance ensures a system continues operating despite hardware crashes, network partitions, or regional outages by eliminating single points of failure through **redundancy** and automated **failover**.

![Multi-Region Active-Passive Failover and Leader Election](./assets/03-sharding-replication-failover.svg)

### Redundancy Tiers & Placement

| Architecture | Availability SLA | Annual Downtime | Fault Tolerance |
| :--- | :--- | :--- | :--- |
| **Single Server** | `99%` | ~35 hours/year | None (unacceptable for production) |
| **Master + 1 Replica** | `99.9%` | ~8.7 hours/year | Tolerates 1 server failure |
| **Master + 3 Replicas** | `99.99%` | ~52 minutes/year | Tolerates up to 3 staggered failures |
| **Master + 5 Replicas + Geo** | `99.999%` | ~5 minutes/year | Tolerates simultaneous failures + regional outages |

- **Placement Hierarchy:** Spread replicas across different servers → racks → datacenters/AZs → geographic regions → cloud providers (highest cost, ultimate resilience).

### Active-Passive vs Active-Active Failover

```mermaid
flowchart LR
    subgraph AP["Active-Passive Failover"]
        VIP["Virtual IP / Geo-DNS"] -->|"All Traffic"| P["Primary (Active)"]
        P -.->|"Heartbeat (100ms) + Replication"| S["Secondary (Passive Standby)"]
        VIP -.->|"Failover at t=6s"| S
    end

    subgraph AA["Active-Active Failover"]
        LB["Global Load Balancer"] -->|"50% Traffic"| A["Server A (Active)"]
        LB -->|"50% Traffic"| B["Server B (Active)"]
        A <-->|"Bi-Directional Sync"| B
    end

    classDef active fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    classDef passive fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#f8fafc
    classDef route fill:#312e81,stroke:#818cf8,stroke-width:2px,color:#f8fafc
    class P,A,B active
    class S passive
    class VIP,LB route
```

| Failover Mode | Resource Utilization | Failover Speed | Complexity & Risks |
| :--- | :--- | :--- | :--- |
| **Active-Passive** | Standby sits idle for writes | Seconds (e.g., 5s timeout + VIP/DNS switch) | Split-brain, false positives on network jitter, async data loss |
| **Active-Active** | 100% active (no idle capacity) | Near-instant (remove failed node from pool) | Distributed consensus, write conflicts, higher operational overhead |

> [!IMPORTANT]
> Most real-world outages stem not from the initial node failure, but from **failover bugs** (split-brain, thundering herds, or untested promotion scripts). Always test automated failover in staging or chaos-engineering drills.

### Heartbeat Mechanism & Failure Detection

```mermaid
stateDiagram-v2
    [*] --> Healthy: Heartbeat Received (1s interval)
    Healthy --> Healthy: Reset Timeout Timer
    Healthy --> Suspected: Missed Heartbeat (&gt;3s)
    Suspected --> Healthy: Heartbeat Restored
    Suspected --> Dead: Quorum Confirms Timeout (5s)
    Dead --> Failover: Promote Standby + Fence Old Primary
    Failover --> [*]
```

- **Payload:** Periodic (every `1s`) JSON heartbeat `{server_id, timestamp, healthy, seq_num}` over a dedicated network interface separate from the data path.
- **Challenges:**
  1. **False Positives:** Network jitter triggers unnecessary failover → solve with **quorum** (e.g., 2 of 3 nodes must declare death).
  2. **Cascading Failures:** Asymmetric network partitions trigger simultaneous failovers → solve with **consensus** (Raft/Paxos) and fencing (STONITH).
  3. **Timeout Tuning:** Too short causes false positives; too long inflates downtime (typical: `1s` interval, `3–5s` timeout).
- **Best Practices:** Exponential backoff on retries, randomized **jitter** to prevent thundering herds, dedicated heartbeat NICs, and continuous monitoring of heartbeat loss rate/latency.

> [!WARNING]
> Never promote a standby node without **fencing** the old primary (revoking its lease or network access); otherwise, a temporarily partitioned primary can wake up and corrupt data.

---

## Recovery and Durability

Recovery and durability define how much data and time a system can afford to lose during a disaster, and the storage mechanisms that guarantee committed writes survive crashes.

### RPO vs RTO

```mermaid
flowchart LR
    Crash["Failure Occurs (t_fail)"] -->|"Look Back: RPO (Data Loss Window)"| LastBackup["Last Replicated/Backed-Up State"]
    Crash -->|"Look Forward: RTO (Downtime Window)"| Restored["Service Restored &amp; Serving"]

    classDef fail fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#f8fafc
    classDef ok fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    classDef state fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    class Crash fail
    class LastBackup state
    class Restored ok
```

- **RPO (Recovery Point Objective):** Maximum acceptable data loss measured in time.
- **RTO (Recovery Time Objective):** Maximum acceptable downtime to restore service.

| Target Tier | RPO Mechanism | RTO Mechanism | Relative Cost |
| :--- | :--- | :--- | :--- |
| **Basic (`RPO 24h / RTO 4h`)** | Nightly backups | Manual restore scripts | `1x` (Cheap) |
| **Standard (`RPO 1h / RTO 1h`)** | Hourly snapshots | Automated recovery + alerts | `3x` (Medium) |
| **High (`RPO 1–5m / RTO 5–15m`)** | Continuous async replication | Hot standby + automated failover | `5x` (Expensive) |
| **Mission-Critical (`RPO 0 / RTO 0`)** | Synchronous multi-site replication | Redundant active-active + instant routing | `10x` (Very Expensive) |

### Checkpointing and Recovery
Long-running batch jobs (e.g., processing `1M` items over 1 hour) save periodic checkpoints to durable storage (Database, HDFS, or S3—never in-memory) so a crash at item `500K` resumes at `500K + 1` instead of restarting from `0`.

```python
def process_items(items):
    checkpoint = load_checkpoint()
    start_index = checkpoint.last_item_id + 1

    for i in range(start_index, len(items)):
        process(items[i])
        if i % 10000 == 0:
            save_checkpoint(i)  # Persist every 10K items (1-5% of total time)
```

> [!TIP]
> Aim for a checkpoint interval equal to **1–5% of total job duration**—frequent enough to bound rework on crash, infrequent enough to avoid write amplification.

### Write-Ahead Logging (WAL)

```mermaid
sequenceDiagram
    participant App as Application
    participant WAL as WAL (Sequential Disk)
    participant Mem as DB Memory Buffer
    participant Data as Data Files (Disk)

    App->>WAL: 1. Append "UPDATE user SET name=Alice WHERE id=1"
    WAL-->>App: Durable Flush (t=10ms)
    App->>Mem: 2. Update In-Memory State (t=20ms)
    Mem-->>App: 3. Return Success to Client (t=30ms)
    Note over Mem,Data: Crash at t=50ms before background flush!
    WAL->>Data: 4. Recovery: Replay WAL entries to restore state
```

- **Why WAL:** Without WAL, updating memory at `t=0ms` and crashing at `t=50ms` before the `t=100ms` disk flush loses the committed update.
- **Pros:** Guarantees durability before client ACK, fast sequential disk I/O, and simple crash recovery via log replay.
- **Cons:** Disk I/O overhead per write unless batched, potential log-disk bottleneck, and requires log rotation/compaction.
- **Best Practices:** Batch log flushes, use SSDs, separate log disk from data disk for parallel I/O, and archive/rotate old logs.

> [!IMPORTANT]
> Checkpoints and WALs only provide durability if flushed (`fsync`) to **persistent storage** (local SSD, replicated DB, or object storage). In-memory buffers vanish on power loss.

---

## Distributed Consensus

When multiple servers must agree on a single source of truth (e.g., Master A has `balance = 100` vs Master B `balance = 150`, or electing a single leader), **distributed consensus** prevents data corruption and split-brain.

### Raft State Machine & Log Replication

> [!IMPORTANT]
> Never implement custom consensus or leader-election protocols from scratch. Use battle-tested Raft/Paxos systems like **etcd**, **Consul**, **ZooKeeper**, or **CockroachDB**.

```mermaid
stateDiagram-v2
    [*] --> Follower: Boot / Start
    Follower --> Candidate: Election Timeout (No Heartbeat)
    Candidate --> Candidate: Split Vote (New Term)
    Candidate --> Leader: Receives Majority Votes
    Leader --> Follower: Discovers Higher Term
    Candidate --> Follower: Discovers Current Leader or Higher Term
```

```mermaid
sequenceDiagram
    participant C as Client
    participant L as Leader (Term 2)
    participant F1 as Follower 1
    participant F2 as Follower 2

    C->>L: Write Command (x=5)
    L->>L: Append to Local Log
    par Replicate to Quorum
        L->>F1: AppendEntries(x=5)
        L->>F2: AppendEntries(x=5)
    end
    F1-->>L: ACK
    Note over L,F1: Majority (2/3) Reached → Entry Committed!
    L-->>C: Success
    L->>F1: Heartbeat (Commit Index Updated)
    L->>F2: AppendEntries / Commit Index Updated
```

### Paxos vs Raft

| Dimension | Paxos | Raft |
| :--- | :--- | :--- |
| **Core Mechanism** | Two-phase: **Stage 1 (Prepare/Promise)** + **Stage 2 (Accept/Accepted)** | **Leader Election** + **Log Replication** with monotonic terms |
| **Understandability** | Notoriously complex, many edge cases | Designed for clarity and teachability |
| **Safety** | Provably safe across network partitions | Only 1 leader/term; majority log before commit; never loses committed entries |
| **Fault Tolerance** | Tolerates `(N - 1) / 2` failures | `3` nodes → 1 failure; `5` nodes → 2 failures; `7` nodes → 3 failures |
| **Production Usage** | Google Chubby, Apache Cassandra (LWT) | `etcd` (Kubernetes), Consul, CockroachDB |

> [!WARNING]
> Always deploy consensus clusters with an **odd number of nodes** (`3`, `5`, or `7`). A 4-node cluster has the exact same fault tolerance (`1` failure) as a 3-node cluster while requiring a larger quorum (`3` vs `2`).

---

## Backpressure and Load Shedding

When downstream services or databases slow down, unbounded request queues exhaust memory and cause cascading latency spikes across the entire system. **Backpressure** and **load shedding** protect system stability under overload.

```mermaid
flowchart LR
    Client["Incoming Traffic"] --> Gate{"Rate Limiter / Concurrency Gate"}
    Gate -->|"Within Capacity"| Queue["Bounded Queue (Max N)"]
    Gate -->|"Overload: Shed Load"| Reject["HTTP 429 / 503 + Retry-After"]
    Queue -->|"Consumer Pulls at Safe Rate"| Worker["Worker Pool"]
    Worker -->|"Queue Full Signal"| Gate

    classDef ok fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    classDef gate fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#f8fafc
    classDef drop fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#f8fafc
    classDef node fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    class Client,Worker ok
    class Gate gate
    class Reject drop
    class Queue node
```

```mermaid
stateDiagram-v2
    [*] --> Closed: Normal Operation
    Closed --> Open: Error / Timeout Threshold Exceeded
    Open --> HalfOpen: Cooldown Timer Expires
    HalfOpen --> Closed: Probe Requests Succeed
    HalfOpen --> Open: Probe Requests Fail
```

- **Backpressure (Slow Down Upstream):** Propagate congestion signals upstream using bounded queues, TCP flow control, reactive streams (pull-based demand), or adaptive concurrency limits (AIMD).
- **Load Shedding (Drop Excess Work):** When capacity is saturated, immediately reject low-priority requests (returning `HTTP 429 Too Many Requests` or `503 Service Unavailable` with `Retry-After`) so high-priority traffic succeeds with low latency.
- **Circuit Breakers:** Stop calling a failing downstream dependency (`Open` state) to prevent thread-pool exhaustion and allow recovery before probing again (`Half-Open`).

> [!WARNING]
> Unbounded queues are a reliability anti-pattern: they hide overload until memory is exhausted or request latencies exceed client timeouts, causing clients to retry and amplify the outage (**retry storm**).

| Mechanism | Action Under Overload | Primary Goal | Example |
| :--- | :--- | :--- | :--- |
| **Bounded Queues** | Cap buffer size; block or reject when full | Prevent OOM crashes | Kafka consumer poll limits, fixed thread-pool queues |
| **Backpressure** | Signal producer to slow emission rate | Match producer rate to consumer capacity | gRPC flow control, Reactive Streams |
| **Load Shedding** | Drop excess/low-priority requests early | Preserve latency for admitted requests | Returning `503` at API Gateway |
| **Circuit Breaker** | Fail fast without calling degraded dependency | Prevent cascading thread exhaustion | Resilience4j, Envoy outlier detection |

> [!TIP]
> Pair load shedding with **randomized exponential backoff + jitter** on clients so rejected callers do not synchronize and overwhelm the server again simultaneously.

---

## Key Takeaways

```mermaid
flowchart LR
    S["1. Scale Horizontally"] --> ST["2. Keep Tiers Stateless"]
    ST --> SH["3. Shard &amp; Replicate Data"]
    SH --> CO["4. Proven Consensus (Raft)"]
    CO --> FT["5. Redundancy &amp; Tested Failover"]
    FT --> BP["6. Backpressure, WAL &amp; RPO/RTO"]

    classDef step fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    classDef endnode fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc
    class S,ST,SH,CO,FT step
    class BP endnode
```

1. **Scale horizontally** when possible (more commodity servers, not bigger single servers).
2. **Keep compute stateless** by externalizing session data to Redis or shared stores.
3. **Redundancy is essential** — a single server is a guaranteed point of failure.
4. **Replication strategy matters** (sync vs async vs semi-sync; master-replica vs master-master).
5. **Failover needs testing** — most outages stem from failover bugs, split-brain, or missing fencing.
6. **Consensus is hard** — use proven libraries (`Raft`, `etcd`, `Consul`), never home-grown protocols.
7. **RPO and RTO** directly drive infrastructure architecture and cost (`1x` to `10x`).
8. **Checkpointing, WAL, and Backpressure** enable fast crash recovery and prevent cascading overload.

> [!TIP]
> In system design interviews, always tie your reliability choices back to explicit **RPO/RTO targets**, **SLA nines** (`99.9%` vs `99.999%`), and **graceful degradation** under load.
