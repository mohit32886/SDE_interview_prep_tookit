# Classic System Designs

## Table of Contents
1. [URL Shortener](#url-shortener)
2. [Rate Limiter](#rate-limiter)
3. [Consistent Hashing](#consistent-hashing)
4. [Key-Value Store](#key-value-store)
5. [Unique ID Generator](#unique-id-generator)

---

## URL Shortener

Design a URL shortening service like TinyURL. Users can shorten long URLs, and others can access the original URL via the short link.

### Requirements

**Functional:**
- Users can submit long URL → get short URL
- Access short URL → redirect to long URL
- Optional: Expiration, custom aliases, analytics

**Non-Functional (at Twitter/TinyURL scale):**
- DAU: 100M
- Write: 500M URLs shortened/day = 5,787 write QPS
- Read: 2B accesses/day = 23,148 read QPS (read-heavy)
- Latency: Redirect < 100ms (user experience)
- Availability: 99.9%
- Durability: URLs never expire (unless explicitly)
- Scale for 10+ years of data

### Back-of-Envelope Estimation

```
Calculations:

1. DAU: 100M
2. Per-user behavior:
   - Create: 5 short URLs/day
   - Access: 20 accesses/day per URL
   - Total: 100M × 5 = 500M URLs created/day
   - Total: 500M × 5 redirects = 2.5B accesses/day

3. QPS:
   - Write QPS = 500M / 86,400 = 5,787
   - Read QPS = 2.5B / 86,400 = 28,935
   - Peak: 3x = ~87K read QPS

4. Storage (10 years):
   - Data per URL:
     ├─ short_url: 12 bytes
     ├─ original_url: ~500 bytes average
     ├─ created_at: 8 bytes
     ├─ metadata: ~200 bytes
     └─ Total: ~720 bytes per entry

   - Total: 500M URLs/day × 720 bytes × 365 days × 10 years
   - = 1.3 PB raw data
   - With replication (3x): 3.9 PB
   - With indexes: 5 PB

5. Bandwidth:
   - Write: 5,787 QPS × 500 bytes = 2.9 MB/s
   - Read: 28,935 QPS × 300 bytes (redirect response) = 8.7 MB/s
```

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client                               │
│           Shorten: POST /shorten                            │
│           Redirect: GET /{short_code}                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   DNS/      │
                    │   CDN       │
                    │  (cache     │
                    │  redirects) │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │Load Bal. │ │Load Bal. │ │Load Bal. │
        │(US-EAST) │ │(EU-WEST) │ │(APAC)    │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
    ┌────────┴────────────┼────────────┴────────┐
    │                     │                     │
    ▼                     ▼                     ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│API Server 1 │     │API Server 2 │     │API Server 3 │
│Stateless    │     │Stateless    │     │Stateless    │
└────┬────────┘     └────┬────────┘     └────┬────────┘
     │                   │                   │
     └───────────────────┼───────────────────┘
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
        ┌──────────────┐     ┌──────────────┐
        │Cache Layer   │     │DB Layer      │
        │(Redis)       │     │(Sharded DB)  │
        │Hot URLs      │     │              │
        │High perf     │     │Persistent    │
        └──────────────┘     └──────────────┘
```

### API Design

```
1. Shorten URL
POST /shorten
Content-Type: application/json

Request:
{
  "long_url": "https://example.com/very/long/path?query=value",
  "custom_alias": "my-code",  // optional
  "expiration": "2025-12-31"  // optional
}

Response (201 Created):
{
  "short_url": "https://tinyurl.com/abc123",
  "short_code": "abc123",
  "long_url": "https://example.com/very/long/path?query=value",
  "created_at": "2024-01-15T10:30:00Z",
  "expires_at": "2025-12-31T23:59:59Z"
}

2. Redirect to Original URL
GET /{short_code}
Host: tinyurl.com

Response (301 Moved Permanently):
Location: https://example.com/very/long/path?query=value
Cache-Control: public, max-age=3600  // Cache redirect for 1 hour

3. Get URL Details
GET /{short_code}/info

Response (200 OK):
{
  "short_code": "abc123",
  "short_url": "https://tinyurl.com/abc123",
  "long_url": "https://example.com/...",
  "created_at": "2024-01-15T10:30:00Z",
  "clicks": 1523,
  "unique_clicks": 892
}
```

### Data Model

```
URL Mapping Table:
┌─────────┬──────────────┬─────────────────────────┬──────────────┬──────────────┐
│short_id │short_code    │long_url                 │created_at    │expires_at    │
├─────────┼──────────────┼─────────────────────────┼──────────────┼──────────────┤
│1001     │abc123        │https://example.com/...  │2024-01-15    │2025-12-31    │
│1002     │xyz789        │https://google.com/...   │2024-01-16    │NULL          │
│1003     │my-code       │https://github.com/...   │2024-01-17    │2026-01-17    │
└─────────┴──────────────┴─────────────────────────┴──────────────┴──────────────┘

Indexes:
- PRIMARY KEY: short_id
- UNIQUE INDEX: short_code (fast lookup by code)
- INDEX: created_at (for analytics)
- INDEX: expires_at (for cleanup/expiration)

Analytics Table (optional):
┌─────────┬──────────┬──────────────┬──────────┬──────────────┐
│short_id │timestamp │user_agent    │ip        │referer       │
├─────────┼──────────┼──────────────┼──────────┼──────────────┤
│1001     │2024-01.. │Mozilla/5.0.. │127.0.0.1│google.com    │
└─────────┴──────────┴──────────────┴──────────┴──────────────┘
```

### Deep Dive: Short Code Generation

#### Option 1: Base62 Encoding

```
Algorithm:
1. Assign incrementing ID to each URL
2. Encode ID in base62 (0-9, a-z, A-Z = 62 chars)
3. Use as short code

Example:
ID 1001 in base62:
1001 / 62 = 16 remainder 9   → 'j' (9)
16 / 62 = 0 remainder 16     → 'g' (16)
Result: "gj" (reverse order)

Lookup:
short_code "gj"
'g' = 16, 'j' = 9
Decode: 16 * 62 + 9 = 1001
Query: SELECT * FROM urls WHERE short_id = 1001

Pros:
├─ Deterministic (same ID always → same code)
├─ Sequential (no collisions)
├─ Compact (6 chars = 62^6 = 56 trillion combinations)
└─ Reversible (can get back to ID)

Cons:
├─ Predictable (user can guess next URL)
├─ Exposes ID (sequential)
├─ Need global counter (bottleneck)

Calculation:
6-character base62 codes:
62^6 = 56,800,235,584 ≈ 57 billion unique codes

Using sequentially (at 5,787 write QPS):
57 billion / 5,787 QPS = 9.8 million seconds = ~114 days to exhaust!
Long enough for most purposes, use 7+ chars for safety (362 trillion combinations)
```

#### Option 2: MD5 Hash

```
Algorithm:
1. Hash long URL with MD5
2. Take first 6 characters
3. Use as short code

Example:
long_url = "https://example.com/very/long/path?query=value"
hash = MD5(long_url) = "5d41402abc4b2a76b9719d911017c592"
short_code = hash[0:6] = "5d4140"

Pros:
├─ Same long URL always → same short code
├─ Unpredictable (secure)
├─ No need for database lookup during generation
└─ Distributed (no central counter)

Cons:
├─ Collisions possible (6 chars = 16^6 = 4.3 billion combos)
├─ Birthday paradox: ~98K URLs before collision likely
├─ Need collision handling

Collision handling:
If short_code exists:
├─ Try hash[0:7]
├─ If still collides: hash[0:8]
├─ Keep extending until unique

Implementation:
def generate_short_code(long_url):
    for length in range(6, 12):
        hash_value = hashlib.md5(long_url.encode()).hexdigest()
        short_code = hash_value[:length]
        if not exists_in_db(short_code):
            return short_code
    raise "Too many collisions"

Collision probability (birthday paradox):
N items, M possible codes:
P(collision) ≈ sqrt(M)

With 6-char codes (16^6 = 4.3B):
P(collision) ≈ sqrt(4.3B) ≈ 65,000 URLs before high collision rate
```

#### Option 3: Random Generation

```
Algorithm:
1. Generate random 6-character code
2. Check if unique in database
3. If collision: retry with new random code

Example:
random_code = generate_random_code(6)  // "aB3xZq"
if not exists_in_db("aB3xZq"):
    save("aB3xZq")
else:
    retry()

Pros:
├─ No predictability
├─ Simple
└─ Works with multi-instance (no coordination)

Cons:
├─ Retries on collision
├─ As collision rate increases: exponentially more retries
├─ Could reach 99% failure rate at high IDs
├─ Not deterministic (same URL → different codes possible)

Collision probability as codes used up:
0%: Instant generation
10% full: Low retry rate
50% full: ~1 retry average
90% full: ~10 retries average
99% full: ~100 retries (unacceptable!)

Not recommended unless:
├─ Accept determinism loss
├─ Use very long codes (10+ chars)
└─ Accept complexity of collision handling
```

### Recommendation

**Use base62 encoding with sequential IDs:**
- Simplest implementation
- No collisions
- Deterministic
- Only risk: predictability (acceptable for most use cases)

### Scaling Considerations

#### Single Point of Failure: ID Counter

```
Problem: Need global counter for sequential IDs
┌────────────────┐
│ID Counter      │
│(single server) │
└───────┬────────┘
        │
        └─ BOTTLENECK! All writes need counter

Solution: Range allocation
Each server gets range of IDs:

Server 1: IDs 1-10,000,000
Server 2: IDs 10,000,001-20,000,000
Server 3: IDs 20,000,001-30,000,000

┌────────────────┐
│ID Allocator    │ (give out ranges)
└───────┬────────┘
        │
    ┌───┼───┬───┐
    ▼   ▼   ▼   ▼
   S1  S2  S3  S4 (each gets range)

Benefits:
├─ No per-request coordination
├─ No lock contention
├─ Scales linearly
└─ ID Allocator is still SPOF, but infrequent access

Implementation:
┌─────────────────────┐
│ ID Allocator DB     │
├─────────────────────┤
│min_range: 1         │
│max_range: 30M       │
│next_range_start: 30M│
└─────────────────────┘

When server needs IDs:
1. Call allocator: "Give me next range"
2. Allocator: "Take 10M-20M" (atomic update)
3. Server: Use range locally
4. When range exhausted: request new range

No contention on individual IDs!
```

#### Sharding by Short Code

```
Problem: Single database maxes at ~10K QPS

Solution: Shard by short_code

Hash function:
shard_id = hash(short_code) % num_shards

Lookup:
short_code = "abc123"
hash("abc123") % 10 = 3
Query shard 3

Write:
generated_code = "xyz789"
hash("xyz789") % 10 = 7
Insert into shard 7

Shards:
┌──────────────┐
│Shard 0-9      │
│(0, 10, 20...) │
└──────────────┘

With 10 shards:
Each shard: ~3K write QPS
Manageable by single database

Replication:
Each shard: Master + 2 Replicas
├─ Master: 3K write QPS
├─ Replicas: 30K read QPS each
└─ Total: Can handle 28K read QPS (plenty)
```

#### Cache Layer

```
Most short codes are accessed repeatedly:
├─ Some URLs are popular (celebrity links)
├─ Some URLs are rarely accessed

Cache strategy:

On redirect hit (GET /{code}):
1. Check Redis cache
   ├─ Hit: return (fast, ~1ms)
   └─ Miss: query database

2. Query database (if miss)
   ├─ Get original URL
   └─ Update cache (TTL = 24 hours)

3. Return to client

Cache hit rate: 80-90% (pareto distribution)
└─ 80% of traffic on 20% of URLs

Reduced load:
With cache: 30K read QPS → 3K database QPS (87% reduction!)

Cost: One Redis cluster (moderate cost)
Benefit: 10x more capacity without adding database shards
```

---

## Rate Limiter

Design a rate limiting service (like Stripe, AWS API) that limits users to X requests per time window.

### Requirements

**Functional:**
- Allow X requests per user per time window
- Return rate limit exceeded error when exceeded
- Support different limits for different users/tiers
- Work across distributed systems

**Non-Functional:**
- Sub-millisecond latency (add minimal overhead)
- High throughput (millions of rate limit checks/sec)
- Accurate (minimal false positives/negatives)
- Durability: No loss of rate limit state

### Estimation

```
Scale:
- 1B API requests/day
- QPS: 1B / 86,400 = 11,574 baseline
- Peak: 3x = 35,000 QPS for rate limit checks

Latency: Must be < 1ms (else adds huge overhead)

Distribution:
- 10M users
- 1000 requests/user/hour average
- Some users exceed limits (the ones we rate limit)
```

### Algorithms (Revisited)

See Building Blocks section for detailed explanations.

**Recommendation: Token Bucket**
- Allows controlled bursts
- Smooth traffic
- Industry standard (AWS, Google use this)

### High-Level Architecture

```
┌──────────────────────────────────────────┐
│Client Request to API                     │
│GET /api/users/me                         │
│X-API-Key: api_key_12345                  │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│Rate Limiter Service                      │
│(before request hits main API)            │
└────────┬─────────────────────────────────┘
         │
         ├─ Extract API key from request
         ├─ Look up user's rate limit policy
         ├─ Check tokens in Redis
         │  ├─ Sufficient tokens? Decrement, allow request
         │  └─ No tokens? Return 429 (rate limit exceeded)
         │
         ├─ If allowed:
         │  └─ Add headers to response
         │     ├─ X-RateLimit-Limit: 1000
         │     ├─ X-RateLimit-Remaining: 487
         │     └─ X-RateLimit-Reset: 1234567890
         │
         ▼
    ┌─────────────────────┐
    │Main API Server      │
    │(only if allowed)    │
    └─────────────────────┘
         │
         ▼
    Response to client
```

### Implementation: Token Bucket with Redis

```
Redis data structure:

Key: "rate_limit:{user_id}"
Value: {
  "tokens": 95,           // tokens available
  "last_refill": 1704067400,  // last refill time (unix timestamp)
  "capacity": 100,        // max tokens
  "refill_rate": 10       // tokens per second
}

Algorithm:

def check_rate_limit(user_id, tokens_needed=1):
    key = f"rate_limit:{user_id}"
    current_time = time.time()

    # Get current state
    state = redis.hgetall(key)
    if not state:  # First time user
        state = {
            "tokens": capacity,
            "last_refill": current_time,
            "capacity": 100,
            "refill_rate": 10
        }

    # Calculate tokens to add since last refill
    time_passed = current_time - float(state["last_refill"])
    tokens_to_add = time_passed * float(state["refill_rate"])
    tokens = min(float(state["capacity"]),
                 float(state["tokens"]) + tokens_to_add)

    # Check if request allowed
    if tokens >= tokens_needed:
        tokens -= tokens_needed
        allowed = True
    else:
        allowed = False

    # Update state (atomic with Lua script)
    lua_script = """
    redis.call('HSET', KEYS[1], 'tokens', ARGV[1])
    redis.call('HSET', KEYS[1], 'last_refill', ARGV[2])
    return {ARGV[1], ARGV[3]}
    """
    result = redis.eval(lua_script, 1, key, tokens, current_time, allowed)

    return {
        "allowed": allowed,
        "tokens_remaining": result[0],
        "reset_time": current_time + (state["capacity"] - tokens) / state["refill_rate"]
    }

Atomicity:
├─ Use Lua script in Redis (atomic on Redis server)
├─ No race conditions
├─ Consistent state
└─ All-or-nothing execution
```

### Multi-User Rate Limiting

```
Different limits for different users:

Basic tier: 1000 requests/hour
Standard tier: 10,000 requests/hour
Premium tier: 100,000 requests/hour

Implementation:

api_keys = {
    "api_key_user1": {"tier": "basic"},
    "api_key_user2": {"tier": "standard"},
    "api_key_user3": {"tier": "premium"}
}

rate_limits = {
    "basic": {"capacity": 1000, "window": 3600},
    "standard": {"capacity": 10000, "window": 3600},
    "premium": {"capacity": 100000, "window": 3600}
}

def check_rate_limit(api_key):
    user_tier = api_keys[api_key]["tier"]
    limit = rate_limits[user_tier]
    return check_token_bucket(api_key, limit)
```

### Distributed Rate Limiting

```
Problem: Rate limiter checks happening across multiple servers
Can't coordinate in real-time → users bypass by hitting different servers

Solution 1: Centralized Redis
├─ All servers query Redis
├─ Single source of truth
├─ Redis is bottleneck
└─ At 35K QPS: single Redis is overloaded

Solution 2: Redis Cluster
├─ Partition rate limit data by user_id
├─ user_id → Redis node using consistent hashing
├─ No cross-node communication
└─ Scales linearly

Cluster setup:
┌──────────────────────────────────────────────┐
│API Server                                    │
│rate_limit_check(user_id="123")               │
└────┬─────────────────────────────────────────┘
     │
     ├─ hash("123") % 10 = 3 → Query Redis-3
     │
     ▼
     ┌─────────────────────────────────────────┐
     │Redis Cluster                            │
     │┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐     │
     ││Redis││Redis││Redis││Redis│ ...  │     │
     ││-0   ││-1   ││-2   ││-3   │      │     │
     │└──────┘ └──────┘ └──────┘ └──────┘     │
     └─────────────────────────────────────────┘

Each Redis node handles:
- 1B users / 10 nodes = 100M users
- 35K QPS / 10 nodes = 3.5K QPS per node
- Easily handleable

Replication:
Each Redis shard: Master + 1 Replica
├─ Master: handles writes
├─ Replica: failover backup
└─ If node fails: replica takes over
```

---

## Consistent Hashing

See Building Blocks section for detailed explanation. Here's how to implement:

### Implementation

```python
class ConsistentHash:
    def __init__(self, num_virtual_nodes=150):
        self.ring = {}  # position -> node_id
        self.sorted_positions = []
        self.num_virtual_nodes = num_virtual_nodes

    def add_node(self, node_id):
        for i in range(self.num_virtual_nodes):
            virtual_key = f"{node_id}:v{i}"
            position = hash(virtual_key) % (2**32)
            self.ring[position] = node_id
            self.sorted_positions.append(position)

        self.sorted_positions.sort()

    def remove_node(self, node_id):
        for i in range(self.num_virtual_nodes):
            virtual_key = f"{node_id}:v{i}"
            position = hash(virtual_key) % (2**32)
            del self.ring[position]
            self.sorted_positions.remove(position)

    def get_node(self, key):
        if not self.ring:
            return None

        position = hash(key) % (2**32)

        # Find next position >= key's position (clockwise)
        for ring_pos in self.sorted_positions:
            if ring_pos >= position:
                return self.ring[ring_pos]

        # Wrap around (no position >= key found)
        return self.ring[self.sorted_positions[0]]

    def get_replicas(self, key, num_replicas=3):
        """Get N replicas for this key (for replication)"""
        replicas = []
        seen = set()

        position = hash(key) % (2**32)

        for ring_pos in self.sorted_positions:
            if ring_pos >= position:
                node = self.ring[ring_pos]
                if node not in seen:
                    replicas.append(node)
                    seen.add(node)
                if len(replicas) == num_replicas:
                    break

        # Wrap around if needed
        for ring_pos in self.sorted_positions:
            node = self.ring[ring_pos]
            if node not in seen:
                replicas.append(node)
                seen.add(node)
            if len(replicas) == num_replicas:
                break

        return replicas
```

---

## Key-Value Store

Design a distributed key-value store like DynamoDB or Cassandra.

### Requirements

**Functional:**
- get(key) → value
- put(key, value)
- delete(key)
- Distributed (multiple servers)

**Non-Functional:**
- High availability (99.99%)
- Scalability (hundreds of TB)
- Consistency: eventual (not strong)
- Durability: durable (replication)

### Architecture

```
┌──────────────────────────────────────────────────────┐
│Client                                                │
│get("user:123") → fetch user data                     │
└────────┬─────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│Coordinator Node                                      │
│(route requests to right shard)                       │
└────────┬────────────┬───────────────┬────────────────┘
         │            │               │
         ▼            ▼               ▼
    ┌────────┐  ┌────────┐  ┌────────┐
    │Shard 1 │  │Shard 2 │  │Shard 3 │
    │(0-6)   │  │(7-13)  │  │(14-20) │
    │┌──────┐│  │┌──────┐│  │┌──────┐│
    ││Key:  ││  ││Key:  ││  ││Key:  ││
    ││Value ││  ││Value ││  ││Value ││
    │└──────┘│  │└──────┘│  │└──────┘│
    └────┬───┘  └────┬───┘  └────┬───┘
         │           │           │
         ├─ Master node
         ├─ Replica 1
         └─ Replica 2 (replication for HA)
```

### Partitioning with Consistent Hashing

```
Ring of 16 positions (simplified, real: 2^32):

         Node-A
       /        \
      /          \
    Node-D       Node-B
      \          /
       \        /
         Node-C

Key distribution:
key="user:123"
hash("user:123") % 16 = 5

Clockwise from position 5:
5 → 8 → 12 → 0 → ... (find next node)

Suppose nodes at positions:
Node-A: position 0
Node-B: position 5
Node-C: position 10
Node-D: position 14

key="user:123" (hash=5):
├─ Position 5 is exactly Node-B
├─ Primary: Node-B
├─ Replica 1: Next clockwise = Node-C
└─ Replica 2: Next = Node-D

Write path:
PUT key="user:123", value="Alice"
1. Route to primary (Node-B)
2. Node-B writes to local disk
3. Node-B replicates to Node-C, Node-D (async)
4. Return to client (from primary only)

Read path (quorum):
GET key="user:123"
1. Read from any replica (Node-B, Node-C, or Node-D)
2. If versions differ: use conflict resolution (LWW)
3. Return value
```

### Conflict Resolution

```
Scenario: Network partition
Node-B (primary) receives write at t=100ms
Node-C doesn't get update until t=200ms

Meanwhile:
Read from Node-C at t=150ms → sees old value!
Read from Node-B at t=150ms → sees new value!

Solutions:

1. Last-Write-Wins (LWW)
   ├─ Each value has timestamp
   ├─ Timestamp = wall clock
   ├─ Higher timestamp wins
   ├─ Problem: broken if clocks wrong

   Version vectors:
   ├─ Track causal history
   ├─ Detect concurrent vs sequential updates
   └─ Example: [Node-B: 5, Node-C: 3] > [Node-B: 4, Node-C: 3]

2. Application-level merging
   ├─ Store both versions
   ├─ Return both to application
   ├─ Application decides correct version
   ├─ Example: shopping cart merges items from both versions

3. Read repairs
   ├─ On read: check all replicas
   ├─ If versions differ: repair (write latest to lagging replicas)
   └─ Ensures eventual consistency
```

---

## Unique ID Generator

Design a service that generates globally unique IDs (like Snowflake at Twitter).

### Requirements

**Functional:**
- Generate unique IDs
- IDs sortable by timestamp
- No coordination between services
- Fast (< 1ms)

**Non-Functional:**
- Distributed (no single server)
- High throughput (millions of IDs/sec)
- No collisions

### Snowflake ID Format

```
Snowflake ID = 64 bits

┌──────────────────┬─────────┬──────────────┬──────────┐
│ Timestamp        │ Machine │ Sequence     │ Padding  │
│ 41 bits          │ 10 bits │ 12 bits      │ 1 bit    │
├──────────────────┼─────────┼──────────────┼──────────┤
│ 0-40             │ 41-50   │ 51-62        │ 63       │
└──────────────────┴─────────┴──────────────┴──────────┘

Bit breakdown:
- Timestamp (41 bits): Milliseconds since epoch
  └─ Can represent 2^41 = 2 trillion ms = 69 years
  └─ Good enough until year 2089

- Machine ID (10 bits): Which server generated this
  └─ Supports 2^10 = 1024 machines
  └─ Assigned at startup

- Sequence (12 bits): Counter within same millisecond
  └─ Supports 2^12 = 4096 IDs per ms per machine
  └─ Resets every millisecond

- Padding (1 bit): Unused, kept as 0 (signed bit)

Example:
┌─────────────────────────────────────────────────────────────────┐
│ 01111111111 1001010101 101010101010 0                           │
│ Timestamp   Machine    Sequence     Padding                      │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation

```python
import time
import threading

class SnowflakeIDGenerator:
    def __init__(self, machine_id, datacenter_id):
        self.machine_id = machine_id & 0x3FF  # 10 bits
        self.datacenter_id = datacenter_id & 0x1F  # 5 bits
        self.sequence = 0
        self.last_timestamp = 0
        self.lock = threading.Lock()

        # Epoch: 2020-01-01 00:00:00 UTC (in ms)
        self.epoch = 1577836800000

    def generate(self):
        with self.lock:
            current_timestamp = int(time.time() * 1000) - self.epoch

            if current_timestamp < self.last_timestamp:
                # Clock went backwards (system time adjusted)
                # Wait for clock to catch up
                while current_timestamp < self.last_timestamp:
                    current_timestamp = int(time.time() * 1000) - self.epoch

            if current_timestamp == self.last_timestamp:
                # Same millisecond: increment sequence
                self.sequence = (self.sequence + 1) & 0xFFF  # 12 bits
                if self.sequence == 0:
                    # Sequence overflow: wait for next millisecond
                    while current_timestamp == self.last_timestamp:
                        current_timestamp = int(time.time() * 1000) - self.epoch
            else:
                # New millisecond: reset sequence
                self.sequence = 0

            self.last_timestamp = current_timestamp

            # Construct ID
            id = (current_timestamp << 22) | \
                 (self.datacenter_id << 17) | \
                 (self.machine_id << 12) | \
                 self.sequence

            return id

# Usage:
generator = SnowflakeIDGenerator(machine_id=1, datacenter_id=1)
user_id = generator.generate()  # Returns unique 64-bit integer
```

### Advantages of Snowflake

```
vs UUID:
├─ Snowflake: 64 bits (sortable by time)
└─ UUID: 128 bits (random, not sortable)

vs Database auto-increment:
├─ Snowflake: Distributed (no coordination)
└─ Database: Centralized (bottleneck, single point of failure)

vs Unix timestamp + randomness:
├─ Snowflake: Guaranteed unique
└─ Random: Collision possible (though low probability)

Properties:
├─ Ordered by timestamp: Can sort by ID
├─ Distributed: Each machine generates independently
├─ Efficient: 64-bit integers (no strings)
├─ High throughput: Millions per second
└─ No coordination: Lock-free distributed generation
```

### Scaling Considerations

```
Throughput calculation:
- Per machine: 4096 IDs/ms = 4M IDs/sec
- 1000 machines: 4B IDs/sec
- Plenty for most systems!

Clock issues:
- If system clock goes backwards: algorithm waits
- If clock skew between machines: different sequence spaces
  └─ No collision (different machine IDs)
  └─ But might break ordering guarantee

Solutions:
├─ Use NTP (Network Time Protocol) to sync clocks
├─ Handle clock adjustments gracefully
└─ Monitor for abnormal clock behavior
```

---

## Key Takeaways

1. **URL Shortener**: Base62 encoding + sequential IDs + sharding
2. **Rate Limiter**: Token bucket in Redis + consistent hashing for distribution
3. **Consistent Hashing**: Virtual nodes + rebalancing support
4. **Key-Value Store**: Partitioning + replication + conflict resolution
5. **Unique ID Generator**: Snowflake format (timestamp + machine + sequence)

Each system has trade-offs. Know the constraints and choose wisely!
