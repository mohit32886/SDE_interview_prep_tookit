# System Design: Distributed Rate Limiter

**Target Audience**: Mid-level Java engineers (5 YOE) interviewing at FAANG
**Prerequisites**: Basic understanding of distributed systems, Redis, Spring Boot
**Estimated Read Time**: 60-90 minutes

---

## Table of Contents

1. [Problem Statement & Requirements](#1-problem-statement--requirements)
2. [Rate Limiting Algorithms](#2-rate-limiting-algorithms)
3. [Distributed Rate Limiting](#3-distributed-rate-limiting)
4. [Multi-Level Rate Limiting](#4-multi-level-rate-limiting)
5. [Production Concerns](#5-production-concerns)
6. [Complete Spring Boot Implementation](#6-complete-spring-boot-implementation)
7. [Interview Follow-ups & Discussion](#7-interview-follow-ups--discussion)

---

## 1. Problem Statement & Requirements

### Why Rate Limiting Matters

Rate limiting is a cornerstone of API design and infrastructure protection. Here's why it's critical:

#### 1. **DDoS Protection**
A single attacker sending 1000 requests/second can take down your service. Rate limiting immediately rejects requests beyond a threshold.

#### 2. **Fair Usage & Resource Protection**
Without limits, one misbehaving client can monopolize resources (database connections, CPU, memory), starving legitimate users.

#### 3. **Cost Control**
For cloud services, uncontrolled usage = massive bills. Rate limiting keeps costs predictable.

#### 4. **API Monetization**
Different tiers (free: 100 req/min, premium: 1000 req/min) enable business models.

#### 5. **Service Degradation Prevention**
Graceful rejection at the API layer is far better than cascading failures deep in your system.

### Functional Requirements

```
┌─────────────────────────────────────────────────────────────┐
│           Functional Requirements                           │
├─────────────────────────────────────────────────────────────┤
│ 1. Support multiple limiting keys:                          │
│    - User ID (authenticated users)                          │
│    - IP address (unauthenticated)                           │
│    - API key (service-to-service)                           │
│                                                             │
│ 2. Configurable rules without code redeployment:           │
│    - Limit: 100 requests per minute                         │
│    - Limit: 1000 requests per hour                          │
│    - Different limits per user tier                         │
│                                                             │
│ 3. Return appropriate HTTP response:                        │
│    - Status: 429 Too Many Requests                          │
│    - Headers: Retry-After, X-RateLimit-Reset              │
│    - Body: Error message with reset time                    │
│                                                             │
│ 4. Support burst handling:                                  │
│    - Allow short bursts without rejection                   │
│    - Smooth out traffic over time                           │
└─────────────────────────────────────────────────────────────┘
```

### Non-Functional Requirements

| Requirement | Target | Rationale |
|---|---|---|
| **Latency Overhead** | <1ms | Rate limiting adds to p99 latency; minimize it |
| **Accuracy** | 99%+ | Near-perfect at enforcing limits (edge cases acceptable) |
| **Availability** | 99.99% | Rate limiter should be more reliable than the main service |
| **Throughput** | >100k req/sec per node | Must handle peak traffic on a single machine |
| **Scalability** | Horizontal | Add servers without architectural changes |
| **Consistency Model** | Eventually consistent | Occasional over-limit acceptable; strict consistency too expensive |

---

## 2. Rate Limiting Algorithms

### 2.1 Token Bucket

The most popular algorithm in production systems.

#### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Token Bucket Algorithm                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Bucket Capacity: 10 tokens                                 │
│  Refill Rate: 1 token every 100ms                          │
│                                                             │
│  Time=0ms:                                                  │
│  [█ █ █ █ █ █ █ █ █ █] (10/10 tokens)                      │
│                                                             │
│  Request 1 (costs 1 token):                               │
│  [█ █ █ █ █ █ █ █ █] ✓ Allowed                            │
│                                                             │
│  Time=50ms: (refilled 0.5 tokens, rounded down to 0)      │
│  [█ █ █ █ █ █ █ █ █] (9/10 tokens)                        │
│                                                             │
│  Time=100ms: (refilled 1 token)                            │
│  [█ █ █ █ █ █ █ █ █ █] (10/10 tokens)                      │
│                                                             │
│  Burst Request (5 requests):                              │
│  [█ █ █ █ █] ✓ ✓ ✓ ✓ ✓ Allowed (5/10 tokens used)        │
│                                                             │
│  Next requests fail until tokens refilled                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Java Implementation

```java
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;

public class TokenBucket {
    private final long capacity;           // Max tokens
    private final long refillRate;         // Tokens per millisecond
    private long tokens;                   // Current tokens
    private long lastRefillTime;           // Last time tokens were added
    private final ReentrantLock lock = new ReentrantLock();

    /**
     * @param capacity Maximum tokens in bucket
     * @param refillRatePerSecond Tokens added per second
     */
    public TokenBucket(long capacity, double refillRatePerSecond) {
        this.capacity = capacity;
        // Convert tokens/sec to tokens/ms (with precision)
        this.refillRate = (long) (refillRatePerSecond * 1_000_000 / 1000);
        this.tokens = capacity * 1_000_000;  // Store in microtokens
        this.lastRefillTime = System.currentTimeMillis();
    }

    /**
     * Try to consume tokens. Returns true if allowed, false otherwise.
     */
    public boolean allowRequest(long tokensNeeded) {
        lock.lock();
        try {
            refillTokens();

            if (tokens >= tokensNeeded * 1_000_000) {
                tokens -= tokensNeeded * 1_000_000;
                return true;
            }
            return false;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Add tokens based on time elapsed since last refill
     */
    private void refillTokens() {
        long now = System.currentTimeMillis();
        long timePassed = now - lastRefillTime;

        long tokensToAdd = timePassed * refillRate;
        tokens = Math.min(tokens + tokensToAdd, capacity * 1_000_000);
        lastRefillTime = now;
    }

    /**
     * Get remaining tokens (for monitoring/headers)
     */
    public long getRemainingTokens() {
        lock.lock();
        try {
            refillTokens();
            return tokens / 1_000_000;  // Convert back to regular tokens
        } finally {
            lock.unlock();
        }
    }
}

// Usage Example
public class TokenBucketExample {
    public static void main(String[] args) throws InterruptedException {
        // 100 tokens max, refill at 10 tokens/sec
        TokenBucket limiter = new TokenBucket(100, 10.0);

        System.out.println("Test: Request 50 tokens immediately");
        for (int i = 0; i < 50; i++) {
            if (limiter.allowRequest(1)) {
                System.out.println("Request " + (i+1) + " allowed");
            } else {
                System.out.println("Request " + (i+1) + " rejected");
                break;
            }
        }

        System.out.println("\nWait 1 second (10 tokens should be added)");
        Thread.sleep(1000);

        System.out.println("Remaining tokens: " + limiter.getRemainingTokens());

        if (limiter.allowRequest(1)) {
            System.out.println("Request after refill: allowed");
        }
    }
}
```

#### Complexity Analysis

| Metric | Value | Notes |
|---|---|---|
| **Time Complexity** | O(1) | Lock-based; no iteration |
| **Space Complexity** | O(1) | Fixed-size bucket |
| **Refill Overhead** | ~0.1ms | Single timestamp comparison |

#### Pros & Cons

**Pros:**
- Simple to understand and implement
- Handles bursts naturally (up to bucket capacity)
- Per-request overhead is constant
- Works well in both single-node and distributed settings

**Cons:**
- Clock skew in distributed systems can cause inconsistencies
- Requires careful handling of floating-point refill calculations
- No built-in support for multiple rate limits per user

**When to Use:**
- API gateways protecting microservices
- General-purpose rate limiting
- When simplicity is valued over perfect accuracy

---

### 2.2 Leaky Bucket

Ensures smooth, steady output rate.

#### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Leaky Bucket Algorithm                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Requests arrive at variable rate                          │
│  Bucket leaks at constant rate                             │
│                                                             │
│  Queue size: 100 requests max                              │
│  Leak rate: 10 requests/sec (outflow)                      │
│                                                             │
│  t=0: [█████████████] (13 requests in queue)              │
│       ↓ (steady leak of 10/sec)                            │
│                                                             │
│  t=1s: [███] (3 remain + new requests added)              │
│       New 15 requests arrive:                              │
│       Queue = 3 + 15 = 18 (all accepted)                  │
│                                                             │
│  t=2s: [████████████████] (18 requests)                   │
│       New 20 requests arrive:                              │
│       Queue would be 18 + 20 = 38 ✓ Accepted              │
│                                                             │
│  t=3s: [██████████████████] (38 requests)                │
│       New 30 requests arrive:                              │
│       Queue would be 38 + 30 = 68 ✓ Accepted              │
│                                                             │
│  t=4s: [████████████████████████████████] (68 requests)  │
│       New 50 requests arrive:                              │
│       Queue would be 68 + 50 = 118 > 100                  │
│       18 requests REJECTED ✗                               │
│       Queue = 100 (at capacity)                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Java Implementation

```java
import java.util.LinkedList;
import java.util.Queue;
import java.util.concurrent.locks.ReentrantLock;

public class LeakyBucket {
    private final int capacity;           // Queue max size
    private final double leakRate;        // Requests/second (outflow)
    private final Queue<Long> requests;   // Timestamps of enqueued requests
    private long lastLeakTime;            // Last time we processed outflow
    private final ReentrantLock lock = new ReentrantLock();

    /**
     * @param capacity Max requests in queue
     * @param leakRatePerSecond Requests processed per second
     */
    public LeakyBucket(int capacity, double leakRatePerSecond) {
        this.capacity = capacity;
        this.leakRate = leakRatePerSecond;
        this.requests = new LinkedList<>();
        this.lastLeakTime = System.currentTimeMillis();
    }

    /**
     * Try to enqueue a request. Returns true if accepted.
     */
    public boolean allowRequest() {
        lock.lock();
        try {
            leakRequests();

            if (requests.size() < capacity) {
                requests.offer(System.currentTimeMillis());
                return true;
            }
            return false;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Remove requests that have been "leaked" (processed)
     */
    private void leakRequests() {
        long now = System.currentTimeMillis();
        long timePassed = now - lastLeakTime;

        // Calculate how many requests should have leaked
        int requestsToLeak = (int) (timePassed * leakRate / 1000);

        for (int i = 0; i < requestsToLeak && !requests.isEmpty(); i++) {
            requests.poll();
        }

        lastLeakTime = now;
    }

    /**
     * Get current queue size
     */
    public int getQueueSize() {
        lock.lock();
        try {
            leakRequests();
            return requests.size();
        } finally {
            lock.unlock();
        }
    }
}

// Usage Example
public class LeakyBucketExample {
    public static void main(String[] args) throws InterruptedException {
        // Capacity 10, leak 2 requests/sec
        LeakyBucket limiter = new LeakyBucket(10, 2.0);

        System.out.println("Sending 10 requests immediately:");
        for (int i = 0; i < 10; i++) {
            if (limiter.allowRequest()) {
                System.out.println("Request " + (i+1) + " accepted");
            } else {
                System.out.println("Request " + (i+1) + " rejected - queue full");
            }
        }

        System.out.println("Queue size: " + limiter.getQueueSize());

        System.out.println("\nWait 2 seconds (4 requests should leak)");
        Thread.sleep(2000);

        System.out.println("Queue size after leak: " + limiter.getQueueSize());

        System.out.println("Sending 3 new requests:");
        for (int i = 0; i < 3; i++) {
            if (limiter.allowRequest()) {
                System.out.println("Request " + (10+i+1) + " accepted");
            }
        }
    }
}
```

#### Complexity Analysis

| Metric | Value | Notes |
|---|---|---|
| **Time Complexity** | O(leak_rate) | Must dequeue leaked requests |
| **Space Complexity** | O(capacity) | Stores all queued requests |
| **Per-Request Cost** | ~0.5ms | Depends on leak rate |

#### Pros & Cons

**Pros:**
- Guarantees smooth, constant outflow rate
- Better for backends sensitive to traffic spikes
- Easier to predict queue depth

**Cons:**
- More complex than token bucket
- Requests experience queueing delay
- Doesn't handle bursts as gracefully
- Higher memory usage (stores all request timestamps)

**When to Use:**
- Protecting downstream systems (databases, message queues)
- When you need strict rate guarantees
- Batch processing systems

---

### 2.3 Fixed Window Counter

Simplest approach; watch out for boundary burst.

#### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│              Fixed Window Counter Algorithm                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Limit: 5 requests per 10-second window                    │
│  Reset: Every 10 seconds                                   │
│                                                             │
│  Window 1: [0s ───────── 9s]                               │
│  ────────────────────────────                              │
│  t=2s:  Count=1  ✓                                          │
│  t=4s:  Count=2  ✓                                          │
│  t=6s:  Count=3  ✓                                          │
│  t=8s:  Count=4  ✓                                          │
│  t=9s:  Count=5  ✓                                          │
│  t=9.5s: Count=5  ✗ REJECTED (at limit)                    │
│                                                             │
│  Window 2: [10s ─────── 19s]                               │
│  ────────────────────────────                              │
│  t=10s: Counter resets! Count=1  ✓                        │
│  t=10.1s: Count=2  ✓                                        │
│  ...                                                        │
│                                                             │
│  THE BURST PROBLEM:                                        │
│  ════════════════════                                       │
│  t=9s: Make 5 requests (at end of window 1)  ✓            │
│  t=10s: Counter RESETS, make 5 more requests ✓            │
│  Total: 10 requests in 1 second!                           │
│         (should be limited to 5)                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Java Implementation

```java
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;

public class FixedWindowCounter {
    private final int limit;              // Max requests per window
    private final long windowSize;        // Window duration in ms
    private int counter;                  // Current count
    private long windowStart;             // When current window started
    private final ReentrantLock lock = new ReentrantLock();

    /**
     * @param limit Requests allowed per window
     * @param windowSizeSeconds Duration of each window in seconds
     */
    public FixedWindowCounter(int limit, long windowSizeSeconds) {
        this.limit = limit;
        this.windowSize = windowSizeSeconds * 1000;
        this.counter = 0;
        this.windowStart = System.currentTimeMillis();
    }

    /**
     * Try to allow a request.
     */
    public boolean allowRequest() {
        lock.lock();
        try {
            long now = System.currentTimeMillis();
            long timeInWindow = now - windowStart;

            // Check if we need to reset to new window
            if (timeInWindow >= windowSize) {
                counter = 0;
                windowStart = now;
            }

            // Check if limit exceeded
            if (counter < limit) {
                counter++;
                return true;
            }
            return false;
        } finally {
            lock.unlock();
        }
    }

    public int getCounter() {
        lock.lock();
        try {
            return counter;
        } finally {
            lock.unlock();
        }
    }
}

// Usage Example - Demonstrating the Boundary Burst Problem
public class FixedWindowExample {
    public static void main(String[] args) throws InterruptedException {
        // 5 requests per 5 seconds
        FixedWindowCounter limiter = new FixedWindowCounter(5, 5);

        System.out.println("=== Fixed Window Burst Problem Demo ===\n");
        System.out.println("Setup: 5 requests per 5-second window\n");

        // Simulate requests near window boundary
        long windowSize = 5000; // 5 seconds
        long startTime = System.currentTimeMillis();

        // Make 5 requests near end of first window
        System.out.println("At ~4.9s into first window:");
        for (int i = 0; i < 5; i++) {
            boolean allowed = limiter.allowRequest();
            System.out.println("  Request " + (i+1) + ": " + (allowed ? "✓ ALLOWED" : "✗ REJECTED"));
        }

        // Wait until new window starts
        long elapsed = System.currentTimeMillis() - startTime;
        long waitTime = windowSize - elapsed + 200; // +200ms buffer
        System.out.println("\nWaiting " + waitTime + "ms for new window...");
        Thread.sleep(waitTime);

        // Now make 5 more requests (new window)
        System.out.println("\nAt start of new window:");
        for (int i = 0; i < 5; i++) {
            boolean allowed = limiter.allowRequest();
            System.out.println("  Request " + (5+i+1) + ": " + (allowed ? "✓ ALLOWED" : "✗ REJECTED"));
        }

        System.out.println("\n⚠️  Problem: 10 requests allowed in ~1 second!");
        System.out.println("   Should have been limited to 5 requests in 5 seconds!");
    }
}
```

#### Complexity Analysis

| Metric | Value | Notes |
|---|---|---|
| **Time Complexity** | O(1) | Simple comparison and increment |
| **Space Complexity** | O(1) | Just two counters |
| **Accuracy** | 80% | Burst at boundaries |

#### Pros & Cons

**Pros:**
- Extremely simple implementation
- O(1) memory and time
- Easy to understand

**Cons:**
- **Boundary burst problem** (critical flaw)
- Inaccurate at window boundaries
- Not suitable for strict rate limiting

**When to Use:**
- Educational purposes only
- Very loose limits where accuracy doesn't matter
- **Not recommended for production**

---

### 2.4 Sliding Window Log

Accurate but memory-intensive.

#### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│              Sliding Window Log Algorithm                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Maintain log of all request timestamps                     │
│  Limit: 5 requests per 10-second window                    │
│                                                             │
│  Timestamps: [1s, 3s, 5s, 7s, 9s]                          │
│              ↑                      ↑                        │
│              └──── 10-second window ────┘                   │
│                                                             │
│  At t=12s: Remove old timestamps                           │
│  Timestamps: [3s, 5s, 7s, 9s] (1s is too old)             │
│              ↑                      ↑                        │
│              └──── 10-second window ────┘                   │
│                (from t=2s to t=12s)                         │
│                                                             │
│  t=12s: Count=4, Limit=5 → ✓ ALLOWED                       │
│  t=12.5s: Add new request                                  │
│  Timestamps: [3s, 5s, 7s, 9s, 12.5s]                       │
│  Count=5, Limit=5 → ✓ ALLOWED                              │
│                                                             │
│  t=12.6s: Count=5 → ✗ REJECTED                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Java Implementation

```java
import java.util.LinkedList;
import java.util.Queue;
import java.util.concurrent.locks.ReentrantLock;

public class SlidingWindowLog {
    private final int limit;              // Max requests per window
    private final long windowSize;        // Window in milliseconds
    private final Queue<Long> log;        // Timestamps of requests
    private final ReentrantLock lock = new ReentrantLock();

    /**
     * @param limit Requests allowed per window
     * @param windowSizeSeconds Window duration in seconds
     */
    public SlidingWindowLog(int limit, long windowSizeSeconds) {
        this.limit = limit;
        this.windowSize = windowSizeSeconds * 1000;
        this.log = new LinkedList<>();
    }

    /**
     * Try to allow request. This is the most accurate algorithm.
     */
    public boolean allowRequest() {
        lock.lock();
        try {
            long now = System.currentTimeMillis();
            long windowStart = now - windowSize;

            // Remove timestamps outside the current window
            while (!log.isEmpty() && log.peek() < windowStart) {
                log.poll();
            }

            // Check if we can add this request
            if (log.size() < limit) {
                log.offer(now);
                return true;
            }
            return false;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Get time until next request is allowed (for Retry-After header)
     */
    public long getRetryAfterMs() {
        lock.lock();
        try {
            if (log.isEmpty()) {
                return 0;
            }

            long oldestTimestamp = log.peek();
            long windowStart = oldestTimestamp + windowSize;
            long now = System.currentTimeMillis();

            return Math.max(0, windowStart - now);
        } finally {
            lock.unlock();
        }
    }
}

// Usage Example
public class SlidingWindowLogExample {
    public static void main(String[] args) throws InterruptedException {
        // 3 requests per 5 seconds
        SlidingWindowLog limiter = new SlidingWindowLog(3, 5);

        System.out.println("=== Sliding Window Log (Most Accurate) ===\n");
        System.out.println("Setup: 3 requests per 5 seconds\n");

        // Make 3 requests at t=0s
        System.out.println("At t=0s (start):");
        for (int i = 0; i < 3; i++) {
            if (limiter.allowRequest()) {
                System.out.println("  Request " + (i+1) + " ✓");
            }
        }

        // 4th request should be rejected
        if (!limiter.allowRequest()) {
            System.out.println("  Request 4 ✗ (limit reached)");
            System.out.println("  Retry after: " + limiter.getRetryAfterMs() + "ms");
        }

        // Wait 3 seconds
        System.out.println("\nWaiting 3 seconds...");
        Thread.sleep(3000);

        // One request should be allowed (oldest one aged out)
        System.out.println("At t=3s:");
        if (limiter.allowRequest()) {
            System.out.println("  Request 5 ✓ (oldest request fell out of window)");
        }

        // Wait 2 more seconds (5 seconds total from start)
        System.out.println("\nWaiting 2 more seconds...");
        Thread.sleep(2000);

        System.out.println("At t=5s:");
        System.out.println("  Entire original window expired");

        // Now all 3 requests should be allowed
        for (int i = 0; i < 3; i++) {
            if (limiter.allowRequest()) {
                System.out.println("  Request " + (5+i+1) + " ✓");
            }
        }
    }
}
```

#### Complexity Analysis

| Metric | Value | Notes |
|---|---|---|
| **Time Complexity** | O(n) worst case | Where n = requests in window |
| **Space Complexity** | O(limit) | Stores all timestamps in window |
| **Accuracy** | 100% | Perfect accuracy |

#### Pros & Cons

**Pros:**
- Perfect accuracy
- No boundary burst problems
- Easy to get exact Retry-After time

**Cons:**
- **Memory overhead** grows with limit
- O(n) time complexity in worst case
- Not suitable for high-frequency rate limiting
- Each request timestamp must be stored

**When to Use:**
- Small limits (< 1000 requests)
- Situations where accuracy is more important than performance
- Security-critical APIs
- Regulatory compliance requirements

---

### 2.5 Sliding Window Counter (Hybrid) - Production Standard

Balances accuracy and efficiency. **This is what most production systems use.**

#### How It Works

The idea: combine current and previous window counts with a weighted formula.

```
┌─────────────────────────────────────────────────────────────┐
│         Sliding Window Counter (Hybrid Approach)            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Limit: 10 requests per 60 seconds                          │
│  Window granularity: 10-second buckets                      │
│                                                             │
│  Historical buckets:                                         │
│  [0-10s]: 3 requests    [10-20s]: 2 requests  [20-30s]: 4   │
│  [30-40s]: 1 request    [40-50s]: 3 requests  [50-60s]: 2   │
│                                                             │
│  Current time: 35s (5 seconds into [30-40s] bucket)        │
│                                                             │
│  SLIDING WINDOW CALCULATION:                                │
│  ═══════════════════════════════════════════               │
│                                                             │
│  Current window [30-40s]:    3 requests ✓                  │
│  Previous window [20-30s]:   4 requests                    │
│                                                             │
│  Percentage of previous window in our view:                │
│    = (60 - 5) / 10                                          │
│    = 55 / 10 = 0.5 (55% of previous window)               │
│                                                             │
│  Estimated count from previous window:                      │
│    = 4 * 0.5 = 2 requests                                   │
│                                                             │
│  Total estimate:                                            │
│    = 3 (current) + 2 (previous*0.5) = 5 requests           │
│    < 10 limit ✓ ALLOWED                                    │
│                                                             │
│  At 35.1s with 1 new request:                              │
│    Total = 4 (current) + 2 (previous*0.5) = 6 ✓            │
│                                                             │
│  At 35.5s with 5 new requests:                             │
│    Total = 8 (current) + 2 (previous*0.5) = 10 ✓          │
│                                                             │
│  At 35.6s with 1 more request:                             │
│    Total = 9 (current) + 2 (previous*0.5) = 11 > 10 ✗      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Java Implementation

```java
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;

public class SlidingWindowCounter {
    private final int limit;              // Requests allowed
    private final long windowSize;        // Total window in ms
    private final long bucketSize;        // Sub-window granularity in ms

    private long currentBucketCount;      // Requests in current bucket
    private long previousBucketCount;     // Requests in previous bucket
    private long currentBucketStart;      // When current bucket started
    private final ReentrantLock lock = new ReentrantLock();

    /**
     * @param limit Max requests per window
     * @param windowSizeSeconds Total window duration
     * @param bucketSizeMs Granularity of sub-windows (typically 1-10 seconds)
     */
    public SlidingWindowCounter(int limit, long windowSizeSeconds, long bucketSizeMs) {
        this.limit = limit;
        this.windowSize = windowSizeSeconds * 1000;
        this.bucketSize = bucketSizeMs;
        this.currentBucketStart = System.currentTimeMillis();
        this.currentBucketCount = 0;
        this.previousBucketCount = 0;
    }

    /**
     * The magic formula for sliding window:
     * Count = current_bucket_count + previous_bucket_count * weight
     *
     * Where weight = how much of previous bucket is still in our window
     */
    public boolean allowRequest() {
        lock.lock();
        try {
            long now = System.currentTimeMillis();
            long timeSinceWindowStart = (now - currentBucketStart) % bucketSize;

            // Check if we've moved to a new bucket
            if (now - currentBucketStart >= bucketSize) {
                previousBucketCount = currentBucketCount;
                currentBucketCount = 0;
                currentBucketStart = now;
                timeSinceWindowStart = 0;
            }

            // Calculate weight of previous bucket still in window
            double weightOfPrevious = 1.0 - (double) timeSinceWindowStart / bucketSize;

            // Estimate total count
            long estimatedCount = currentBucketCount +
                                 (long) Math.ceil(previousBucketCount * weightOfPrevious);

            if (estimatedCount < limit) {
                currentBucketCount++;
                return true;
            }
            return false;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Get estimated count in current window
     */
    public long getEstimatedCount() {
        lock.lock();
        try {
            long now = System.currentTimeMillis();
            long timeSinceWindowStart = (now - currentBucketStart) % bucketSize;
            double weightOfPrevious = 1.0 - (double) timeSinceWindowStart / bucketSize;

            return currentBucketCount + (long) Math.ceil(previousBucketCount * weightOfPrevious);
        } finally {
            lock.unlock();
        }
    }

    public int getRateLimit() {
        return limit;
    }
}

// Usage Example
public class SlidingWindowCounterExample {
    public static void main(String[] args) throws InterruptedException {
        // 10 requests per 60 seconds, buckets of 10 seconds
        SlidingWindowCounter limiter = new SlidingWindowCounter(10, 60, 10_000);

        System.out.println("=== Sliding Window Counter (Production) ===\n");
        System.out.println("Setup: 10 requests per 60 seconds\n");

        // Simulate requests
        System.out.println("Making 10 requests at t=0s:");
        for (int i = 0; i < 10; i++) {
            boolean allowed = limiter.allowRequest();
            System.out.println("  Request " + (i+1) + ": " + (allowed ? "✓" : "✗"));
        }

        System.out.println("Estimated count: " + limiter.getEstimatedCount());

        // 11th request should be rejected
        if (!limiter.allowRequest()) {
            System.out.println("Request 11: ✗ (limit reached)");
        }

        // Wait for bucket transition
        System.out.println("\nWaiting 10+ seconds for bucket transition...");
        Thread.sleep(10_500);

        System.out.println("After bucket transition, previous bucket weight < 1.0:");
        System.out.println("Estimated count: " + limiter.getEstimatedCount());

        // Should be able to make some requests now
        System.out.println("\nMaking 3 new requests:");
        for (int i = 0; i < 3; i++) {
            boolean allowed = limiter.allowRequest();
            System.out.println("  Request " + (11+i) + ": " + (allowed ? "✓" : "✗"));
        }
    }
}
```

#### Complexity Analysis

| Metric | Value | Notes |
|---|---|---|
| **Time Complexity** | O(1) | Constant time operations |
| **Space Complexity** | O(1) | Only stores 2 bucket counts |
| **Accuracy** | 99%+ | Near-perfect in production |

#### Pros & Cons

**Pros:**
- Excellent accuracy (99%+) for reasonable bucket sizes
- O(1) time and space
- No boundary burst issues
- Production-ready
- Used by most cloud providers (AWS, Google Cloud)

**Cons:**
- Slightly more complex implementation
- Requires tuning bucket size
- Small edge cases with burst timing

**When to Use:**
- **All production systems**
- APIs with strict SLAs
- High-frequency rate limiting (> 10k req/sec)
- Distributed rate limiting

---

### Algorithm Comparison Matrix

| Aspect | Token Bucket | Leaky Bucket | Fixed Window | Sliding Log | Sliding Counter |
|---|---|---|---|---|---|
| **Accuracy** | 95% | 90% | 80% | 100% | 99%+ |
| **Memory** | O(1) | O(limit) | O(1) | O(limit) | O(1) |
| **Time** | O(1) | O(leak_rate) | O(1) | O(n) | O(1) |
| **Complexity** | Low | Medium | Very Low | Medium | Medium |
| **Burst Support** | ✓ Excellent | ✗ Poor | ✓ Too Good | ✓ Good | ✓ Good |
| **Production Ready** | ✓ Yes | ✓ Yes | ✗ No | ✓ Yes | ✓ Yes |

---

## 3. Distributed Rate Limiting

### The Distributed Problem

Here's the critical issue: in a distributed system with multiple load-balanced servers, each server maintains its own counter.

```
┌─────────────────────────────────────────────────────────────┐
│              Single User, Multiple Servers                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  User's Limit: 100 requests per minute                      │
│                                                             │
│  Load Balancer                                              │
│        │                                                    │
│        ├──────────────────────┬───────────────────┐        │
│        │                      │                   │         │
│      Server 1              Server 2            Server 3     │
│    Counter: 0             Counter: 0          Counter: 0    │
│                                                             │
│  Request 1 → Server 1: Counter = 1 ✓                        │
│  Request 2 → Server 2: Counter = 1 ✓                        │
│  Request 3 → Server 3: Counter = 1 ✓                        │
│  ...                                                        │
│  Request 99 → Server 1: Counter = 33 ✓                      │
│  Request 100 → Server 2: Counter = 34 ✓                     │
│  Request 101 → Server 3: Counter = 34 ✓                     │
│  Request 102 → Server 1: Counter = 34 ✓                     │
│  Request 103 → Server 2: Counter = 35 ✓                     │
│                                                             │
│  PROBLEM: User made 103 requests but each server thinks     │
│  it's only at ~35 requests. User exceeded 100 limit!        │
│                                                             │
│  Actual count: ~35 per server × 3 servers = 105 total ✗    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Solution 1: Centralized Rate Limiter with Redis

Use a single source of truth for all counters.

#### Redis Implementation with Lua Script

```java
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;
import java.util.Collections;

@Component
public class RedisRateLimiter {
    private static final String RATE_LIMIT_KEY_PREFIX = "rate_limit:";
    private static final String RATE_LIMIT_RESET_KEY_PREFIX = "rate_limit_reset:";

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    /**
     * Lua script for atomic rate limiting in Redis
     *
     * KEYS[1] = rate limit key (e.g., "rate_limit:user:123")
     * ARGV[1] = current timestamp
     * ARGV[2] = limit (max requests)
     * ARGV[3] = window size in seconds
     *
     * Returns 1 if allowed, 0 if rejected
     * Sets expiry on the key automatically
     */
    private static final String RATE_LIMIT_LUA_SCRIPT =
        "local current = redis.call('INCR', KEYS[1]) " +
        "if current == 1 then " +
        "  redis.call('EXPIRE', KEYS[1], ARGV[3]) " +
        "end " +
        "if current <= tonumber(ARGV[2]) then " +
        "  return {1, current} " +
        "else " +
        "  return {0, current} " +
        "end";

    /**
     * Allow request if under limit. Thread-safe and distributed.
     *
     * @param limitKey Identifier (userId, ipAddress, etc.)
     * @param limit Max requests
     * @param windowSizeSeconds Window duration
     * @return RateLimitResult with allow flag and remaining count
     */
    public RateLimitResult allowRequest(String limitKey, int limit, long windowSizeSeconds) {
        String key = RATE_LIMIT_KEY_PREFIX + limitKey;

        RedisScript<List<Long>> script = redisTemplate.getConnectionFactory()
            .getConnection().getScriptingCommands()
            .scriptLoad(RATE_LIMIT_LUA_SCRIPT);

        @SuppressWarnings("unchecked")
        List<Long> result = (List<Long>) redisTemplate.execute(
            RedisScript.of(RATE_LIMIT_LUA_SCRIPT, List.class),
            Collections.singletonList(key),
            String.valueOf(System.currentTimeMillis()),
            String.valueOf(limit),
            String.valueOf(windowSizeSeconds)
        );

        if (result != null && result.size() == 2) {
            boolean allowed = result.get(0).equals(1L);
            long currentCount = result.get(1);
            long remaining = Math.max(0, limit - currentCount);

            return new RateLimitResult(allowed, remaining, windowSizeSeconds);
        }

        return new RateLimitResult(false, 0, windowSizeSeconds);
    }

    /**
     * Reset counter for a key (admin operation)
     */
    public void reset(String limitKey) {
        redisTemplate.delete(RATE_LIMIT_KEY_PREFIX + limitKey);
    }
}

/**
 * Result of rate limit check
 */
public class RateLimitResult {
    public final boolean allowed;
    public final long remaining;
    public final long resetAfterSeconds;

    public RateLimitResult(boolean allowed, long remaining, long resetAfterSeconds) {
        this.allowed = allowed;
        this.remaining = Math.max(0, remaining);
        this.resetAfterSeconds = resetAfterSeconds;
    }
}

// Usage in Controller
@RestController
@RequestMapping("/api")
public class ApiController {

    @Autowired
    private RedisRateLimiter rateLimiter;

    @GetMapping("/data")
    public ResponseEntity<?> getData(HttpServletRequest request) {
        String clientId = getClientIdentifier(request);

        RateLimitResult result = rateLimiter.allowRequest(
            clientId,
            100,              // 100 requests
            60                // per 60 seconds
        );

        HttpHeaders headers = new HttpHeaders();
        headers.set("X-RateLimit-Limit", "100");
        headers.set("X-RateLimit-Remaining", String.valueOf(result.remaining));
        headers.set("X-RateLimit-Reset",
            String.valueOf(System.currentTimeMillis() / 1000 + result.resetAfterSeconds));

        if (!result.allowed) {
            headers.set("Retry-After", String.valueOf(result.resetAfterSeconds));
            return ResponseEntity
                .status(HttpStatus.TOO_MANY_REQUESTS)
                .headers(headers)
                .body(Map.of("error", "Rate limit exceeded"));
        }

        return ResponseEntity.ok()
            .headers(headers)
            .body(Map.of("data", "Your data"));
    }

    private String getClientIdentifier(HttpServletRequest request) {
        // Try user ID if authenticated
        String userId = request.getUserPrincipal().getName();
        if (userId != null) {
            return "user:" + userId;
        }
        // Fall back to IP
        return "ip:" + getClientIp(request);
    }

    private String getClientIp(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            return xForwardedFor.split(",")[0];
        }
        return request.getRemoteAddr();
    }
}
```

#### Why Lua Scripts?

Without Lua, there's a race condition:

```
Without Lua (BROKEN):
────────────────────
Thread 1: GET rate_limit:user:123           → Returns 99
Thread 2: GET rate_limit:user:123           → Returns 99
Thread 1: SET rate_limit:user:123 = 100     ✓ Within limit
Thread 2: SET rate_limit:user:123 = 100     ✗ Should be rejected!

With Lua (FIXED):
─────────────────
INCR is atomic, returns 99
INCR is atomic, returns 100
```

### Solution 2: Sliding Window with Redis Sorted Sets

More accurate than simple counters, better performance than Lua.

```java
@Component
public class SlidingWindowRedisRateLimiter {

    private static final String RATE_LIMIT_KEY_PREFIX = "rate_limit_window:";

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    /**
     * Using Redis Sorted Set for sliding window
     * Members: request timestamps
     * Scores: epoch milliseconds
     */
    public RateLimitResult allowRequest(String limitKey, int limit, long windowSizeSeconds) {
        String key = RATE_LIMIT_KEY_PREFIX + limitKey;
        long now = System.currentTimeMillis();
        long windowStart = now - (windowSizeSeconds * 1000);

        // Remove old requests outside the window
        redisTemplate.opsForZSet().removeRangeByScore(key, 0, windowStart);

        // Count requests in current window
        long currentCount = redisTemplate.opsForZSet().zCard(key);

        if (currentCount < limit) {
            // Add this request
            redisTemplate.opsForZSet().add(key, String.valueOf(now), now);
            // Set expiry
            redisTemplate.expire(key, windowSizeSeconds + 1, java.util.concurrent.TimeUnit.SECONDS);

            return new RateLimitResult(true, limit - currentCount - 1, windowSizeSeconds);
        }

        return new RateLimitResult(false, 0, windowSizeSeconds);
    }
}
```

**Pros:**
- Higher accuracy than counter-based approach
- Handles burst better
- Automatic cleanup of old entries

**Cons:**
- More Redis memory usage
- More operations per request (ZREMRANGEBYSCORE + ZCARD + ZADD)

### Solution 3: Sticky Sessions

Route all requests from a user to the same server.

```
┌──────────────────────────────────────────┐
│        Sticky Session Approach           │
├──────────────────────────────────────────┤
│                                          │
│  Load Balancer (sticky by cookie)        │
│       │                                  │
│       └─────────────── User's Cookie: S1 │
│                                          │
│  Request 1 → Server 1: Count = 1         │
│  Request 2 → Server 1: Count = 2         │
│  Request 3 → Server 1: Count = 3         │
│  ...                                     │
│  Request 100 → Server 1: Count = 100 ✓  │
│  Request 101 → Server 1: Count = 101 ✗  │
│                                          │
│  PROBLEM: Server 1 becomes bottleneck!   │
│  Uneven load distribution                │
│                                          │
└──────────────────────────────────────────┘
```

**Pros:**
- Simple implementation
- No distributed coordination

**Cons:**
- Uneven load distribution
- Server failures cause user's limit to reset
- Not horizontally scalable

### Solution 4: Local Rate Limiter + Best Effort Sync

Trade accuracy for performance. Acceptable for many use cases.

```java
@Component
public class LocalRateLimiterWithSync {

    private final ConcurrentHashMap<String, TokenBucket> localLimiters = new ConcurrentHashMap<>();

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    /**
     * Best-effort rate limiting:
     * 1. Check local counter first (very fast)
     * 2. Periodically sync with Redis
     * 3. Accept occasional over-limit requests
     */
    public RateLimitResult allowRequest(String limitKey, int limit, long windowSizeSeconds) {
        // Get or create local limiter
        TokenBucket localLimiter = localLimiters.computeIfAbsent(limitKey, k ->
            new TokenBucket(limit, limit / windowSizeSeconds)
        );

        // Check local limit first (no network call)
        if (localLimiter.allowRequest(1)) {
            return new RateLimitResult(true, localLimiter.getRemainingTokens(), windowSizeSeconds);
        }

        // Rate limited locally, but do a distributed check
        // (maybe another server allowed some requests)
        RateLimitResult distributedCheck = checkDistributedLimit(limitKey, limit, windowSizeSeconds);

        if (distributedCheck.allowed) {
            localLimiter.reset(); // Reset local counter based on distributed state
            return distributedCheck;
        }

        return new RateLimitResult(false, 0, windowSizeSeconds);
    }

    private RateLimitResult checkDistributedLimit(String limitKey, int limit, long windowSizeSeconds) {
        // Call Redis for authoritative count
        // (only when local says no)
        // Implementation similar to Solution 1
        return new RateLimitResult(false, 0, windowSizeSeconds);
    }
}
```

**Pros:**
- Sub-millisecond latency for most requests
- Minimal Redis load
- Good scalability

**Cons:**
- Users can exceed limit (across servers)
- ~5% over-limit requests acceptable in most systems
- Requires monitoring

### Distributed Solution Comparison

| Solution | Consistency | Latency | Redis Load | Notes |
|---|---|---|---|---|
| **Centralized (Lua)** | Strong | 5-10ms | High | Accurate but slower |
| **Sliding Window (Sorted Set)** | Strong | 5-15ms | High | Most accurate |
| **Sticky Sessions** | Strong | <1ms | None | But causes hot spots |
| **Local + Sync** | Eventual | <1ms | Low | Best for scale |

**Recommendation for FAANG**: Sliding Window Sorted Set with local cache (multi-level approach):
- Use local cache for most requests (<1ms)
- Refresh from Redis periodically (~100ms)
- Accept small over-limit requests
- Provides 99%+ accuracy with low latency

---

## 4. Multi-Level Rate Limiting

Real systems need multiple limits simultaneously.

```
┌──────────────────────────────────────────────────────────┐
│              Multi-Level Rate Limiting                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  User Request Flow:                                      │
│                                                          │
│  1. Per-User Limit:        100 req/min                   │
│     Current: 45/100  ✓ PASS                              │
│                                                          │
│  2. Per-IP Limit:          500 req/min                   │
│     Current: 250/500  ✓ PASS                             │
│                                                          │
│  3. Per-API-Key Limit:     1000 req/min (service tier)  │
│     Current: 750/1000  ✓ PASS                            │
│                                                          │
│  4. Global Limit:          100k req/min                  │
│     Current: 75k/100k  ✓ PASS                            │
│                                                          │
│  5. Endpoint-Specific:     /expensive → 10 req/min       │
│     Current: 8/10  ✓ PASS                                │
│                                                          │
│  All checks passed → Request allowed ✓                   │
│                                                          │
│  If ANY check fails → 429 Too Many Requests ✗            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Rules Engine Implementation

```java
/**
 * Configurable rate limit rules (no code changes needed)
 */
@Data
public class RateLimitRule {
    private String name;                    // "per_user_free"
    private String limitKey;                // "user:{userId}"
    private int requestsPerWindow;          // 100
    private long windowSizeSeconds;         // 60
    private int priority;                   // Lower = checked first
    private Map<String, String> conditions; // tier=free, plan=basic
    private boolean enabled;

    public boolean matches(HttpServletRequest request, String userId) {
        // Check if this rule applies to this request
        if (!enabled) return false;

        // Check condition matching (e.g., user tier = free)
        String userTier = getUserTier(userId);
        if (conditions.containsKey("tier") && !conditions.get("tier").equals(userTier)) {
            return false;
        }

        return true;
    }

    private String getUserTier(String userId) {
        // Look up from user service
        return "free"; // Simplified
    }
}

@Component
public class RateLimitRulesEngine {

    @Autowired
    private RedisRateLimiter redisLimiter;

    private List<RateLimitRule> rules; // Loaded from config file or DB

    /**
     * Check all applicable rules
     */
    public RateLimitCheckResult checkRateLimit(HttpServletRequest request) {
        String userId = extractUserId(request);
        String clientIp = getClientIp(request);

        // Sort by priority
        List<RateLimitRule> applicableRules = rules.stream()
            .filter(r -> r.matches(request, userId))
            .sorted(Comparator.comparingInt(RateLimitRule::getPriority))
            .collect(Collectors.toList());

        // Check each rule
        for (RateLimitRule rule : applicableRules) {
            String limitKey = rule.getLimitKey()
                .replace("{userId}", userId)
                .replace("{ip}", clientIp);

            RateLimitResult result = redisLimiter.allowRequest(
                limitKey,
                rule.getRequestsPerWindow(),
                rule.getWindowSizeSeconds()
            );

            if (!result.allowed) {
                // Rule violated
                return new RateLimitCheckResult(
                    false,
                    rule.getName(),
                    rule.getRequestsPerWindow(),
                    result.resetAfterSeconds
                );
            }
        }

        return new RateLimitCheckResult(true, null, 0, 0);
    }
}

@Data
public class RateLimitCheckResult {
    public final boolean allowed;
    public final String violatedRule;      // Which limit was exceeded?
    public final int limit;
    public final long resetAfterSeconds;
}

// Configuration (JSON/YAML)
public class RulesConfig {
    public static List<RateLimitRule> loadRules() {
        return Arrays.asList(
            // Free tier users
            new RateLimitRule(
                "free_user_per_minute",
                "user:{userId}",
                100,
                60,
                1,
                Map.of("tier", "free"),
                true
            ),
            new RateLimitRule(
                "free_user_per_hour",
                "user:{userId}",
                5000,
                3600,
                2,
                Map.of("tier", "free"),
                true
            ),

            // Premium tier users
            new RateLimitRule(
                "premium_user_per_minute",
                "user:{userId}",
                10000,
                60,
                1,
                Map.of("tier", "premium"),
                true
            ),

            // IP-based (unauthenticated)
            new RateLimitRule(
                "ip_per_minute",
                "ip:{ip}",
                500,
                60,
                3,
                Collections.emptyMap(),
                true
            ),

            // Global limit (circuit breaker)
            new RateLimitRule(
                "global_per_minute",
                "global",
                100000,
                60,
                99, // Checked last
                Collections.emptyMap(),
                true
            ),

            // Expensive endpoints
            new RateLimitRule(
                "expensive_endpoint",
                "user:{userId}:expensive",
                10,
                60,
                2,
                Collections.emptyMap(),
                true
            )
        );
    }
}
```

### Priority-Based Limiting

Different user tiers get different limits:

```java
@Data
public class UserTier {
    public enum Tier {
        FREE(100, 100, 5_000),         // 100/min, 5k/hour
        BASIC(1_000, 1_000, 50_000),   // 1k/min, 50k/hour
        PRO(10_000, 50_000, 500_000),  // 10k/min, 500k/hour
        ENTERPRISE(Integer.MAX_VALUE, Integer.MAX_VALUE, Integer.MAX_VALUE);

        public final int perMinute;
        public final int perHour;
        public final int perDay;

        Tier(int perMinute, int perHour, int perDay) {
            this.perMinute = perMinute;
            this.perHour = perHour;
            this.perDay = perDay;
        }
    }

    private String userId;
    private Tier tier;
    private LocalDateTime subscriptionEnds;

    public boolean isPremium() {
        return tier == Tier.PRO || tier == Tier.ENTERPRISE;
    }
}
```

---

## 5. Production Concerns

### Failure Modes: Redis Down?

What happens when your rate limiter Redis instance fails?

#### Strategy 1: Fail Open (Permissive)

```java
@Component
public class FailOpenRateLimiter implements RateLimiter {

    @Autowired(required = false)
    private RedisTemplate<String, String> redisTemplate;

    @Override
    public RateLimitResult allowRequest(String limitKey, int limit, long windowSize) {
        try {
            if (redisTemplate != null) {
                // Try to use Redis
                return redisLimiter.allowRequest(limitKey, limit, windowSize);
            }
        } catch (RedisConnectionFailureException e) {
            log.error("Redis connection failed", e);
            metrics.increment("rate_limit.redis.failure");
        }

        // Fallback: allow all requests
        log.warn("Rate limiter degraded - allowing all requests");
        return new RateLimitResult(true, Long.MAX_VALUE, windowSize);
    }
}
```

**Pros:**
- Service stays available
- Users don't get errors
- Can continue serving requests

**Cons:**
- **Vulnerability to DDoS** - no protection
- Attackers could abuse the service
- Brief outage becomes security incident

#### Strategy 2: Fail Closed (Restrictive)

```java
@Component
public class FailClosedRateLimiter implements RateLimiter {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Override
    public RateLimitResult allowRequest(String limitKey, int limit, long windowSize) {
        try {
            return redisLimiter.allowRequest(limitKey, limit, windowSize);
        } catch (RedisConnectionFailureException e) {
            log.error("Redis connection failed", e);
            metrics.increment("rate_limit.redis.failure");

            // Fallback: reject all requests
            throw new ServiceUnavailableException("Rate limiter temporarily unavailable");
        }
    }
}
```

**Pros:**
- Prevents DDoS
- Protects system from being overwhelmed
- Forces immediate Redis recovery

**Cons:**
- Service returns 503 errors
- Bad user experience
- Users can't access service during Redis outage

#### Strategy 3: Hybrid (Recommended)

Use local circuit breaker with gradual degradation:

```java
@Component
public class HybridRateLimiter implements RateLimiter {

    private final CircuitBreaker circuitBreaker;
    private final LocalRateLimiter localLimiter;
    private final RedisRateLimiter redisLimiter;

    private enum State {
        NORMAL,      // Redis working
        DEGRADED,    // Redis failing, use local
        CRITICAL     // Local limits exceeded
    }

    private State currentState = State.NORMAL;

    @Override
    public RateLimitResult allowRequest(String limitKey, int limit, long windowSize) {
        try {
            // Try Redis first
            if (currentState == State.NORMAL) {
                return redisLimiter.allowRequest(limitKey, limit, windowSize);
            }
        } catch (RedisConnectionFailureException e) {
            // Record failure
            circuitBreaker.recordFailure();

            if (circuitBreaker.isOpen()) {
                currentState = State.DEGRADED;
                metrics.increment("rate_limit.degraded");
            }
        }

        // Use local limiter with tighter limits
        if (currentState == State.DEGRADED) {
            RateLimitResult local = localLimiter.allowRequest(limitKey, limit / 3, windowSize);
            if (!local.allowed) {
                currentState = State.CRITICAL;
            }
            return local;
        }

        // Circuit breaker open - reject 80% of requests
        if (currentState == State.CRITICAL && Math.random() > 0.2) {
            return new RateLimitResult(false, 0, windowSize);
        }

        // Monitor: if Redis recovers, switch back
        if (circuitBreaker.isClosed()) {
            currentState = State.NORMAL;
        }

        return new RateLimitResult(true, limit, windowSize);
    }
}
```

### Rate Limit Headers

Always return these headers:

```
X-RateLimit-Limit: 100              ← Total limit
X-RateLimit-Remaining: 45           ← How many left in window
X-RateLimit-Reset: 1707123456       ← Unix timestamp when limit resets
Retry-After: 30                      ← Seconds to wait before retrying (on 429)
```

### Spring Boot Filter Implementation

```java
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    @Autowired
    private RateLimitRulesEngine rulesEngine;

    @Autowired
    private MetricsService metrics;

    private static final String[] EXCLUDED_PATHS = {"/health", "/metrics"};

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                   HttpServletResponse response,
                                   FilterChain filterChain)
            throws ServletException, IOException {

        // Skip excluded paths
        if (shouldExclude(request.getRequestURI())) {
            filterChain.doFilter(request, response);
            return;
        }

        // Check rate limits
        RateLimitCheckResult result = rulesEngine.checkRateLimit(request);

        // Set response headers
        setRateLimitHeaders(response, result);

        if (!result.allowed) {
            metrics.increment("rate_limit.rejected",
                Map.of("rule", result.violatedRule));

            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write(
                "{\"error\": \"Rate limit exceeded: " + result.violatedRule + "\", " +
                "\"retry_after\": " + result.resetAfterSeconds + "}"
            );
            return;
        }

        filterChain.doFilter(request, response);
    }

    private void setRateLimitHeaders(HttpServletResponse response,
                                    RateLimitCheckResult result) {
        long now = System.currentTimeMillis() / 1000;
        response.setHeader("X-RateLimit-Limit", String.valueOf(result.limit));
        response.setHeader("X-RateLimit-Reset",
            String.valueOf(now + result.resetAfterSeconds));

        if (!result.allowed) {
            response.setHeader("Retry-After", String.valueOf(result.resetAfterSeconds));
        }
    }

    private boolean shouldExclude(String path) {
        return Arrays.stream(EXCLUDED_PATHS).anyMatch(path::startsWith);
    }
}
```

### Testing Rate Limiters

```java
@SpringBootTest
public class RateLimiterTest {

    @Autowired
    private RateLimitRulesEngine rulesEngine;

    @MockBean
    private RedisTemplate<String, String> redisTemplate;

    @Test
    public void testRateLimitExceeded() {
        // Setup
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setPrincipal(() -> "user123");
        request.setRemoteAddr("192.168.1.1");

        // First 100 requests allowed
        for (int i = 0; i < 100; i++) {
            RateLimitCheckResult result = rulesEngine.checkRateLimit(request);
            assertTrue(result.allowed, "Request " + i + " should be allowed");
        }

        // 101st request rejected
        RateLimitCheckResult result = rulesEngine.checkRateLimit(request);
        assertFalse(result.allowed, "Request 101 should be rejected");
        assertEquals("free_user_per_minute", result.violatedRule);
    }

    @Test
    public void testMultipleLimitsEnforced() {
        // Verify per-user AND per-IP limits work together
        RateLimitCheckResult result = rulesEngine.checkRateLimit(request);
        assertTrue(result.allowed);
    }

    @Test
    public void testRedisFallback() {
        // Simulate Redis failure
        when(redisTemplate.execute(any(), any(), any()))
            .thenThrow(new RedisConnectionFailureException("Connection refused"));

        RateLimitCheckResult result = rulesEngine.checkRateLimit(request);
        // Should fall back gracefully
        assertNotNull(result);
    }
}
```

### Monitoring & Alerting

```java
@Component
public class RateLimiterMetrics {

    private final MeterRegistry meterRegistry;
    private final AlertService alertService;

    public void recordRequest(String limitKey, boolean allowed, String ruleName) {
        Counter counter = Counter.builder("rate_limit.requests")
            .tag("allowed", String.valueOf(allowed))
            .tag("rule", ruleName)
            .register(meterRegistry);
        counter.increment();

        if (!allowed) {
            // Alert on spike
            long recentRejections = getRecentRejectionCount(ruleName);
            if (recentRejections > 1000) {
                alertService.alert(
                    "RATE_LIMIT_SPIKE",
                    "Rule " + ruleName + " rejecting " + recentRejections + " requests/min"
                );
            }
        }
    }

    public void recordRedisLatency(long latencyMs) {
        Timer.builder("rate_limit.redis.latency")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(meterRegistry)
            .record(Duration.ofMillis(latencyMs));
    }
}
```

---

## 6. Complete Spring Boot Implementation

A complete, production-ready rate limiter.

```java
// ============================================
// 1. Configuration Classes
// ============================================

@Configuration
public class RateLimiterConfiguration {

    @Bean
    public RedisTemplate<String, String> redisTemplate(
            RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, String> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(new StringRedisSerializer());
        return template;
    }

    @Bean
    public RateLimitRulesEngine rateLimitRulesEngine() {
        return new RateLimitRulesEngine();
    }
}

@Data
@Configuration
@ConfigurationProperties(prefix = "rate-limit")
public class RateLimitProperties {
    private boolean enabled = true;
    private String redisUrl;
    private long circuitBreakerThreshold = 10;
    private long circuitBreakerWindowSeconds = 60;
}

// ============================================
// 2. Core Rate Limiter Components
// ============================================

public interface RateLimiter {
    RateLimitResult allowRequest(String limitKey, int limit, long windowSize);
}

@Component
public class RedisRateLimiter implements RateLimiter {

    private static final String KEY_PREFIX = "rate_limit:";
    private static final String LUA_SCRIPT =
        "local current = redis.call('INCR', KEYS[1]) " +
        "if current == 1 then " +
        "  redis.call('EXPIRE', KEYS[1], ARGV[3]) " +
        "end " +
        "if current <= tonumber(ARGV[2]) then " +
        "  return {1, current} " +
        "else " +
        "  return {0, current} " +
        "end";

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Autowired
    private MeterRegistry meterRegistry;

    @Override
    public RateLimitResult allowRequest(String limitKey, int limit, long windowSizeSeconds) {
        long startTime = System.currentTimeMillis();
        String key = KEY_PREFIX + limitKey;

        try {
            @SuppressWarnings("unchecked")
            List<Long> result = (List<Long>) redisTemplate.execute(
                RedisScript.of(LUA_SCRIPT, List.class),
                Collections.singletonList(key),
                String.valueOf(System.currentTimeMillis()),
                String.valueOf(limit),
                String.valueOf(windowSizeSeconds)
            );

            long latency = System.currentTimeMillis() - startTime;
            meterRegistry.timer("rate_limiter.redis.latency").record(latency, TimeUnit.MILLISECONDS);

            if (result != null && result.size() == 2) {
                boolean allowed = result.get(0).equals(1L);
                long currentCount = result.get(1);
                long remaining = Math.max(0, limit - currentCount);

                return new RateLimitResult(allowed, remaining, windowSizeSeconds);
            }
        } catch (Exception e) {
            meterRegistry.counter("rate_limiter.redis.errors").increment();
            throw new RateLimiterException("Redis operation failed", e);
        }

        return new RateLimitResult(false, 0, windowSizeSeconds);
    }
}

// ============================================
// 3. Rules and Multi-Level Configuration
// ============================================

@Data
public class RateLimitRule {
    private String name;
    private String limitKeyPattern;    // "user:{userId}", "ip:{ip}"
    private int requestsPerWindow;
    private long windowSizeSeconds;
    private int priority;              // Lower priority = checked first
    private Map<String, String> conditions;
    private boolean enabled;

    public String buildLimitKey(HttpServletRequest request, String userId) {
        String key = limitKeyPattern
            .replace("{userId}", userId != null ? userId : "anonymous")
            .replace("{ip}", extractClientIp(request))
            .replace("{endpoint}", request.getRequestURI());
        return key;
    }

    private String extractClientIp(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            return xForwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}

@Component
public class RateLimitRulesEngine {

    @Autowired
    private RedisRateLimiter rateLimiter;

    @Autowired
    private UserService userService;

    private List<RateLimitRule> rules;

    @PostConstruct
    public void loadRules() {
        // In production: load from database or config file
        this.rules = Arrays.asList(
            // Free tier
            new RateLimitRule("free_per_minute", "user:{userId}", 100, 60, 1,
                Map.of("tier", "free"), true),
            new RateLimitRule("free_per_hour", "user:{userId}", 5000, 3600, 2,
                Map.of("tier", "free"), true),

            // Premium tier
            new RateLimitRule("premium_per_minute", "user:{userId}", 10000, 60, 1,
                Map.of("tier", "premium"), true),

            // IP-based
            new RateLimitRule("ip_per_minute", "ip:{ip}", 500, 60, 3,
                Collections.emptyMap(), true),

            // Global circuit breaker
            new RateLimitRule("global_per_minute", "global", 100000, 60, 99,
                Collections.emptyMap(), true)
        );
    }

    public RateLimitCheckResult checkRateLimit(HttpServletRequest request) {
        String userId = extractUserId(request);

        // Get applicable rules sorted by priority
        List<RateLimitRule> applicableRules = rules.stream()
            .filter(rule -> rule.isEnabled() && matchesConditions(rule, userId))
            .sorted(Comparator.comparingInt(RateLimitRule::getPriority))
            .collect(Collectors.toList());

        // Check each rule
        for (RateLimitRule rule : applicableRules) {
            String limitKey = rule.buildLimitKey(request, userId);
            RateLimitResult result = rateLimiter.allowRequest(
                limitKey,
                rule.getRequestsPerWindow(),
                rule.getWindowSizeSeconds()
            );

            if (!result.allowed) {
                return new RateLimitCheckResult(
                    false,
                    rule.getName(),
                    rule.getRequestsPerWindow(),
                    result.remaining,
                    result.resetAfterSeconds
                );
            }
        }

        return new RateLimitCheckResult(true, null, 0, 0, 0);
    }

    private String extractUserId(HttpServletRequest request) {
        Principal principal = request.getUserPrincipal();
        return principal != null ? principal.getName() : null;
    }

    private boolean matchesConditions(RateLimitRule rule, String userId) {
        if (rule.getConditions() == null || rule.getConditions().isEmpty()) {
            return true;
        }

        for (Map.Entry<String, String> condition : rule.getConditions().entrySet()) {
            String userTier = userService.getUserTier(userId);
            if ("tier".equals(condition.getKey()) && !condition.getValue().equals(userTier)) {
                return false;
            }
        }

        return true;
    }
}

// ============================================
// 4. HTTP Filter
// ============================================

@Component
@Order(1) // Execute early in filter chain
public class RateLimitingFilter extends OncePerRequestFilter {

    @Autowired
    private RateLimitRulesEngine rulesEngine;

    @Autowired
    private MeterRegistry meterRegistry;

    @Autowired
    private RateLimitProperties properties;

    private static final String[] EXCLUDED_PATHS = {
        "/health",
        "/metrics",
        "/swagger-ui.html",
        "/v3/api-docs"
    };

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                   HttpServletResponse response,
                                   FilterChain filterChain)
            throws ServletException, IOException {

        if (!properties.isEnabled()) {
            filterChain.doFilter(request, response);
            return;
        }

        if (isExcludedPath(request.getRequestURI())) {
            filterChain.doFilter(request, response);
            return;
        }

        // Check rate limits
        RateLimitCheckResult result = rulesEngine.checkRateLimit(request);

        // Set response headers
        setRateLimitHeaders(response, result);

        if (!result.allowed) {
            recordMetrics(result, request);

            response.setStatus(429);
            response.setContentType("application/json");
            response.getWriter().write(String.format(
                "{\"error\": \"Rate limit exceeded\", " +
                "\"rule\": \"%s\", " +
                "\"limit\": %d, " +
                "\"retry_after_seconds\": %d}",
                result.violatedRule,
                result.limit,
                result.resetAfterSeconds
            ));
            return;
        }

        filterChain.doFilter(request, response);
    }

    private void setRateLimitHeaders(HttpServletResponse response, RateLimitCheckResult result) {
        long now = System.currentTimeMillis() / 1000;

        if (result.allowed) {
            response.setHeader("X-RateLimit-Limit", String.valueOf(result.limit));
            response.setHeader("X-RateLimit-Remaining", String.valueOf(result.remaining));
            response.setHeader("X-RateLimit-Reset", String.valueOf(now + result.resetAfterSeconds));
        } else {
            response.setHeader("Retry-After", String.valueOf(result.resetAfterSeconds));
        }
    }

    private void recordMetrics(RateLimitCheckResult result, HttpServletRequest request) {
        meterRegistry.counter(
            "rate_limit.rejected",
            "rule", result.violatedRule,
            "endpoint", request.getRequestURI()
        ).increment();
    }

    private boolean isExcludedPath(String path) {
        return Arrays.stream(EXCLUDED_PATHS).anyMatch(path::startsWith);
    }
}

// ============================================
// 5. Annotation-Based Rate Limiting
// ============================================

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimit {
    int requestsPerMinute() default 100;
    String limitKey() default "endpoint";  // "endpoint" or "user"
}

@Aspect
@Component
public class RateLimitingAspect {

    @Autowired
    private RateLimitRulesEngine rulesEngine;

    @Before("@annotation(rateLimit)")
    public void enforceRateLimit(JoinPoint joinPoint, RateLimit rateLimit) {
        ServletRequestAttributes attributes =
            (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();

        if (attributes != null) {
            HttpServletRequest request = attributes.getRequest();

            // Dynamic rule creation from annotation
            String limitKey = rateLimit.limitKey().equals("endpoint") ?
                "endpoint:" + request.getRequestURI() :
                "endpoint:" + request.getUserPrincipal().getName();

            RateLimitCheckResult result = rulesEngine.checkRateLimit(request);

            if (!result.allowed) {
                throw new RateLimitExceededException(
                    "Rate limit exceeded for: " + limitKey,
                    result.resetAfterSeconds
                );
            }
        }
    }
}

// ============================================
// 6. Data Classes
// ============================================

@Data
public class RateLimitResult {
    public final boolean allowed;
    public final long remaining;
    public final long resetAfterSeconds;
}

@Data
public class RateLimitCheckResult {
    public final boolean allowed;
    public final String violatedRule;
    public final int limit;
    public final long remaining;
    public final long resetAfterSeconds;
}

// ============================================
// 7. Controller Examples
// ============================================

@RestController
@RequestMapping("/api")
public class ApiController {

    @GetMapping("/data")
    public ResponseEntity<?> getData() {
        return ResponseEntity.ok(Map.of("data", "example"));
    }

    @GetMapping("/expensive")
    @RateLimit(requestsPerMinute = 10, limitKey = "endpoint")
    public ResponseEntity<?> expensiveOperation() {
        // Expensive operation with tight rate limit
        return ResponseEntity.ok(Map.of("result", "expensive calculation"));
    }
}

@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<?> handleRateLimitExceeded(
            RateLimitExceededException ex) {

        return ResponseEntity
            .status(429)
            .header("Retry-After", String.valueOf(ex.getRetryAfterSeconds()))
            .body(Map.of(
                "error", "Rate limit exceeded",
                "message", ex.getMessage(),
                "retry_after_seconds", ex.getRetryAfterSeconds()
            ));
    }
}

// Application properties
/*
spring.redis.url=redis://localhost:6379
rate-limit.enabled=true
rate-limit.circuit-breaker-threshold=10
rate-limit.circuit-breaker-window-seconds=60
*/
```

---

## 7. Interview Follow-ups & Discussion

### Question 1: "How would you rate limit across multiple data centers?"

**Mid-Level Answer:**
"We'd replicate the Redis instance across data centers and use each local copy. But that could be inconsistent."

**Senior Answer:**
"There are trade-offs:

1. **Global Redis (Strong Consistency)**
   - Single Redis instance with replication (e.g., AWS ElastiCache with cross-region)
   - Add latency: ~100ms for cross-region writes
   - Pros: Perfect accuracy; Cons: latency spike, single point of failure

2. **Local Rate Limiter + Distributed Sync (Eventual Consistency)**
   - Each DC has local rate limiter (Redis or in-memory)
   - Periodic sync (every 100ms): exchange counters via message queue
   - Pros: <1ms latency, no single point of failure
   - Cons: Users might slightly exceed limit during sync window

3. **Token Bucket with NTP Sync (Hybrid)**
   - Each DC runs token bucket locally
   - Synchronize clock via NTP (ensures they refill at same rate)
   - Very low overhead
   - Works well for distributed systems

**For most FAANG use cases**: Option 2 (local + sync) provides the best balance. Here's why:
- Acceptable accuracy (~99%)
- Minimal latency (<2ms)
- No single point of failure
- Scales to any number of DCs

**Implementation**: Use Apache Kafka or Pulsar to sync rate limit state every 100ms. If sync message is lost, acceptable because:
- They'll resync in next batch
- Over-limit rate is < 1%
"

### Question 2: "How do you handle burst traffic from legitimate users?"

**Mid-Level Answer:**
"Um, we could increase the limit during peak hours?"

**Senior Answer:**
"Bursts are actually a design requirement, not a bug. Here's the approach:

1. **Token Bucket is Natural for Bursts**
   ```
   Limit: 100 requests/minute (average)
   But: Bucket capacity = 500 tokens

   This allows legitimate bursts up to 500 requests,
   then smooths back to 100/min rate
   ```

2. **Graduated Backoff (User-Friendly)**
   - First 120 requests: allowed (20% over limit)
   - Next 50 requests: 50% allowed (random drop)
   - Beyond that: all rejected
   - Users don't get hard block; they degrade gracefully

3. **Premium Burst Quota**
   - Track monthly requests
   - If under monthly limit: allow burst
   - If over: apply strict per-minute limit
   ```java
   if (monthlyRequests < monthlyLimit * 0.8) {
       // Under quota, allow burst
       return tokenBucket.allowRequest();
   } else {
       // Near quota, strict limiting
       return slidingWindowCounter.allowRequest();
   }
   ```

4. **Adaptive Rate Limiting**
   - Monitor error rates downstream
   - If backends healthy: increase limit (up to max)
   - If error rate > 5%: decrease limit
   - Self-healing under varying load

**Best Practice**: Combine token bucket (handles bursts) with periodic audits (detect abuse).
"

### Question 3: "What's the trade-off between accuracy and performance?"

**Mid-Level Answer:**
"Accurate limiting is slower because it requires more processing?"

**Senior Answer:**
"Let me compare the algorithms:

```
Algorithm             Accuracy    Latency    Memory    Production Use
─────────────────────────────────────────────────────────────────────
Token Bucket          95%         0.5ms      O(1)      ✓ Common
Fixed Window          80%         0.1ms      O(1)      ✗ Avoid
Sliding Log           100%        5ms        O(n)      ✓ Small limits
Sliding Counter       99%+        1ms        O(1)      ✓ Standard
```

**The Key Insight**: For distributed systems, we ACCEPT < 100% accuracy:

1. **Why Perfect Accuracy is Impossible in Distributed Systems**
   - Network latency means decisions are based on stale data
   - Synchronizing to perfect accuracy requires 2-phase commit (slow)
   - CAP theorem: choose 2 of (Consistency, Availability, Partition-tolerance)
   - Rate limiting chooses: Availability + Partition-tolerance

2. **Practical Trade-off Formula**
   ```
   Let A = Accuracy %, L = Latency (ms)

   For rate limiting: A * L should be minimized

   Token Bucket:      95% * 0.5ms = 47.5  ← Best for most cases
   Sliding Counter:   99% * 1ms = 99      ← Best for strict SLAs
   Sliding Log:       100% * 5ms = 500    ← Only for compliance
   ```

3. **When to Use Each**
   - **99%+ Accuracy Needed**: Sliding Window Counter + Local Cache
     - Use case: API monetization, billing-critical limits
     - Implement: Sync every 100ms from Redis to local cache
     - Latency: <1ms, Accuracy: 99.5%

   - **95% Accuracy OK**: Token Bucket
     - Use case: Most APIs, DDoS protection
     - Implement: Pure client-side or local Redis
     - Latency: <0.5ms, Accuracy: 95%

   - **80% Accuracy Acceptable**: Fixed Window with burst allowance
     - Use case: Loose limits, monitoring only
     - Implement: Simple counter
     - Latency: <0.1ms, Accuracy: 80%

**Real Example**: At scale, 1% inaccuracy = 1000 requests over limit per 100k requests. Magnitude: acceptable.
"

### Question 4: "Design a rate limiter for a new API. Walk me through your decisions."

**Structured Answer:**

1. **Clarify Requirements (5 min)**
   ```
   - Expected load: 100k requests/sec? 1M/sec?
   - Accuracy requirements: Billing-critical or DDoS-protection?
   - Multi-region deployment?
   - User tiers: free/premium or flat?
   - Burst allowance needed?
   ```

2. **High-Level Design (10 min)**
   ```
   For 100k req/sec with 3-tier system:

   Tier 1 (Client): Client-side rate limiting (library)
   → Saves round trips, prevents obvious abuse

   Tier 2 (Gateway): Sliding Window Counter with Redis
   → Catches coordinated attacks
   → 1ms latency, 99% accuracy

   Tier 3 (Service): Local token bucket
   → Circuit breaker for backend protection
   → Rejects if cascading

   Why 3 tiers?
   - Client side: saves latency cost
   - Gateway: distributed enforcement
   - Service: last-mile protection
   ```

3. **Data Model**
   ```java
   Key: "rate_limit:{limitKey}"
   Value: {
       count: long,        // Current count
       windowStart: long,  // Window start timestamp
       tier: string        // "free" or "premium"
   }

   Example keys:
   - rate_limit:user:123456
   - rate_limit:ip:192.168.1.1
   - rate_limit:api_key:sk_live_123456
   ```

4. **Configuration**
   ```yaml
   limits:
     free_user:
       per_minute: 100
       per_hour: 5000
       per_day: 50000

     premium_user:
       per_minute: 10000
       per_hour: 500000
       per_day: 5000000

     api_key:
       per_minute: 500
       per_hour: 25000

     ip:
       per_minute: 1000
       per_hour: 50000
   ```

5. **Failure Scenarios**
   ```
   Scenario 1: Redis down
   → Fail open with local circuit breaker
   → Allow 80% of requests (random drop)
   → Prevents complete outage

   Scenario 2: Rate limit too strict (misconfiguration)
   → Monitor 429 rate
   → Auto-adjust if > 10% of traffic

   Scenario 3: Sudden traffic spike
   → Token bucket naturally handles (burst up to capacity)
   → If sustained, hit hard limit

   Scenario 4: DDoS attack
   → Increase IP-level limits
   → Customer tiers unaffected
   → Send alert to security team
   ```

6. **Monitoring & Alerts**
   ```
   Metrics:
   - rate_limit.rejected (tagged by rule)
   - rate_limit.redis.latency (p50, p95, p99)
   - rate_limit.redis.errors

   Alerts:
   - 429 rate > 5% of traffic → misconfiguration
   - Redis latency p99 > 10ms → redis performance issue
   - Redis connection failures → failover or scaling
   - One IP causing > 50% of 429s → DDoS detection
   ```

7. **Estimated Costs**
   ```
   For 100k req/sec with 1 year of data retention:

   Redis Memory:
   - 1000 concurrent users × 10 keys each × 100 bytes = 1MB
   - Manageable with standard Redis (2GB instance)

   Network:
   - INCR + EXPIRE per request = 2 Redis commands
   - 100k req/sec × 2 commands = 200k commands/sec
   - AWS ElastiCache (cache.m5.large) handles 200k ops/sec ✓

   Cost: ~$0.50/day for rate limiter infrastructure
   ```

---

## Senior vs Mid-Level Comparison

| Aspect | Mid-Level | Senior |
|---|---|---|
| **Algorithm Choice** | "Use Redis to count requests" | "Token bucket for bursts, sliding window for accuracy" |
| **Distributed System** | "Put Redis on each server" | "Centralized Redis with local cache, eventual consistency" |
| **Failure Handling** | "Reject all if Redis down" | "Graceful degradation, fail open with circuit breaker" |
| **Configuration** | "Hardcode limits in code" | "External rules engine, no-recompile updates" |
| **Accuracy** | "Must be 100% accurate" | "99% is fine, 1% over-limit acceptable" |
| **Performance** | "Minimize Redis calls" | "Optimize for latency, trade accuracy for performance" |
| **Monitoring** | "Check error logs" | "Detailed metrics, auto-scaling rules, anomaly detection" |
| **Multi-tier** | "One rate limit per user" | "Per-user, per-IP, per-API-key, per-endpoint, global" |

---

## Key Takeaways

### For Interviews

1. **Start with Requirements**: Ask clarifying questions about scale, consistency, failure modes
2. **Choose Appropriate Algorithm**: Token Bucket (simple), Sliding Window Counter (accurate), Lua+Redis (distributed)
3. **Handle Distributed Complexity**: Local caching, eventual consistency, graceful degradation
4. **Plan for Failures**: What if Redis is down? Circuit breaker, fail open with limits
5. **Think About Operations**: Monitoring, alerting, easy configuration changes
6. **Discuss Trade-offs**: Accuracy vs latency, consistency vs availability

### For Implementation

1. Use **Sliding Window Counter** with local Redis for 99%+ accuracy
2. Implement **multi-level limiting** (per-user, per-IP, per-API-key)
3. Make limits **configurable** without code changes
4. Always return **rate limit headers** (Retry-After, X-RateLimit-*)
5. Handle **Redis failures** gracefully (fail open with local limits)
6. Monitor everything and set up **alerts** for anomalies

---

## Additional Resources

- **Papers**: "Token Bucket Filter" by Sally Floyd and Van Jacobson
- **Cloud Providers**: AWS API Gateway rate limiting, Google Cloud quota management
- **OSS Libraries**: Bucket4j (Java), go-rate (Go), PyRate (Python)
- **Benchmarking**: Load test with Apache JMeter or Gatling

---

**Last Updated**: February 2025
**Estimated Interview Time**: 60-90 minutes for full walkthrough
