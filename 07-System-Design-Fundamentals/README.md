# System Design Interview Preparation (FAANG Level)

**For:** Mid-level Java engineer with 5 years at Barclays (investment banking, monolith decomposition, data lake work)

**Goal:** Master system design interviews at FAANG companies in 45-60 minute sessions

---

## What You'll Learn

This comprehensive guide covers everything needed to ace system design interviews at Google, Amazon, Facebook, Apple, Microsoft, and other FAANG companies.

### Included Materials

#### 📚 Core Files (7,943 lines total)

1. **01-System-Design-Basics.md** (690 lines)
   - How FAANG interviews work (45-60 min format)
   - The 5-step framework (Requirements → Estimation → Design → Deep Dive → Trade-offs)
   - Back-of-envelope calculations with real examples
   - Key metrics: QPS, latency, throughput, availability (99.9% = 8.76 hrs/year)
   - CAP theorem with CP vs AP systems
   - Consistency models: strong, eventual, causal
   - SLAs, SLOs, SLIs explained with examples

2. **02-Building-Blocks.md** (1,742 lines) ⭐ Most Detailed
   - DNS & CDN (push vs pull CDN, cache invalidation)
   - Load balancing (L4 vs L7, algorithms: round-robin, least connections, IP hash)
   - Reverse proxy vs forward proxy
   - Caching deep dive:
     * Strategies: cache-aside, read-through, write-through, write-behind, write-around
     * Eviction: LRU, LFU, TTL
     * Problems: stampede, penetration, avalanche (with solutions)
   - Database types: SQL vs NoSQL vs graph (when to use each)
   - Consistent hashing (virtual nodes, rebalancing)
   - Message queues (Kafka vs RabbitMQ vs SQS)
   - Blob storage, search engines (Elasticsearch, inverted indexes)
   - API design (REST vs gRPC vs GraphQL)
   - Rate limiting (token bucket, leaky bucket, fixed/sliding window)

3. **03-Scalability-and-Reliability.md** (1,180 lines)
   - Horizontal vs vertical scaling strategies
   - Stateless vs stateful services
   - Database replication (master-slave, master-master, sync vs async)
   - Database partitioning/sharding (range, hash, directory, consistent hashing)
   - Handling hotspots in sharding
   - Fault tolerance and failover (active-passive, active-active)
   - Heartbeat mechanisms and failure detection
   - RPO and RTO (recovery objectives)
   - Checkpointing and recovery
   - Write-ahead logging (WAL)
   - Distributed consensus (Paxos, Raft simplified)

4. **04-Classic-System-Designs.md** (1,021 lines)
   - URL Shortener (TinyURL)
     * Base62 encoding, MD5 hashing, random generation comparison
     * Sharding strategy
     * Cache layer optimization
   - Rate Limiter
     * Token bucket with Redis
     * Multi-user rate limiting
     * Distributed rate limiting with consistent hashing
   - Consistent Hashing (implementation in pseudocode)
   - Key-Value Store
     * Partitioning with consistent hashing
     * Replication and conflict resolution
   - Unique ID Generator
     * Snowflake ID format (timestamp + machine + sequence)
     * Implementation with examples
     * Clock adjustment handling

5. **05-Advanced-System-Designs.md** (1,345 lines)
   - Twitter/X Feed
     * Fan-out on read vs fan-out on write
     * Hybrid approach for celebrities
     * Cache implementation with Redis sorted sets
     * Fanout workers and message queues
   - YouTube
     * Upload pipeline and transcoding
     * Adaptive bitrate streaming
     * CDN distribution strategy
     * GPU acceleration for transcoding
   - WhatsApp/Chat System
     * WebSocket connection management
     * Message delivery guarantees (sent, delivered, read)
     * Group chat fanout (1M+ users)
     * Typing indicators
     * Message persistence and tiering
   - Google Search
     * Web crawling and indexing
     * Inverted indexes explained
     * PageRank algorithm (simplified)
     * Query autocomplete with Trie

6. **06-Infra-and-DevOps-Design.md** (1,219 lines)
   - Notification System
     * Multi-channel: push, email, SMS
     * Deduplication strategy
     * Template system with versioning
     * Rate limiting per channel
   - Logging and Monitoring System
     * Log collection and aggregation
     * Elasticsearch indexing
     * Real-time alerting
     * Log retention and archival (hot/warm/cold storage)
   - Distributed Task Scheduler
     * Exactly-once execution with distributed locks
     * Retry strategy (exponential backoff)
     * Task state tracking
   - CI/CD Pipeline
     * Blue-green deployment (zero downtime)
     * Rollback strategies
     * Monitoring during deployment
     * Canary releases

7. **07-System-Design-Interview-Cheatsheet.md** (746 lines) ⭐ Quick Reference
   - The 5-step framework (one-pager)
   - Estimation formulas (memorize these!)
   - Numbers every engineer should know
   - Technology comparison table
   - Decision trees for caching, sharding, rate limiting
   - CAP theorem trade-off matrix
   - Red flags (what NOT to do)
   - How to handle "What if..." questions
   - Top 20 system design questions ranked by frequency
   - Fill-in-the-blank template for any system
   - Interviewer evaluation criteria
   - Interview day tips and tricks
   - Post-interview guidance

---

## How to Use This Guide

### For Initial Learning (2-3 weeks)

**Week 1:**
- Day 1-2: Read 01-System-Design-Basics.md (understand framework)
- Day 3-5: Read 02-Building-Blocks.md (learn components)
- Day 6-7: Skim 07-System-Design-Interview-Cheatsheet.md (quick reference)

**Week 2:**
- Day 1-3: Read 03-Scalability-and-Reliability.md (understand constraints)
- Day 4-6: Read 04-Classic-System-Designs.md (practice basic designs)
- Day 7: Review formulas and numbers from cheatsheet

**Week 3:**
- Day 1-3: Read 05-Advanced-System-Designs.md (practice complex designs)
- Day 4-5: Read 06-Infra-and-DevOps-Design.md (infrastructure thinking)
- Day 6-7: Practice 3 full interviews (1 hour each)

### For Interview Prep (1 week before)

1. **Monday:** Deep dive on 1 system (e.g., URL Shortener) - 2 hours
2. **Tuesday:** Deep dive on 1 system (e.g., Rate Limiter) - 2 hours
3. **Wednesday:** Full mock interview (60 min, use cheatsheet as reference) - 1.5 hours
4. **Thursday:** Full mock interview with different system - 1.5 hours
5. **Friday:** Review cheatsheet, key trade-offs, and red flags - 1 hour
6. **Saturday:** Practice 1 more interview (your weakest area) - 1.5 hours
7. **Sunday:** Rest, review cheatsheet one more time - 30 min

### For Interview Day

1. **Night before:** Review 07-System-Design-Interview-Cheatsheet.md (memorize formulas)
2. **Morning:** Light review (15 min), eat breakfast, be calm
3. **Interview:** Follow the 5-step framework (it works!)
4. **After:** Learn from feedback and adjust future practice

---

## Key Concepts to Memorize

### Formulas
```
QPS = Daily Operations / 86,400 seconds
Storage = Daily Ops × Data Size × Retention × Replication
Bandwidth = QPS × Payload Size
Peak QPS = Average QPS × 2-3
```

### Important Numbers
```
L1 cache: 1 ns
RAM: 100 ns
Disk: 10 ms
Network (same DC): 1 ms
Network (cross-country): 100-200 ms

Single DB: 1-5K QPS
Redis: 50-100K QPS
Message queue: 100K-1M QPS

Availability: 99.9% = 8.76 hours/year downtime
Availability: 99.99% = 52 minutes/year downtime
```

### The 5-Step Framework
1. Requirements (5-10 min)
2. Estimation (10-15 min)
3. High-level design (10-15 min)
4. Deep dive (15-20 min)
5. Bottlenecks & scale (5-10 min)

### Technology Decision Matrix
```
SQL: Consistency + structured data (vertical scale only)
NoSQL: Availability + scale (eventual consistency)
Redis: Caching + fast access (in-memory)
Kafka: Async + decoupling (high throughput)
Elasticsearch: Search + indexing (full-text)
CDN: Content distribution (geographic scale)
```

---

## Real Interview Tips

### What Interviewers Look For (Priority Order)
1. **Clarification** - Do you ask the right questions?
2. **Estimation** - Can you do math quickly and accurately?
3. **Architecture** - Can you design at scale?
4. **Decomposition** - Can you break complex into simple?
5. **Technical depth** - Do you understand trade-offs?
6. **Communication** - Can you explain clearly?
7. **Trade-offs** - Do you know pros/cons?
8. **Uncertainty** - Can you make reasonable assumptions?

### Common Mistakes to Avoid
- ❌ Not asking clarifying questions
- ❌ Designing without understanding requirements
- ❌ Getting bogged down in details too early
- ❌ Not drawing a clear architecture diagram
- ❌ Refusing to adapt based on feedback
- ❌ Claiming you don't know without offering to figure it out

### What to Do Instead
- ✓ Ask clarifying questions (show you care about requirements)
- ✓ Always estimate (shows engineering thinking)
- ✓ Draw early, discuss early (get feedback)
- ✓ Explain your reasoning out loud (show thinking process)
- ✓ Welcome feedback and adapt gracefully
- ✓ Say "I'd need to research that, but here's my approach..."

---

## Content Highlights

### Most Useful for Your Background (Barclays)
Given your experience with monolith decomposition and data lakes:

1. **Database sharding** (03-Scalability-and-Reliability.md)
   - You've seen monoliths, now learn how to split them horizontally
   - Critical for handling 100B+ transactions

2. **Message queues** (02-Building-Blocks.md)
   - Replace synchronous monolith calls with async
   - Essential for decoupling at scale

3. **Logging and monitoring** (06-Infra-and-DevOps-Design.md)
   - Your data lake experience helps here
   - Understand how to instrument at scale

4. **Distributed systems** (03-Scalability-and-Reliability.md)
   - Most complex topic, but critical for FAANG
   - Consensus, replication, failure handling

### Most Commonly Asked at Each Company
- **Google:** Search, indexing, distributed systems
- **Amazon:** Scalability, CDN, storage
- **Meta:** Feed systems, real-time, massive scale
- **Microsoft:** Data systems, cloud, APIs
- **Apple:** Real-time, privacy-aware systems

---

## Practice Projects

After reading, implement these (optional but recommended):

1. **URL Shortener** (1 day)
   - Build a simple version locally
   - Understand hashing, sharding, caching

2. **Rate Limiter** (1 day)
   - Implement token bucket in code
   - Test with high concurrency

3. **Cache System** (1 day)
   - Implement LRU cache
   - Understand eviction policies

4. **Mini-Search** (1 day)
   - Build simple inverted index
   - Understand full-text search

---

## Estimated Time Investment

- **Reading all materials:** 15-20 hours
- **Deep dive on systems:** 10-15 hours
- **Mock interviews:** 5-10 hours
- **Practice coding:** 5-10 hours (optional)
- **Total:** 35-55 hours (roughly 5-8 weeks at 1 hour/day)

**Fast track (3 weeks before interview):** Focus on 02, 04, 05, and 07 only

---

## Success Metrics

**Before using this guide:**
- You feel lost during system design interviews
- You can't estimate at scale
- You don't know what technologies to choose

**After using this guide:**
- You can follow the 5-step framework consistently
- You can estimate QPS, storage, bandwidth accurately
- You know when to use each technology
- You can discuss trade-offs intelligently
- You can go deep on 2-3 components
- You're comfortable with distributed systems concepts

**Goal:** Pass system design interviews at FAANG level (good hire / strong hire)

---

## Additional Resources

**Practice sites:**
- LeetCode System Design (paid)
- DesignGurus.io (paid)
- Educative.io (paid)
- YouTube: Tech Dummies, Gaurav Sen (free)

**Papers to read (after preparation):**
- Dynamo (Amazon's KVS)
- Bigtable (Google's data store)
- MapReduce (Google's processing)
- GFS (Google's file system)

**Books:**
- "Designing Data-Intensive Applications" by Martin Kleppmann (best book)
- "System Design Interview" by Alex Xu (very similar to this, more concise)

---

## Final Notes

System design is a skill, not a test of knowledge. You're not expected to know everything. What matters is:

1. **Thinking** - Can you reason about trade-offs?
2. **Communication** - Can you explain your thinking clearly?
3. **Adaptability** - Can you adjust your design based on feedback?
4. **Pragmatism** - Do you make reasonable choices given constraints?

This guide gives you the vocabulary and patterns. The rest is practice.

**You can do this. Good luck! 🚀**

---

Generated: 2024-01-15 | Lines of content: 7,943 | Reading time: ~12 hours
