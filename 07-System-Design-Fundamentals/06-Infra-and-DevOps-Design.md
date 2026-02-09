# Infrastructure and DevOps System Designs

## Table of Contents
1. [Notification System](#notification-system)
2. [Logging and Monitoring System](#logging-and-monitoring-system)
3. [Distributed Task Scheduler](#distributed-task-scheduler)
4. [CI/CD Pipeline](#cicd-pipeline)

---

## Notification System

Design a notification service that sends push, SMS, and email notifications at scale.

### Requirements

**Functional:**
- Send notifications via multiple channels: push, SMS, email
- Support batch sending (e.g., daily digest)
- Track delivery status
- Support notification templates
- User notification preferences (opt-in/out)

**Non-Functional:**
- 1B DAU
- 10B notifications/day
- Delivery latency: < 1 minute
- Reliability: 99.9% (must deliver)
- Deduplication: prevent duplicate sends
- Rate limiting: per user, per channel

### Estimation

```
Scale:
- 10B notifications/day
- QPS: 10B / 86,400 = 115.7K write QPS
- Peak: 3x = 350K QPS

Channel breakdown:
- Push (50%): 5B/day = 57.9K QPS
- Email (30%): 3B/day = 34.7K QPS
- SMS (20%): 2B/day = 23.1K QPS

Each notification:
├─ Push: 1 KB
├─ Email: 50 KB (includes HTML, images)
└─ SMS: 0.1 KB

Storage (1 year):
- Notification records: 10B × 50 bytes = 500 GB
- Email bodies: 3B × 50KB = 150 TB
- Total: ~150 TB
```

### Architecture

```
┌─────────────────────────────────────────────────┐
│Application Service                             │
│(decides to send notification)                   │
│trigger_notification(user_id, type, context)    │
└──────────┬──────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│Notification Service (API)                       │
│                                                  │
│- Deduplication (prevent duplicate sends)        │
│- User preferences (respect opt-outs)            │
│- Template rendering                            │
│- Priority classification                        │
└──────────┬───────────────────────────────────────┘
           │
           ├─ Check user preferences
           ├─ Check deduplication cache
           ├─ Render template
           ├─ Calculate priority
           │
           ▼
┌──────────────────────────────────────────────────┐
│Notification Queue (Kafka)                       │
│                                                  │
│Topics:                                          │
│├─ notifications.push (high throughput)          │
│├─ notifications.email (lower throughput)        │
│└─ notifications.sms (critical, rate-limited)    │
└──────────┬──────────────────────┬───────────────┘
           │                      │
           ├──────────┬───────────┼─────────┐
           ▼          ▼           ▼         ▼
    ┌──────────┐┌──────────┐┌──────────┐┌──────────┐
    │Push      ││Email     ││SMS       ││In-App    │
    │Service   ││Service   ││Service   ││Service   │
    │(workers) ││(workers) ││(workers) ││(workers) │
    └────┬─────┘└────┬─────┘└────┬─────┘└────┬─────┘
         │           │           │           │
         ├─ Call FCM/APNS    ├─ Call SendGrid  ├─ Call Twilio
         │                   │                 │
         │                   └─ Check bounce   └─ Respect rate limit
         │                     list
         │
         ├─ Retry on failure
         └─ Track delivery status
              │
              ▼
         ┌──────────────────────┐
         │Notification DB       │
         │(delivery status)     │
         │                      │
         │notification_id       │
         │user_id               │
         │type (push/email/sms) │
         │status (sent/failed)  │
         │timestamp             │
         └──────────────────────┘
```

### Channels: Push, Email, SMS

```
PUSH NOTIFICATIONS
──────────────────
Providers: Firebase Cloud Messaging (FCM), Apple Push Notification (APNS)

Flow:
1. Server sends to FCM/APNS
2. FCM/APNS delivers to user's device
3. Device is offline? FCM holds message, delivers when online

Request:
{
  "user_id": "12345",
  "title": "Order confirmed",
  "body": "Your order #999 is confirmed",
  "data": {
    "order_id": "999",
    "deep_link": "myapp://orders/999"
  }
}

Delivery: ~1 second if device online, up to 24 hours if offline

Pros:
├─ Fast (seconds)
├─ High engagement (user sees notification)
└─ Can trigger app actions

Cons:
├─ User must have app installed
├─ Can be annoying (users disable)
└─ Depends on third-party (FCM/APNS availability)

Rate limiting:
├─ Max 5 push notifications per user per hour
├─ Batch multiple actions into single notification
└─ Respect user quiet hours (e.g., no notifs 9 PM - 8 AM)

EMAIL NOTIFICATIONS
───────────────────
Providers: SendGrid, Mailgun, AWS SES

Flow:
1. Server sends to email service
2. Email service delivers to user's inbox
3. Can take seconds to minutes (depends on ISP)

Request:
{
  "to": "user@example.com",
  "template": "order_confirmation",
  "data": {
    "order_id": "999",
    "items": [...],
    "total": "$99.99"
  }
}

Delivery: Seconds to minutes (depends on email provider)

Pros:
├─ No installation required (everyone has email)
├─ Good for important notifications
├─ Can be long-form (order details, receipts)
└─ Trackable (open rate, click rate)

Cons:
├─ Slower than push
├─ Can be marked as spam
├─ Depends on email provider rate limits
├─ Large payloads (50 KB vs 1 KB for push)

Bounce handling:
├─ Hard bounces: email doesn't exist (mark invalid)
├─ Soft bounces: temporary issue (retry later)
├─ Track bounce list to prevent future sends

SMS NOTIFICATIONS
─────────────────
Providers: Twilio, AWS SNS, Nexmo

Flow:
1. Server sends to SMS provider
2. SMS provider sends to carrier
3. Carrier delivers to user's phone

Request:
{
  "phone": "+1-555-123-4567",
  "message": "Your code is 123456"
}

Delivery: Seconds (very fast)

Pros:
├─ Fast (seconds)
├─ High engagement (98% open rate vs email)
├─ Works on any phone
├─ Good for time-sensitive (2FA, alerts)

Cons:
├─ Expensive ($0.01-0.10 per SMS)
├─ Limited length (160 characters)
├─ Can be intrusive (costs user money on pre-paid plans)
├─ Requires phone number (privacy concern)

Rate limiting:
├─ Max 1 SMS per user per hour (expensive!)
├─ Batch multiple updates into single SMS
├─ Use only for critical alerts

Cost comparison (per 1B notifications):
├─ Push: ~$0 (FCM free)
├─ Email: ~$100K (at $0.03 per email)
└─ SMS: ~$10M (at $0.05 per SMS)
```

### Deduplication Strategy

```
Problem: Same notification sent twice (retry, duplicate request, etc.)

Example:
User1 follows User2
Order notification triggered twice (service retried)
User1 gets 2 identical "User2 just posted" notifications

Solution: Deduplication via request ID

Request:
{
  "request_id": "abc123-def456",  // idempotency key
  "user_id": "12345",
  "type": "follow_notification",
  "data": {...}
}

Server-side:
1. Hash the request_id
2. Check deduplication cache:
   dedup_cache[abc123-def456] = {
     "status": "sent",
     "timestamp": 1704067400
   }

3. If found and sent recently (< 5 minutes):
   └─ Return cached response (don't resend)

4. If not found or expired:
   └─ Send notification
   └─ Store in cache with TTL

Benefits:
├─ Prevents duplicate sends
├─ Idempotent (safe to retry)
├─ Minimal overhead (cache lookup)

Cache implementation:
├─ Redis: key="dedup:{request_id}", value=response
├─ TTL: 5 minutes (if request retried after 5 min, OK to resend)
└─ At 350K QPS: need 1M entries = 100MB RAM (small!)

Trade-off:
TTL too short: duplicates possible
TTL too long: legitimate re-sends blocked
Sweet spot: 5-60 minutes depending on use case
```

### Template System

```
Problem: Hardcoding notification text = inflexible

Solution: Template engine

Template storage:

templates table:
├─ template_id: "order_confirmed"
├─ subject: "Order {{order_id}} confirmed"
├─ body_text: "Your order {{order_id}} for {{total}} has been placed..."
├─ body_html: "<html><body>..."
├─ created_at: 2024-01-15
└─ version: 1

Rendering:

Template: "Hello {{user_name}}, your order {{order_id}} is ready"

Input: {
  "user_name": "Alice",
  "order_id": "999"
}

Output: "Hello Alice, your order 999 is ready"

Template versioning:
├─ template_id: "order_confirmed"
├─ version: 1 (old)
│  └─ body: "Your order has been confirmed"
├─ version: 2 (current)
│  └─ body: "Your order has been confirmed! Track: {{tracking_url}}"
└─ All notifications reference (template_id, version)
   └─ Prevents issues if template changes

Multi-language support:

templates table:
├─ template_id: "order_confirmed"
├─ language: "en"
├─ subject: "Order {{order_id}} confirmed"
├─ language: "es"
├─ subject: "Pedido {{order_id}} confirmado"
└─ language: "fr"
├─ subject: "Commande {{order_id}} confirmée"

On send:
1. Get user's preferred language (from user profile)
2. Fetch template with that language
3. Render with user data
4. Send

A/B testing:
├─ Template A: "Order ready!"
├─ Template B: "Your order is waiting"
├─ Randomly show 50/50
├─ Track open rate, click rate
├─ Winner gets rolled out to all users
```

---

## Logging and Monitoring System

Design a centralized logging and monitoring system like ELK stack or Datadog.

### Requirements

**Functional:**
- Collect logs from all services
- Store logs for querying
- Real-time alerting
- Dashboards for metrics
- Root cause analysis

**Non-Functional:**
- 1B log events/day
- Query latency: < 1 second
- Retention: 30 days hot, 1 year archive
- Availability: 99.9%
- Cost-effective

### Estimation

```
Scale:
- 1000+ services
- Each service: 100K log events/day
- Total: 1B log events/day

QPS:
- Ingest: 1B / 86,400 = 11.5K logs/second
- Peak: 3x = 35K logs/second

Log size:
- Average log line: 500 bytes
- Daily volume: 1B × 500 bytes = 500 GB/day
- Monthly: 15 TB/month
- Yearly: 180 TB/year

Query patterns:
- Full-text search: "error" in logs
- Time-range queries: logs from last 1 hour
- Aggregation: count of error vs warning logs
- Tracing: logs for specific request_id
```

### Architecture

```
┌─────────────────────────────────────────────────┐
│Application Services                             │
│(microservices, API servers, workers)            │
│                                                  │
│stdout/stderr:                                    │
│├─ [INFO] Request received: GET /api/users      │
│├─ [ERROR] Database connection failed            │
│└─ [DEBUG] Processing item 123                  │
└──────────────────┬──────────────────────────────┘
                   │
                   ├─ Write logs to stdout/stderr
                   │ (container/orchestrator captures)
                   │
                   ▼
        ┌──────────────────────┐
        │Log Collector         │
        │(Filebeat/Logstash)   │
        │                      │
        │- Tail log files      │
        │- Parse structured    │
        │- Batch events        │
        └────────┬─────────────┘
                 │
                 ├─ Buffer logs locally
                 ├─ Batch: 1000 events or 5 seconds
                 │
                 ▼
    ┌────────────────────────────────────┐
    │Message Queue (Kafka)               │
    │                                    │
    │Topic: logs-ingest                  │
    │- Partitioned by service            │
    │- High throughput (100K/sec)        │
    └────────┬───────────────────────────┘
             │
             ├─ Buffer for consumer lag
             ├─ Durability: replicated
             │
             ▼
    ┌────────────────────────────────────┐
    │Stream Processing                   │
    │(Kafka Streams / Spark Streaming)   │
    │                                    │
    │- Parse JSON logs                   │
    │- Extract fields                    │
    │- Normalize timestamps              │
    │- Add metadata                      │
    └────────┬───────────────────────────┘
             │
             ├─ Real-time rules engine
             │  (fire alerts)
             │
             ├─ Aggregate metrics
             │  (count, avg, p99)
             │
             ▼
    ┌────────────────────────────────────┐
    │Search Index (Elasticsearch)        │
    │                                    │
    │- Inverted index of logs            │
    │- Full-text search                  │
    │- Field-level queries               │
    │                                    │
    │Shards: 10 (parallelized queries)   │
    │Replicas: 2 (high availability)     │
    └────────┬───────────────────────────┘
             │
             ├─ Store hot (SSD): 30 days
             ├─ Store warm (HDD): 1 year (archive)
             │
             ▼
    ┌────────────────────────────────────┐
    │Metrics Store (Prometheus)          │
    │                                    │
    │- Time-series database              │
    │- Counters, gauges, histograms      │
    │- 1 year retention                  │
    └────────────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────┐
    │Dashboards & Alerts                 │
    │(Grafana, custom UI)                │
    │                                    │
    │- Real-time charts                  │
    │- Alert notifications               │
    │- Log tailing                       │
    └────────────────────────────────────┘
```

### Log Indexing and Search

```
Problem: 500 GB of logs/day
Need to search across all logs in < 1 second

Solution: Elasticsearch (inverted index)

Inverted index for logs:

Log:
{
  "timestamp": "2024-01-15T10:30:00Z",
  "service": "auth-service",
  "level": "ERROR",
  "message": "Failed to authenticate user",
  "user_id": "12345",
  "error": "Invalid token"
}

Inverted index:
├─ "failed" → [log1, log234, log5678, ...]
├─ "authenticate" → [log1, log23, log567, ...]
├─ "user" → [log1, log2, log3, ..., all logs]
├─ "invalid" → [log1, log99, log876, ...]
├─ "token" → [log1, log45, log56, ...]
├─ service="auth-service" → [log1, log2, ..., many logs]
├─ level="ERROR" → [log234, log567, ..., some logs]
└─ user_id="12345" → [log1, log999, ...]

Query: "authenticate user error"
1. Find logs with "authenticate": [log1, log23, ...]
2. Find logs with "user": [log1, log2, ...]
3. Find logs with "error": [log1, log234, ...]
4. Intersection: [log1]
5. Return log1 (instant!)

Query: service="auth-service" AND level="ERROR"
1. Find logs with service="auth-service": [many]
2. Find logs with level="ERROR": [some]
3. Intersection: [error logs from auth-service]
4. Return (milliseconds)

Elasticsearch sharding:

10 shards for parallelization:

┌──────────────────────────────────────┐
│Elasticsearch Cluster                 │
├─────────┬─────────┬──────────────────┤
│Shard 0  │Shard 1  │Shard 2   ... S9  │
│         │         │                  │
│Logs from│Logs from│Logs from         │
│hash(id) │hash(id) │hash(id)          │
│% 10=0   │% 10=1   │% 10=2            │
└─────────┴─────────┴──────────────────┘

Query "authenticate":
1. Parallel query to all 10 shards
2. Each shard searches its inverted index
3. Results aggregated
4. Top 100 results returned
5. Total time: 50-200ms

Indexing 500 GB/day:
├─ 35K logs/second
├─ Each log indexed immediately
├─ Distributed across 10 shards: 3.5K logs/shard/sec
├─ SSD throughput: easily 100K+ logs/sec
└─ No bottleneck
```

### Alerting

```
Scenario: Error rate spike detected

Alert rule:
IF error_count > 100/minute for duration 5 minutes
THEN send alert

Implementation:

1. Real-time stream processing:
   Kafka Streams consumes logs
   └─ Window: 1-minute buckets
   └─ Count errors per minute
   └─ Aggregate across services

2. Check condition:
   current_errors > threshold (100)
   └─ If true: increment spike_duration counter
   └─ If false: reset spike_duration to 0

3. If spike_duration > 5 minutes:
   └─ Alert fired!
   └─ Send to alerting system

4. Alerting channels:
   ├─ PagerDuty (incident management)
   ├─ Slack (chat notification)
   ├─ SMS (critical alerts)
   ├─ Email (detailed information)
   └─ Webhook (custom integration)

Alert correlation:
Multiple errors in different services
├─ Service-A: Error spike
├─ Service-B: Error spike (1 min later)
├─ Service-C: Error spike (2 min later)
└─ Likely: shared dependency failure (database)

Correlation engine:
├─ Group alerts with similar timestamp
├─ Identify common pattern
├─ Root cause: "Database connection pool exhausted"
├─ Route to on-call DBA

Alert tuning:
Problem: Too many alerts (alert fatigue)
├─ Alert threshold too low
├─ Alert fires on every minor issue
└─ On-call team ignores (misses real issues)

Solution: Smart alerting
├─ Threshold tuning (based on historical data)
├─ Deduplication (don't repeat alert)
├─ Aggregation (combine related alerts)
├─ Severity levels (critical, warning, info)
└─ Only page on critical alerts

Severity levels:
├─ Critical: immediate paging (error rate > 1%)
├─ Warning: ticket created (error rate > 0.1%)
├─ Info: logged, visible in dashboard (error rate > 0.01%)
```

### Log Retention and Archival

```
Cost optimization:

Hot storage (Elasticsearch SSD): 30 days
├─ Cost: $50K/month
├─ Used for: most queries (90%)
├─ Retention: 30 days
└─ Total: 15 TB

Warm storage (HDD): 90 days
├─ Cost: $5K/month
├─ Used for: occasional queries (9%)
├─ Retention: 60 additional days
└─ Total: 30 TB

Cold storage (S3 Glacier): 1 year
├─ Cost: $1K/month
├─ Used for: rare queries, compliance (1%)
├─ Retention: 275 additional days
└─ Total: 135 TB

Lifecycle:
Day 1-30: Hot (SSD)  → Query latency: 50-100ms
Day 31-90: Warm (HDD) → Query latency: 500-1000ms
Day 91-365: Cold (S3)  → Query latency: 5-60 seconds (retrieval from archive)

Archival process:

Day 31: Move logs to warm storage
1. Export from Elasticsearch
2. Compress (gzip): 500 GB → 50 GB
3. Upload to HDD archive
4. Delete from Elasticsearch

Day 91: Move logs to cold storage
1. Read from HDD
2. Re-compress if needed
3. Upload to S3 Glacier
4. Delete from HDD

Cost breakdown (per year):
├─ Hot (SSD): $50K × 12 = $600K
├─ Warm (HDD): $5K × 12 = $60K
├─ Cold (S3): $1K × 12 = $12K
└─ Total: ~$672K per year

For 1B logs/day * 365 days = 365B events/year
Cost per event: $672K / 365B = ~$0.000002 (very cheap!)
```

---

## Distributed Task Scheduler

Design a system to schedule and execute periodic tasks (like cron).

### Requirements

**Functional:**
- Schedule tasks to run at specific times
- Support recurring tasks (daily, hourly, etc.)
- Execute tasks on available workers
- Retry on failure
- Monitor task execution

**Non-Functional:**
- 1M tasks
- 100K task executions per day
- Exactly-once execution (no duplicates)
- Task execution latency: < 1 minute
- Availability: 99.9%

### Estimation

```
Scale:
- 1M scheduled tasks
- Average: 100 executions/day per task
- Total: 1M × 100 = 100M task executions/day
- QPS: 100M / 86,400 = 1.16K tasks/second

Task payload:
- Task metadata: 1 KB
- Log output: 10 KB
- Database storage: 1M tasks × 1KB = 1 GB
- Execution logs (1 year): 100M × 10KB = 1 TB

Execution time:
- Avg task: 10 seconds
- Workers needed: 1.16K QPS × 10 sec = 11.6K concurrent tasks
- Assuming 8 concurrent tasks per worker: 1.5K workers
```

### Architecture

```
┌─────────────────────────────────────────────────┐
│Scheduler                                        │
│(periodic trigger)                               │
│                                                  │
│At each minute:                                   │
│- Query DB for tasks due now                     │
│- Enqueue them                                   │
└──────────────┬──────────────────────────────────┘
               │
               ├─ Check tasks table:
               │  next_run_time <= NOW()
               │
               ▼
    ┌──────────────────────────────┐
    │Tasks to Execute Queue        │
    │(distributed message queue)   │
    │                              │
    │Format:                       │
    │{                             │
    │  "task_id": "daily_backup",  │
    │  "run_id": "run_12345",      │
    │  "params": {...},            │
    │  "retry_count": 0            │
    │}                             │
    └────────────┬─────────────────┘
                 │
                 ├─ Partitioned by task_id (consistent hashing)
                 │  └─ Same task always goes to same worker pool
                 │  └─ Enables exactly-once semantics
                 │
                 ▼
    ┌──────────────────────────────┐
    │Workers (processes tasks)     │
    │                              │
    │Worker-1, Worker-2, ...       │
    │                              │
    │For each task:                │
    │1. Acquire distributed lock   │
    │2. Execute task               │
    │3. Record result              │
    │4. Release lock               │
    └────────────┬─────────────────┘
                 │
                 ├─ Execute task code
                 ├─ Capture output
                 ├─ Track execution time
                 │
                 ▼
    ┌──────────────────────────────┐
    │Task Execution DB             │
    │                              │
    │task_executions table:        │
    │├─ run_id                     │
    │├─ task_id                    │
    │├─ status (success/failed)    │
    │├─ start_time                 │
    │├─ end_time                   │
    │├─ output                     │
    │└─ error_message              │
    │                              │
    │tasks table:                  │
    │├─ task_id                    │
    │├─ cron_expression            │
    │├─ next_run_time              │
    │└─ retry_count (current)      │
    └──────────────────────────────┘
```

### Exactly-Once Execution

```
Problem: Task might be executed twice (worker crashes after execution)

Scenario:
1. Worker picks up task
2. Worker executes task (successfully)
3. Worker crashes before updating DB
4. Task retried → executed twice!

Solution: Distributed lock + idempotency

Implementation:

Distributed lock (Redis):

def execute_task(task_id, run_id):
    lock_key = f"lock:{task_id}:{run_id}"
    lock_value = generate_unique_id()

    # Try to acquire lock (non-blocking)
    if redis.set(lock_key, lock_value, NX=True, EX=60):
        # Lock acquired!
        try:
            result = run_task_code(task_id)
            db.update_execution(run_id, status="success", result=result)
        except Exception as e:
            db.update_execution(run_id, status="failed", error=str(e))
        finally:
            # Release lock
            redis.delete(lock_key)
    else:
        # Lock held by another worker
        # Don't execute (let other worker finish)
        pass

Benefits:
├─ Only one worker executes task per run_id
├─ If worker crashes: lock expires after 60 seconds
├─ Next worker (or retry) picks up task
└─ No duplicate execution

Idempotency: Task must be idempotent
├─ Running twice should produce same result
├─ Example: "Delete all files in /tmp" (idempotent)
├─ Counter-example: "Increment counter" (not idempotent)

Making tasks idempotent:
├─ Check before modifying: "Already done? Skip"
├─ Store results in database: "Return cached result"
├─ Use update not increment: "Set X = 100" not "Add 1 to X"
└─ Document assumptions clearly
```

### Retry Strategy

```
Task execution failed (e.g., network timeout)

Retry logic:

def execute_with_retry(task, max_retries=3):
    for attempt in range(1, max_retries + 1):
        try:
            result = execute_task(task)
            return result
        except TemporaryError as e:
            if attempt < max_retries:
                wait_time = exponential_backoff(attempt)
                sleep(wait_time)
            else:
                raise

exponential_backoff(attempt):
    base_delay = 1  # 1 second
    max_delay = 60  # 1 minute
    delay = min(base_delay * (2 ** attempt), max_delay)
    # Add jitter: ±10%
    jitter = delay * random.uniform(0.9, 1.1)
    return jitter

Backoff example:
Attempt 1: fail immediately
Attempt 2: wait 1-3 seconds, retry
Attempt 3: wait 2-6 seconds, retry
Attempt 4: wait 4-12 seconds, give up

Benefits:
├─ Handles transient failures (temporary outage)
├─ Exponential backoff: don't hammer service
├─ Jitter: prevent thundering herd
└─ Eventually: give up (don't retry forever)

Retry limits:
├─ Permanent errors (404, 403): don't retry
├─ Temporary errors (500, timeout): retry
├─ Unknown errors: retry conservatively

Task status tracking:

task_executions:
├─ Status: pending, in_progress, success, failed, retrying
├─ retry_count: 0, 1, 2, 3...
├─ next_retry_time: when to retry again
└─ last_error: reason for failure

Alert on persistent failure:
├─ If task fails 3 times in a row
├─ Notify on-call team
├─ Escalate for manual intervention
```

---

## CI/CD Pipeline

Design a continuous integration and continuous deployment pipeline.

### Requirements

**Functional:**
- Build code on push to repository
- Run tests automatically
- Deploy to staging/production
- Rollback on failure
- Track deployment history

**Non-Functional:**
- Build time: < 5 minutes
- Test time: < 10 minutes
- Deployment latency: < 5 minutes
- Success rate: > 99%
- Availability: 99.9%

### Pipeline Stages

```
┌──────────────────────────────────────────────────────────┐
│Developer pushes code to GitHub                           │
│git push origin feature/new-feature                       │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │GitHub Webhook                │
        │(triggers CI/CD)              │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │Stage 1: Build                │
        │(compile, create artifacts)   │
        │                              │
        │- Checkout code               │
        │- Compile (Java, Go, etc)     │
        │- Build Docker image          │
        │- Push to artifact registry   │
        │                              │
        │Time: 3-5 minutes             │
        └──────────────┬───────────────┘
                       │
        ┌──────────────▼───────────────┐
        │Stage 2: Test                 │
        │(unit, integration, E2E)      │
        │                              │
        │- Run unit tests              │
        │- Run integration tests       │
        │- Run E2E tests               │
        │                              │
        │Time: 5-10 minutes            │
        │Parallel: multiple test suites│
        └──────────────┬───────────────┘
                       │
        ┌──────────────▼───────────────┐
        │Stage 3: Security Scan        │
        │(check for vulnerabilities)   │
        │                              │
        │- SAST (static code analysis) │
        │- Dependency scanning         │
        │- Container image scan        │
        │                              │
        │Time: 2-3 minutes             │
        └──────────────┬───────────────┘
                       │
        ┌──────────────▼───────────────┐
        │Stage 4: Deploy to Staging    │
        │(test in production-like env) │
        │                              │
        │- Create staging environment  │
        │- Deploy image                │
        │- Run smoke tests             │
        │- Run load tests              │
        │                              │
        │Time: 3-5 minutes             │
        └──────────────┬───────────────┘
                       │
        ┌──────────────▼───────────────┐
        │Stage 5: Manual Approval      │
        │(human decision)              │
        │                              │
        │- Review deployment           │
        │- Check metrics/alerts        │
        │- Click "Approve"             │
        │                              │
        │Time: minutes to hours        │
        └──────────────┬───────────────┘
                       │
        ┌──────────────▼───────────────┐
        │Stage 6: Deploy to Production │
        │(blue-green deployment)       │
        │                              │
        │- Deploy to canary (5% users) │
        │- Monitor (5-10 minutes)      │
        │- If OK: shift 50% traffic    │
        │- Monitor (5-10 minutes)      │
        │- If OK: shift 100% traffic   │
        │                              │
        │Total time: 20-30 minutes     │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │Deployment Complete           │
        │                              │
        │- Alert team: "Deployed"      │
        │- Record in deployment DB     │
        │- Start monitoring            │
        │                              │
        │If errors spike:              │
        │- Auto-rollback               │
        │- Page on-call team           │
        └──────────────────────────────┘
```

### Blue-Green Deployment

```
Zero-downtime deployment strategy

Setup:
┌──────────────────────────────────────────────┐
│Load Balancer / API Gateway                   │
│Currently routing 100% traffic to Blue        │
└─────────────────┬────────────────────────────┘
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
    ┌────────────┐      ┌────────────┐
    │Blue (v1)   │      │Green (idle)│
    │Running     │      │Not running │
    │100% traffic│      │            │
    └────────────┘      └────────────┘

Deploy new version:
1. Bring up Green with new code (v2)
   └─ No traffic yet

2. Run tests against Green
   └─ Health checks, sanity tests
   └─ Load tests (ramp up traffic to 10%)

3. If tests pass: Switch traffic
   ├─ Load balancer sends 100% traffic to Green
   └─ Blue remains running (backup)

4. Monitor Green
   └─ Error rate, latency, resource usage
   └─ If anything goes wrong: switch back to Blue

5. If all good for 1 hour:
   └─ Stop Blue
   └─ Blue becomes new backup
   └─ Next deployment uses Green as old version

Benefits:
├─ Zero downtime (no traffic loss)
├─ Instant rollback (switch to Blue immediately)
├─ Easy testing (test Green before switching)
└─ No state migration (each version has own data)

Timeline:
├─ Deploy Green: 2 minutes
├─ Run tests: 3 minutes
├─ Switch traffic: < 1 second
├─ Monitor Green: 5 minutes
└─ Total: ~10 minutes

Rollback:
If error spike detected in Green:
├─ Immediately switch 100% traffic back to Blue
├─ Page on-call team
├─ Investigate Green
└─ Fix and redeploy

Canary deployment (safer than blue-green):

Instead of switching all traffic at once:
├─ Route 1% traffic to Green
├─ Monitor for 5 minutes
├─ If errors: rollback (99% still on Blue)
├─ If OK: route 5% to Green
├─ Keep increasing percentage
└─ Takes longer (20-30 min) but safer
```

### Rollback Strategy

```
Scenario: Deployed new version, error spike detected

Automatic rollback:

1. Monitoring system detects error rate spike
   ├─ Error rate > 1% (threshold)
   ├─ Sustained for 5 minutes
   └─ Alert triggered

2. Rollback triggered automatically
   ├─ Switch traffic back to previous stable version
   ├─ Stop new version
   └─ Page on-call team

3. Notify team
   ├─ Slack: "Deployment rolled back due to error spike"
   ├─ PagerDuty: incident created
   └─ Save logs for postmortem

Rollback timeline:
├─ Error detection: 5 minutes
├─ Execution: < 1 minute
├─ Total: ~6 minutes from error to rollback

Manual rollback:

On-call team notices issue (not auto-detected):
1. Look at deployment history
   ├─ Current: v2.1.3 (deployed 10 min ago)
   └─ Previous: v2.1.2 (stable)

2. Click "Rollback" button
   ├─ Load balancer switches to v2.1.2
   └─ Blue-green: just swap routing

3. Verify
   ├─ Check error rate dropped
   ├─ Check latency normalized
   └─ Confirm rollback successful

4. Investigate
   ├─ Why did v2.1.3 fail?
   ├─ Review code change
   ├─ Check test coverage
   └─ Plan fix

Preventive measures:
├─ Unit tests (catch 70% of bugs)
├─ Integration tests (catch 20% of bugs)
├─ E2E tests (catch 5% of bugs)
├─ Code review (catch 3-5% of bugs)
├─ Staging deployment (catch 1% of bugs)
└─ Monitoring (detect 1% that slip through)
```

### Monitoring Deployment

```
Before deployment:
Record baseline metrics (last 1 hour)
├─ Error rate: 0.05%
├─ P95 latency: 200ms
├─ P99 latency: 500ms
├─ CPU usage: 60%
└─ Memory usage: 70%

During deployment (canary, 5% traffic on new version):

Metrics dashboard:
├─ Error rate on canary: 0.08% (small increase, OK)
├─ P95 latency: 210ms (2ms increase, OK)
├─ P99 latency: 520ms (2% increase, OK)
├─ CPU usage: 65% (within limit)
└─ Memory usage: 72% (within limit)

Continue ramping up traffic (10%, 25%, 50%, 100%)

After 100% deployment:

Monitor for 1 hour:
├─ Error rate: stable at 0.05%
├─ Latency: stable
├─ Resource usage: stable
└─ No anomalies

Alert thresholds:

Error rate spike:
├─ Alert if error rate > baseline + 2x
├─ Or if error rate > 1%
└─ Example: baseline 0.05%, alert if > 0.1%

Latency spike:
├─ Alert if P99 > baseline + 50%
├─ Or if P99 > 2 seconds
└─ Example: baseline 500ms, alert if > 750ms

Resource spike:
├─ Alert if CPU > 90% (before it maxes out)
├─ Alert if memory > 85%
└─ Prevents cascading failures

Custom metrics:
├─ Application-specific errors (e.g., "auth failures")
├─ Business metrics (e.g., "failed orders")
├─ Performance metrics (e.g., "slow database queries")
└─ Configure alerts on these too
```

---

## Key Takeaways

1. **Notification System**: Multi-channel (push/email/SMS), deduplication, template-based
2. **Logging**: Elasticsearch for indexing, real-time alerting, tiered storage (hot/warm/cold)
3. **Task Scheduler**: Distributed locks for exactly-once execution, exponential backoff for retries
4. **CI/CD**: Blue-green deployment for zero-downtime, automatic rollback on errors, comprehensive monitoring
