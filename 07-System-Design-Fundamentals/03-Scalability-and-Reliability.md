# Scalability and Reliability

## Table of Contents
1. [Scaling Strategies](#scaling-strategies)
2. [Stateless vs Stateful Services](#stateless-vs-stateful-services)
3. [Database Replication](#database-replication)
4. [Database Partitioning](#database-partitioning)
5. [Fault Tolerance and Failover](#fault-tolerance-and-failover)
6. [Recovery and Durability](#recovery-and-durability)
7. [Distributed Consensus](#distributed-consensus)

---

## Scaling Strategies

### Vertical Scaling (Scale Up)

```
Definition: Add more CPU, memory, or disk to single server

Before:
┌──────────────────────┐
│ Single Server        │
│ 8 CPUs, 32GB RAM     │
│ 1TB disk             │
└──────────────────────┘

After:
┌──────────────────────┐
│ Single Server        │
│ 128 CPUs, 512GB RAM  │
│ 50TB disk            │
└──────────────────────┘

Pros:
├─ Simple (no distributed logic)
├─ No sharding complexity
├─ Transactions still ACID
└─ Good for stateful services

Cons:
├─ Hardware limits (max 1000s of CPUs per machine)
├─ Downtime during upgrade
├─ High cost ($100k+ for massive server)
├─ Single point of failure
└─ Diminishing returns (eventually CPU doesn't help)

When to use:
├─ Early stage (simple)
├─ Stateful services (databases, caches)
├─ Until you hit hardware limits
└─ Typically: scale vertically until 50K QPS, then horizontal
```

### Horizontal Scaling (Scale Out)

```
Definition: Add more servers/machines to cluster

Before:
┌──────────────────┐
│ Server 1         │
│ Processing 100%  │
└──────────────────┘

After:
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Server 1         │    │ Server 2         │    │ Server 3         │
│ Processing 33%   │    │ Processing 33%   │    │ Processing 33%   │
└──────────────────┘    └──────────────────┘    └──────────────────┘
        ▲                       ▲                       ▲
        └───────────────────────┼───────────────────────┘
                                │
                        Load Balancer

Pros:
├─ Unlimited scaling (add servers indefinitely)
├─ No downtime (add servers while running)
├─ Redundancy (if one fails, others work)
└─ Cost-effective (commodity hardware)

Cons:
├─ Complex (load balancing, sharding, consensus)
├─ Eventual consistency (replicas might lag)
├─ Network overhead (distributed calls)
└─ Debugging harder (distributed systems)

When to use:
├─ High traffic (millions of QPS)
├─ Need redundancy
├─ Stateless services (web servers, API servers)
└─ Most modern systems
```

### Comparison: When to Use What

```
Traffic Scale       Recommended Approach
─────────────────────────────────────────
1-10K QPS           Vertical scaling
10-100K QPS         Mix: vertical + horizontal
100K+ QPS           Horizontal scaling
1M+ QPS             Horizontal + advanced techniques

Example progression:
t=0:    1 server (8 core, 32GB) → 500 QPS
t=1yr:  1 server (128 core, 512GB) → 50K QPS (vertical limit)
t=2yr:  10 servers (128 core, 512GB each) → 500K QPS
t=3yr:  100 servers (128 core, 512GB each) → 5M QPS
```

---

## Stateless vs Stateful Services

### Stateless Services

```
Definition: No local storage of client data between requests
Each request is independent (or session data in external store)

Example: Web API server

Request 1: POST /users
├─ Read from database
├─ Return response
└─ No memory of session

Request 2: GET /users/1
├─ Can go to any server
├─ Reads fresh data from database
└─ Doesn't care which server handled request 1

Scaling:
┌──────────┐
│ Request  │
│ (POST)   │
└────┬─────┘
     │
     ├─→ Load Balancer ─→ Server A (or B, or C, or any)
     │
┌────▼─────┐
│ Response │
└──────────┘

Properties:
├─ Can add/remove servers anytime
├─ Load balancer can use simple algorithms (round-robin)
├─ Horizontal scaling is simple
└─ Each server identical (symmetric)

Best for:
├─ Web servers (API endpoints)
├─ Microservices
├─ Anything frontend-facing
```

### Stateful Services

```
Definition: Stores client data locally between requests
Client must connect to same server (sticky sessions)

Example: In-memory cache (Redis) session storage

Session stored locally on server:
Server A: {user_123: {cart: [item1, item2], login_time: ...}}
Server B: {user_456: {...}}

Request from user_123:
├─ Must go to Server A (has session data)
├─ Load balancer uses sticky sessions (hash IP or cookie)
└─ If Server A dies → session lost!

Scaling problem:
Add Server C
├─ Old data still on Server A + Server B
├─ New data goes to Server C
├─ Uneven distribution
└─ Session loss if server dies

Solutions:
1. Replication
   └─ Replicate session to multiple servers
   └─ If primary dies, replica has copy

2. Session store (Redis)
   ├─ Move session out of server
   ├─ All servers query Redis for session
   └─ Effective: make stateless service

Example (better architecture):
┌──────────────────────┐
│ Client (user_123)    │
└────────┬─────────────┘
         │
         ├─→ Load Balancer
         │
    ┌────┼────────────────────┐
    ▼    ▼                    ▼
 Server1 Server2 Server3
    │    │        │
    └────┴────┬───┘
               ▼
            Redis (session store)
               │
     user_123_session: {cart: [...]}

Now stateless: any server can handle user_123 requests

Best for:
├─ Data stores (databases, caches)
├─ If you need sticky sessions, architect differently
```

---

## Database Replication

### Master-Slave (Master-Replica)

```
Topology:
           ┌─────────────────────────┐
           │ Master                  │
           │ Accepts reads + writes  │
           └────────────┬────────────┘
                        │
                        │ Replication stream
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
    ┌────────┐     ┌────────┐     ┌────────┐
    │Slave 1 │     │Slave 2 │     │Slave 3 │
    │Read    │     │Read    │     │Read    │
    │only    │     │only    │     │only    │
    └────────┘     └────────┘     └────────┘

Write flow:
1. Client writes to Master
2. Master updates local disk
3. Master sends update to Slaves
4. Slaves apply update (eventually)

Read flow:
1. Client reads from Slave (faster, distributed)
2. Or reads from Master (always latest, slower)

Replication lag:
Master: INSERT user WHERE id=1001 at t=0ms
Slave 1: Receives at t=5ms, applies at t=6ms
Slave 2: Receives at t=8ms, applies at t=10ms

If client reads Slave 1 at t=7ms → sees update ✓
If client reads Slave 2 at t=7ms → doesn't see update ✗

Pros:
├─ Simple (single source of truth)
├─ Good read scalability (many slaves)
├─ Slave failure: no impact (still have master)
└─ Write consistency: guaranteed on master

Cons:
├─ Master failure: need failover
├─ Write bottleneck: all writes go to master
├─ Replication lag: slaves see stale data
└─ Cascading replication: master→slave→slave (slower)

Failover process (Master dies):
1. Detect master is dead (no heartbeat)
2. Promote one slave to master
3. Redirect all clients to new master
4. Other slaves replicate from new master

Problem: Potential data loss
├─ If master dies after write but before replicating to chosen slave
├─ That write is lost (chosen slave becomes new master without it)
└─ Solution: wait for quorum ACK before acknowledging write
```

### Master-Master (Active-Active)

```
Topology:
    ┌─────────────┐         ┌─────────────┐
    │Master-1     │◄───────▶│Master-2     │
    │Accepts R+W  │Bi-direc-│Accepts R+W  │
    └──────┬──────┘tional   └──────┬──────┘
           │replication            │
           │                       │
     ┌─────▼──────┬────────────────▼─────┐
     │             │                     │
     ▼             ▼                     ▼
  Client-1    Client-2              Client-3

Write flow:
Client-1 writes to Master-1 → Master-1 sends to Master-2
Client-2 writes to Master-2 → Master-2 sends to Master-1

Pros:
├─ Fault tolerance (write to either master)
├─ Geographic distribution (each region has master)
├─ No single point of failure
└─ Higher write availability

Cons:
├─ Conflict resolution: what if both masters write same key?
├─ Complex: requires distributed consensus
├─ Higher latency: writes go to 2+ masters
└─ Risk of split-brain: if network partition

Conflict resolution strategies:
1. Last-Write-Wins (LWW)
   └─ Timestamp on write
   └─ Master-2 write (t=100) overwrites Master-1 write (t=95)
   └─ Risk: correct version lost if clocks wrong

2. Application-level merge
   └─ Store both versions
   └─ Application decides: "merge these changes"
   └─ Example: document with different fields edited on each master

3. Quorum-based
   └─ Need majority of masters to ACK write
   └─ If network partition, minority can't write
   └─ Prevents split-brain

Split-brain scenario (Master-Master without quorum):
┌─────────────┐         Network          ┌─────────────┐
│Master-1     │◄─ PARTITION ─┼─ ─→│Master-2     │
│Write: A=1   │         ─┼─ ─ ─        │Write: A=2   │
└─────────────┘                        └─────────────┘

Both masters now have different data!
When network heals, conflict: A should be 1 or 2?
```

### Synchronous vs Asynchronous Replication

```
Synchronous Replication:
Write flow:
1. Client writes to Master
2. Master waits for Slave ACK
3. Master returns success to client

Timeline:
Master: WRITE at t=0
   ├─ Send to Slave (t=0ms)
   ├─ Wait for ACK (t=5ms for network, t=10ms for disk write)
   ├─ Receive ACK (t=15ms)
   └─ Return to client (t=15ms) [Slower!]

Slave: Receive at t=5ms
   └─ Write to disk at t=15ms
   └─ Send ACK at t=15ms

Pros:
├─ Consistency: write always replicated before ACK
├─ No data loss: slave always has latest
└─ Strong guarantee: can query slave for latest data

Cons:
├─ Slow: wait for slave to ACK (1-100ms overhead)
├─ If slave slow: blocks all writes
├─ If network slow: timeout issues
└─ Not suitable for interactive applications

Use when:
├─ Consistency critical (banking, transactions)
├─ Data loss unacceptable
└─ Can tolerate slower writes

───────────────────────────────────────────────────────

Asynchronous Replication:
Write flow:
1. Client writes to Master
2. Master returns success to client (immediately!)
3. Master sends to Slave asynchronously

Timeline:
Master: WRITE at t=0
   ├─ Write to own disk (t=1ms)
   ├─ Queue replication message (t=1.5ms)
   ├─ Return to client (t=2ms) [Fast!]
   └─ Send to Slave (t=100ms, in background)

Slave: Receive at t=100ms
   └─ Write to disk at t=115ms

Pros:
├─ Fast: return to client immediately
├─ High throughput: don't wait for slaves
└─ Suitable for interactive apps

Cons:
├─ Replication lag: slave lags behind master
├─ Data loss risk: if master dies before replicating
├─ Eventual consistency: slaves see stale data
└─ Must tolerate stale reads

Use when:
├─ Performance critical (high write rate)
├─ Some data loss acceptable (logs, analytics)
├─ Can tolerate eventual consistency
└─ Most web applications

Hybrid approach (Semi-synchronous):
1. Write to Master
2. Master sends to Slave 1 (and waits for ACK)
3. Master sends to Slave 2 (doesn't wait)
└─ Return to client
└─ Somewhere between: tolerance for 1 slave down, but fast writes
```

---

## Database Partitioning (Sharding)

### Sharding Basics

```
Definition: Distribute data across multiple databases (shards)
Each shard stores subset of data (partition)

Example: User database with 100M users

No sharding:
┌────────────────────────────────────┐
│ User Database                      │
│ 100M users                         │
│ Single server: maxes at ~10K QPS   │
└────────────────────────────────────┘

With 10 shards:
Shard 1: Users 1-10M
Shard 2: Users 10-20M
Shard 3: Users 20-30M
...
Shard 10: Users 90-100M

Architecture:
┌──────────────────┐
│ Client request   │
│ "Get user 5M"    │
└────────┬─────────┘
         │
         ├─ Shard key: user_id = 5M
         ├─ Hash/range/directory lookup: goes to Shard 1
         │
         ▼
┌────────────────────────────────┐
│ Shard 1                        │
│ Users 1-10M (fast, 1M records) │
└────────────────────────────────┘

Benefits:
├─ Linear scalability: 10 shards = 10x capacity
├─ Parallel queries: query all shards simultaneously
└─ Smaller dataset per shard: faster queries

Challenges:
├─ Shard key selection: must be good distribution
├─ Cross-shard queries: need to hit multiple shards
├─ Rebalancing: add shard, move data (complex!)
├─ Hotspots: some shards busier than others
└─ Consistency: transactions within shard only
```

### Sharding Strategies

#### Range-Based Sharding

```
Shard by range of values

Example: User ID ranges
Shard 1: IDs 1 to 1M
Shard 2: IDs 1M+1 to 2M
Shard 3: IDs 2M+1 to 3M

Lookup:
user_id = 5123456
shard = (user_id / 1M) + 1 = Shard 6

Pros:
├─ Simple logic (no hash function needed)
├─ Range queries efficient (users 1-10K on same shard)
└─ Easy to find record

Cons:
├─ Uneven distribution: some IDs more popular
├─ Hotspots: early IDs (1-1M) created first, more active
├─ Sequential IDs: new users all go to latest shard
└─ Rebalancing hard: ranges shift when adding shard

Real-world problem:
Shard 1 (IDs 1-1M): 10K QPS, lots of old data
Shard 2 (IDs 1M-2M): 5K QPS
Shard N (IDs (N-1)M-NM): 50K QPS (new users, hot!)
└─ Uneven load: can't just add shard to fix
```

#### Hash-Based Sharding

```
Shard by hash of key

Example:
shard = hash(user_id) % num_shards

Calculation:
user_id = 5123456
hash(5123456) = 314159 (SHA256 first bytes, for example)
shard = 314159 % 10 = Shard 9

Pros:
├─ Uniform distribution (hashing spreads values)
├─ No hotspots (random distribution)
├─ Simple implementation
└─ Works well for many use cases

Cons:
├─ Rebalancing nightmare: adding shard changes ALL hashes!
├─ Old: shard = 314159 % 10 = 9
├─ New: shard = 314159 % 11 = 8 (moved!)
└─ Almost all keys need to move (expensive!)

Example of rebalancing problem:
num_shards = 10
key = "alice"
hash("alice") % 10 = 3 → Shard 3

Add new shard (num_shards = 11)
hash("alice") % 11 = 2 → Shard 2 (different!)

Millions of keys rehash to different shards
Need to copy data from old shards to new shards
During migration: inconsistency, complexity

Solution: Use consistent hashing (see Building Blocks section)
```

#### Directory-Based Sharding

```
Maintain lookup table: key → shard

Example:
┌────────────────┬─────────┐
│ User ID Range  │ Shard   │
├────────────────┼─────────┤
│ 1-1M           │ Shard 1 │
│ 1M-2M          │ Shard 2 │
│ 2M-3M          │ Shard 3 │
│ 3M-5M          │ Shard 4 │  (expanded after growth)
└────────────────┴─────────┘

Lookup:
user_id = 5123456
SELECT shard FROM user_shard_directory WHERE user_id BETWEEN 1 AND 5M
Result: Shard 4

Pros:
├─ Flexible: can rebalance without formula change
├─ No hash collisions
├─ Can create custom distributions
└─ Easy to add/remove shards

Cons:
├─ Requires lookup (extra query)
├─ Directory itself is bottleneck if not cached
├─ Must keep directory consistent
└─ Operational overhead

Real-world example:
Rebalance by changing directory entry:
Old: user_id 3M-5M → Shard 4
New: user_id 3M-4M → Shard 4
New: user_id 4M-5M → Shard 5 (new shard)

Only data in 4M-5M range needs to move (25% instead of all)
```

### Handling Cross-Shard Operations

```
Problem: Need to read/write across multiple shards

Example: "Get all posts from users I follow"
├─ Get user's followers (might be in different shards)
├─ For each follower, get their posts (more shards)
└─ Merge results

Solution 1: Denormalization
├─ Store follower posts with user
├─ Single shard read
├─ Trade: storage increase + write complexity

Solution 2: Fan-out query
├─ Query all shards in parallel
├─ Merge results in application

Solution 3: Aggregate microservice
├─ Dedicated service for cross-shard queries
├─ Maintains materialized view
├─ Eventual consistency

Solution 4: Avoid cross-shard
├─ Design schema/queries to avoid need
├─ Store denormalized data
├─ Accept some redundancy
```

### Hotspot Problem

```
Definition: Some shards get more traffic than others

Example:
Shard: user_id % 10 = shard_id

Celebrity user_id = 1000000001
hash(1000000001) % 10 = 1 → Shard 1

1B followers all request updates from this user
All requests go to Shard 1 → overloaded

Solutions:

1. Split hot key (replicate)
   ├─ Replicate hot key to multiple shards
   ├─ user:1000000001:v1 → Shard 1
   ├─ user:1000000001:v2 → Shard 2
   ├─ Read: randomly pick v1 or v2
   ├─ Write: update all versions
   └─ Trade: write load increases

2. Cache
   ├─ Cache celebrity data aggressively
   ├─ Most reads served from cache
   ├─ Shard only handles cache misses
   └─ Trade: stale data possible

3. Separate shard for hot data
   ├─ Move hot keys to dedicated high-capacity shard
   ├─ Regular shards handle cold data
   └─ Trade: operational complexity

4. Distribute hot key differently
   ├─ Don't shard by user_id for celebrity accounts
   ├─ Handle in application tier
   └─ Trade: application complexity
```

---

## Fault Tolerance and Failover

### Redundancy

```
Definition: Duplicate critical components so failure doesn't break system

Architecture without redundancy:
┌──────────────────┐
│ Single Database  │
└────────┬─────────┘
         │
      Dies! No backup!
         │
      CRASH
     (Data loss?)

Architecture with redundancy:
┌────────────────────────────┐
│Primary Database            │
└────────┬───────────────────┘
         │
         ├─ Active replication (master-master)
         │
         ▼
┌────────────────────────────┐
│Secondary Database          │
│(Replica)                   │
└────────────────────────────┘

If primary fails:
├─ Secondary takes over (failover)
├─ Client traffic redirected
└─ System continues (downtime: seconds)

Redundancy levels:
1. Single server
   ├─ Availability: 99% (35 hours downtime/year)
   └─ Unacceptable for production

2. Master + 1 Replica
   ├─ Availability: 99.9% (8.7 hours downtime/year)
   └─ Can tolerate: one server failure

3. Master + 3 Replicas
   ├─ Availability: 99.99% (52 minutes downtime/year)
   └─ Can tolerate: up to 3 failures if staggered

4. Master + 5 Replicas + Geographic distribution
   ├─ Availability: 99.999% (5 minutes downtime/year)
   └─ Can tolerate: multiple simultaneous failures + regional outages

Redundancy placement:
├─ Across different servers
├─ Across different racks
├─ Across different datacenters
├─ Across different geographic regions
└─ Across different cloud providers (expensive, but ultimate redundancy)
```

### Failover: Active-Passive

```
Setup:
┌──────────────────────────┐    ┌──────────────────────────┐
│ Primary (Active)         │    │Secondary (Passive)       │
│ ┌────────────────────┐   │    │ ┌────────────────────┐   │
│ │ Accepts all traffic│   │    │ │ Idle, synchronized│   │
│ │ Heartbeat: ✓      │   │    │ │ by replication     │   │
│ └────────────────────┘   │    │ └────────────────────┘   │
└──────────────────────────┘    └──────────────────────────┘
         ▲                                  │
         │ Heartbeat (every 100ms)         │
         └──────────────────────────────────┘

Failover Process:
t=0:  Primary sends heartbeat "I'm alive"
      Secondary receives: Primary OK

t=1:  Primary crashes (network issue)
      Secondary doesn't receive heartbeat

t=5:  Secondary times out (no heartbeat for 5 seconds)
      Secondary detects failure

t=6:  Secondary takes VIP (virtual IP)
      └─ Assumes identity of primary
      └─ Client connections redirect to secondary

t=7:  Secondary is now active
      └─ Accepts writes, serves reads

Problems:
1. Split-brain: if network partition
   ├─ Primary thinks secondary dead
   ├─ Secondary thinks primary dead
   ├─ Both become "active"
   └─ Conflicting writes!

2. False positives
   ├─ Network slow (not dead)
   ├─ Secondary assumes primary failed
   ├─ Causes unnecessary failover
   └─ Costs: consistency issues, client disruption

3. Data loss
   ├─ Primary crash before replicating recent writes
   ├─ Secondary becomes primary
   ├─ Lost writes never recovered
```

### Failover: Active-Active

```
Setup:
┌──────────────────────────┐    ┌──────────────────────────┐
│ Server A (Active)        │    │ Server B (Active)        │
│ ┌────────────────────┐   │    │ ┌────────────────────┐   │
│ │ Accepts traffic    │   │    │ │ Accepts traffic    │   │
│ │ Heartbeat: ✓      │   │    │ │ Heartbeat: ✓      │   │
│ └────────────────────┘   │    │ └────────────────────┘   │
└──────────────────────────┘    └──────────────────────────┘
         ▲                                  ▲
         │ Bi-directional replication      │
         └──────────────────────────────────┘

Pros:
├─ No idle server (efficient resource use)
├─ Faster failover (already active)
└─ Load distribution (spread traffic)

Cons:
├─ Complex (distributed consensus needed)
├─ Conflict resolution (both received writes)
└─ Higher operational overhead

Failover:
If Server A fails:
└─ Server B already active, continues serving
└─ No failover needed!
└─ Just remove A from pool
```

### Heartbeat Mechanism

```
Server A sends periodic heartbeat to Server B

Heartbeat message (every 1 second):
┌──────────────────────────┐
│ {                        │
│   "server_id": "A",      │
│   "timestamp": 1234567,  │
│   "healthy": true,       │
│   "seq_num": 5678        │
│ }                        │
└──────────────────────────┘

Server B processes:
├─ If received: update last_heartbeat_time
├─ If not received for 5 seconds: declare A dead
├─ If received: A is healthy

Challenges:

1. False positives (network glitch)
   ├─ Heartbeat lost due to network hiccup
   ├─ Server B declares A dead
   ├─ Causes failover (unnecessary)
   └─ Solution: Use quorum (3 servers, need 2 to declare dead)

2. Cascading failures
   ├─ If Server B heartbeats to Server C
   ├─ And network partitions C from B
   ├─ C might declare B dead
   ├─ B might declare A dead
   ├─ Both failovers trigger simultaneously
   └─ Solution: Use distributed consensus (Raft, Paxos)

3. Timeout tuning
   ├─ Too short: false positives (network jitter)
   ├─ Too long: slow detection (high downtime)
   └─ Typical: 3-5 seconds timeout, 1 second heartbeat interval

Best practices:
├─ Use exponential backoff for retries
├─ Monitor heartbeat metrics (loss rate, latency)
├─ Separate heartbeat from data path
├─ Use dedicated network interface for heartbeats
└─ Implement jitter (randomize heartbeat timing to avoid thundering herd)
```

---

## Recovery and Durability

### RPO (Recovery Point Objective)

```
Definition: Maximum data loss you can tolerate (measured in time)

Examples:
RPO = 1 hour
└─ Can lose up to 1 hour of data
└─ If system fails at 10:30, recover data from 09:30

RPO = 1 minute
└─ Can lose up to 1 minute of data
└─ Requires frequent backups (every minute)
└─ More expensive infrastructure

RPO = 0 (zero)
└─ Cannot lose any data
└─ Requires synchronous replication to multiple sites
└─ Very expensive

Achieving different RPOs:
RPO = 24 hours: Nightly backups
RPO = 1 hour: Hourly backups
RPO = 1 minute: Continuous replication (or snapshots every minute)
RPO = 0: Synchronous replication to 2+ sites

Cost vs RPO:
RPO = 24h: 1x cost (bare minimum)
RPO = 1h: 3x cost (more infrastructure)
RPO = 5min: 5x cost (continuous replication)
RPO = 0: 10x cost (synchronous replication, multiple sites)
```

### RTO (Recovery Time Objective)

```
Definition: Maximum downtime you can tolerate (time to recover)

Examples:
RTO = 4 hours
└─ Acceptable downtime: 4 hours
└─ After failure, can take up to 4 hours to restore service
└─ Acceptable for: analytics, batch systems

RTO = 15 minutes
└─ Unacceptable downtime: 15 minutes
└─ After failure, restore service in < 15 minutes
└─ Acceptable for: web services, critical apps

RTO = 0 (zero)
└─ Zero downtime
└─ Instant failover
└─ Requires: hot standby + redundancy
└─ Very expensive

Achieving different RTOs:
RTO = 4 hours: Manual recovery (run restore scripts)
RTO = 1 hour: Automated recovery + alerts
RTO = 5 minutes: Hot standby + quick failover
RTO = 0: Redundant active-active + instant failover

Typical costs:
RTO = 4h: Cheap (no redundancy)
RTO = 1h: Medium (single backup)
RTO = 5min: Expensive (hot standby)
RTO = 0: Very expensive (multiple active nodes)
```

### Checkpointing and Recovery

```
Definition: Periodically save system state to recover from failures

Naive approach (no checkpointing):
Process starts
├─ Read 1M items from database
├─ Process each item (takes 1 hour)
├─ Crashes at item 500K (halfway through!)
└─ Must restart from beginning → waste 30 minutes

With checkpointing:
Process starts
├─ Read batch of 10K items
├─ Process items
├─ Save checkpoint: "processed items 1-10K" to durable storage
├─ Repeat
├─ Crashes after processing 500K items
└─ Restart: read checkpoint → resume from item 500K+1

Checkpoint design:

Checkpoint format:
{
  "process_id": "batch-processor-1",
  "last_item_id": 500000,
  "last_update_time": "2024-01-15T10:30:00Z",
  "processing_state": {...}
}

Frequency trade-off:
├─ Checkpoint every 10K items: fast recovery, overhead on writes
├─ Checkpoint every 100K items: slower recovery, less overhead
└─ Typical: checkpoint interval = 1-5% of total time

Implementation:
def process_items(items):
    checkpoint = load_checkpoint()
    start_index = checkpoint.last_item_id + 1

    for i in range(start_index, len(items)):
        process(items[i])
        if i % 10000 == 0:
            save_checkpoint(i)  // Every 10K items

Durability:
Checkpoint MUST be on durable storage:
├─ Database
├─ Distributed file system (HDFS)
├─ Blob storage (S3)
└─ NOT in-memory (lost on crash!)
```

### Write-Ahead Logging (WAL)

```
Definition: Log all writes to durable storage BEFORE applying to database

Problem (without WAL):
┌─────────────────┐
│ Application     │
└────────┬────────┘
         │ "UPDATE user SET name=Alice WHERE id=1"
         │
         ▼
┌─────────────────┐
│ Database        │
│ Updates memory  │
│ (t=0ms)         │
│                 │
│ Flushes to disk │
│ (t=100ms)       │
│                 │
│ CRASH at t=50ms │◄─ Updated memory, but not disk!
└─────────────────┘
         │
    Restart
         │
    ▼ Memory lost! Update lost!

Solution (WAL):
Application writes to database:

1. Write to log (durable, sequential, fast)
   └─ Log: "UPDATE user SET name=Alice WHERE id=1"
   └─ Flush to disk (t=10ms)

2. Write to in-memory database (fast)
   └─ Update memory (t=20ms)

3. Return to application
   └─ Client: operation succeeded (t=30ms)

4. Async: Flush to disk
   └─ Write actual data to disk (background)

Crash scenario:
┌─────────────────────┐
│ Application         │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Log (WAL)           │
│ Write: "..."        │◄─ Always durable
│ Durability: ✓       │
└─────────────────────┘
          │
          ▼
┌─────────────────────┐
│ Database Memory     │
│ Updated            │
└─────────────────────┘
          │
       CRASH!
          │
          ▼
      Recovery:
      1. Read log
      2. Replay all operations
      3. Restore to consistent state

Pros:
├─ Data durability (write persists before ACK)
├─ Fast (log is sequential)
└─ Simple recovery (replay log)

Cons:
├─ Disk I/O for every write (unless batched)
├─ Log disk can become bottleneck
└─ Requires log cleanup (remove old entries)

Best practices:
├─ Batch writes: accumulate writes, flush once
├─ Use SSD (fast sequential writes)
├─ Separate log disk from data disk (parallel I/O)
└─ Implement log rotation (archive old logs, reclaim space)
```

---

## Distributed Consensus

### Why Consensus Matters

```
Problem: Multiple servers must agree on value

Scenario: Two master databases, both receive writes
├─ Master A: "balance = 100"
├─ Master B: "balance = 150"
├─ Which is correct? Need consensus!

Without consensus: data corruption, financial loss, chaos

With consensus: all servers agree on one truth
```

### Paxos (High Level)

```
Simplified explanation (real Paxos very complex):

Problem: 3 servers, each gets different value
Server A: "balance = 100"
Server B: "balance = 150"
Server C: "balance = 120"

Paxos stages:

Stage 1 (Prepare):
├─ Proposer announces: "I propose value 100"
├─ Acceptors promise: "We won't accept lower proposals"
└─ Guarantees: no earlier proposal takes precedence

Stage 2 (Accept):
├─ Proposer sends: "Accept value 100"
├─ Acceptors accept if they didn't promise higher
├─ Once majority accepts → value is committed
└─ Guarantees: no contradiction

Result:
├─ All servers learn committed value
├─ Consensus reached!

Pros:
├─ Provably safe (never violates safety)
└─ Works with network partitions

Cons:
├─ Very complex (hundreds of edge cases)
├─ Slow (multiple rounds of messages)
├─ Hard to implement correctly
└─ Even Lamport (inventor) said "Paxos is not intuitive"
```

### Raft (More Intuitive)

```
Raft consensus algorithm (simpler than Paxos)

Key idea: Leader election + log replication

Servers have states:
├─ Leader (one per term): receives requests, replicates log
├─ Follower: follows leader
└─ Candidate: candidate for leader

Leader election:
1. Start: all followers
2. Follower times out (no heartbeat)
3. Becomes candidate, increments term
4. Requests votes from other servers
5. If gets majority votes: becomes leader
6. Sends heartbeats to all followers

Log replication:
┌─────────┐
│ Leader  │ (has all logs)
└────┬────┘
     │
     ├─ Send log entries to Follower A
     ├─ Send log entries to Follower B
     └─ Send log entries to Follower C

Followers append to log, reply with ACK
Once majority ACKs → commit entry

Safety guarantees:
├─ Only one leader per term
├─ Logs replica on majority before commit
├─ If leader crashes, state recovers from logs
└─ Never loses committed entries

Typical Raft deployment:
├─ 3 servers (can tolerate 1 failure)
├─ 5 servers (can tolerate 2 failures)
├─ 7 servers (can tolerate 3 failures)

Used in production:
├─ etcd (Kubernetes configuration)
├─ Consul (service discovery)
├─ CockroachDB (database)
└─ Many others
```

---

## Key Takeaways

1. **Scale horizontally** when possible (more servers, not bigger servers)
2. **Redundancy is essential** - single server = guaranteed failure
3. **Replication strategy matters** (sync vs async, master-slave vs master-master)
4. **Failover needs testing** - most outages from failover bugs
5. **Consensus is hard** - use proven libraries (Raft, not home-grown)
6. **RPO and RTO** drive infrastructure costs
7. **Checkpointing and logging** enable recovery
