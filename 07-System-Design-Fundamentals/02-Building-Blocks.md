# System Design Building Blocks

## Table of Contents
1. [DNS & CDN](#dns--cdn)
2. [Load Balancing](#load-balancing)
3. [Reverse Proxy vs Forward Proxy](#reverse-proxy-vs-forward-proxy)
4. [Caching](#caching)
5. [Databases](#databases)
6. [Consistent Hashing](#consistent-hashing)
7. [Message Queues](#message-queues)
8. [Blob Storage](#blob-storage)
9. [Search Engines](#search-engines)
10. [API Design](#api-design)
11. [Rate Limiting](#rate-limiting)

---

## DNS & CDN

### DNS (Domain Name System)

**What it is:** Maps human-readable domain names to IP addresses.

```
User request flow:
┌──────────────────────────────────────────────┐
│ User types "google.com" in browser           │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
        ┌─────────────────────┐
        │  Recursive Resolver │
        │  (ISP DNS)          │
        │  Caches results     │
        └────────┬────────────┘
                 │
        ┌────────┴─────────────────┬──────────┐
        ▼                          ▼          ▼
   ┌─────────────┐      ┌────────────────┐ ┌──────────────┐
   │Root         │      │TLD Nameserver  │ │Authoritative │
   │Nameserver   │      │(.com)          │ │Nameserver    │
   │13 globally  │      │                │ │(google.com)  │
   └─────────────┘      └────────────────┘ └──────────────┘
        │                      │                    │
        └──────────────────────┴────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────┐
        │ Answer: 142.251.41.14 (Google IP)    │
        │ Cached for 3600 seconds (TTL)        │
        └──────────────────────────────────────┘
```

**TTL (Time To Live):**
- Short TTL (300 sec): Changes propagate quickly, but more DNS queries
- Long TTL (86400 sec): Fewer queries, but slow to change IPs

**Best practice:** Use TTL=300 during migrations, TTL=3600 normally.

### Content Delivery Network (CDN)

**What it is:** Geographically distributed servers that cache and serve content.

```
Traditional (no CDN):
┌─────────────┐         ┌──────────────┐
│User in Asia │────────▶│Origin Server │
│(2000ms)     │         │(US)          │
└─────────────┘         └──────────────┘
                              △
                              │
                        Slow! Far away!

With CDN:
┌─────────────┐         ┌─────────────────┐
│User in Asia │────────▶│CDN Edge Server  │
│(50ms)       │         │(Singapore)      │
└─────────────┘         └────────┬────────┘
                                 │
                                 ▼ (origin request)
                        ┌──────────────────┐
                        │Origin Server (US)│
                        └──────────────────┘
```

#### Push CDN vs Pull CDN

**Push CDN:**
```
You push content to CDN edges proactively.

Setup:
├─ Configure CDN with file URLs
├─ Upload files to all edge locations
└─ Keep in sync (operational burden)

Pros:
├─ Guaranteed availability
├─ No origin load during peak
└─ Good for pre-known content

Cons:
├─ Complex operations
├─ Manual updates needed
└─ Wastes storage (not all users access all files)

Best for: Static assets, software releases, large files
```

**Pull CDN:**
```
CDN fetches content from origin on-demand.

Setup:
├─ Configure CDN with origin server
├─ CDN fetches on first request
└─ Caches for TTL

Pros:
├─ Zero operational overhead
├─ Automatic cache management
└─ Only popular content cached

Cons:
├─ First user pays latency penalty
├─ Origin load during traffic spike
└─ Cache misses possible

Best for: Dynamic content, user-generated content, majority of web
```

**Recommendation:** Use Pull CDN for most cases (simpler, less operational burden).

### CDN Cache Invalidation

```
Problem: New version of file deployed, but CDN still serves old version.

Solution 1: URL versioning (Recommended)
├─ Old: /api/logo.png
├─ New: /api/logo-v2.png or /api/logo?v=2
└─ Different URL = always cache miss, origin serves new version

Solution 2: TTL-based
├─ Set low TTL on files (e.g., 300 seconds)
├─ Downside: More origin load
└─ Use for files that change frequently

Solution 3: Explicit invalidation
├─ Call CDN API to purge specific files
├─ Slow (propagates to all edges in minutes)
└─ Use for emergency fixes only

Solution 4: Version in path (Best practice)
├─ webpack bundles: app.abc123.js
├─ Static assets: /v1/styles.css
└─ Automatically busted when new version deployed
```

---

## Load Balancing

### Load Balancer Types

#### Layer 4 (Transport Layer) Load Balancer

```
What it does: Routes based on IP, Port, Protocol (TCP/UDP)
              No knowledge of application

Example:
IP:Port → 203.0.113.1:443 → Route to backend-1
IP:Port → 203.0.113.2:443 → Route to backend-2
         (round-robin, least connections, etc.)

Pros:
├─ Very fast (minimal processing)
├─ Handles millions of connections
├─ Good for non-HTTP protocols
└─ Lower latency

Cons:
├─ Can't route based on URL/hostname
├─ Limited load balancing strategies
└─ Can't cache or compress

When to use: Database connections, game servers, WebSocket
Technologies: Nginx (stream), HAProxy, AWS NLB, Google Cloud LB
```

#### Layer 7 (Application Layer) Load Balancer

```
What it does: Routes based on HTTP data (URL, hostname, headers, cookies)
              Understands application protocol

Example:
GET /api/users → backend-api-1
GET /images/   → backend-images-1
GET /videos/   → backend-videos-1 (CDN might be better, but example)

Host: example.com → backend-example
Host: api.example.com → backend-api

Pros:
├─ Intelligent routing (URL, hostname, headers)
├─ Can compress, cache, rewrite
├─ Support sticky sessions
└─ Better for microservices

Cons:
├─ More CPU intensive
├─ Lower throughput per instance
└─ Higher latency

When to use: Web applications, microservices, REST APIs
Technologies: Nginx, HAProxy, AWS ALB, Envoy, NGINX Plus
```

### Load Balancing Algorithms

```
Round-Robin (simplest):
├─ Distribute requests equally
├─ Requests: 1→LB1, 2→LB2, 3→LB3, 4→LB1
├─ Pro: Simple, fair
└─ Con: Ignores server capacity

Least Connections:
├─ Route to server with fewest active connections
├─ Good for long-lived connections (WebSocket, chat)
├─ Pro: Handles varying load
└─ Con: More computational overhead

Weighted Round-Robin:
├─ High-capacity servers get more traffic
├─ Weight 3: gets 3x more requests
├─ Pro: Handles heterogeneous clusters
└─ Con: Requires configuration

IP Hash / Consistent Hash:
├─ Same IP always goes to same server
├─ Hash(IP) mod server_count = server_id
├─ Pro: Sticky sessions, cache-friendly
└─ Con: Uneven distribution if servers added

Least Load / Response Time:
├─ Route based on server CPU/memory/response time
├─ Pro: Most intelligent
└─ Con: Requires monitoring system
```

### Load Balancer Placement

```
Topology:
           ┌─────────────────────────┐
           │    Client Requests      │
           │  (from all over world)  │
           └────────────┬────────────┘
                        │
           ┌────────────▼─────────────┐
           │  Load Balancer           │
           │  (primary entry point)   │
           │  Single point of failure!│
           └────────────┬─────────────┘
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
    ┌────────┐     ┌────────┐      ┌────────┐
    │Backend1│     │Backend2│      │Backend3│
    │Port 80 │     │Port 80 │      │Port 80 │
    └────────┘     └────────┘      └────────┘

Problem: LB is SPOF (Single Point of Failure)

Solution: HA Load Balancer Setup
    ┌─────────────────────────────────┐
    │  Virtual IP (VIP): 203.0.113.1  │
    │  Heartbeat: Active-Passive LBs  │
    └─────────────────────────────────┘
            │                    │
    ┌───────▼──────┐     ┌──────▼──────┐
    │LB-1 (Active) │     │LB-2 (Passive)
    │Handles 100%  │────▶│Monitoring   │
    │              │◀────│If LB-1 dies │
    │VIP assigned  │     │takes VIP    │
    └──────────────┘     └─────────────┘

Heartbeat protocol (every 100ms):
├─ Periodic ICMP ping / HTTP health check
├─ If no response → failover to LB-2
└─ Ensure only one active at a time (split-brain prevention)
```

---

## Reverse Proxy vs Forward Proxy

### Forward Proxy

```
What it does: Sits between client and internet.
              Client requests go through proxy to origin.

Setup:
┌────────┐  HTTP Request   ┌──────────────┐  HTTP Request  ┌───────┐
│ Client ├────────────────▶│Forward Proxy ├───────────────▶│Origin │
│        │◀────────────────┤              │◀───────────────┤       │
└────────┘ HTTP Response   └──────────────┘ HTTP Response  └───────┘

From origin perspective:
- Origin sees proxy's IP, not client's IP
- Origin doesn't know actual client

Use cases:
├─ Corporate proxy (monitor employee traffic)
├─ Hide client IP from servers
├─ Geographic IP spoofing
├─ Bypass restrictions
└─ Caching at network level
```

### Reverse Proxy

```
What it does: Sits between internet and server.
              Client requests come through proxy to backend.

Setup:
┌────────┐  HTTP Request  ┌──────────────┐  HTTP Request  ┌────────┐
│ Client ├──────────────▶│Reverse Proxy ├──────────────▶│Backend │
│        │◀──────────────┤              │◀──────────────┤        │
└────────┘ HTTP Response └──────────────┘ HTTP Response └────────┘

From client perspective:
- Client sees reverse proxy as the server
- Client doesn't know backend exists

Use cases:
├─ Load balancing (distribute traffic)
├─ Caching (reduce backend load)
├─ SSL termination (decrypt HTTPS once)
├─ Compression
├─ Rate limiting
├─ Authentication/authorization
└─ Hide backend topology

Typical responsibilities:
├─ TLS/SSL termination (asymmetric crypto only once)
├─ Request/response logging
├─ GZip compression
├─ Virtual host routing
└─ Connection pooling
```

### Reverse Proxy Benefits Deep Dive

```
Architecture:
    Client (HTTPS)
         │
         ▼
    ┌───────────────────────────────────┐
    │ Reverse Proxy (Nginx)             │
    ├─ SSL/TLS termination             │
    ├─ Compression                      │
    ├─ Load balancing                   │
    ├─ Rate limiting                    │
    └───────────┬───────────────────────┘
                │
    ┌───────────┼──────────────┬────────────────┐
    ▼           ▼              ▼                ▼
Backend-1   Backend-2      Backend-3       Backend-4
(HTTP)      (HTTP)         (HTTP)          (HTTP)

Benefits:
1. SSL/TLS only once: O(1) expensive crypto ops instead of O(n)
2. Compression: 10:1 ratio for JSON, saves bandwidth
3. Load balancing: Spread load across backends
4. Caching: 50-90% of requests served from cache
5. Security: Hide backend IPs, add WAF (Web Application Firewall)
```

---

## Caching

### Cache Tiers

```
Latency vs Capacity tradeoff:

L1 Cache (Fastest, Smallest)
├─ CPU cache: 1-100 nanoseconds
├─ Size: KB-MB
└─ Transparent to software

L2 Cache (Memory)
├─ In-process cache: ~100 microseconds
├─ Size: MB-GB
└─ Example: HashMap, Redis node

L3 Cache (Distributed)
├─ Distributed cache: ~1-10 milliseconds
├─ Size: GB-TB across cluster
└─ Example: Redis cluster, Memcached

L4 Cache (CDN)
├─ Geographic edge cache: ~10-50 milliseconds
├─ Size: TB-PB across globe
└─ Example: Cloudflare, Akamai CDN

L5 Cache (Database)
├─ Database query cache: ~100 milliseconds
├─ Size: Variable
└─ Example: Query result caching

Storage (Source of Truth)
├─ Database: ~10-100 milliseconds
├─ Size: Unlimited (limited by hardware)
└─ Durability: High (ACID/BASE guarantees)
```

### Cache Strategies

#### 1. Cache-Aside (Lazy Loading)

```
Flow:
1. Client requests data
2. Check cache (Redis)
   └─ Hit: Return cached data (fast!)
   └─ Miss: Fetch from database, cache it, return to client

Code pattern:
    def get_user(user_id):
        cache_key = f"user:{user_id}"
        user = cache.get(cache_key)

        if user is None:  # Cache miss
            user = db.get_user(user_id)
            cache.set(cache_key, user, ttl=3600)

        return user

Pros:
├─ Simple to implement
├─ Only caches accessed data
└─ No stale data issue (db is source of truth)

Cons:
├─ Cache miss = extra DB hit (latency)
├─ Complex cache invalidation
└─ Thundering herd (many misses at once)

Best for: Read-heavy, infrequently changing data
```

#### 2. Read-Through (Write-Behind lookup)

```
Flow:
1. Client requests data
2. Cache handler checks
   └─ Hit: Return data
   └─ Miss: Cache fetches from DB, returns, auto-caches

Similar to cache-aside, but cache is responsible for fetching.
Requires cache library integration with database.

Pros:
├─ Cache handles all logic
└─ Simple client code

Cons:
├─ Requires specialized cache library
└─ Tight coupling with data source
```

#### 3. Write-Through

```
Flow:
1. Client writes data
2. Write to cache
3. Write to database (synchronous)
4. Return success to client

Code:
    def update_user(user_id, data):
        cache.set(f"user:{user_id}", data)
        db.update_user(user_id, data)
        return success

Pros:
├─ Data always consistent
├─ Good for write-heavy workloads
└─ Tolerate cache failures (DB always has latest)

Cons:
├─ Higher write latency (wait for DB)
├─ Extra DB load (every write hits DB)
└─ Cache must be same as DB

Best for: Financial transactions, critical data
```

#### 4. Write-Behind (Write-Back, Write-Deferred)

```
Flow:
1. Client writes data
2. Write to cache only (immediate return)
3. Cache asynchronously writes to database (eventual)

Code:
    def update_user(user_id, data):
        cache.set(f"user:{user_id}", data)
        queue.enqueue(("update_user", user_id, data))
        return success  # Immediate, don't wait for DB

    # Background worker
    def process_queue():
        while True:
            op, user_id, data = queue.dequeue()
            db.update_user(user_id, data)

Pros:
├─ Very fast writes (cache only)
├─ Batches writes to DB
├─ Reduces DB load

Cons:
├─ Data loss risk (cache fails before DB write)
├─ Eventual consistency (reads might see old data)
├─ Complex error handling
└─ Ordering issues (updates out of order)

Best for: Non-critical data, analytics, recommendations
```

#### 5. Write-Around

```
Flow:
1. Client writes data
2. Write only to database (skip cache)
3. Cache is populated on next read

Code:
    def update_user(user_id, data):
        db.update_user(user_id, data)
        cache.delete(f"user:{user_id}")  # Invalidate cache
        return success

Pros:
├─ Prevents cache pollution (don't cache writes)
└─ Reduces write latency to cache

Cons:
├─ Next read is cache miss
├─ Higher latency for readers
└─ Cache inconsistency until first read

Best for: Data with high write:read ratio
```

### Cache Eviction Policies

When cache is full, which item to evict?

#### LRU (Least Recently Used)

```
Evict item accessed longest ago.

Example (Cache size = 3):
Set: [A, B, C]
Access A: [A*, B, C] (A is recent)
Access B: [A, B*, C]
Add D: Evict C (least recent) → [A, B*, D]

Implementation:
├─ Doubly linked list + HashMap
├─ Move accessed item to front
├─ Evict from back
└─ O(1) operations with proper structure

Pros:
├─ Intuitive
├─ Works well in practice
└─ Spatial locality: hot items stay

Cons:
├─ Doesn't consider item value/size
├─ Sequential scans pollute cache
└─ Pathological case: 1,2,3,4,1,2,3,4... keeps missing

Best for: General purpose caching (Memcached, Redis default)
```

#### LFU (Least Frequently Used)

```
Evict item accessed least often.

Example (Cache size = 3):
Set: [A(freq=1), B(freq=1), C(freq=1)]
Access A 5 times: [A(freq=5), B(freq=1), C(freq=1)]
Add D: Evict B or C (freq=1) → [A(freq=5), C(freq=1), D(freq=1)]

Implementation:
├─ Frequency counter per item
├─ Min-heap of frequencies
└─ Evict min frequency item

Pros:
├─ Considers access frequency
└─ Better for popular items

Cons:
├─ More complex to implement
├─ Historical frequency weights old data
└─ No recency factor (old frequently accessed item stays)

Best for: Long-term caching, analytics
```

#### TTL (Time To Live)

```
Evict item after fixed time.

Example:
cache.set("key", value, ttl=3600)  # Expires after 1 hour
    │
    ├─ After 30 min: Still valid
    ├─ After 1 hour: Expired, will be evicted
    └─ Lazy deletion: Actually removed on access or eviction

Pros:
├─ Simple
├─ Prevents stale data
└─ Works with cache-aside pattern

Cons:
├─ No consideration of access patterns
├─ Might evict frequently used items
└─ Wasted space for rarely accessed items

Best for: Session data, temporary caches, API responses
```

### Cache Problems and Solutions

#### Problem 1: Cache Stampede (Thundering Herd)

```
Scenario:
- Popular key expires at exact same time
- 1000s of requests hit cache simultaneously
- All miss → all query database
- Database gets 1000x traffic spike → crashes

Timeline:
t=0:   key expires
t=0.1: 1000 requests arrive, all check cache, all miss
t=0.1: All 1000 hit database
t=0.2: Database overwhelmed, timeouts occur

Solutions:

1. Probabilistic early expiration (Recommended)
   └─ Refresh cache BEFORE expiry, with probability

   def get(key):
       value, exp_time = cache.get(key)
       if should_refresh_early():  # e.g., when 80% TTL passed
           background_task(refresh_cache, key)
       return value

2. Locks/Mutexes
   └─ First miss acquires lock, queries DB, caches result
   └─ Other requests wait for lock, then use cache

   def get(key):
       value = cache.get(key)
       if value is None:
           if acquire_lock(key):  # Only 1 winner
               value = db.get(key)  # Expensive query
               cache.set(key, value)
               release_lock(key)
           else:
               wait_for_lock(key)  # Wait for other thread
               value = cache.get(key)  # Try again
       return value

3. Stale-while-revalidate
   └─ Serve stale value immediately, refresh in background

   def get(key):
       value, is_stale = cache.get(key)
       if is_stale:
           background_task(refresh, key)
       return value  # Return stale data, refresh async

Best practice: Use (1) + (3) together
```

#### Problem 2: Cache Penetration

```
Scenario:
- Request for non-existent data
- Misses cache (nothing to cache)
- Hits database (expensive, returns nothing)
- Every identical request repeats this
- Attacker can DOS with random IDs

Example:
user_id: 999999999999 (doesn't exist)
├─ Check cache: miss
├─ Hit database: miss (returns nothing)
├─ No cache entry created
└─ Next request for same ID: repeat steps

Solutions:

1. Cache negative results (Recommended)
   └─ Store explicit "not found" sentinel value

   def get_user(user_id):
       cached = cache.get(f"user:{user_id}")
       if cached == "NOT_FOUND":
           return None  # Cached negative result
       if cached is not None:
           return cached

       user = db.get_user(user_id)
       if user is None:
           cache.set(f"user:{user_id}", "NOT_FOUND", ttl=300)
           return None
       else:
           cache.set(f"user:{user_id}", user, ttl=3600)
           return user

2. Bloom filters
   └─ Probabilistic data structure: "might exist" or "definitely not exist"
   └─ Before querying DB, check bloom filter

   bloom_filter = BloomFilter(capacity=1M, false_positive_rate=1%)

   def get_user(user_id):
       if user_id not in bloom_filter:
           return None  # Definitely not in database

       cached = cache.get(f"user:{user_id}")
       if cached is not None:
           return cached

       user = db.get_user(user_id)
       cache.set(f"user:{user_id}", user)
       return user

3. Rate limiting
   └─ Limit requests per IP
   └─ Limit requests for non-existent resources
   └─ Slows down attacker

Best practice: Combine (1) for easy cases + (2) for large datasets
```

#### Problem 3: Cache Avalanche

```
Scenario:
- Multiple cache nodes fail simultaneously
- OR mass expiration of many keys at once
- Remaining cache gets overwhelmed
- Cascades to database failure
- Entire system goes down

Example:
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Cache Node 1 │ │ Cache Node 2 │ │ Cache Node 3 │
└──────────────┘ └──────────────┘ └──────────────┘
      │                  │                  │
      └──────────────────┼──────────────────┘
                         ▼
            ┌──────────────────────┐
            │ Remaining Cache      │ (overloaded!)
            │ 10x traffic spike    │
            └──────────────────────┘
                         ▼
            ┌──────────────────────┐
            │ Database             │ (crashes)
            │ 100x traffic spike   │
            └──────────────────────┘

Solutions:

1. Multiple cache nodes (redundancy)
   └─ Distribute across availability zones
   └─ Use master-slave or cluster configuration
   └─ Monitor node health

2. Randomized expiration
   └─ Don't set all TTLs to same value
   └─ Add random variance: TTL + random(0, TTL*0.1)

   ttl = BASE_TTL + random(0, BASE_TTL // 10)
   cache.set(key, value, ttl=ttl)

3. Circuit breaker
   └─ If database latency high, return stale cache
   └─ Don't query database if already overloaded

   def get(key):
       value = cache.get(key)
       if value is None:
           if circuit_breaker.is_open():
               return error_response("Service temporarily unavailable")
           try:
               value = db.get(key)
           except SlowDatabaseError:
               circuit_breaker.open()  # Stop querying DB temporarily
               return error_response(...)
       return value

4. Gradual cache warming
   └─ Preload cache on startup
   └─ Load hot data before serving traffic

   def warm_cache():
       hot_keys = db.get_top_10000_items()
       for key, value in hot_keys:
           cache.set(f"item:{key}", value)

Best practice: Combine (1) + (2) + (3)
```

---

## Databases

### Database Types and When to Use

#### Relational Databases (SQL)

```
What: Tables with ACID transactions, joins, schema

Examples: PostgreSQL, MySQL, Oracle, SQL Server

Characteristics:
├─ Schema: Defined upfront (rigid, but safe)
├─ Consistency: Strong (transactions, constraints)
├─ Scalability: Vertical (single master scales up)
└─ Queries: SQL (flexible, powerful)

When to use:
├─ Structured data (users, products, orders)
├─ Complex relationships (many joins)
├─ Need transactions (atomicity)
├─ Need consistency (banking, inventory)

When NOT to use:
├─ Need horizontal scaling (sharding is complex)
├─ Unstructured data (documents, images)
├─ Flexible schema (schema changes expensive)
└─ Need super high availability (replication lags)

Scaling strategies:
├─ Vertical: Add more CPU/memory (limited)
├─ Read replicas: Distribute reads
├─ Sharding: Partition data (complex joins break)
└─ Caching: Cache hot queries
```

#### NoSQL - Document Stores (MongoDB, CouchDB)

```
What: JSON/BSON documents, flexible schema, eventually consistent

Characteristics:
├─ Schema: Flexible (add fields on the fly)
├─ Queries: MongoDB Query Language (less powerful than SQL)
├─ Consistency: Eventually consistent (replication lag)
└─ Scalability: Horizontal (sharding built-in)

When to use:
├─ Unstructured/semi-structured data
├─ Flexible schema (new fields often)
├─ Document-oriented data (user profiles, catalogs)
├─ Need horizontal scaling (many shards)

When NOT to use:
├─ Complex relationships (many joins needed)
├─ Need ACID transactions across shards
├─ Need strong consistency
├─ Query patterns very diverse

Example:
// Document structure (flexible)
{
  "_id": ObjectId("..."),
  "name": "Alice",
  "emails": ["alice@example.com", "alice.work@example.com"],  // Array
  "address": {
    "city": "San Francisco",
    "zip": "94102"
  },
  "profile": {
    "bio": "Engineer",
    "followers": 1000
  }
}

// New document with different schema (allowed)
{
  "_id": ObjectId("..."),
  "name": "Bob",
  "phone": "555-1234",
  "newsletter_preference": true
}

Scaling:
├─ Sharding by user_id (partition by key)
├─ Each shard stores subset of documents
└─ Query goes to specific shard or all shards
```

#### NoSQL - Key-Value Stores (Redis, Memcached)

```
What: Simple key → value mapping, fast, in-memory

Characteristics:
├─ Operations: get, set, delete, increment
├─ Consistency: Eventual (but fast)
├─ Persistence: Optional (can be memory-only)
└─ Scalability: Horizontal (sharding by key)

When to use:
├─ Caching (warm queries)
├─ Session storage
├─ Rate limiting
├─ Leaderboards (sorted sets in Redis)
├─ Real-time counters

When NOT to use:
├─ Need transactions
├─ Complex queries
├─ Need persistence (or very expensive)
├─ Large data sets (in-memory = expensive)

Example:
redis.set("user:1001:name", "Alice")
redis.set("user:1001:email", "alice@example.com")
redis.get("user:1001:name")  # "Alice"

redis.incr("page_views:home")  # Counters
redis.zadd("leaderboard", 1000, "alice", 900, "bob")  # Sorted set
```

#### NoSQL - Column-Family Stores (HBase, Cassandra)

```
What: Distributed key-value with columns, optimized for analytics

Characteristics:
├─ Structure: Row key → columns (sparse)
├─ Consistency: Eventually consistent
├─ Scalability: Horizontal (excellent)
└─ Data: Time-series, analytics

When to use:
├─ Time-series data (metrics, logs)
├─ Analytics (columnar compression)
├─ Massive scale (100s of TB+)
├─ Write-heavy (millions of writes/sec)

When NOT to use:
├─ Need quick response times (optimized for throughput, not latency)
├─ Complex queries
├─ Strong consistency needed

Example:
// Row: user:1001
// Columns: profile:name, profile:email, recent_logins:2024-01-15

Row Key      │ profile:name │ profile:email │ recent_logins:2024-01-15
─────────────┼──────────────┼───────────────┼─────────────────────────
user:1001    │ "Alice"      │ "alice@ex"    │ "10:23:45"
user:1002    │ "Bob"        │ "bob@ex"      │ "09:12:30"

// Efficient compression: many columns are sparse/null
// Efficient for: SELECT profile:name WHERE row_key LIKE 'user:*'
```

#### NoSQL - Graph Databases (Neo4j, ArangoDB)

```
What: Nodes and edges optimized for relationships

Characteristics:
├─ Data: Nodes (vertices) + relationships (edges)
├─ Queries: Graph queries (traversals)
├─ Consistency: ACID (some support transactions)
└─ Scalability: Moderate (not as horizontally scalable)

When to use:
├─ Social networks (friendships, followers)
├─ Recommendation engines (products, users)
├─ Knowledge graphs (Wikipedia relationships)
├─ Access control (who can access what)

When NOT to use:
├─ Simple key-value access
├─ Need massive scale (not as horizontally scalable)
├─ Unrelated data (random access patterns)

Example:
Query: "Find friends of friends who like sci-fi"

// Nodes
User(name="Alice") -[FRIEND]-> User(name="Bob")
User(name="Bob") -[FRIEND]-> User(name="Charlie")
User(name="Charlie") -[LIKES]-> Movie(genre="sci-fi")

// Query
MATCH (alice:User {name:"Alice"})-[:FRIEND]->(friend)-[:FRIEND]->(friend_of_friend)
      ,(friend_of_friend)-[:LIKES]->(movie:Movie {genre:"sci-fi"})
RETURN friend_of_friend, movie
```

### Database Comparison Table

```
┌──────────┬─────────────┬────────────┬──────────────┬──────────┐
│ Type     │ Consistency │ Scalability│ Query Power  │ Use Case │
├──────────┼─────────────┼────────────┼──────────────┼──────────┤
│ SQL      │ Strong      │ Vertical   │ Very Powerful│ Business │
│ Document │ Eventual    │ Horizontal │ Moderate     │ Web App  │
│ Key-Value│ Eventual    │ Horizontal │ Simple       │ Cache    │
│ Column   │ Eventual    │ Horizontal │ Analytic     │ Analytics│
│ Graph    │ Varies      │ Moderate   │ Graph        │ Social   │
└──────────┴─────────────┴────────────┴──────────────┴──────────┘
```

---

## Consistent Hashing

### The Problem: Simple Hashing

```
Store data across N servers using hash(key) % N

Servers: [S1, S2, S3]  (N = 3)

Distribution:
key="alice" → hash("alice") % 3 = 0 → S1
key="bob"   → hash("bob") % 3 = 1 → S2
key="charlie" → hash("charlie") % 3 = 2 → S3

Problem: Add new server S4

Distribution changes:
key="alice" → hash("alice") % 4 = 0 → S1  (same)
key="bob"   → hash("bob") % 4 = 1 → S2    (same)
key="charlie" → hash("charlie") % 4 = 2 → S3  (same)
key="diana" → hash("diana") % 4 = 3 → S4

Issue: Every key rehashes!
└─ Hash ring changes → all N-1 moves out of distribution
└─ Massive cache invalidation
└─ Database queries for everything
```

### Consistent Hashing Solution

```
Arrange servers on a ring (0 to 2^32-1)

Ring layout:
           S1 (position: 123456)
          /  \
         /    \
   S3(6789)   S2(876543)

Hash key to ring:
key="alice" → hash("alice") = 234567
key="bob" → hash("bob") = 45678

Find server: Move clockwise until hitting server:
alice (234567) → clockwise → S2 (876543) ✓
bob (45678) → clockwise → S1 (123456) ✓

Add new server S4 (position: 500000):

         S1 (123456)
        /  \
       /    \
  S3(6789)  S2(876543)
       \    /
        \  /
      S4(500000)

Rebalancing:
alice (234567) → still S2 (unchanged) ✓
bob (45678) → now S4 (500000) ✗ (moved!)
charlie (600000) → now S1 (from S2)

Only keys between S3 and S4 move (~N/4 keys move, not all!)
```

### Virtual Nodes (Replication Factor)

```
Problem: Few servers → uneven load distribution

Solution: Each server has multiple virtual nodes on ring

Ring with virtual nodes:
         S1-v1 (10000)
        /          \
    S1-v2(99000)    S2-v1(50000)
       /              \
    S3-v2(5000)      S2-v2(150000)
       \              /
       S3-v1(120000)

Benefits:
├─ Even distribution (each server covers multiple sections)
├─ Fault tolerance (load distributed if one server down)
├─ Better rebalancing (less data moves per operation)

Typical configuration:
├─ Virtual nodes per server: 150-300
├─ Effectively spreads each server across ring
└─ Load distribution deviation: <5%

Implementation:
for i in range(num_virtual_nodes):
    virtual_key = f"{server_id}:v{i}"
    ring.add(hash(virtual_key), server_id)
```

### Consistent Hashing with Replication

```
Replicate each key on multiple servers (usually 3)

Ring:
    S1(100) → S2(200) → S3(300) → S1(400) → ...

Key alice(150):
Primary: S2(200) ← clockwise next
Replica 1: S3(300)
Replica 2: S1(400)  (or S1(100) depending on implementation)

Write:
├─ Write to primary S2
├─ Replicate to S3, S1
└─ Return to client (once primary + 1 replica ACKs)

Read:
├─ Read from closest server (any replica)
├─ Fallback if primary down
└─ Serve stale data if needed

Replication factor (RF) = 3:
├─ Each key stored on 3 servers
├─ Can tolerate 2 server failures
└─ Quorum reads: wait for 2/3 ACKs (strong consistency)
```

---

## Message Queues

### Message Queue Basics

```
Producer writes messages → Queue → Consumer reads messages

Use case: Decouple producer from consumer (async processing)

Example:
// Producer: User submits order
order = {"user_id": 1001, "items": [...]}
message_queue.publish("orders", order)
// Returns immediately

// Consumer: Process order (asynchronously)
while True:
    order = message_queue.consume("orders")
    process_order(order)
    charge_credit_card(order)
    send_email(order)
    // Takes time, but doesn't block producer
```

### Kafka vs RabbitMQ vs SQS

```
                 Kafka              RabbitMQ        AWS SQS
────────────────────────────────────────────────────────────
Throughput       Millions/sec       Thousands/sec   Millions/sec
Latency          Low (ms)           Medium (ms)     Medium (ms)
Durability       Very High          High            High
Ordering         Strong (per part.) Per queue       FIFO only
Replayability    Yes (log)          No              No
Scale            Excellent          Good            Excellent
Operational      Complex            Medium          Simple (managed)
────────────────────────────────────────────────────────────

Use Kafka when:
├─ Need replay/reprocessing
├─ Need millions of messages/sec
├─ Stream processing (Kafka Streams)
└─ Event sourcing architecture

Use RabbitMQ when:
├─ Traditional pub/sub needed
├─ Complex routing rules
├─ Distributed team managing infrastructure
└─ Need point-to-point + pub/sub

Use SQS when:
├─ AWS-native infrastructure
├─ Don't want to operate Kafka cluster
├─ High availability important (AWS manages)
└─ Standard queues acceptable (no ordering guarantee)
```

### Message Queue Guarantees

```
At-Least-Once Delivery:
├─ Consumer gets message at least once
├─ Consumer might get duplicates if crashes after processing
├─ Requires idempotent operations
└─ Most common guarantee

At-Most-Once Delivery:
├─ Consumer gets message 0 or 1 times
├─ If consumer crashes, message lost
└─ Used for non-critical notifications (error logs, analytics)

Exactly-Once Delivery:
├─ Theoretically impossible (consult literature)
├─ In practice: idempotency + deduplication
├─ Use unique message IDs
├─ Track processed IDs (in database or separate store)
└─ Re-processed messages: skip if already processed

Implementation (Exactly-Once):
processed_messages = set()  // or database table

def consume_and_process(message):
    if message.id in processed_messages:
        return  // Already processed, skip

    process(message)
    processed_messages.add(message.id)
    acknowledge(message)  // Tell queue: done with this message
```

---

## Blob Storage

### Blob Storage Basics

```
What: Store large unstructured files (photos, videos, documents)

Examples: AWS S3, Azure Blob Storage, Google Cloud Storage

Characteristics:
├─ Unlimited capacity (pay per GB)
├─ Highly durable (multi-region replication)
├─ Accessed via HTTP (simple API)
├─ Organized by buckets (like directories)

API:
├─ PUT object: upload file
├─ GET object: download file
├─ DELETE object: remove file
├─ LIST objects: list files in bucket

Typical architecture:
User → Upload → API → Blob Storage
                       ├─ Primary region: us-east-1
                       ├─ Backup region: us-west-2
                       ├─ Disaster: eu-central-1
                       └─ Durability: 99.999999999% (11 9s)
```

### CDN for Blob Storage

```
Don't serve blobs directly from bucket (slow)

Instead: Cloudfront CDN → S3

User in Tokyo
  │
  ├─ Cache miss → CDN edge in Tokyo requests S3 (first time)
  └─ Cache hit → CDN edge serves (subsequent requests)

Configuration:
S3 bucket (origin)
   ↑
   │
   └─ CloudFront distribution (cache layer)
       │
       ├─ Edge location: Tokyo
       ├─ Edge location: London
       ├─ Edge location: São Paulo
       └─ Edge location: Singapore

Benefits:
├─ Faster downloads (geographic proximity)
├─ Reduces S3 load (cache hits)
├─ Can compress files (gzip, brotli)
└─ Geographic cost optimization (expensive bandwidth in some regions)
```

---

## Search Engines

### Elasticsearch Basics

```
What: Search engine optimized for full-text search over documents

Use case: Search through millions of documents (products, articles)

Core concept: Inverted Index

Document:
ID=1: "The quick brown fox jumps over lazy dog"
ID=2: "The lazy dog sleeps in the sun"

Inverted Index:
the        → [Doc1, Doc2]
quick      → [Doc1]
brown      → [Doc1]
fox        → [Doc1]
jumps      → [Doc1]
over       → [Doc1]
lazy       → [Doc1, Doc2]
dog        → [Doc1, Doc2]
sleeps     → [Doc2]
in         → [Doc2]
sun        → [Doc2]

Query: "lazy dog"
├─ Find "lazy" → [Doc1, Doc2]
├─ Find "dog" → [Doc1, Doc2]
├─ Intersection → [Doc1, Doc2]
└─ Return both documents
```

### How Inverted Indexes Work

```
Traditional Index (Forward):
Doc1 → [word1, word2, word3, ...]
Doc2 → [word1, word5, ...]

Query "word3": Check every document (slow!)

Inverted Index (Better for search):
word1 → [Doc1, Doc2, Doc5, ...]
word2 → [Doc1, Doc10, ...]
word3 → [Doc1, Doc7, ...]

Query "word3": Check word3 → Get [Doc1, Doc7] (fast!)

Benefits:
├─ O(1) lookup of word positions
├─ Easy boolean queries (AND/OR/NOT)
├─ Supports phrase queries
└─ Can store additional metadata (position, frequency)

Storage example (Elasticsearch):
{
  "index": "products",
  "mappings": {
    "properties": {
      "name": {"type": "text"},
      "description": {"type": "text"},
      "category": {"type": "keyword"}
    }
  }
}

Each field gets its own inverted index!
Search across multiple fields efficiently.
```

### Scalability: Sharding and Replication

```
Elasticsearch Index = Shards × Replicas

Index "products":
├─ 5 primary shards (distribute data)
├─ 1 replica per shard (redundancy)
└─ Total physical space: 5 × (1+1) = 10× logical data size

Shard distribution:
┌─────────────────────────────────────────┐
│ Elasticsearch Cluster                   │
├───────────────────┬─────────────────────┤
│ Node 1            │ Node 2              │
│ Shard 0 (primary) │ Shard 0 (replica)   │
│ Shard 1 (replica) │ Shard 1 (primary)   │
│ Shard 2 (primary) │ Shard 2 (replica)   │
└───────────────────┴─────────────────────┘

Search flow:
User query: "laptop"
  │
  ├─ Router calculates shard → hash(query) % num_shards
  ├─ Query goes to 1 replica per shard (3 shards = 3 parallel requests)
  ├─ Each shard searches its local index
  └─ Results merged and ranked (by relevance score)
```

---

## API Design

### REST vs gRPC vs GraphQL

```
REST (HTTP):
├─ Pros: Simple, stateless, caching-friendly (HTTP cache)
├─ Cons: Multiple requests per operation, over/under-fetching
└─ Use: Public APIs, web applications

Example:
GET /users/1
GET /users/1/posts
GET /users/1/posts/123/comments

Problem: 3 requests for related data (N+1 problem)

gRPC (Protocol Buffers over HTTP/2):
├─ Pros: Binary protocol (fast), bidirectional streams, strong typing
├─ Cons: Complex, requires schema definition, less web-friendly
└─ Use: Microservice communication, real-time data

Example:
GetUserWithPostsAndComments(user_id=1)
  // Single request, gets all related data

GraphQL:
├─ Pros: Query what you need (no over-fetching), strong typing
├─ Cons: Complex to implement, can be slow if misused
└─ Use: APIs with diverse client needs (mobile, web, different queries)

Example:
{
  user(id: 1) {
    name
    posts {
      title
      comments {
        text
      }
    }
  }
}

Comparison:
┌────────────┬──────────────┬────────────┬───────────┐
│ Feature    │ REST         │ gRPC       │ GraphQL   │
├────────────┼──────────────┼────────────┼───────────┤
│Simplicity  │ High         │ Low        │ Medium    │
│Performance │ Medium       │ High       │ Medium    │
│Caching     │ Easy (HTTP)  │ Hard       │ Hard      │
│Type Safety │ None         │ Strong     │ Strong    │
└────────────┴──────────────┴────────────┴───────────┘
```

---

## Rate Limiting

### Rate Limiting Algorithms

#### Token Bucket

```
Concept: Bucket holds N tokens, refill at rate R per second

Configuration:
├─ Capacity: 100 tokens
├─ Refill rate: 10 tokens/second

Timeline:
t=0:    Bucket: [████████] 100 tokens
t=0.1:  Request 50 tokens → Bucket: [████] 50 tokens
t=0.2:  Request 60 tokens → REJECTED (need 60, have 50+1)
t=0.3:  Refill 3 tokens → Bucket: [███] 53 tokens
t=0.4:  Request 30 tokens → Bucket: [███] 23 tokens

Implementation:
bucket_size = 100
tokens = 100
refill_rate = 10  // tokens per second
last_refill_time = now()

def allow_request(needed_tokens=1):
    current_time = now()
    time_elapsed = current_time - last_refill_time
    tokens_to_add = time_elapsed * refill_rate
    tokens = min(bucket_size, tokens + tokens_to_add)
    last_refill_time = current_time

    if tokens >= needed_tokens:
        tokens -= needed_tokens
        return True
    else:
        return False

Pros:
├─ Burst handling (can exceed rate momentarily)
├─ Smooth traffic
└─ Easy to implement

Cons:
├─ Allows brief bursts (may be issue)
└─ Distributed systems: need shared state
```

#### Leaky Bucket

```
Concept: Requests fill a bucket, leak at constant rate

Configuration:
├─ Bucket size: 100
├─ Leak rate: 10 requests/second

Timeline:
t=0:   Request 100 → Bucket: [████████] 100
t=0.1: Leak 1 → Bucket: [███████] 99
t=0.2: Request 20 → Bucket: [█████████████] 119 → REJECTED
       (exceeded capacity)
t=0.3: Leak 1 → Bucket: [███████] 98
       Request 5 → Bucket: [████████] 103 → REJECTED

Implementation:
// Less common in practice (token bucket preferred)
// But concept: bounded queue

queue = []
leak_rate = 10  // per second

def allow_request(request):
    current_time = now()

    // Process queue (leak)
    while queue and (current_time - queue[0].time) > 1/leak_rate:
        queue.pop(0)

    if len(queue) < bucket_size:
        queue.append((request, current_time))
        return True
    else:
        return False  // Queue full

Pros:
├─ Smooth, constant rate
├─ No bursts
└─ Predictable latency

Cons:
├─ Higher latency (requests queued)
└─ Less useful for handling spikes
```

#### Fixed Window

```
Concept: Divide time into fixed windows, count per window

Configuration:
├─ Window size: 1 minute
├─ Limit: 100 requests per window

Timeline:
00:00-00:59: Can make 100 requests
01:00-01:59: Can make 100 requests

Problem: Edge case
t=00:59 → 50 requests made (50 left)
t=01:00 → Window resets → 100 requests allowed
t=01:01 → User made 150 requests in 2 seconds! (50+100)

Implementation:
window_size = 60  // seconds
limit = 100
current_window_start = now()
requests_in_window = 0

def allow_request():
    global current_window_start, requests_in_window

    current_time = now()
    if current_time - current_window_start >= window_size:
        current_window_start = current_time
        requests_in_window = 0

    if requests_in_window < limit:
        requests_in_window += 1
        return True
    else:
        return False

Pros:
├─ Simple implementation
└─ Low memory

Cons:
├─ Edge case: can exceed rate at boundaries
└─ Poor handling of bursty traffic
```

#### Sliding Window

```
Concept: Fixed window + fractional accounting

Configuration:
├─ Window size: 1 minute
├─ Limit: 100 requests per window

Implementation:
Let window_start = current_time - window_size
Count requests in (window_start, current_time]
If count < limit → allow

Timeline:
t=00:00 → First request → count=1, allow
t=00:30 → requests=50 → allow
t=00:59 → requests=100 → allow
t=01:00 → Window slides
        → window_start = 01:00 - 60 = 00:00
        → Count requests in (00:00, 01:00] = 100
        → REJECT (at limit)
t=01:01 → window_start = 01:01 - 60 = 00:01
        → One request from [00:00, 00:01] falls out
        → Count = 99
        → ALLOW

Pros:
├─ No edge case exploits
├─ Smooth rate limiting
└─ Accurate window enforcement

Cons:
├─ More complex implementation
├─ Higher memory (store timestamps)
└─ More CPU (calculate sliding window)
```

### Distributed Rate Limiting

```
Problem: Single rate limiter is a bottleneck and SPOF

Solution 1: Rate limiter per server

Server 1: 100 req/min
Server 2: 100 req/min
Server 3: 100 req/min
└─ Total: 300 req/min across cluster

Problem: User can game system
├─ Make 100 req/min to Server 1
├─ Make 100 req/min to Server 2
├─ Make 100 req/min to Server 3
└─ Total: 300 req/min (but should be limited to 100 per user)

Solution 2: Shared Redis rate limiter

Load Balancer
  │
  ├─ Server 1 ──┐
  ├─ Server 2 ──┼─→ Redis (shared state)
  └─ Server 3 ──┘

All servers check Redis for rate limit state
User limited to 100 req/min across all servers

Problem: Redis is bottleneck + SPOF

Solution 3: Distributed rate limiting with quorum

Each server has local rate limiter
Every 100ms, sync with other servers
Quorum decision: majority vote

Servers track:
server_1_quota_left = 95
server_2_quota_left = 92
server_3_quota_left = 88

If >= 2/3 servers say "allow" → allow request

Pros:
├─ No single point of failure
├─ Distributed consensus
└─ Low latency (mostly local)

Cons:
├─ Complex to implement
├─ Requires reliable clock sync
└─ Possible quota overages (eventual consistency)
```

---

## Key Takeaways

- **Caching is critical** - multi-layer caching strategy
- **Databases vary widely** - pick right one for use case
- **Consistent hashing** - enables horizontal scaling
- **Message queues** - decouple producer and consumer
- **Rate limiting** - protect against abusers and spikes
- **Monitoring everything** - can't optimize what you don't measure
