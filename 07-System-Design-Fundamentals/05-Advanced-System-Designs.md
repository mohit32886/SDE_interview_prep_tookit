# Advanced System Designs

## Table of Contents
1. [Design Twitter Feed](#design-twitter-feed)
2. [Design YouTube](#design-youtube)
3. [Design WhatsApp/Chat System](#design-whatsappchat-system)
4. [Design Google Search](#design-google-search)

---

## Design Twitter Feed

Design a system for generating user timelines (home feed) like Twitter/X.

### Requirements

**Functional:**
- User can view home feed (tweets from followed users)
- Feed ordered by recency/relevance
- User can tweet, retweet, like, reply
- Real-time updates (new tweets appear immediately)

**Non-Functional:**
- DAU: 300M
- Feed QPS: 1B feed loads/day = 11.5K read QPS
- Write QPS: 500M tweets/day = 5.8K write QPS
- Latency: Feed loads in < 500ms (p95)
- Availability: 99.9%
- Eventual consistency acceptable (seconds lag)

### Estimation

```
Scale:
- DAU: 300M
- Avg followers: 50 per user
- Avg tweets viewed: 20 per day per user

Feed QPS:
- 300M DAU × 20 feeds/day = 6B loads/day
- = 69K QPS (peak: 200K QPS)

Feed generation time:
- 200K QPS × 500ms = 100M operations/sec
- Each operation reads multiple tweet indexes
- Must be fast!

Storage:
- 500M tweets/day × 300 bytes = 150 GB/day
- Keep for 1 year: 150GB × 365 = 54.7 TB
- With replication (3x): 164 TB
- With indexes: 250+ TB
```

### Approach 1: Fan-Out On Read

```
Architecture:
┌─────────────────┐
│User A           │
│Followers: 50M   │
└────────┬────────┘
         │
         ├─ Posts tweet
         │
         ▼
    ┌──────────┐
    │Database  │
    │(tweets)  │
    └──────────┘

When follower reads feed:
1. Query database: "Get all tweets from accounts I follow"
2. Filter tweets by followed accounts
3. Sort by timestamp
4. Return to user

SQL Query:
SELECT t.* FROM tweets t
INNER JOIN follows f ON f.followed_user_id = t.user_id
WHERE f.follower_user_id = :user_id
ORDER BY t.created_at DESC
LIMIT 20

Pros:
├─ Simple (only query database)
├─ No extra storage (no duplicate tweets)
└─ Tweets always fresh

Cons:
├─ Database query is heavy (join, sort on large tables)
├─ Slow for users with many followers
├─ High database load
├─ P99 latency high (some queries very slow)

Performance:
- User with 50 followers: query 50 tweet feeds, merge, sort
- Database index: (follower_user_id, created_at)
- Still slow if many followers or long-tail tweets

Use when:
├─ Moderate follower counts
├─ Can tolerate high latency
└─ Storage limited
```

### Approach 2: Fan-Out On Write

```
Architecture:
┌─────────────────┐
│User A (Celebrity)│
│Followers: 50M   │
└────────┬────────┘
         │
         ├─ Posts tweet "Hello world"
         │
         ▼
    ┌──────────────────┐
    │Tweet Database    │
    │(original tweet)  │
    └────────┬─────────┘
             │
             ├─ Asynchronously fan-out to followers
             │
             ▼
    ┌──────────────────────┐
    │Fan-out Queue         │
    │(message queue)       │
    │{"tweet": {...},      │
    │ "followers": [1,2..]}│
    └────────┬─────────────┘
             │
             ├─ Worker processes queue
             │
             ▼
    ┌──────────────────────┐
    │User Timeline Cache   │
    │(Redis per user)      │
    │                      │
    │user:1 → [tweet_id_1, │
    │          tweet_id_2, │
    │          tweet_id_3, │
    │          ...]        │
    │                      │
    │user:2 → [tweet_id_1, │
    │          tweet_id_4, │
    │          ...]        │
    └──────────────────────┘

When follower reads feed:
1. Read from Redis cache (instant!)
2. Get list of tweet IDs
3. Fetch tweet details from database
4. Return to user

Pros:
├─ Fast reads (cache hit, no heavy queries)
├─ Constant latency (users see feed in ~100ms)
├─ Good user experience
└─ P99 latency low

Cons:
├─ Heavy write load (fan-out to millions of followers)
├─ Storage: duplicate tweets in each user's feed
├─ Celebrity problem: 1 tweet → 50M writes!
└─ Complex (message queue, workers, cache)

Performance:
- Celebrity with 50M followers posts 1 tweet
- System must replicate to 50M user caches
- At 10K writes/sec: takes 50M / 10K = 5000 seconds = 83 minutes!
- User's feed gets the tweet after hours!

Use when:
├─ Users have moderate followers
├─ Most users are not celebrities
└─ Can handle eventual consistency
```

### Hybrid Approach: Fan-Out On Write + Read

```
Problem with pure fan-out:
- Celebrities crash the system (50M followers → too many writes)

Solution: Hybrid
├─ Most users: fan-out on write (fast reads)
├─ Celebrities: lazy load on read (read-time merge)

Implementation:

1. Identify celebrities
   └─ Users with > 1M followers

2. For regular users:
   ├─ Write tweet
   ├─ Fan-out to followers' caches
   └─ Followers see immediately (< 100ms)

3. For celebrities:
   ├─ Write tweet to database only
   ├─ DON'T fan-out to cache
   ├─ When follower reads feed:
   │  ├─ Check cache (tweets from followed accounts)
   │  ├─ Check celebrity timeline (on-read, if cached miss)
   │  └─ Merge and return
   └─ Trade: extra latency for celebrities' tweets (but rare)

Architecture:

┌──────────────────────────┐
│Tweet Database            │
│(all tweets)              │
└───────┬──────────────────┘
        │
        ├─ If author is celebrity: skip fan-out
        │
        └─ If author is regular: fan-out
             │
             ▼
        ┌──────────────────────┐
        │Fan-out Queue         │
        └───────┬──────────────┘
                │
                ▼
        ┌──────────────────────┐
        │User Timeline Cache   │
        │(tweets from followed │
        │ non-celebrity users) │
        └──────────────────────┘

Feed generation:
1. Read cache: get 15 tweets from cache (non-celebrities)
2. Query celebrity timeline: get 5 tweets on-read
3. Merge, sort by timestamp
4. Return 20 tweets

Latency:
- Cache hit: ~50ms (memory)
- Celebrity fetch: +100ms (database)
- Merge: +10ms
- Total: ~160ms (acceptable!)

Storage:
- Only non-celebrity tweets cached
- 80% reduction in cache storage
- Celebrity tweets fetched on-read (no storage)
```

### Deep Dive: Cache Implementation

```
Cache structure:
┌────────────────────────────────────────┐
│Redis (per user)                        │
│user:123:feed → [tweet_id_1,           │
│                 tweet_id_2,            │
│                 tweet_id_3,            │
│                 ...up to 1000]         │
│                                        │
│Score: timestamp (for sorting)          │
│TTL: 24 hours (regenerate if stale)     │
└────────────────────────────────────────┘

Sorted Set:
ZADD user:123:feed <timestamp> <tweet_id>

Insert new tweet from followed user:
def on_tweet(tweet):
    tweet_author = tweet.user_id
    followers = get_followers(tweet_author)

    for follower_id in followers:
        # Insert into cache (sorted by timestamp)
        redis.zadd(
            f"user:{follower_id}:feed",
            {tweet.id: tweet.timestamp}
        )
        # Keep only 1000 most recent tweets
        redis.zremrangebyrank(f"user:{follower_id}:feed", 1000, -1)
        # Extend TTL
        redis.expire(f"user:{follower_id}:feed", 86400)

Get feed:
def get_feed(user_id, offset=0, limit=20):
    # Get most recent 20 tweets
    tweet_ids = redis.zrevrange(
        f"user:{user_id}:feed",
        offset,
        offset + limit - 1
    )

    if not tweet_ids:
        return []

    # Fetch full tweet objects from database
    tweets = db.get_tweets(tweet_ids)

    # Return sorted by timestamp
    return sorted(tweets, key=lambda t: t.timestamp, reverse=True)

Cache efficiency:
- Most reads served from cache: 90%+ hit rate
- Database queries only for cache misses
- Parallel database fetches for tweet details
```

### Deep Dive: Fanout Workers

```
Fan-out Queue:
┌────────────────────────────────────────┐
│Message Queue (Kafka)                   │
│                                        │
│{                                       │
│  "tweet_id": 12345,                    │
│  "user_id": 456,                       │
│  "timestamp": 1704067400,              │
│  "followers": [1,2,3,...,50000]        │
│}                                       │
└────────────────────────────────────────┘

Workers (Fan-out):
┌────────────────────────────────────────┐
│Worker-1        Worker-2        ...    │
│                                        │
│Consume tweets   Consume tweets         │
│Fan-out to      Fan-out to             │
│followers        followers              │
│                                        │
│Throughput:     Throughput:            │
│5K writes/sec   5K writes/sec           │
│                                        │
│(Parallel, no contention)               │
└────────────────────────────────────────┘

Fan-out process:
1. Consume message from queue
2. Get list of followers (from follower graph database)
3. For each follower: ZADD to Redis
4. Batch writes: use Redis pipeline
   ├─ Accumulate 100 writes
   ├─ Send as single batch (1-2ms roundtrip)
   └─ Much faster than individual writes

Batching example:
pipe = redis.pipeline()
for follower_id in followers:
    pipe.zadd(f"user:{follower_id}:feed", {tweet_id: timestamp})
    if len(pipe.commands) >= 100:
        pipe.execute()
        pipe = redis.pipeline()
pipe.execute()

Fan-out delays:
- For 50M followers at 5K writes/sec: 50M / 5K = 10,000 seconds = 2.7 hours
- Problem! Followers see tweet hours later

Solution: Faster fans
├─ Increase workers to 100 → 500K writes/sec
├─ 50M / 500K = 100 seconds = OK
├─ Or: Use tiered fan-out
│  ├─ Priority 1: Active followers (tweeted in last 24h)
│  ├─ Priority 2: Engaged followers
│  └─ Priority 3: Others (eventual)
```

---

## Design YouTube

Design a video hosting platform (YouTube, Netflix scale).

### Requirements

**Functional:**
- Users upload videos
- Users watch videos with playback controls
- Support different video qualities
- Search and browse videos
- Comments and likes

**Non-Functional:**
- 500+ hours of video uploaded per minute
- 1B views per day
- Support playback from any location (latency < 1s)
- Support various devices (phones, tablets, TVs)
- Durability: videos never lost
- Availability: 99.99%

### Estimation

```
Scale:
- 500 hours uploaded/minute = 720K hours/day
- Average video size: 1GB per hour of 1080p
- Raw storage: 720K GB/day = 720 TB/day
- Keep for 5 years: 720TB × 365 × 5 = 1.3 Exabytes!

With transcoding to 5 qualities:
- 1.3 EB × 5 = 6.5 Exabytes (!)

Views:
- 1B views/day = 11.5K view QPS
- Video bytes per view:
  - P50: 500MB (typical video, 30 min)
  - Total: 11.5K QPS × 500MB = 5.75 PB/day egress bandwidth
  - That's 66.6 Terabytes per second!

This is why YouTube uses:
├─ CDN (geographically distributed)
├─ Transcoding (multiple qualities)
├─ Compression (reduce bandwidth)
└─ Adaptive bitrate streaming
```

### Architecture

```
Upload Path:

User uploads video
└─ POST /upload {video_file}
│
▼
┌──────────────────────────┐
│API Server                │
│(ingestion)               │
└────────┬─────────────────┘
         │
         ├─ Store raw video in blob storage (S3)
         │
         ├─ Enqueue transcoding task
         │
         ▼
    ┌──────────────────────┐
    │Transcoding Queue     │
    │(message queue)       │
    └────────┬─────────────┘
             │
             ├─ Worker fetches task
             │
             ▼
    ┌──────────────────────┐
    │Transcoding Service   │
    │                      │
    │ffmpeg conversion:    │
    │├─ 4K (2160p)        │
    │├─ 1080p             │
    │├─ 720p              │
    │├─ 480p              │
    │└─ 240p              │
    └────────┬─────────────┘
             │
             ├─ Store all versions in blob storage
             │
             ▼
    ┌──────────────────────┐
    │Video Metadata DB     │
    │                      │
    │{video_id, title,     │
    │ uploaded_by, sizes}  │
    └──────────────────────┘


Watch Path:

User requests video
└─ GET /video/{video_id}
│
▼
┌──────────────────────┐
│API Server            │
│(video gateway)       │
└────────┬─────────────┘
         │
         ├─ Query metadata
         │
         ├─ Check user's connection speed
         │
         ├─ Select quality (adaptive bitrate)
         │
         ▼
    ┌──────────────────────┐
    │CDN                   │
    │(Cloudflare, Akamai)  │
    │                      │
    │Local edge servers    │
    │Stream video          │
    │(latency < 100ms)     │
    └──────────────────────┘
```

### Adaptive Bitrate Streaming

```
Problem:
- Different users have different bandwidth
- User on 4G: can stream 1080p
- User on 3G: needs 480p (2Mbps)
- Fixed bitrate: buffering or poor quality

Solution: Adaptive Bitrate (ABR)

Process:
1. Video transcoded to multiple bitrates
   ├─ 4K (25 Mbps)
   ├─ 1080p (5 Mbps)
   ├─ 720p (2.5 Mbps)
   ├─ 480p (1.5 Mbps)
   └─ 240p (0.5 Mbps)

2. Video split into chunks (6-10 second segments)
   ├─ Segment 1 (1080p): chunk-1-1080p.m4s
   ├─ Segment 2 (1080p): chunk-2-1080p.m4s
   └─ Each quality has own segments

3. Playlist (manifest) lists all segments
   Playlist (HLS format):
   ├─ #EXT-X-STREAM-INF:BANDWIDTH=5000000
   ├─ stream-1080p.m3u8
   ├─ #EXT-X-STREAM-INF:BANDWIDTH=2500000
   ├─ stream-720p.m3u8
   └─ ... (other qualities)

4. Player adaptive algorithm:
   - Monitor bandwidth in real-time
   - Calculate available bandwidth
   - Select quality that fits
   - If bandwidth drops: switch to lower quality
   - If bandwidth improves: switch to higher quality

Player logic (simplified):
current_bandwidth = measure_bandwidth()  // Last 5 chunks

for segment_number in range(total_segments):
    // Measure bandwidth after each chunk
    current_bandwidth = measure_bandwidth()

    // Select best quality that fits
    selected_quality = None
    for quality in [4K, 1080p, 720p, 480p, 240p]:
        if quality.bitrate <= current_bandwidth * 0.85:
            selected_quality = quality
            break  // Select highest quality that fits

    // Download segment
    chunk_data = download(f"chunk-{segment_number}-{selected_quality}.m4s")

    // Buffer and play
    buffer.add(chunk_data)
    if buffer.size > 3:  // 3 chunks = 18-30 seconds buffered
        player.play(buffer.get())

Bitrate selection factors:
├─ Current bandwidth
├─ Buffer occupancy (if low: choose low quality)
├─ Latency (if high: choose low quality)
├─ Device screen size (4K unnecessary on phone)
└─ User preferences (max quality setting)
```

### Transcoding Pipeline

```
Massive scale problem:
- 500 hours/minute = 7.2M hours/day
- Each hour takes 30 minutes to transcode to 1 quality
- Need: 7.2M hours × 30 min / 5 qualities = ???

If single machine (8 cores):
- 1 transcoding job per machine = 30 min per hour
- Need 7.2M / (24 × 60 / 30) = 7.2M / 48 = 150K machines!

Solution: Distributed transcoding

┌─────────────────────────────────────┐
│Upload Queue                         │
│(new videos uploaded)                │
└──────────┬──────────────────────────┘
           │
    ┌──────▼───────────────────────────┐
    │Transcoding Orchestrator         │
    │(assign jobs to workers)         │
    └──────┬──────────────────────────┘
           │
    ┌──────┼──────────────────────┬───────┐
    ▼      ▼                      ▼       ▼
┌──────┐┌──────┐           ┌──────┐┌──────┐
│Trans-││Trans-│ ...       │Trans-││Trans-│
│code- ││code- │           │code- ││code- │
│Job-1 ││Job-2 │           │Job-N ││Job-N+│
│      ││      │           │      ││1     │
│240p  ││480p  │           │4K    ││1080p │
└──────┘└──────┘           └──────┘└──────┘
                (10,000+ workers)

Parallelization:
- 500 hours/min uploaded
- Each quality transcoded in parallel (5 workers)
- 10,000 workers total
- Throughput: 10,000 workers × (60 min job / 30 min) = 20K hours/min
- Can handle 500 hours/min (plenty of headroom!)

GPU acceleration:
- CPU transcoding (ffmpeg): slow (30 min per hour)
- GPU transcoding (NVIDIA): fast (3-5 min per hour)
- Use GPU cluster for transcoding
- Cost: $10K per GPU, but 10x faster = worth it
```

### CDN Distribution

```
Content distribution:

Raw video in blob storage (S3):
├─ US East: 1 copy
├─ EU West: 1 copy
└─ APAC: 1 copy (3-way replication)

CDN edge servers:
┌─────────────────────────────────────┐
│CDN Operator (Cloudflare, Akamai)   │
│                                     │
│Edge Servers:                        │
│├─ NYC (USA)                         │
│├─ London (Europe)                   │
│├─ Tokyo (APAC)                      │
│├─ São Paulo (South America)         │
│├─ Sydney (Oceania)                  │
│├─ Dubai (Middle East)               │
│└─ ... (50+ total locations)         │
│                                     │
│Each edge caches popular videos      │
└─────────────────────────────────────┘

User watches video:
1. User in Tokyo
2. Request goes to Tokyo edge server
3. If cached: serve from edge (0-50ms latency)
4. If not cached: fetch from origin S3, cache for 24h

Cache hierarchy:
┌───────────────┐
│User           │
└───────┬───────┘
        │
        ▼
┌───────────────────────┐
│Edge (Tokyo)           │ ← First check here
│Cache for popular      │
└─────┬─────────────────┘
      │
      ├─ Hit: serve (instant)
      │
      └─ Miss: query regional cache
              │
              ▼
         ┌──────────────────┐
         │Regional Cache    │
         │(APAC region)     │
         └────┬─────────────┘
              │
              └─ Miss: query origin
                      │
                      ▼
                 ┌────────────┐
                 │S3 Origin   │
                 │(US/EU/APAC)│
                 └────────────┘

Cache sizes:
- Edge server: 50 TB (hot videos)
- Regional cache: 500 TB
- Origin: unlimited (all videos)
```

---

## Design WhatsApp/Chat System

Design a real-time messaging system like WhatsApp, Slack.

### Requirements

**Functional:**
- Users can send text messages 1:1
- Group chat support
- Read receipts (message, delivered, read status)
- Typing indicators
- Online/offline status
- Message persistence

**Non-Functional:**
- 1B DAU
- 100B messages/day
- Message delivery latency < 1 second
- Group chats up to 10K users
- Availability: 99.99%
- Message durability: never lost

### Estimation

```
Scale:
- 1B DAU
- 100B messages/day = 1.15M write QPS
- Message size: 200 bytes (text + metadata)
- Storage: 100B × 200 bytes = 20 TB/day
- Keep for 5 years: 20TB × 365 × 5 = 36.5 PB

Online users:
- ~30% of DAU online at peak
- 300M concurrent connections
- Each needs WebSocket/long-poll connection
```

### Architecture

```
┌──────────────────────────────────────────┐
│User Devices                              │
│(phones, web, desktop)                    │
└────────┬─────────────────────────────────┘
         │
         ├─ Open WebSocket connection (persistent)
         │
         ▼
┌──────────────────────────────────────────┐
│API Gateway (Load Balancer)               │
│(route to appropriate chat server)        │
└────────┬─────────────────────────────────┘
         │
    ┌────┴────────────┬────────────────┐
    ▼                 ▼                ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│Chat Server │  │Chat Server │  │Chat Server │
│ Node 1     │  │ Node 2     │  │ Node N     │
│            │  │            │  │            │
│(1000s of   │  │(1000s of   │  │(1000s of   │
│WebSocket   │  │WebSocket   │  │WebSocket   │
│conns)      │  │conns)      │  │conns)      │
└─────┬──────┘  └─────┬──────┘  └─────┬──────┘
      │               │               │
      └───────────────┼───────────────┘
                      │
              ┌───────┼───────┐
              ▼               ▼
         ┌────────────┐  ┌────────────┐
         │Message     │  │Notification│
         │Queue       │  │Service     │
         │(Kafka)     │  │(push, SMS) │
         └─────┬──────┘  └────────────┘
               │
               ├─ Store in DB
               │
               ├─ Update user's message queue (Redis)
               │
               └─ Notify recipient (if online)
```

### WebSocket Connection Management

```
Challenge: 300M concurrent connections

Solution: Connection pooling at server

Server capacity:
- Single server: ~10K concurrent WebSocket connections
- Need: 300M / 10K = 30,000 chat servers

Connection setup:

1. User opens app
2. Makes WebSocket connection:
   WS://api.chat.com/ws?user_id=123

3. Load balancer routes to least-loaded chat server
   hash(user_id) → Chat Server 42

4. Server accepts connection
   Store in memory:
   ├─ connections[user_id] = WebSocket
   └─ Keep-alive: periodic ping (every 30s)

5. User receives confirmation:
   {"status": "connected", "server": "chat-42"}

Disconnect handling:

User loses network → WebSocket closes
└─ Server detects connection lost (no ping response)
└─ Server marks user offline
└─ Other users see status "Offline" (if subscribed)

When reconnecting:
1. Connects to load balancer
2. Might be routed to different server
3. New server: "User was on chat-42, fetch pending messages"
4. User gets all undelivered messages
```

### Message Delivery Guarantees

```
States of a message:

1. SENT (on sender's device)
   └─ Message composed, user hits "send"

2. SENT_TO_SERVER (reached our servers)
   └─ Server received message

3. DELIVERED (reached recipient device, stored)
   └─ Message in recipient's database
   └─ Recipient can see in conversation view
   └─ UI shows checkmark ✓

4. READ (recipient opened and read)
   └─ Recipient scrolled to message or opened chat
   └─ UI shows blue checkmark ✓✓

Implementation:

Send message flow:
┌──────────────────┐
│Sender            │
│Composes: "Hi!"   │
└────────┬─────────┘
         │ Send
         ▼
    ┌──────────────────────┐
    │Chat Server (receives)│
    │SENT_TO_SERVER status │
    └────────┬─────────────┘
             │
      ┌──────┴──────────┐
      │                 │
      ├─ Is receiver    │
      │  online?        │
      │                 │
      ├─ YES: Send to   │ ├─ NO: Queue in
      │  receiver over  │ │  database
      │  WebSocket      │ │
      │                 │ │  When receiver
      │  └─ Receiver    │ │  comes online:
      │     stores in   │ │  ├─ Query pending
      │     database    │ │  │  messages
      │                 │ │  └─ Send over
      │  └─ DELIVERED   │ │     WebSocket
      │     status      │ │
      │                 │ └─ DELIVERED status
      └──────┬──────────┘
             │
             ├─ Send delivery confirmation to sender
             │  {"status": "DELIVERED", "msg_id": "abc123"}
             │
             └─ Sender's UI shows checkmark ✓

Read receipt flow:
Recipient reads message
└─ Client detects: message is visible on screen
└─ Calls API: POST /messages/{msg_id}/read
└─ Server marks message as READ
└─ Server notifies sender: "Message read at 10:30 AM"
└─ Sender's UI shows double checkmark ✓✓
```

### Group Chat

```
Challenge: Broadcasting message to 10K users

Naive approach:
┌─────────────────────┐
│User sends message   │
│to group "Team"      │
└────────┬────────────┘
         │
         ├─ Look up all 10K group members
         │
         ├─ For each member:
         │  ├─ Send message
         │  ├─ Update DB
         │  ├─ Send notification
         │
         └─ Total: 10K iterations (slow!)

Better approach: Fanout queue

1. User sends message
   POST /groups/team/messages
   {"text": "Meeting at 2 PM"}

2. Store in message DB
   messages table:
   ├─ msg_id: 999
   ├─ group_id: team
   ├─ sender_id: alice
   ├─ text: "Meeting at 2 PM"
   └─ timestamp: 1704067400

3. Enqueue fanout task
   PUSH message_queue {
     "msg_id": 999,
     "group_id": "team",
     "members": [bob, charlie, dave, ...]
   }

4. Fanout workers process in parallel
   ├─ Worker 1: notify members 1-100
   ├─ Worker 2: notify members 101-200
   └─ ...

5. Each worker:
   ├─ Check if member online
   ├─ If online: send over WebSocket
   ├─ If offline: queue message
   └─ Update delivery status

Benefits:
├─ Parallelization (faster)
├─ Decoupled (API returns immediately)
└─ Scalable (add workers as needed)

Timeline:
- API call returns: < 100ms
- 90% of group members notified: < 1 second
- All members notified: < 5 seconds
- Offline members get on next login
```

### Typing Indicators

```
Real-time feature: "alice is typing..."

Implementation:

1. User types in message field
   └─ Client detects: keypress, text changed
   └─ Client: timer starts

2. Every 1 second, send typing indicator
   WS.send({
     "event": "TYPING",
     "chat_id": "chat123",
     "user_id": "alice",
     "timestamp": 1704067400
   })

3. Server receives typing event
   └─ Broadcast to all users in chat:
      └─ (except sender)
      └─ to each online connection

4. Recipient receives notification
   └─ Display "alice is typing..."
   └─ Show typing bubble animation
   └─ If no new typing event for 5s: hide

Optimization:

Don't send on every keystroke (spam!)

Throttle:
├─ Send first keystroke
├─ Then send every 1 second (if still typing)
├─ Don't send if user already marked as "typing"
└─ Stop when user:
   ├─ Sends message (typing ends)
   ├─ Deletes all text (typing ends)
   └─ No keystroke for 3 seconds

Server-side throttle:
├─ Cache typing state per chat
├─ Cache TTL: 5 seconds
├─ Broadcasting: only once per second
└─ Prevent duplicate "alice is typing" notifications
```

### Message Persistence

```
Requirements:
- Messages never lost
- Users can retrieve history (even old messages)
- Efficient storage (36.5 PB for 5 years)

Database design:

Table: messages
┌────────┬──────────────┬──────────────┬──────────┬───────────┐
│msg_id  │sender_id     │receiver_id   │text      │timestamp  │
├────────┼──────────────┼──────────────┼──────────┼───────────┤
│1       │alice         │bob           │Hello     │1704067400 │
│2       │bob           │alice         │Hi there! │1704067401 │
│3       │alice         │group:team    │FYI...    │1704067402 │
└────────┴──────────────┴──────────────┴──────────┴───────────┘

Index strategy:
├─ PRIMARY KEY: msg_id
├─ INDEX: (receiver_id, timestamp) — for retrieval
├─ INDEX: (sender_id, timestamp) — for analytics
└─ INDEX: timestamp — for cleanup/archival

Partitioning:
- Partition by date
- messages_2024_01_15 (only messages from Jan 15)
- messages_2024_01_16
- Benefits:
  ├─ Parallel queries (query only recent partitions)
  ├─ Easy deletion (drop old partition)
  └─ Faster (smaller table = faster scans)

Archival:
- Hot storage: last 3 months (SSD, fast)
- Warm storage: 3-12 months (HDD, slower)
- Cold storage: > 1 year (S3 Glacier, cheapest)

User retrieves old message (6 months):
1. Check hot storage → miss
2. Check warm storage → hit
3. Fetch from warm storage (slower, but acceptable)
4. Return to user (might take 2-5 seconds)

Cost optimization:
- Hot: 1.5 PB (recent 3 months)
- Warm: 2.5 PB (3-12 months)
- Cold: 32.5 PB (> 1 year)
- Cost: ~$100K/month for storage
```

---

## Design Google Search

Design a search engine backend like Google Search.

### Requirements

**Functional:**
- Index billions of web pages
- Return relevant results < 1 second
- Support query refinement (autocomplete suggestions)
- Handle typos and variations

**Non-Functional:**
- Queries: 5B/day = 57K QPS (peak: 200K)
- Web pages: 100B pages
- Result page: top 10 results per query
- Freshness: pages crawled weekly (billions of pages)
- Availability: 99.99%
- Scalability: handle 10x growth

### Estimation

```
Storage:

100B web pages indexed
Average page size: 100KB (just content, not DOM)
Total: 100B × 100KB = 10 Exabytes (just raw pages!)

With index (inverted index):
Raw pages: 10 EB
Inverted index: 1-2 EB (maps words to pages)
Total: 11-12 EB

Real world:
Google uses specialized compression: ~1 EB equivalent

Query QPS:
5B queries/day / 86,400 = 57K QPS
Peak: 3x = 170K QPS

Latency:
- P50: 100ms
- P95: 500ms
- P99: 2 seconds
(Allow for: disk I/O, network, multiple servers)
```

### High-Level Architecture

```
┌──────────────────────────────────────────┐
│User enters "machine learning"            │
│in Google search box                      │
└───────────────┬──────────────────────────┘
                │
                ├─ Real-time suggestions
                │  (autocomplete)
                │
                ▼
    ┌──────────────────────────────────┐
    │User clicks "Search"              │
    │Sends query                       │
    └───────────────┬──────────────────┘
                    │
                    ▼
    ┌──────────────────────────────────┐
    │Query Server                      │
    │(parse query, normalize)          │
    │                                  │
    │Input: "machine learning"         │
    │Output: tokens: [machine, learn]  │
    └───────────────┬──────────────────┘
                    │
                    ├─ Check spelling
                    ├─ Expand synonyms
                    └─ Remove stop words
                    │
                    ▼
        ┌──────────────────────┐
        │Index Lookup          │
        │(find pages with      │
        │words: machine, learn)│
        └────────┬─────────────┘
                 │
                 ├─ Inverted index lookup
                 │  machine → [page1, page3, page5, ...]
                 │  learning → [page1, page2, page4, ...]
                 │
                 ├─ Intersection
                 │  pages matching BOTH → [page1, ...]
                 │
                 ▼
    ┌──────────────────────────────────┐
    │Ranking Server                    │
    │(score pages by relevance)        │
    │                                  │
    │Factors:                          │
    │├─ PageRank (link popularity)    │
    │├─ TF-IDF (term frequency)       │
    │├─ Domain authority              │
    │├─ Freshness                     │
    │├─ User signals (CTR, dwell time)│
    │└─ Personalization               │
    └───────────────┬──────────────────┘
                    │
                    ├─ Score top 1000 pages
                    ├─ Re-rank by relevance
                    │
                    ▼
        ┌──────────────────────┐
        │Result Formatter      │
        │(prepare response)    │
        │                      │
        │Top 10 results:       │
        │1. Title              │
        │2. URL                │
        │3. Snippet (excerpt)  │
        └──────────────────────┘
                    │
                    ▼
    ┌──────────────────────────────────┐
    │Return results to client          │
    │Display on SERP (search result    │
    │page)                             │
    └──────────────────────────────────┘
```

### Inverted Index

```
Definition: Maps words to documents (opposite of forward index)

Traditional approach:
Document 1: "Google search engine"
Document 2: "Machine learning tutorial"
Document 3: "Google machine learning"

Forward index (document → words):
doc1 → [google, search, engine]
doc2 → [machine, learning, tutorial]
doc3 → [google, machine, learning]

Search "google": check all 3 documents (slow!)

Inverted index (word → documents):
google → [doc1, doc3]
search → [doc1]
engine → [doc1]
machine → [doc2, doc3]
learning → [doc2, doc3]
tutorial → [doc2]

Search "google": lookup 1 key → [doc1, doc3] (instant!)

With frequency/position data:

google → {
  doc1: [position: 1, frequency: 1],
  doc3: [position: 1, frequency: 1]
}

machine → {
  doc2: [position: 1, frequency: 1],
  doc3: [position: 2, frequency: 1]
}

Search query: "google machine"
─────────────────────────────────
1. Get posting lists:
   google → [doc1, doc3]
   machine → [doc2, doc3]

2. Intersection (AND):
   doc1 ∩ doc3 ∩ doc2 ∩ doc3 = [doc3] (only doc3 has both)

3. Score doc3:
   ├─ google at position 1: good!
   ├─ machine at position 2: good!
   └─ Score: high

Result: doc3 ranked highest
```

### PageRank Algorithm (Simplified)

```
Idea: Popular pages are important pages
"importance" = number of high-quality links pointing to page

Simplified PageRank:
PR(A) = (1-d)/N + d × [PR(T1)/C(T1) + PR(T2)/C(T2) + ...]

Where:
- A = page being ranked
- d = damping factor (0.85, meaning 85% follows links)
- N = total pages (bias term)
- T1, T2 = pages linking to A
- C(T1) = number of outlinks from T1
- PR(T1) = PageRank of page T1

Example:

Pages: A, B, C, D
Links:
├─ B → A
├─ C → A
├─ C → B
├─ D → A
├─ D → B
├─ D → C

Initial PR: each page starts with 1.0

Iteration 1:
PR(A) = 0.15/4 + 0.85 × [PR(B)/1 + PR(C)/2 + PR(D)/3]
      = 0.0375 + 0.85 × [1/1 + 1/2 + 1/3]
      = 0.0375 + 0.85 × 1.833
      = 0.0375 + 1.558
      = 1.596

Iterate until convergence...

Result: Pages with many incoming links get high rank

Problem: Iterating billions of pages is expensive!

Approximation: Use MapReduce
├─ Map: Distribute rank to outlinks
├─ Reduce: Aggregate incoming ranks
└─ Repeat until convergence (usually 20-30 iterations)

Modern Google: Uses much more complex algorithm
├─ 200+ signals considered
├─ Machine learning ranking
├─ Real-time user signals
└─ Not just PageRank anymore
```

### Query Autocomplete

```
Challenge:
- 200K peak QPS
- Response in < 100ms
- Suggestions must be relevant

Example:
User types: "mach"
Autocomplete returns:
├─ machine learning
├─ machine translation
├─ macbook pro
└─ machinery

Implementation:

1. Build frequency table offline
   ├─ Analyze past queries (5B/day)
   ├─ Count: "machine learning" = 5M queries/day
   ├─ Count: "machine translation" = 2M queries/day
   ├─ Count: "macbook pro" = 1M queries/day
   └─ Sort by frequency

2. Build Trie (prefix tree) of popular queries
   ┌──────────────────────────────┐
   │Root                          │
   ├─── m                         │
   │    ├─── a                    │
   │    │    ├─── c              │
   │    │    │    ├─── h         │
   │    │    │    │    ├─── i    │
   │    │    │    │    │    ├─ n (→"machine learning": 5M)
   │    │    │    │    │    └─ e (→"machine translation": 2M)
   │    │    │    │    └─── b (→"macbook pro": 1M)

3. On query, traverse Trie
   User types "mach"
   ├─ Start at root
   ├─ Follow m → a → c → h
   ├─ At "h" node, find top results (sorted by frequency)
   └─ Return: ["machine learning", "machine translation", "macbook pro"]

4. Store Trie in memory
   ├─ Entire Trie: ~100GB
   ├─ Distributed across N servers
   ├─ Each server: subset of Trie (sharded by prefix)
   └─ Server for "a*": handles autocomplete for queries starting with "a"

5. Return top 10 suggestions
   Response time: < 10ms (in-memory lookup)

Updates:
- Rebuild Trie daily/weekly
- Update frequencies based on recent queries
- Remove outdated/spam suggestions
- Handle trending topics (e.g., "covid", "election")
```

---

## Key Takeaways

1. **Twitter Feed**: Hybrid fan-out (fan-out on write for regular users, fan-out on read for celebrities)
2. **YouTube**: Transcoding pipeline, CDN distribution, adaptive bitrate streaming
3. **WhatsApp**: WebSocket connection pooling, message delivery guarantees, fanout for group chat
4. **Google Search**: Inverted indexing, PageRank for ranking, Trie for autocomplete
