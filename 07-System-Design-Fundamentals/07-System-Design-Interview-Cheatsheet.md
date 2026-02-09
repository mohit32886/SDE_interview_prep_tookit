# System Design Interview Cheatsheet

Quick reference guide for system design interviews. Use this to quickly reference key concepts, formulas, and talking points.

---

## The 5-Step Framework (Memorize This!)

```
┌─────────────────────────────────┐
│1. REQUIREMENTS (5-10 min)       │
│   ├─ Functional: What it does   │
│   └─ Non-functional: How it runs│
│                                 │
│2. ESTIMATION (10-15 min)        │
│   ├─ QPS, storage, bandwidth    │
│   └─ Back-of-envelope math      │
│                                 │
│3. HIGH-LEVEL DESIGN (10-15 min) │
│   ├─ Architecture diagram       │
│   ├─ Technology choices         │
│   └─ Component overview         │
│                                 │
│4. DEEP DIVE (15-20 min)         │
│   ├─ Pick 2-3 critical parts    │
│   ├─ Explain algorithms         │
│   └─ Address trade-offs         │
│                                 │
│5. BOTTLENECKS & SCALE (5-10 min)│
│   ├─ What breaks first?         │
│   ├─ How to handle 10x growth?  │
│   └─ Questions: "What if...?"   │
└─────────────────────────────────┘
```

---

## Estimation Formulas (Commit These to Memory)

### QPS Calculation

```
QPS = Daily Operations / 86,400 seconds
Peak QPS = Average QPS × 2-3 (for traffic spikes)

Example:
- 500M operations/day
- QPS = 500M / 86,400 = 5,787
- Peak = 5,787 × 3 = 17,361 QPS
```

### Storage Calculation

```
Daily Storage = Daily Operations × Average Data Size
Total Storage = Daily Storage × Retention Days × Replication Factor

Example:
- 500M operations/day
- 1 KB per operation
- 3x replication (for HA)
- 1 year retention

Daily = 500M × 1KB = 500 GB
Yearly = 500GB × 365 × 3 = 547.5 TB
```

### Bandwidth Calculation

```
Bandwidth = QPS × Average Payload Size

Example:
- 10K read QPS
- 100 KB per response
- Bandwidth = 10K × 100 KB = 1 GB/s egress
```

### Concurrent Users

```
Concurrent Users = DAU × (Peak Hour % / 24) × Session Duration

Example:
- 100M DAU
- 10% active in peak hour
- Avg session: 10 min = 1/6 hour
- Concurrent = 100M × 0.1 × (1/6) = 1.67M users
```

---

## Numbers Every Engineer Should Know

```
LATENCY (from Latency Numbers Every Programmer Should Know):

L1 cache reference              ~1 nanosecond
L2 cache reference              ~4 nanoseconds
RAM access                       ~100 nanoseconds
Disk seek                        ~10 milliseconds
Network round-trip (same DC)     ~1 millisecond
Network round-trip (different DC)~100 milliseconds
Network round-trip (across world)~200-300 milliseconds

MEMORY:
1 MB    = 1,024 KB
1 GB    = 1,024 MB
1 TB    = 1,024 GB
1 PB    = 1,024 TB

TIME:
1 minute   = 60 seconds
1 hour     = 3,600 seconds
1 day      = 86,400 seconds
1 year     = 31,536,000 seconds

CAPACITY:
Single database server: 1K-5K QPS
Redis cache server: 10K-100K QPS
Message queue: 100K-1M QPS
CDN: 10M+ QPS
```

---

## One-Pager: Building Blocks

### When to Use Each Technology

```
┌────────────────┬─────────────────┬──────────────────┬─────────────┐
│Technology      │Use Case         │Throughput        │Trade-off    │
├────────────────┼─────────────────┼──────────────────┼─────────────┤
│PostgreSQL      │Structured data, │1-5K QPS          │Vertical     │
│                │ACID needed      │                  │scaling only │
├────────────────┼─────────────────┼──────────────────┼─────────────┤
│MongoDB         │Flexible schema, │5-10K QPS         │Eventual     │
│                │document model   │                  │consistency  │
├────────────────┼─────────────────┼──────────────────┼─────────────┤
│Redis           │Caching, sessions│50-100K QPS       │In-memory,   │
│                │real-time data   │                  │limited size │
├────────────────┼─────────────────┼──────────────────┼─────────────┤
│Elasticsearch   │Full-text search │10K-100K QPS      │Not for      │
│                │log indexing     │                  │strong ACID  │
├────────────────┼─────────────────┼──────────────────┼─────────────┤
│Kafka           │Async processing,│100K-1M QPS       │Not database │
│                │event streaming  │                  │(no storage) │
├────────────────┼─────────────────┼──────────────────┼─────────────┤
│S3/Blob Storage │Files, images,   │Unlimited GB      │Not optimized│
│                │videos           │                  │for retrieval│
├────────────────┼─────────────────┼──────────────────┼─────────────┤
│CDN             │Static content,  │Millions QPS      │Cache only,  │
│                │videos           │                  │doesn't store│
├────────────────┼─────────────────┼──────────────────┼─────────────┤
│GraphDB         │Relationships,   │10K QPS           │Limited scale│
│                │recommendations  │                  │            │
├────────────────┼─────────────────┼──────────────────┼─────────────┤
│Cassandra       │Time-series, mega│100K-1M QPS       │Complex ops, │
│                │scale write      │                  │eventual cons│
└────────────────┴─────────────────┴──────────────────┴─────────────┘
```

### Load Balancing Algorithms

```
Round-Robin:
├─ When: Equal capacity servers
└─ Use: Stateless services (web servers)

Least Connections:
├─ When: Long-lived connections (WebSocket, database)
└─ Use: Varying load patterns

Weighted Round-Robin:
├─ When: Different capacity servers
└─ Use: Heterogeneous clusters

IP Hash / Consistent Hash:
├─ When: Need sticky sessions
└─ Use: Caching, state-dependent services
```

### Caching Strategies (Decision Tree)

```
Need to cache data?
│
├─ HOW IS IT ACCESSED?
│  │
│  ├─ Mostly reads, occasional writes
│  │  └─ Use: Cache-Aside (Lazy Loading)
│  │
│  ├─ Frequent writes, some reads
│  │  └─ Use: Write-Behind
│  │
│  └─ Mixed, need consistency
│     └─ Use: Write-Through
│
├─ WHEN TO EVICT?
│  │
│  ├─ Recently accessed items matter
│  │  └─ Use: LRU (Least Recently Used)
│  │
│  ├─ Frequently accessed items matter
│  │  └─ Use: LFU (Least Frequently Used)
│  │
│  └─ Time-based expiration
│     └─ Use: TTL (Time To Live)
│
└─ PROTECT AGAINST?
   │
   ├─ Many misses at same time
   │  └─ Use: Probabilistic Early Expiration
   │
   ├─ Requests for non-existent data
   │  └─ Use: Bloom Filter + Cache Negative Results
   │
   └─ Multiple node failures
      └─ Use: Redundant Cache Nodes
```

---

## Rate Limiting Comparison

```
┌──────────────┬─────────────────┬──────────────┬────────────────┐
│Algorithm     │Latency          │Burstable     │Distributed     │
├──────────────┼─────────────────┼──────────────┼────────────────┤
│Token Bucket  │< 1ms (memory)   │Yes (burst)   │Redis (SPOF)    │
│Leaky Bucket  │< 1ms (memory)   │No (smooth)   │Redis (SPOF)    │
│Fixed Window  │< 1ms (memory)   │Yes (edge)    │Redis (SPOF)    │
│Sliding Window│2-5ms (sorted)   │No (accurate) │Redis (SPOF)    │
└──────────────┴─────────────────┴──────────────┴────────────────┘

Default: Token Bucket (AWS, Google use this)
```

---

## Sharding Strategy Decision Tree

```
Need to shard?
│
├─ YES: Data > Single server capacity
│  │
│  ├─ SHARD KEY KNOWN UPFRONT?
│  │  │
│  │  ├─ YES: Use Hash-Based or Range-Based
│  │  │
│  │  └─ NO: Use Directory-Based (flexibility)
│  │
│  ├─ HOW TO SELECT STRATEGY?
│  │  │
│  │  ├─ Range-based: Good for range queries
│  │  │  Problem: Hotspots (uneven distribution)
│  │  │
│  │  ├─ Hash-based: Even distribution
│  │  │  Problem: Rebalancing is nightmare
│  │  │
│  │  └─ Consistent Hash: Best of both
│  │     Solution: Virtual nodes + rebalancing
│  │
│  └─ HANDLE HOTSPOTS?
│     │
│     ├─ Replicate hot key
│     ├─ Cache aggressively
│     ├─ Or: Accept uneven load (OK for 20% hotspot)
│     └─ Last resort: Separate shard for hot data
│
└─ NO: Single server enough (most cases!)
```

---

## Consistency vs Availability Trade-off

```
CAP Theorem Matrix:

                 CONSISTENCY
                 (All replicas same)
                     │
        ┌────────────┼────────────┐
        │            │            │
    CP System     Neither       AP System
    ├─ Database  │ (bad!)    └─ Cache
    └─ Strong    │             └─ NoSQL
     guarantees  │
                PARTITION
             TOLERANCE
             (handle split)

For your system:

If you MUST have consistency:
└─ Use: SQL database (PostgreSQL)
└─ Accept: Limited scalability

If you MUST have availability:
└─ Use: NoSQL (Cassandra, DynamoDB)
└─ Accept: Eventual consistency

If you MUST scale to billions:
└─ Use: Hybrid approach
├─ Consistency for critical (payments, orders)
├─ Eventual for non-critical (feeds, recommendations)
└─ Separate databases by use case
```

---

## Latency vs Storage Trade-off

```
System Tiers:

                    LATENCY        CAPACITY
┌──────────────────────────────────────────┐
│L1: CPU Cache    │ 1ns            │ MB    │
│L2: Memory (RAM) │ 100ns          │ GB    │
│L3: SSD          │ 100µs          │ TB    │
│L4: Redis        │ 1ms            │ GB-TB │
│L5: Database     │ 10-100ms       │ TB-PB │
│L6: Blob Storage │ 100-500ms      │ EB    │
│L7: Archive      │ 5-60 seconds   │ EB    │
└──────────────────────────────────────────┘

Optimization strategy:
├─ Put hot data in Redis (cache everything accessed in last 24h)
├─ Put warm data in database
├─ Archive old data (older than 1 year)
└─ Result: 99% of queries hit cache (< 1ms)
```

---

## Red Flags (What NOT to Do)

```
❌ Single Point of Failure
   Problem: One server down = entire system down
   Solution: Redundancy (master-slave, master-master)

❌ Unsharded Monolithic Database
   Problem: Can't scale past single server (1-5K QPS max)
   Solution: Shard by key, use distributed databases

❌ No Caching
   Problem: Database queries are slow (10-100ms each)
   Solution: Cache layer (Redis) between app and DB

❌ Synchronous Everything
   Problem: One slow operation blocks entire system
   Solution: Async with message queue (Kafka)

❌ No Monitoring
   Problem: Can't detect when system breaks
   Solution: Metrics, alerts, dashboards

❌ Database as Queue
   Problem: Polling is inefficient, slow
   Solution: Use message queue (Kafka, RabbitMQ)

❌ Single Datacenter
   Problem: Regional outage = 100% downtime
   Solution: Multi-region replication

❌ No Load Balancing
   Problem: Traffic concentration on single server
   Solution: Load balancer distributes traffic

❌ Unbounded Data
   Problem: Keeps growing (storage explodes)
   Solution: TTL, archival, data lifecycle policies

❌ No Idempotency
   Problem: Retries cause duplicate operations
   Solution: Idempotent APIs, deduplication keys
```

---

## How to Handle "What If..." Questions

```
Common "What if" questions and how to answer:

Q: "What if traffic increases 10x?"
   A: "Scale horizontally:
      - Add more app servers (stateless)
      - Add shards to database
      - Increase CDN capacity
      - Cost would increase ~10x"

Q: "What if database fails?"
   A: "Replication handles it:
      - Master-slave setup
      - If master fails, promote slave to master
      - Downtime: < 1 minute
      - No data loss (synchronous replication)"

Q: "What if there's a network partition?"
   A: "Depends on consistency requirements:
      - Critical systems: use CP (consistency wins)
      - General systems: use AP (availability wins)
      - Hybrid: critical in CP database, rest in AP"

Q: "How would you test this?"
   A: "Multi-pronged approach:
      - Unit tests (70% coverage)
      - Integration tests (20% coverage)
      - E2E tests (5% coverage)
      - Load testing (chaos engineering)
      - Production rollout (canary, blue-green)"

Q: "How would you monitor this?"
   A: "Comprehensive monitoring:
      - Metrics: QPS, latency (p50/p95/p99)
      - Errors: error rate, error types
      - Resources: CPU, memory, disk, network
      - Alerts: paging for critical, Slack for warnings
      - Dashboards: real-time visibility"

Q: "How would you handle cost?"
   A: "Cost optimization:
      - Reserved instances (30-50% discount)
      - Spot instances for non-critical (70% discount)
      - Data lifecycle (hot/warm/cold storage)
      - Compression (10:1 for text, 2:1 for video)
      - Tiered caching (memory→SSD→HDD→S3)"

Q: "How would you migrate data from old system?"
   A: "Dual-write strategy:
      1. Write to both old and new system
      2. Copy historical data (batch job)
      3. Validate data integrity
      4. Switch reads to new system
      5. Stop writes to old system (cleanup)"
```

---

## Quick Reference: Top 20 System Design Questions

Ranked by frequency at FAANG:

```
1. Design Twitter/X Feed (Meta, Twitter)
2. Design URL Shortener (Google, Amazon)
3. Design Rate Limiter (Uber, Stripe, many)
4. Design Key-Value Store (Amazon, Google)
5. Design Distributed Cache (LinkedIn, Adobe)
6. Design Consistent Hashing (Amazon, many)
7. Design WhatsApp/Chat (Meta, Microsoft)
8. Design YouTube/Netflix (video companies)
9. Design Google Search (Google, Microsoft)
10. Design Notification System (Uber, Lyft)

11. Design Logging System (Amazon, Google)
12. Design Database (Amazon, Google, Microsoft)
13. Design Load Balancer (Amazon, Microsoft)
14. Design Task Scheduler (many)
15. Design API Gateway (Amazon, Google)

16. Design Unique ID Generator (Twitter, many)
17. Design Typeahead/Autocomplete (Google, Microsoft)
18. Design Leaderboard (gaming companies)
19. Design Recommendations (Netflix, Amazon)
20. Design Ride-Sharing (Uber, Lyft)
```

---

## Template: Fill-in-the-Blank Structure

Use this structure for ANY system design problem:

```
PROBLEM STATEMENT
─────────────────
Design: [system name]

REQUIREMENTS
────────────
Functional:
├─ [Feature 1]
├─ [Feature 2]
└─ [Feature 3]

Non-Functional:
├─ Scale: [DAU] users
├─ Write QPS: [QPS] (from [operations]/day)
├─ Read QPS: [QPS] (typically higher)
├─ Latency: [target] ms (p99)
├─ Consistency: [Strong/Eventual]
└─ Availability: [99.9%/99.99%]

ESTIMATION
──────────
Daily Ops: [DAU] × [ops per user] = [X] ops/day
Write QPS: [X] / 86,400 = [Y] QPS
Read QPS: [Z] QPS (usually 5-10x higher)
Peak QPS: [Y] × 3 = [peak]

Storage:
- Daily: [ops] × [size/op] = [GB/day]
- Yearly: [GB/day] × 365 × [replication] = [TB]

HIGH-LEVEL DESIGN
─────────────────
[Draw simple ASCII diagram showing:
- Client
- Load Balancer
- API/App servers
- Database
- Cache
- etc.]

API DESIGN
──────────
[Describe 2-3 key APIs]
POST /resource
  Input: {...}
  Output: {...}

DATA MODEL
──────────
[Draw table schema]
table: [name]
├─ [column1]: [type]
├─ [column2]: [type]
└─ Index: [indexed columns]

DEEP DIVE (Pick 2-3)
────────────────────
1. [Critical Component 1]
   - How it works
   - Algorithm/approach
   - Scaling strategy

2. [Critical Component 2]
   - ...

BOTTLENECKS & SCALE
───────────────────
At current scale:
├─ Database: [X] QPS max
├─ Cache hit rate: [%]
└─ Storage: [TB]

At 10x scale:
├─ Solution 1: [shard database]
├─ Solution 2: [add more caching]
└─ Solution 3: [CDN for distribution]
```

---

## Interviewer Evaluation Criteria

Interviewers score on these (in priority order):

```
1. CLARIFICATION (Critical)
   ✓ Did you ask right questions?
   ✓ Did you confirm assumptions?
   ✓ Did you define scope?

2. ESTIMATION (Critical)
   ✓ Can you do back-of-envelope math?
   ✓ Are calculations reasonable?
   ✓ Did you double-check?

3. ARCHITECTURE (Critical)
   ✓ Did you draw a clear diagram?
   ✓ Are components reasonable?
   ✓ Did you justify choices?

4. PROBLEM DECOMPOSITION (Important)
   ✓ Did you break complex problem into parts?
   ✓ Did you prioritize correctly?
   ✓ Did you consider all aspects?

5. TECHNICAL DEPTH (Important)
   ✓ Can you go deep on 2-3 topics?
   ✓ Do you understand trade-offs?
   ✓ Can you explain algorithms?

6. COMMUNICATION (Important)
   ✓ Did you explain clearly?
   ✓ Did you listen to feedback?
   ✓ Did you adjust based on feedback?

7. TRADE-OFFS (Nice to have)
   ✓ Did you discuss pros/cons?
   ✓ Did you know when to use what?
   ✓ Did you make reasonable choices?

8. HANDLING UNCERTAINTY (Nice to have)
   ✓ Did you make reasonable assumptions?
   ✓ Did you acknowledge limitations?
   ✓ Did you propose solutions anyway?
```

---

## Interview Day Tips

```
BEFORE INTERVIEW:
├─ Get good sleep (8 hours)
├─ Eat breakfast
├─ Review these notes (5 min)
└─ Be on time (5 min early)

DURING INTERVIEW (First 5 min):
├─ Listen to problem carefully
├─ Take notes
├─ Ask clarifying questions
├─ Confirm your understanding

REQUIREMENTS PHASE (5-10 min):
├─ Explicit: "Let me confirm I understand..."
├─ Ask about scale ("How many users?")
├─ Ask about consistency ("Does this need strong consistency?")
├─ Ask about latency ("What's the target latency?")
└─ Narrow scope: "I'll assume X for now"

ESTIMATION PHASE (10-15 min):
├─ Talk out loud (show reasoning)
├─ Write down calculations
├─ Double-check math
├─ State assumptions clearly
└─ "Does this seem reasonable to you?"

DESIGN PHASE (15-20 min):
├─ Draw diagram on whiteboard/shared screen
├─ Start with simple design
├─ Gradually add components
├─ Explain each choice
└─ "This design handles X, Y, Z"

DEEP DIVE PHASE (15-20 min):
├─ Pick components YOU know well
├─ Explain algorithms clearly
├─ Draw diagrams for complex parts
├─ Discuss scaling strategy
└─ Address concerns proactively

BOTTLENECK PHASE (5-10 min):
├─ Identify actual bottleneck (not random)
├─ Propose specific solution
├─ Calculate new capacity
├─ "This would handle 10x growth"

HANDLING INTERRUPTIONS:
├─ Interviewer interrupts: "Good point. Let me reconsider..."
├─ They suggest different approach: Listen carefully
├─ They ask "What if?": Adapt design, don't get defensive
└─ You don't know something: "That's a good question. Here's what I'd do..."

HANDLING SILENCE:
├─ Don't panic (silence means thinking)
├─ Keep talking (show reasoning)
├─ Ask for feedback: "Does this make sense so far?"
└─ If stuck: "Let me approach this differently..."

ENDING STRONG (Last 5 min):
├─ Summarize: "So my design has..."
├─ Call out trade-offs: "We chose this to optimize for..."
├─ What you'd do differently: "If time permitted, I'd add..."
└─ Thank them: "Thanks for the good questions"

AVOID:
├─ Talking too fast (interview is marathon)
├─ Making up technologies (stick to common ones)
├─ Being defensive (embrace feedback)
├─ Overcomplicating early (start simple)
├─ Optimizing before understanding problem
└─ Saying "I don't know" without offering to figure it out
```

---

## Post-Interview

```
AFTER (within 24 hours):
├─ Thank interviewer (email)
├─ Mention something you learned
├─ Express interest in role
└─ Keep it brief (2-3 sentences)

SAMPLE EMAIL:
"Hi [Name],
Thanks for the great conversation about designing [system].
I appreciated your feedback on [specific thing].
I'm very interested in this role and look forward to hearing from you.
Best regards,
[Your name]"

IF REJECTED:
├─ Ask for feedback (if offered)
├─ Learn from mistakes
├─ Practice more (system design is learnable)
├─ Apply again next year (companies rehire)

IF PASSED:
├─ Congratulations!
├─ Prepare for on-site (harder interviews)
└─ Study actual systems (read papers, design docs)
```

---

## Final Reminders

```
Remember:
✓ This is a conversation, not an interrogation
✓ You're solving a problem together, not alone
✓ Showing your thinking > correct answer
✓ Trade-offs matter more than perfection
✓ Be humble and open to feedback
✓ You got this!

Common mistakes that sink interviews:
❌ Not asking clarifying questions
❌ Designing without understanding requirements
❌ Getting bogged down in details too early
❌ Not communicating clearly
❌ Refusing to adapt design based on feedback
❌ Overcomplicating with unnecessary tech

Practice these:
✓ 3-5 more full system design interviews
✓ 10-20 smaller component deep-dives
✓ Whiteboard drawing (practice writing)
✓ Estimation calculations (get fast at math)
└─ You'll be ready!
```

Good luck! You've got this.
