# System Design Fundamentals for FAANG Interviews

## Table of Contents
1. [How FAANG System Design Interviews Work](#how-faang-system-design-interviews-work)
2. [The 5-Step Framework](#the-5-step-framework)
3. [Requirements Analysis](#requirements-analysis)
4. [Back-of-Envelope Estimation](#back-of-envelope-estimation)
5. [Key Metrics and SLA](#key-metrics-and-sla)
6. [CAP Theorem](#cap-theorem)
7. [Consistency Models](#consistency-models)
8. [SLAs, SLOs, SLIs](#slas-slos-slis)

---

## How FAANG System Design Interviews Work

### Interview Format (45-60 minutes)

**Timeline Breakdown:**
- **0-2 min**: Greeting, understand the problem statement
- **2-10 min**: Clarify requirements (functional and non-functional)
- **10-20 min**: High-level design with architecture diagram
- **20-40 min**: Deep dive into 2-3 critical components
- **40-50 min**: Discuss bottlenecks, trade-offs, and improvements
- **50-60 min**: Q&A, back-of-envelope calculations verification

### Interviewer's Lens

Interviewers are looking for:
1. **Communication**: Can you articulate your thinking?
2. **Problem decomposition**: Can you break complex problems into components?
3. **Technical depth**: Do you understand trade-offs?
4. **Pragmatism**: Can you make reasonable assumptions?
5. **Scalability mindset**: Can you design for millions of users?
6. **Recovery thinking**: How do you handle failures?

### Common System Design Questions at FAANG

**Frequency ranking:**
1. Design Twitter/X Feed (most common at Meta)
2. Design URL Shortener (good baseline, Google/Amazon)
3. Rate Limiter (infrastructure focus, Uber/Stripe)
4. Design a Cache/Distributed Cache (LinkedIn, Adobe)
5. Design Key-Value Store (Amazon, Google)
6. Design WhatsApp/Chat System (Meta, Microsoft)
7. Design YouTube (Video company interviews)
8. Design Search Engine (Google, Microsoft, Airbnb)
9. Design Notification System (Infrastructure)
10. Design Database (Amazon, Google, Microsoft)

---

## The 5-Step Framework

### Step 1: Clarify Requirements

This is often overlooked but CRITICAL. Spend 5-10 minutes here.

**Functional Requirements** (What does the system do?):
- What are the core features?
- What are we NOT building? (scope control)
- Who are the users?
- What's the primary use case?

**Non-Functional Requirements** (How does it perform?):
- Scale: How many users? QPS?
- Latency: Response time requirements?
- Availability: Uptime requirements (99.9% vs 99.99%)?
- Consistency: Strict consistency or eventual?
- Durability: Data loss acceptable?
- Security: Authentication/encryption needs?
- Multi-tenancy/regions: Geographic distribution?

### Step 2: Back-of-Envelope Estimation

**Calculate:**
1. Daily Active Users (DAU)
2. Queries Per Second (QPS)
3. Storage requirements
4. Bandwidth needed
5. Key throughput numbers

### Step 3: High-Level Design

**Create:**
- Architecture diagram (2-3 layers)
- Technology choices
- Data flow
- System components

**Your diagram should show:**
```
[Client] → [API Gateway/Load Balancer] → [Service Layer] → [Data Layer]
```

### Step 4: Deep Dive

Pick 2-3 critical components and go deep:
- How does caching work?
- How do you handle sharding?
- What happens when a node fails?
- How do you ensure consistency?

### Step 5: Bottlenecks and Improvements

- What's your biggest bottleneck?
- How do you solve it?
- What trade-offs did you make?
- What would you do differently at 10x scale?

---

## Requirements Analysis

### Example: Designing Twitter Feed

**Functional Requirements:**
- Users can create/delete tweets
- Users can view their home feed (timeline)
- Users can follow/unfollow other users
- Tweets should be visible immediately to followers
- Support likes, retweets, replies

**Non-Functional Requirements:**
- DAU: ~300M (Twitter scale)
- Write QPS: 3M tweets/day ÷ (86400s) ≈ 35 write QPS
- Read QPS: 1B feed views/day ÷ (86400s) ≈ 11.5K read QPS (much higher!)
- Latency: Feed should load in <200ms
- Availability: 99.99% (52 min/year downtime)
- Consistency: Eventual consistency acceptable (a few seconds lag)

### Questions to Ask

1. **Scale**: "What's the expected user base?"
2. **Latency**: "What's the latency requirement?"
3. **Consistency**: "Do we need strong or eventual consistency?"
4. **Durability**: "Is data loss acceptable?"
5. **Features**: "Is feature X in scope?"

---

## Back-of-Envelope Estimation

### Key Formula: QPS Calculation

```
QPS = Daily Operations / Seconds per Day
    = Daily Operations / 86,400

Example:
- 500M daily active users
- Each user posts 1 tweet per day = 500M writes/day
- Assuming uniform distribution: 500M / 86,400 ≈ 5,800 write QPS

- Each user views feed 10 times/day = 5B reads/day
- 5B / 86,400 ≈ 57,870 read QPS
```

### Storage Estimation

```
Total Storage = Daily Data Size × Retention Period

Example: Twitter Tweets
- Average tweet size: 300 bytes (text, metadata, timestamps)
- 500M tweets/day × 300 bytes = 150 GB/day
- Keep data for 5 years: 150 GB × 365 × 5 = 273.75 TB

Add 3x for replication/redundancy: ~820 TB
Add 2x for indexes and other metadata: ~1.6 PB
```

### Bandwidth Estimation

```
Bandwidth = QPS × Average Payload Size

Example: Twitter Feed
- Read QPS: 57,870
- Average feed response: 100 tweets × 300 bytes = 30 KB
- Bandwidth: 57,870 × 30 KB = 1.74 GB/s (egress)
```

### Practical Calculation Template

```
Step 1: Get User Base
- Monthly Active Users (MAU) = 300M
- Daily Active Users (DAU) = MAU × 30-40% = 100M

Step 2: Calculate QPS
- Avg operations per user per day = 10
- Total daily operations = 100M × 10 = 1B
- QPS = 1B / 86,400 ≈ 11,574

Step 3: Peak QPS
- Peak is usually 2-3x average
- Peak QPS ≈ 11,574 × 3 = 34,722

Step 4: Storage
- Data size per operation = 1 KB
- Daily data = 1B operations × 1 KB = 1 TB/day
- Yearly storage = 1 TB × 365 = 365 TB
- With replication: 365 TB × 3 = 1.1 PB

Step 5: Bandwidth
- Write bandwidth = 34,722 (peak) × 1 KB = 34.7 MB/s
- Read bandwidth = (if different ratio) × payload size
```

### Real-World Example: YouTube-scale Estimation

```
YouTube Stats:
- DAU: 500M
- Video uploads: 500+ hours/minute

Calculation:
- 500 hours/min = 500 × 60 = 30,000 hours/day
- Upload QPS = (30,000 × 3600 sec) / 86,400 = 1,250 upload QPS
- Average video file: 2 GB
- Storage/day = 30,000 hours × 2 GB = 60 PB/day for raw video
- Add transcoding (5 different qualities): 60 × 5 = 300 PB/day
- Keep 1 year: 300 PB × 365 = 109,500 PB = 109.5 Exabytes (!)

This is why YouTube uses edge caching and CDN heavily.
```

### Common Mistakes in Estimation

1. **Forgetting peak QPS** - Use 2-3x average for infrastructure planning
2. **Ignoring replication** - Always multiply storage by replication factor (2-3x)
3. **Underestimating metadata** - Indexes can be 1-2x the raw data
4. **Wrong unit conversions** - GB vs TB vs PB (1024x differences!)
5. **Assuming uniform distribution** - Real systems have hot spots (80/20 rule)

---

## Key Metrics and SLA

### Core Metrics

#### Latency (Responsiveness)
```
Typical values (2024):
- In-memory database lookup: 1-10 microseconds
- SSD random read: 100-200 microseconds
- Network round trip (same datacenter): 1 millisecond
- Network round trip (different continent): 100-300 milliseconds
- Disk HDD random read: 10-20 milliseconds
- Database query: 10-100 milliseconds
- API call (with network): 100-500 milliseconds
- User page load: 1-2 seconds
```

**Rule of thumb:** Keep p99 latency < 2 seconds for user-facing features.

#### Throughput (Capacity)
```
Throughput = Requests Per Second (RPS/QPS)

Example capacities:
- Single database: 1,000-5,000 QPS
- Single server with caching: 10,000-100,000 QPS
- Message queue: 100,000-1M QPS
- Large CDN: 10M+ QPS
```

#### Availability (Uptime)

```
Availability percentages and downtime per year:

99%     = 87.6 hours downtime/year      (too low for production)
99.5%   = 43.8 hours downtime/year
99.9%   = 8.76 hours downtime/year      (standard for web services)
99.95%  = 4.38 hours downtime/year      (common for SaaS)
99.99%  = 52.6 minutes downtime/year    (difficult, requires redundancy)
99.999% = 5.26 minutes downtime/year    (very difficult)

Downtime = 365 × 24 × 60 × (1 - availability)
```

**Caveat:** Availability is often about your weakest component. A system with 3 components (each 99.9% available) is:
```
Combined availability = 0.999^3 = 99.7% (lower than single components!)
```

### Percentile Metrics (P99, P95, etc.)

When reporting latency, percentiles matter more than averages:

```
Example: API response times for 1,000 requests

P50 (median):  100ms  (50% of users experience ≤100ms)
P95:           500ms  (95% of users experience ≤500ms)
P99:           2000ms (99% of users experience ≤2000ms)
P99.9:         5000ms (most users fast, but 0.1% very slow)

Average might be 150ms (misleading!), but P99 = 2s tells a different story.
```

**Best practice:** Always report P99 or P95, not just average.

---

## CAP Theorem

The CAP Theorem states that distributed systems can only guarantee 2 out of 3 properties:

```
        ┌─────────────────────────────┐
        │         CONSISTENCY         │
        │  All replicas have same     │
        │  data at all times          │
        └────────────────┬────────────┘
                         │
                    ┌────┴────┐
                    │          │
            ┌───────▼──────┐  ┌───────▼──────┐
            │  CP System   │  │  CA System   │
            │ (Google Spanner
            │  HBase)      │  │ (Traditional │
            │              │  │  RDBMS)      │
            └──────────────┘  └──────────────┘
                    │              │
                    │              │
            ┌───────┴──────┐  ┌───────┴──────┐
            │   Partition  │  │ Availability │
            │  Tolerant    │  │  Tolerant    │
            └──────────────┘  └──────────────┘
```

### CP Systems (Consistency over Availability)

**What they sacrifice:** Availability during network partitions

**Examples:**
- Google Spanner
- HBase
- Traditional SQL databases
- Zookeeper

**When to use:**
- Financial transactions (need consistency)
- Banking systems
- Critical inventory management
- When consistency violations are catastrophic

**Trade-off:** System becomes unavailable when partition occurs.

### AP Systems (Availability over Consistency)

**What they sacrifice:** Consistency during network partitions

**Examples:**
- Cassandra
- DynamoDB
- Memcached
- Most NoSQL databases

**When to use:**
- Social media feeds (eventual consistency okay)
- Caches
- Time-series data
- Recommendation systems

**Trade-off:** Data might be temporarily inconsistent across replicas.

### Real World Example: E-commerce System

```
Scenario: Customer places order during network partition

CP Approach (e.g., PostgreSQL with strong consistency):
├─ Partition occurs
├─ Can't replicate order to backup datacenter
├─ System blocks/errors to user
└─ "Service temporarily unavailable" (loss of availability)

AP Approach (e.g., DynamoDB):
├─ Partition occurs
├─ Accept order locally
├─ Queue for replication when partition heals
├─ Order succeeds immediately (high availability)
└─ Risk: Inconsistency if orders replicated differently
```

**Hybrid approach in practice:**
- Use AP for reads (feed, recommendations)
- Use CP for writes (payments, orders)
- Use eventual consistency with conflict resolution

---

## Consistency Models

### 1. Strong Consistency (Linearizability)

```
Definition: Every read returns the most recent write.

Timeline:
Time: 0ms    20ms    40ms    60ms    80ms
      ├─────┤       ├─────┤
      Write X=1    Read X
           │           │
           └─Write seen by read
```

**Pros:**
- Intuitive (works like single machine)
- No conflicts
- Easy to reason about

**Cons:**
- Slow (must wait for all replicas)
- High latency
- Can't tolerate partition

**Examples:** PostgreSQL, Google Spanner, MongoDB (with write concern: majority)

### 2. Eventual Consistency

```
Definition: Replicas eventually converge to the same value.
           No guarantee about intermediate states.

Timeline for replicas A, B, C:

Replica A: X=1 (t=0)   X=2 (t=10)   X=2 (t=20) ✓
Replica B: X=1 (t=0)                X=2 (t=30) ✓
Replica C: X=1 (t=0)   X=2 (t=15)   X=2 (t=20) ✓

Gap between updates and consistency = "replication lag"
```

**Pros:**
- Fast (doesn't wait for replicas)
- High availability
- Fault tolerant

**Cons:**
- Reads might see old data
- Conflicts possible (requires resolution)
- Complex to understand

**Examples:** DynamoDB, Cassandra, most caches

### 3. Causal Consistency

```
Definition: If B depends on A, then all replicas see A before B.
           Causally unrelated events can be out of order.

Example: Chat application
├─ User1: "What's the answer?" (message A)
├─ User2: "It's 42" (message B - depends on A)
└─ Causal consistency ensures all users see A before B

But two independent messages can be seen in different order
```

**Pros:**
- Stronger than eventual, weaker than strong
- Captures real-world causality
- Better than eventual for some applications

**Cons:**
- Complex to implement
- Still requires distributed consensus

**Examples:** Facebook, Google+ (for social ordering)

### 4. Weak Consistency

```
Definition: No guarantees about order or when updates appear.
           Different replicas can show completely different versions.

Example: DNS (TTL-based caching)
- Update DNS record
- Different clients see old or new record
- No ordering guarantee
- Updates eventually appear
```

**Pros:**
- Extremely fast
- Highly available

**Cons:**
- Hard to reason about
- Data can diverge indefinitely

**Examples:** DNS, Memcached, some caches

### Consistency Models Comparison Table

```
┌─────────────────┬──────────────┬────────────┬──────────────┐
│ Model           │ Latency      │ Tolerance  │ Correctness  │
├─────────────────┼──────────────┼────────────┼──────────────┤
│ Strong          │ High         │ Poor       │ Perfect      │
│ Causal          │ Medium       │ Good       │ Good         │
│ Eventual        │ Low          │ Excellent  │ Weak         │
│ Weak            │ Very Low     │ Excellent  │ Very Weak    │
└─────────────────┴──────────────┴────────────┴──────────────┘

Use strong consistency when:
- Correctness is critical (banking, inventory)
- Conflicts are unacceptable
- Queries need latest data

Use eventual consistency when:
- Availability matters more than consistency
- Stale data is acceptable
- Scale matters
```

### Handling Inconsistency: Conflict Resolution

When you choose AP systems, conflicts happen. How to resolve?

```
Example: Two users update same field simultaneously

Last-Write-Wins (LWW):
├─ User A: name = "Alice" (timestamp: 100)
├─ User B: name = "Alice Smith" (timestamp: 105)
└─ Winner: "Alice Smith" (higher timestamp)
   (But what if clocks are wrong?)

Vector Clocks:
├─ Track causal history
├─ Detect concurrent vs sequential updates
└─ Requires application-level merging

Application-level Merging:
├─ Store all conflicting versions
├─ Let application decide (e.g., phone contacts: merge all)
└─ Example: "Alice" + "Alice Smith" = "Alice Smith"
```

---

## SLAs, SLOs, SLIs

### Definitions (Critical to understand!)

**SLI (Service Level Indicator):** The metric
```
"API p99 latency is 200ms"
"Uptime is 99.9%"
"Error rate is 0.1%"
```

**SLO (Service Level Objective):** The target
```
"We commit to p99 latency ≤ 200ms"
"We commit to 99.95% availability"
"Error rate < 0.01%"
```

**SLA (Service Level Agreement):** The contract
```
"If we miss SLO, you get 10% credit"
"If we miss availability target, compensation applies"
(Legal/financial implications)
```

### Example: AWS S3 SLA

```
SLI: Availability measured every month
SLO: 99.99% availability (52.6 minutes downtime/month)
SLA:
├─ If availability 99.9-99.99%: 10% monthly charge credit
├─ If availability 99-99.9%: 30% monthly charge credit
└─ If availability < 99%: 100% monthly charge credit
```

### Setting Realistic SLOs

**Step 1: Measure current performance**
```
Run service for 1 month, measure:
- P99 latency
- Error rate
- Uptime
```

**Step 2: Determine acceptable levels**
```
Be conservative:
- If current p99 = 300ms, SLO = 500ms (not 300ms)
- If current error rate = 0.05%, SLO = 0.1% (not 0.05%)
- Reason: You need buffer for growth/peaks/failures
```

**Step 3: Add monitoring and alerting**
```
SLO: 99.9% availability
├─ Critical alert: Error rate > 0.5% for 5 min
├─ Warning alert: Error rate > 0.2% for 10 min
└─ Dashboard: Real-time error rate, latency percentiles
```

### Error Budget Concept

```
If SLO = 99.9%, you have an error budget:

Error Budget = (1 - SLO) × Time
             = 0.1% × 30 days × 24 hours × 60 min
             = 43.2 minutes/month

This means:
├─ You can have 43 minutes of downtime/errors per month
├─ Use this budget wisely:
│  ├─ 10 min for deploying new feature
│  ├─ 20 min for infrastructure upgrade
│  └─ 13 min for unexpected issues
└─ Once budget exhausted: freeze changes until next month
```

### SLI Examples by System Type

```
Web Application:
├─ Availability: % of successful requests
├─ Latency: P99 response time < 200ms
└─ Error rate: < 0.1%

Database:
├─ Availability: % of connection requests succeeding
├─ Latency: P99 query time < 100ms
└─ Durability: 0 data loss

Message Queue:
├─ Availability: Queue operational
├─ Latency: P99 message processing < 1 second
└─ Durability: All messages persisted
```

### SLO for Different Tiers

```
Tier 1 (Critical):
├─ Payment processing
├─ Authentication
└─ SLO: 99.99% (5 min/month downtime)

Tier 2 (High Priority):
├─ User feeds
├─ Search
└─ SLO: 99.9% (43 min/month downtime)

Tier 3 (Standard):
├─ Recommendations
├─ Analytics
└─ SLO: 99% (432 min/month downtime)
```

---

## Key Takeaways

1. **Requirements → Estimation → Design → Deep Dive → Trade-offs** (follow this order)
2. **Back-of-envelope math** is essential (practice conversions: bits, bytes, KBs, GBs)
3. **Trade-offs are everywhere** - no perfect solution
4. **Consistency vs Availability** - understand CAP and pick your poison
5. **Scale matters** - design decisions change at different scales
6. **Metrics and monitoring** - can't optimize what you don't measure

---

## Practice Exercise

**Design a URL shortener (60 minutes):**

1. (5 min) Requirements: DAU? Write QPS? Read/Write ratio?
2. (5 min) Estimation: Storage for 10 years? Bandwidth?
3. (15 min) High-level design: Components? Technology?
4. (20 min) Deep dive: Hashing? Sharding? Cache?
5. (10 min) Bottlenecks: What breaks first? How to scale?
6. (5 min) Questions: What would you do at 10x scale?

Time yourself. The clock is ticking!
