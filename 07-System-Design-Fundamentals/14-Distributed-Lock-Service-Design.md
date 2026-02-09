# Design a Distributed Lock Service

> **The Interview Question:**
> "Design a distributed locking mechanism that works across multiple servers. How do you prevent two processes from modifying the same resource simultaneously in a distributed system? How do you handle node failures, network partitions, and split-brain scenarios?"

This is the question that tests whether you TRULY understand distributed systems — not just how to use Redis, but why naive approaches fail in subtle, dangerous ways.

---

## Table of Contents

1. [Why Distributed Locks Are Hard](#1-why-distributed-locks-are-hard)
2. [Single-Node Redis Lock — The Starting Point](#2-single-node-redis-lock)
3. [Why Single-Node Lock Fails — And the GC Pause Problem](#3-why-single-node-lock-fails)
4. [Fencing Tokens — The Fix Most People Don't Know](#4-fencing-tokens)
5. [The Redlock Algorithm — Multi-Node Distributed Lock](#5-the-redlock-algorithm)
6. [Martin Kleppmann's Critique of Redlock](#6-martin-kleppmanns-critique-of-redlock)
7. [ZooKeeper-Based Locks — The Consensus Approach](#7-zookeeper-based-locks)
8. [Leader Election](#8-leader-election)
9. [Split-Brain Problem](#9-split-brain-problem)
10. [Comparison: Redis vs ZooKeeper vs etcd](#10-comparison-redis-vs-zookeeper-vs-etcd)
11. [Production Java Implementation](#11-production-java-implementation)
12. [When Do You Actually Need Distributed Locks?](#12-when-do-you-actually-need-distributed-locks)
13. [Senior vs Mid-Level Comparison](#13-senior-vs-mid-level-comparison)
14. [Interview Follow-Up Questions](#14-interview-follow-up-questions)

---

## 1. Why Distributed Locks Are Hard

### Locks on a single machine are simple:

```java
// Single JVM — works perfectly
synchronized (resource) {
    // Only one thread enters here at a time
    modifyResource();
}
```

### But in distributed systems, everything breaks:

```
Server A                              Server B
────────                              ────────
Lock("order-123") ✓ acquired          Lock("order-123") ???
modify order                          modify order
Unlock()                              Unlock()

Problems:
1. Who is the authority? There's no shared memory.
2. What if Server A crashes while holding the lock? Lock held forever.
3. What if the network partitions? Both think they have the lock.
4. What if Server A's GC pauses for 30 seconds? Lock expires,
   Server B acquires it, Server A wakes up and STILL thinks it has the lock.
   → BOTH modify the resource simultaneously. Data corruption.
```

**The fundamental problem:** In a distributed system, you cannot distinguish between "the other node crashed" and "the network is slow." And clocks across machines drift.

---

## 2. Single-Node Redis Lock

### The Basic Approach

```java
// Acquire lock
SET resource_name my_random_value NX EX 30
// NX = only set if not exists (mutual exclusion)
// EX 30 = expires in 30 seconds (prevents deadlock if holder crashes)
// my_random_value = unique per client (prevents releasing someone else's lock)

// Release lock (ONLY if we still own it)
// Must be atomic — use Lua script
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end
```

### Java Implementation

```java
@Service
public class SimpleRedisLock {

    @Autowired private StringRedisTemplate redis;

    private static final String UNLOCK_SCRIPT = """
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        else
            return 0
        end
    """;

    /**
     * Acquire a distributed lock.
     *
     * @param lockKey    The resource to lock (e.g., "order:123")
     * @param requestId  Unique ID for this lock holder (UUID)
     * @param ttlSeconds Lock auto-expires after this time
     * @return true if lock acquired, false if already held by someone else
     */
    public boolean tryLock(String lockKey, String requestId, long ttlSeconds) {
        Boolean acquired = redis.opsForValue().setIfAbsent(
            "lock:" + lockKey,
            requestId,
            Duration.ofSeconds(ttlSeconds)
        );
        return Boolean.TRUE.equals(acquired);
    }

    /**
     * Release the lock — ONLY if we still own it.
     * Uses Lua script for atomic check-and-delete.
     */
    public boolean unlock(String lockKey, String requestId) {
        DefaultRedisScript<Long> script = new DefaultRedisScript<>(UNLOCK_SCRIPT, Long.class);
        Long result = redis.execute(script,
            List.of("lock:" + lockKey),
            requestId);
        return result != null && result == 1;
    }
}
```

### Usage

```java
String lockKey = "payment:order-456";
String requestId = UUID.randomUUID().toString();

if (redisLock.tryLock(lockKey, requestId, 30)) {
    try {
        // Critical section — only one server executes this
        processPayment("order-456");
    } finally {
        redisLock.unlock(lockKey, requestId);
    }
} else {
    // Lock held by another server — retry or fail
    throw new ResourceBusyException("Payment is being processed by another node");
}
```

### Why the Random Value Matters

```
Without random value:
  Server A: SET lock:order-123 "locked" EX 30      → acquired
  Server A: (slow processing... 35 seconds pass)
  Lock expires automatically after 30s
  Server B: SET lock:order-123 "locked" EX 30      → acquired
  Server A: DEL lock:order-123                      → DELETES SERVER B's LOCK!
  Server C: SET lock:order-123 "locked" EX 30      → acquired
  → Server B and C both think they have the lock. DATA CORRUPTION.

With random value:
  Server A: SET lock:order-123 "uuid-aaa" EX 30    → acquired
  Lock expires after 30s
  Server B: SET lock:order-123 "uuid-bbb" EX 30    → acquired
  Server A: GET lock:order-123 → "uuid-bbb" ≠ "uuid-aaa" → DON'T DELETE
  → Server A knows it lost the lock. Safe.
```

---

## 3. Why Single-Node Lock Fails

### Problem 1: Redis Failover

```
Time T1: Client A acquires lock on Redis master
Time T2: Redis master crashes BEFORE replicating to slave
Time T3: Redis slave promoted to master (doesn't have the lock)
Time T4: Client B acquires the "same" lock on new master
→ Both Client A and Client B hold the lock. UNSAFE.
```

This is a fundamental problem with single-node or master-slave Redis locks. Replication is asynchronous — the lock can be lost during failover.

### Problem 2: The GC Pause (Process Pause) Problem

This is the subtle one that catches senior engineers off guard:

```
                    ┌─── GC PAUSE ──────────────────────┐
                    │                                    │
Time ──────────────►│                                    │──────────►
                    │                                    │
T1: Client A        │  T2: Lock expires                  │  T4: Client A
    acquires lock   │      (TTL=30s)                     │  wakes up,
    (30s TTL)       │                                    │  thinks it
                    │  T3: Client B                      │  still has lock!
                    │      acquires lock                 │
                    │      modifies resource              │  T5: Client A
                    │                                    │  modifies resource
                    └────────────────────────────────────┘  → BOTH modified!

Client A's GC pause was 40 seconds.
The lock expired at 30 seconds.
Client A doesn't KNOW the lock expired — it never checked after the pause.
```

**This isn't theoretical.** Java GC pauses of 30+ seconds happen in production with large heaps and full GC events.

---

## 4. Fencing Tokens

### The Fix: Monotonically Increasing Tokens

Instead of just locking, the lock service returns a **fencing token** — a number that increases every time a lock is granted. The protected resource REJECTS any request with a token older than the last one it saw.

```
T1: Client A acquires lock → fencing token = 33
T2: Client A pauses (GC)
T3: Lock expires, Client B acquires lock → fencing token = 34
T4: Client B writes to storage with token 34 → accepted
T5: Client A wakes up, writes to storage with token 33
    → Storage says: "I've seen token 34, rejecting token 33" → REJECTED!
    → Data is SAFE.
```

```
┌──────────┐         ┌──────────────┐         ┌──────────┐
│ Client A │         │  Lock Service │         │ Storage  │
└────┬─────┘         └──────┬───────┘         └────┬─────┘
     │  acquire lock         │                      │
     │──────────────────────►│                      │
     │  token = 33           │                      │
     │◄──────────────────────│                      │
     │                       │                      │
     │  ~~~ GC PAUSE ~~~     │                      │
     │                       │                      │
     │         Client B acquires lock               │
     │                  token = 34                   │
     │                       │                      │
     │               Client B writes (token=34)     │
     │                       │─────────────────────►│
     │                       │         max_token=34 │
     │                       │◄─────────────────────│
     │                       │                      │
     │  ~~~ GC PAUSE ENDS ~~ │                      │
     │                       │                      │
     │  write (token=33)     │                      │
     │──────────────────────────────────────────────►│
     │  REJECTED: 33 < 34    │                      │
     │◄─────────────────────────────────────────────│
```

### Java Implementation with Fencing

```java
@Service
public class FencedLockService {

    @Autowired private StringRedisTemplate redis;

    // Atomic Lua script: acquire lock AND get fencing token
    private static final String ACQUIRE_SCRIPT = """
        local lockKey = KEYS[1]
        local tokenKey = KEYS[2]
        local requestId = ARGV[1]
        local ttl = tonumber(ARGV[2])

        -- Try to acquire lock
        local acquired = redis.call('SET', lockKey, requestId, 'NX', 'EX', ttl)
        if acquired then
            -- Increment global fencing token counter
            local token = redis.call('INCR', tokenKey)
            -- Store token with the lock
            redis.call('SET', lockKey .. ':token', token, 'EX', ttl)
            return token
        else
            return -1
        end
    """;

    /**
     * Acquire lock with fencing token.
     * Returns the fencing token (>0) if acquired, -1 if lock is held.
     */
    public long tryLockWithFencing(String resource, String requestId, long ttlSeconds) {
        DefaultRedisScript<Long> script = new DefaultRedisScript<>(ACQUIRE_SCRIPT, Long.class);

        Long token = redis.execute(script,
            List.of("lock:" + resource, "fence:" + resource),
            requestId,
            String.valueOf(ttlSeconds));

        return token != null ? token : -1;
    }
}

// The STORAGE side must validate fencing tokens
@Service
public class FencedStorageService {

    @Autowired private JdbcTemplate jdbc;

    /**
     * Write to storage ONLY if the fencing token is the latest.
     * Rejects stale writes from clients with expired locks.
     */
    @Transactional
    public boolean writeWithFencing(String resourceId, String data, long fencingToken) {

        // Atomic: update only if our token >= the stored token
        int updated = jdbc.update("""
            UPDATE resources
            SET data = ?,
                last_fencing_token = ?,
                updated_at = NOW()
            WHERE id = ?
              AND last_fencing_token < ?
        """, data, fencingToken, resourceId, fencingToken);

        if (updated == 0) {
            log.warn("Stale write rejected. resource={}, token={}", resourceId, fencingToken);
            return false;  // A newer token already wrote — our lock was expired
        }

        return true;
    }
}
```

### Usage with Fencing

```java
String requestId = UUID.randomUUID().toString();
long token = fencedLockService.tryLockWithFencing("order:456", requestId, 30);

if (token > 0) {
    try {
        String result = processOrder("order:456");

        // Write with fencing — storage rejects if our lock expired
        boolean written = fencedStorage.writeWithFencing("order:456", result, token);

        if (!written) {
            log.warn("Our lock expired during processing. Another client may have taken over.");
            // Don't panic — the storage is consistent. We just lost the race.
        }
    } finally {
        fencedLockService.unlock("order:456", requestId);
    }
}
```

**Interview key point:** "Fencing tokens push the correctness guarantee to the storage layer. Even if the lock service has bugs or the client has a GC pause, the storage will never accept a stale write. This is defense in depth."

---

## 5. The Redlock Algorithm

### The Problem Redlock Solves

Single Redis node = single point of failure. If Redis crashes, all locks are lost.

### The Algorithm (by Salvatore Sanfilippo, creator of Redis)

**Setup:** N independent Redis master nodes (no replication). Typically N=5.

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Redis #1 │  │ Redis #2 │  │ Redis #3 │  │ Redis #4 │  │ Redis #5 │
│ (master) │  │ (master) │  │ (master) │  │ (master) │  │ (master) │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
      │              │             │             │             │
      └──────────────┼─────────────┼─────────────┼─────────────┘
                     │             │             │
                 ┌───▼─────────────▼─────────────▼───┐
                 │         Lock Client                │
                 │   "Try to acquire lock on          │
                 │    majority (3 of 5) nodes"        │
                 └───────────────────────────────────┘
```

**Steps:**

```
1. Get current time in milliseconds (T1)

2. Try to acquire lock on ALL N Redis instances sequentially
   - Use SET NX EX with same key, same random value, same TTL
   - Each attempt has a SHORT timeout (5-50ms)
     (don't wait long if one node is down)

3. Calculate elapsed time: elapsed = now() - T1

4. Lock is acquired IF AND ONLY IF:
   a. Lock was acquired on MAJORITY of nodes (>= N/2 + 1 = 3 of 5)
   b. Total elapsed time < lock TTL
      (if it took 29 seconds to acquire a 30-second lock,
       you effectively have 1 second — not useful)

5. If lock acquired:
   - Effective TTL = original TTL - elapsed time
   - Use this shorter TTL for your critical section

6. If lock NOT acquired:
   - Release the lock on ALL nodes (even ones where you succeeded)
   - Wait a random delay, then retry
```

### Java Implementation

```java
@Service
public class RedlockService {

    private final List<StringRedisTemplate> redisNodes;  // 5 independent Redis instances

    private static final int QUORUM;
    private static final int LOCK_TTL_MS = 30_000;
    private static final int SINGLE_NODE_TIMEOUT_MS = 50;
    private static final int RETRY_DELAY_MS = 200;
    private static final int MAX_RETRIES = 3;

    private static final String UNLOCK_SCRIPT = """
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        else
            return 0
        end
    """;

    public RedlockService(List<StringRedisTemplate> redisNodes) {
        this.redisNodes = redisNodes;
        QUORUM = (redisNodes.size() / 2) + 1;  // Majority: 3 of 5
    }

    /**
     * Acquire a distributed lock using the Redlock algorithm.
     * Tries to lock on majority of Redis nodes.
     */
    public Optional<RedlockHandle> tryLock(String resource, long ttlMs) {
        String requestId = UUID.randomUUID().toString();
        String lockKey = "lock:" + resource;

        for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
            long startTime = System.currentTimeMillis();
            int acquiredCount = 0;

            // Step 1: Try to acquire on all N nodes
            for (StringRedisTemplate node : redisNodes) {
                if (tryLockOnNode(node, lockKey, requestId, ttlMs)) {
                    acquiredCount++;
                }
            }

            // Step 2: Calculate elapsed time
            long elapsed = System.currentTimeMillis() - startTime;
            long effectiveTtl = ttlMs - elapsed;

            // Step 3: Check if we got majority AND still have time left
            if (acquiredCount >= QUORUM && effectiveTtl > 0) {
                return Optional.of(new RedlockHandle(
                    resource, requestId, effectiveTtl, acquiredCount));
            }

            // Step 4: Failed — release lock on ALL nodes
            unlockAll(lockKey, requestId);

            // Step 5: Random delay before retry (prevent thundering herd)
            try {
                Thread.sleep(RETRY_DELAY_MS + ThreadLocalRandom.current().nextInt(100));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return Optional.empty();
            }
        }

        return Optional.empty();  // Failed after all retries
    }

    /**
     * Release the lock on ALL Redis nodes.
     */
    public void unlock(RedlockHandle handle) {
        unlockAll("lock:" + handle.getResource(), handle.getRequestId());
    }

    private boolean tryLockOnNode(StringRedisTemplate node, String key,
                                   String value, long ttlMs) {
        try {
            Boolean result = node.opsForValue().setIfAbsent(
                key, value, Duration.ofMillis(ttlMs));
            return Boolean.TRUE.equals(result);
        } catch (Exception e) {
            // Node is down — that's OK, we just need majority
            return false;
        }
    }

    private void unlockAll(String key, String requestId) {
        DefaultRedisScript<Long> script = new DefaultRedisScript<>(UNLOCK_SCRIPT, Long.class);
        for (StringRedisTemplate node : redisNodes) {
            try {
                node.execute(script, List.of(key), requestId);
            } catch (Exception e) {
                // Best effort — node might be down
            }
        }
    }
}

// The lock handle — returned to the client
@Data
@AllArgsConstructor
public class RedlockHandle {
    private String resource;
    private String requestId;
    private long effectiveTtlMs;
    private int nodesAcquired;
}
```

### Usage

```java
Optional<RedlockHandle> lock = redlockService.tryLock("order:789", 30_000);

if (lock.isPresent()) {
    try {
        log.info("Lock acquired on {}/{} nodes, effective TTL: {}ms",
            lock.get().getNodesAcquired(), 5, lock.get().getEffectiveTtlMs());

        processOrder("order:789");
    } finally {
        redlockService.unlock(lock.get());
    }
} else {
    log.warn("Could not acquire lock on order:789");
}
```

### Why Majority Matters

```
5 Redis nodes. Client acquires lock on 3.

Scenario: 2 nodes crash after lock acquired
  - Lock still valid (held on 3, need 3 for quorum)
  - Other clients can only get 2 nodes (crashed ones have the lock)
  - 2 < quorum (3) → can't acquire → mutual exclusion preserved ✓

Scenario: Client A has 3, Client B tries
  - Client B tries all 5
  - At best, gets the 2 nodes A doesn't have
  - 2 < quorum (3) → can't acquire ✓

Scenario: Network partition splits [1,2] | [3,4,5]
  - Side [1,2]: can't get quorum (need 3) → no lock granted
  - Side [3,4,5]: can get quorum → lock works
  - Only ONE side can have the lock ✓
```

---

## 6. Martin Kleppmann's Critique of Redlock

This is the MOST important part for senior-level interviews. Knowing the Redlock controversy shows deep understanding.

### Kleppmann's Argument (2016)

Martin Kleppmann (author of "Designing Data-Intensive Applications") argued that Redlock is fundamentally flawed:

**Problem 1: Clock jumps**
```
Redlock relies on time-based TTL across 5 independent nodes.
If one node's clock jumps forward (NTP correction, leap second, VM migration),
locks on that node expire prematurely.

Example:
  T0: Lock acquired on nodes 1, 2, 3 (TTL = 30s)
  T1: Node 3's clock jumps forward 30 seconds
  T2: Lock on node 3 expires prematurely
  T3: Another client acquires lock on nodes 3, 4, 5
  → TWO clients hold the lock simultaneously!
```

**Problem 2: Process pauses (same GC problem)**
```
Even with Redlock, if Client A pauses for longer than the TTL,
it will wake up thinking it has the lock — but it expired.
Redlock doesn't solve this.
```

**Kleppmann's conclusion:** For **efficiency** (avoiding duplicate work), a single Redis lock with TTL is fine. For **correctness** (preventing data corruption), you need either:
1. Fencing tokens (any lock service + fenced storage)
2. Consensus-based lock (ZooKeeper / etcd with sessions)

### Antirez's (Redis creator) Rebuttal

Salvatore Sanfilippo responded:
- Clock jumps can be mitigated with `fsync` and by not using NTP step adjustments
- In practice, clock monotonicity is maintained well enough on modern systems
- The algorithm is correct under reasonable assumptions about time

### Interview Answer

> "I'm aware of the Kleppmann vs. Antirez debate on Redlock. Kleppmann argues that Redlock is unsafe because it relies on synchronized clocks and can fail during process pauses or clock jumps. Antirez counters that under practical assumptions, it works well. My position: for efficiency-based locks (preventing duplicate work where worst case is doing work twice), single-node Redis with TTL is fine. For safety-critical locks (preventing data corruption in financial systems), I'd use ZooKeeper or etcd for true consensus, combined with fencing tokens at the storage layer for defense in depth."

---

## 7. ZooKeeper-Based Locks — The Consensus Approach

### Why ZooKeeper Is Different

ZooKeeper uses the **ZAB protocol** (ZooKeeper Atomic Broadcast) — a consensus algorithm similar to Raft/Paxos. This means writes are replicated to a majority BEFORE being acknowledged. No data is lost on failover.

```
Redis (asynchronous replication):
  Client writes → Master acknowledges → Replicates to slave (later)
  → If master crashes before replication: DATA LOST

ZooKeeper (consensus-based):
  Client writes → Leader proposes → Majority of followers acknowledge → Client notified
  → If leader crashes: new leader has ALL acknowledged writes. NO DATA LOST.
```

### How ZooKeeper Locks Work

```
ZooKeeper ZNode tree:
/locks/
  /locks/order-789/
    /locks/order-789/lock-0000000001  ← Client A (ephemeral sequential)
    /locks/order-789/lock-0000000002  ← Client B (ephemeral sequential)
    /locks/order-789/lock-0000000003  ← Client C (ephemeral sequential)

Rule: The client with the LOWEST sequence number holds the lock.
Others watch the node just before them (not the lock holder — avoids herd effect).
```

**Lock acquisition:**
```
1. Client creates an EPHEMERAL SEQUENTIAL znode under /locks/order-789/
   → Gets /locks/order-789/lock-0000000042

2. Client lists all children of /locks/order-789/
   → [lock-0000000040, lock-0000000041, lock-0000000042]

3. Is mine the smallest? (lock-0000000042)
   → No, lock-0000000040 is smallest
   → Set a WATCH on lock-0000000041 (the one just before mine)
   → Wait...

4. When lock-0000000041 is deleted (its holder released or crashed):
   → Client gets notification
   → Check again: is mine now the smallest?
   → If yes → LOCK ACQUIRED
   → If no → watch the new predecessor
```

**Why ephemeral nodes?** If the client crashes, ZooKeeper automatically deletes the ephemeral node (session timeout). The lock is released. No TTL needed, no stuck locks.

**Why watch only the predecessor (not the lock holder)?** If 100 clients are waiting and the lock holder releases, ALL 100 would wake up (thundering herd). By watching only the predecessor, only ONE client wakes up — the next in line.

### Java Implementation with Apache Curator

```java
@Service
public class ZookeeperLockService {

    @Autowired private CuratorFramework curator;

    /**
     * Acquire a distributed lock using ZooKeeper.
     * This is SAFE for correctness — consensus-backed, session-based.
     */
    public <T> T executeWithLock(String resource, Duration timeout,
                                  Callable<T> criticalSection) throws Exception {

        InterProcessMutex lock = new InterProcessMutex(
            curator, "/locks/" + resource);

        if (lock.acquire(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
            try {
                return criticalSection.call();
            } finally {
                lock.release();
            }
        } else {
            throw new LockAcquisitionException(
                "Could not acquire lock on " + resource +
                " within " + timeout);
        }
    }

    /**
     * Read-write lock: multiple readers OR one writer.
     */
    public <T> T executeWithReadLock(String resource, Duration timeout,
                                      Callable<T> readOperation) throws Exception {

        InterProcessReadWriteLock rwLock = new InterProcessReadWriteLock(
            curator, "/locks/" + resource);

        InterProcessMutex readLock = rwLock.readLock();

        if (readLock.acquire(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
            try {
                return readOperation.call();
            } finally {
                readLock.release();
            }
        } else {
            throw new LockAcquisitionException("Could not acquire read lock");
        }
    }
}
```

### Usage

```java
// ZooKeeper lock — safe for correctness
BigDecimal balance = zookeeperLock.executeWithLock(
    "account:mohit-123",
    Duration.ofSeconds(10),
    () -> {
        Account account = accountRepo.findById("mohit-123").orElseThrow();
        account.setBalance(account.getBalance().subtract(amount));
        accountRepo.save(account);
        return account.getBalance();
    }
);
```

---

## 8. Leader Election

### The Problem

In a cluster of 5 instances of your payment service, you need exactly ONE to run the scheduled reconciliation job. If two run simultaneously, you get duplicate processing.

```
Instance 1: runReconciliation()  ← Should run
Instance 2: runReconciliation()  ← Should NOT run
Instance 3: runReconciliation()  ← Should NOT run
Instance 4: (crashed)
Instance 5: runReconciliation()  ← Should NOT run
```

### ZooKeeper Leader Election

```java
@Service
public class LeaderElectionService {

    private final LeaderSelector leaderSelector;
    private final AtomicBoolean isLeader = new AtomicBoolean(false);

    public LeaderElectionService(CuratorFramework curator) {
        this.leaderSelector = new LeaderSelector(
            curator,
            "/election/payment-reconciliation",
            new LeaderSelectorListenerAdapter() {

                @Override
                public void takeLeadership(CuratorFramework client) throws Exception {
                    log.info("This instance is now the LEADER for reconciliation");
                    isLeader.set(true);

                    try {
                        // Hold leadership until cancelled or session lost
                        // This method must NOT return while we want to be leader
                        while (!Thread.currentThread().isInterrupted()) {
                            Thread.sleep(1000);
                        }
                    } finally {
                        isLeader.set(false);
                        log.info("Lost leadership");
                    }
                }
            }
        );

        leaderSelector.autoRequeue();  // Re-join election if leadership lost
        leaderSelector.start();
    }

    public boolean isLeader() {
        return isLeader.get();
    }
}

// Only the leader runs scheduled tasks
@Service
public class ReconciliationScheduler {

    @Autowired private LeaderElectionService leaderElection;

    @Scheduled(fixedRate = 300_000)  // Every 5 minutes
    public void runReconciliation() {
        if (!leaderElection.isLeader()) {
            return;  // Not the leader — skip
        }

        log.info("Running reconciliation as leader...");
        reconciliationService.reconcile();
    }
}
```

### Leader Election Flow

```
Instance 1  ──► Creates /election/job/node-001 (ephemeral sequential)
Instance 2  ──► Creates /election/job/node-002 (ephemeral sequential)
Instance 3  ──► Creates /election/job/node-003 (ephemeral sequential)

Lowest sequence = Instance 1 → LEADER

If Instance 1 crashes:
  ZooKeeper deletes /election/job/node-001 (ephemeral)
  Instance 2 gets notified (was watching node-001)
  Instance 2 is now lowest → becomes new LEADER
  Total failover time: ~session timeout (typically 10-30 seconds)
```

---

## 9. Split-Brain Problem

### What Is Split-Brain?

```
Network partition splits your cluster:

Partition A: [Instance 1, Instance 2, ZK-1, ZK-2]
Partition B: [Instance 3, Instance 4, Instance 5, ZK-3, ZK-4, ZK-5]

If both sides elect a leader → TWO leaders → conflicting writes
This is the "split-brain" problem.
```

### How ZooKeeper Prevents Split-Brain

ZooKeeper requires a **majority quorum** for all operations:

```
5 ZK nodes → need 3 for quorum

Partition A: [ZK-1, ZK-2] → 2 nodes → NO QUORUM → can't write → can't elect leader
Partition B: [ZK-3, ZK-4, ZK-5] → 3 nodes → HAS QUORUM → can elect leader

Result: Only Partition B has a leader. Split-brain prevented.
```

### How Redis Does NOT Prevent Split-Brain

```
5 Redis master nodes (Redlock):

Partition A: [Redis-1, Redis-2]
Partition B: [Redis-3, Redis-4, Redis-5]

Client X (in Partition A): acquires lock on Redis-1, Redis-2 → 2/5 → NO QUORUM ✓
Client Y (in Partition B): acquires lock on Redis-3, Redis-4, Redis-5 → 3/5 → QUORUM ✓

This case is safe. But:

What if locks were acquired BEFORE the partition?
Client X acquired lock on Redis-1, Redis-3, Redis-4 → 3/5 → QUORUM ✓
Then partition happens: [Redis-1,2] | [Redis-3,4,5]
Locks on Redis-3, Redis-4 expire (TTL)
Client Y acquires lock on Redis-3, Redis-4, Redis-5 → 3/5 → QUORUM ✓
→ TWO clients hold the lock. SPLIT-BRAIN.

Redis Redlock depends on TTL timing. ZooKeeper doesn't.
```

### Preventing Split-Brain in Your Application

```java
@Service
public class SplitBrainProtection {

    @Autowired private CuratorFramework curator;

    /**
     * Before performing any critical operation, verify we can
     * still reach ZooKeeper (i.e., we're in the majority partition).
     */
    public boolean isInMajorityPartition() {
        try {
            // Try a lightweight ZK operation
            curator.checkExists().forPath("/health-check");
            return true;  // We can talk to ZK → we're in the majority partition
        } catch (Exception e) {
            log.warn("Cannot reach ZooKeeper — may be in minority partition");
            return false;
        }
    }

    /**
     * Wrap critical operations with split-brain check.
     */
    public <T> T executeIfSafe(Callable<T> operation) throws Exception {
        if (!isInMajorityPartition()) {
            throw new SplitBrainException(
                "This instance may be in a minority partition. " +
                "Refusing to execute critical operation.");
        }
        return operation.call();
    }
}
```

---

## 10. Comparison: Redis vs ZooKeeper vs etcd

| Feature | Redis (single) | Redlock (multi) | ZooKeeper | etcd |
|---------|---------------|-----------------|-----------|------|
| **Consensus** | None | Quorum (weak) | ZAB (strong) | Raft (strong) |
| **Replication** | Async | N/A (independent) | Synchronous | Synchronous |
| **Lock safety** | Best-effort | Debated | Strong | Strong |
| **Fencing support** | Manual | Manual | Session-based | Lease-based |
| **Auto-release on crash** | TTL-based | TTL-based | Ephemeral nodes | Lease expiry |
| **Latency** | <1ms | <10ms | ~2-10ms | ~2-10ms |
| **Throughput** | 100K ops/s | 20K ops/s | 10K ops/s | 10K ops/s |
| **Complexity** | Low | Medium | High | Medium |
| **Split-brain safe** | No | Partially | Yes | Yes |
| **Use case** | Efficiency locks | Moderate safety | Correctness locks | Correctness locks |

### When to Use What

```
"I don't want to send duplicate emails"
  → Redis single-node lock. If it fails, worst case = 2 emails. Acceptable.

"I don't want to process the same payment twice"
  → ZooKeeper or etcd lock + fencing tokens. Double-charge = lawsuit.

"I need leader election for a scheduled job"
  → ZooKeeper / etcd. Must have exactly one leader.

"I need to coordinate microservices during deployment"
  → etcd (used by Kubernetes). Well-suited for config + coordination.
```

---

## 11. Production Java Implementation

### A Complete Lock Service with Strategy Pattern

```java
// Interface — swap implementations without changing business code
public interface DistributedLock {
    Optional<LockHandle> tryLock(String resource, Duration timeout);
    void unlock(LockHandle handle);
}

@Data
public class LockHandle {
    private final String resource;
    private final String requestId;
    private final long fencingToken;
    private final Instant expiresAt;
}

// Redis implementation (for efficiency locks)
@Component("redisLock")
public class RedisDistributedLock implements DistributedLock {
    // ... (implementation from Section 2)
}

// ZooKeeper implementation (for correctness locks)
@Component("zkLock")
public class ZookeeperDistributedLock implements DistributedLock {
    // ... (implementation from Section 7)
}

// Usage — inject the right implementation based on context
@Service
public class PaymentProcessor {

    @Qualifier("zkLock")  // Correctness lock for payments
    @Autowired private DistributedLock lock;

    @Qualifier("redisLock")  // Efficiency lock for dedup
    @Autowired private DistributedLock dedupLock;

    public void processPayment(String orderId) {
        Optional<LockHandle> handle = lock.tryLock(
            "payment:" + orderId, Duration.ofSeconds(30));

        if (handle.isPresent()) {
            try {
                doProcessPayment(orderId, handle.get().getFencingToken());
            } finally {
                lock.unlock(handle.get());
            }
        }
    }
}
```

---

## 12. When Do You Actually Need Distributed Locks?

### Often You Don't — Alternatives

| Pattern | Instead of Lock | How It Works |
|---------|----------------|--------------|
| **Atomic DB operation** | `UPDATE ... WHERE balance >= amount` | Database handles concurrency |
| **Idempotency key** | Check-before-write with unique constraint | Prevents duplicate processing |
| **Optimistic locking** | `@Version` field + retry | No lock held during processing |
| **Queue-based serialization** | Kafka partition per resource | One consumer per partition = serial |
| **CAS operations** | Redis `WATCH + MULTI` or compare-and-swap | Lock-free concurrency |

### Decision Framework

```
"Do I need a distributed lock?"

Is it OK if the operation runs twice?
  ├── Yes → No lock needed. Use idempotency.
  └── No → Continue...

Can you use a database constraint/atomic operation?
  ├── Yes → Do that. Simpler, safer, no lock needed.
  └── No → Continue...

Can you serialize via a message queue?
  ├── Yes → Use Kafka with one partition per resource. No lock needed.
  └── No → You need a distributed lock. Continue...

Is it for efficiency (dedup, caching) or correctness (money, data integrity)?
  ├── Efficiency → Redis lock with TTL
  └── Correctness → ZooKeeper/etcd + fencing tokens
```

**Interview tip:** Starting with "Do we actually need a distributed lock?" shows maturity. Many candidates jump to Redlock when a simple DB constraint would suffice.

---

## 13. Senior vs Mid-Level Comparison

| Topic | Mid-Level | Senior |
|-------|-----------|--------|
| Lock mechanism | "Use Redis SETNX" | "Redis SETNX for efficiency, ZooKeeper for correctness. Always with TTL and random value for safe release." |
| Failure handling | "Set a TTL so locks expire" | "TTL handles crashes, but doesn't handle GC pauses. Fencing tokens at the storage layer are needed for true correctness." |
| Redlock | "Use 5 Redis nodes, get majority" | "I know the Kleppmann critique — Redlock depends on clock synchronization which can fail. For safety-critical systems, I'd prefer consensus-based locks." |
| Split-brain | "..." | "Quorum-based systems (ZK, etcd) prevent split-brain because the minority partition can't form a quorum. Redis Redlock partially mitigates but has timing-dependent edge cases." |
| Alternatives | "Use a lock" | "First question: do we need a lock at all? Atomic DB operations, idempotency keys, or queue-based serialization often eliminate the need for distributed locks entirely." |

---

## 14. Interview Follow-Up Questions

### "How would you implement a distributed read-write lock?"

"ZooKeeper supports this natively with shared (read) and exclusive (write) locks. Multiple readers can hold the lock simultaneously, but a writer needs exclusive access. With Redis, I'd use two keys: `lock:resource:writers` (exclusive) and `lock:resource:readers` (counter). Writers check both are free; readers only check writers is free then increment the reader count. But this gets complex with Redis — ZooKeeper's recipe is more reliable."

### "What happens if ZooKeeper itself goes down?"

"ZooKeeper is a 3- or 5-node cluster with quorum. If 1 of 3 nodes fails, the cluster still works. If 2 of 3 fail, the cluster becomes read-only (no new locks). Clients with existing locks keep them (session is still valid), but new lock acquisitions fail. The application should have a fallback — either fail gracefully or queue work for later."

### "How do you test distributed locks?"

```
1. Unit test: Lock/unlock with single client — verify mutual exclusion
2. Concurrency test: 100 threads competing for same lock — verify only 1 succeeds
3. Failure test: Kill lock holder mid-operation — verify lock eventually released
4. Partition test: Simulate network partition — verify no split-brain
5. Clock skew test: Advance one Redis node's clock — verify Redlock handles it
6. GC pause test: Thread.sleep(TTL + 10s) — verify fencing token rejects stale writes
```

### "How do you choose the TTL value?"

"The TTL needs to be longer than the critical section takes, plus a safety margin. If processing takes 5 seconds on average and 15 seconds at P99, I'd set TTL to 30 seconds. Too short: lock expires during processing, allowing concurrent access. Too long: if the holder crashes, the resource is blocked for the full TTL. For ZooKeeper, there's no TTL — ephemeral nodes are deleted on session close, which is more precise."

---

## One-Page Summary

```
┌─────────────────────────────────────────────────────────────┐
│              DISTRIBUTED LOCKS — THE FULL PICTURE            │
│                                                              │
│  Level 1: Do you even need a lock?                          │
│    → Try: atomic DB operations, idempotency, queue           │
│                                                              │
│  Level 2: Efficiency lock (duplicate work is OK)             │
│    → Redis SETNX + TTL + random value                        │
│    → Simple, fast (<1ms), good enough for most cases         │
│                                                              │
│  Level 3: Safety lock (data corruption is NOT OK)            │
│    → ZooKeeper / etcd (consensus-based)                      │
│    → Ephemeral nodes = auto-release on crash                 │
│    → No clock dependency, quorum prevents split-brain        │
│                                                              │
│  Level 4: Belt AND suspenders                                │
│    → Any lock service + FENCING TOKENS at storage layer      │
│    → Storage rejects stale writes even if lock is buggy      │
│    → This is the only way to be truly safe                   │
│                                                              │
│  The Kleppmann Argument:                                     │
│    "If you need correctness, use consensus + fencing.         │
│     If you need efficiency, a single Redis lock is fine."     │
└─────────────────────────────────────────────────────────────┘
```
