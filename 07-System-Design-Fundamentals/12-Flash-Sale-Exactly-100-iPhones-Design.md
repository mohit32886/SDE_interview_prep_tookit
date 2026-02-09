# Design a Flash Sale System: Sell Exactly 100 iPhones — Not 101, Not 99

> **The Interview Question:**
> "Flipkart Big Billion Day: 100 iPhones priced at ₹100. Expect millions of concurrent users. How do you ensure exactly 100 are sold — not 101 (overselling) and not 99 (underselling)?"

This question is deceptively simple. The real challenge is handling extreme concurrency while maintaining exact inventory counts.

---

## Table of Contents

1. [Why This Problem Is Hard](#1-why-this-problem-is-hard)
2. [The Naive Approach — And Why It Fails](#2-the-naive-approach--and-why-it-fails)
3. [Solution Architecture](#3-solution-architecture)
4. [Layer 1: Traffic Management — Surviving 10M Requests](#4-layer-1-traffic-management)
5. [Layer 2: Redis — The Atomic Counter](#5-layer-2-redis--the-atomic-counter)
6. [Layer 3: Order Processing — Exactly-Once Guarantee](#6-layer-3-order-processing)
7. [Layer 4: Payment and Confirmation — Handling Failures](#7-layer-4-payment-and-confirmation)
8. [The Complete Flow — End to End](#8-the-complete-flow)
9. [Database Schema](#9-database-schema)
10. [Handling Edge Cases](#10-handling-edge-cases)
11. [Why Not Just Use Database Locking?](#11-why-not-just-use-database-locking)
12. [Senior-Level Talking Points](#12-senior-level-talking-points)
13. [Interview Follow-Up Questions](#13-interview-follow-up-questions)

---

## 1. Why This Problem Is Hard

```
10 Million users hit "BUY" at 12:00:00.000 AM
     │
     │  All 10M requests arrive within 1-2 seconds
     │
     ▼
┌─────────────────────────────────────┐
│   Only 100 should succeed.          │
│   9,999,900 must be rejected.       │
│   ZERO overselling.                 │
│   ZERO underselling.                │
│   Sub-second response for everyone. │
└─────────────────────────────────────┘
```

**Three things can go wrong:**

1. **Overselling (101+ sold):** Two threads read stock=1, both think they can buy, both decrement → stock goes to -1. Customer gets charged, but there's no iPhone to ship. Lawsuits follow.

2. **Underselling (99 sold):** A user's payment fails or they abandon checkout, but the reserved stock is never released. 1 iPhone sits in limbo forever. Revenue lost.

3. **System crash under load:** 10M requests/second kills the database. Nobody gets anything. Twitter explodes.

---

## 2. The Naive Approach — And Why It Fails

```java
// ❌ THIS WILL OVERSELL — DO NOT USE
@Transactional
public boolean purchasePhone(String userId) {
    Product product = productRepo.findById("iphone-100");

    if (product.getStock() > 0) {          // Thread A reads stock=1
                                             // Thread B reads stock=1 (SAME TIME)
        product.setStock(product.getStock() - 1);  // Thread A sets stock=0
        productRepo.save(product);                   // Thread B sets stock=0
        orderRepo.save(new Order(userId, product));  // BOTH succeed → OVERSOLD!
        return true;
    }
    return false;
}
```

**The race condition:**
```
Time    Thread A                    Thread B
─────   ──────────────────          ──────────────────
T1      SELECT stock → 1
T2                                  SELECT stock → 1
T3      stock > 0? YES
T4                                  stock > 0? YES
T5      UPDATE stock = 0
T6                                  UPDATE stock = 0
T7      INSERT order ✓
T8                                  INSERT order ✓
        ───────────────────────────────────────
        Result: 2 orders created, but only 1 iPhone existed!
```

Even `@Transactional` doesn't save you here because READ COMMITTED isolation (the default) allows both threads to read the same value before either writes.

---

## 3. Solution Architecture

```
                    10 Million Users
                         │
                         ▼
            ┌────────────────────────┐
            │      CDN + WAF         │  ← Static assets cached, bot filtering
            │   (CloudFront/Akamai)  │
            └───────────┬────────────┘
                        │
            ┌───────────▼────────────┐
    Layer 1 │     API Gateway /      │  ← Rate limit: 1 request/user/second
            │     Load Balancer      │     Reject obvious duplicates
            └───────────┬────────────┘
                        │
            ┌───────────▼────────────┐
    Layer 2 │   Sale Eligibility     │  ← Redis DECR: atomic stock check
            │   Service (Stateless)  │     Returns YES/NO in <5ms
            │   (20 instances)       │     99.999% of users rejected HERE
            └───────────┬────────────┘
                        │ Only ~100-150 requests pass
                        ▼
            ┌────────────────────────┐
    Layer 3 │   Order Service        │  ← Create order, reserve stock in DB
            │   (Kafka Consumer)     │     Exactly-once with idempotency
            └───────────┬────────────┘
                        │
            ┌───────────▼────────────┐
    Layer 4 │   Payment Service      │  ← Charge ₹100, confirm or rollback
            │                        │     TTL-based reservation expiry
            └───────────┬────────────┘
                        │
            ┌───────────▼────────────┐
            │   Confirmation +       │
            │   Notification         │
            └────────────────────────┘

Key Insight: Funnel 10M requests through cheap/fast layers first.
             Only ~100 requests ever touch the database.
```

---

## 4. Layer 1: Traffic Management

### Goal: Survive 10M requests without dying

**Strategy: Reject as early and cheaply as possible.**

```
10,000,000 requests
    │
    │ CDN serves static page (sale UI is pre-rendered)
    │ Only "Buy" API call hits backend
    │
    ├─── Bot detection / CAPTCHA → Reject 40% bots
    │    (6,000,000 remain)
    │
    ├─── Rate limit: 1 request per user per 5 seconds → Reject duplicates
    │    (3,000,000 unique attempts)
    │
    ├─── "Sale ended" flag (once stock=0, all requests return instantly)
    │    (Effective within milliseconds of selling out)
    │
    └─── Redis atomic check (Layer 2) → Only 100 pass
         (2,999,900 get instant "SOLD OUT" response)
```

**Implementation — API Gateway Rate Limiting:**

```yaml
# Spring Cloud Gateway rate limiter
spring:
  cloud:
    gateway:
      routes:
        - id: flash-sale
          uri: lb://sale-service
          predicates:
            - Path=/api/v1/flash-sale/buy
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 1    # 1 request per second
                redis-rate-limiter.burstCapacity: 1    # No burst
                key-resolver: "#{@userKeyResolver}"    # Per-user limiting
```

**Pre-sale optimizations:**
```java
// Serve "SOLD OUT" from a local boolean — no Redis call needed
@RestController
public class FlashSaleController {

    // Volatile ensures visibility across threads
    private volatile boolean saleActive = true;

    @PostMapping("/api/v1/flash-sale/buy")
    public ResponseEntity<?> buy(@RequestHeader("X-User-Id") String userId) {

        // FASTEST CHECK: local in-memory flag (0ms, no network)
        if (!saleActive) {
            return ResponseEntity.status(410)
                .body(new SaleResponse("SOLD_OUT", "All iPhones have been sold"));
        }

        // Proceed to Redis check (Layer 2)
        return saleService.attemptPurchase(userId);
    }

    // Called when Redis counter hits 0
    public void markSaleEnded() {
        this.saleActive = false;  // All future requests fail instantly
    }
}
```

---

## 5. Layer 2: Redis — The Atomic Counter

### This is the CORE of the solution

Redis `DECR` is atomic. Even with 10M concurrent calls, it will NEVER go below 0 if we use a Lua script.

**Why Redis?**
- Single-threaded command execution → no race conditions
- 100K+ operations per second on a single node
- Sub-millisecond latency
- `DECR` is O(1) and atomic

### The Lua Script — Atomic Stock Reservation

```lua
-- reserve_stock.lua
-- This script runs ATOMICALLY in Redis (single-threaded)
-- No other command can interleave between these operations

local stock_key = KEYS[1]           -- "flash_sale:iphone:stock"
local user_set_key = KEYS[2]        -- "flash_sale:iphone:buyers"
local user_id = ARGV[1]             -- The user attempting to buy

-- Check 1: Has this user already purchased? (prevent double-buy)
if redis.call('SISMEMBER', user_set_key, user_id) == 1 then
    return -1  -- Already purchased
end

-- Check 2: Is there stock remaining?
local current_stock = tonumber(redis.call('GET', stock_key))
if current_stock == nil or current_stock <= 0 then
    return 0   -- Sold out
end

-- ATOMIC: Decrement stock AND record the buyer
-- These two operations happen as ONE atomic unit
redis.call('DECR', stock_key)
redis.call('SADD', user_set_key, user_id)

return 1  -- Success! User got one.
```

**Why Lua script instead of just DECR?**
- Plain `DECR` can go negative (Thread 1 decrements to 0, Thread 2 also decrements to -1)
- The Lua script checks AND decrements atomically — no gap between check and action
- Also prevents the same user from buying twice (SISMEMBER + SADD in one atomic block)

### Java Implementation

```java
@Service
public class FlashSaleService {

    @Autowired
    private StringRedisTemplate redis;

    private final DefaultRedisScript<Long> reserveScript;

    @PostConstruct
    public void init() {
        reserveScript = new DefaultRedisScript<>();
        reserveScript.setScriptText("""
            local stock_key = KEYS[1]
            local user_set_key = KEYS[2]
            local user_id = ARGV[1]

            if redis.call('SISMEMBER', user_set_key, user_id) == 1 then
                return -1
            end

            local current_stock = tonumber(redis.call('GET', stock_key))
            if current_stock == nil or current_stock <= 0 then
                return 0
            end

            redis.call('DECR', stock_key)
            redis.call('SADD', user_set_key, user_id)
            return 1
        """);
        reserveScript.setResultType(Long.class);
    }

    /**
     * Initialize sale: set stock to exactly 100
     */
    public void initializeSale(String productId, int quantity) {
        String stockKey = "flash_sale:" + productId + ":stock";
        String buyerKey = "flash_sale:" + productId + ":buyers";

        redis.opsForValue().set(stockKey, String.valueOf(quantity));
        redis.delete(buyerKey);  // Clear any previous buyers
    }

    /**
     * Attempt to reserve one unit. Returns in <5ms.
     *
     * @return 1 = reserved, 0 = sold out, -1 = already purchased
     */
    public long attemptReserve(String productId, String userId) {
        String stockKey = "flash_sale:" + productId + ":stock";
        String buyerKey = "flash_sale:" + productId + ":buyers";

        Long result = redis.execute(
            reserveScript,
            List.of(stockKey, buyerKey),
            userId
        );

        if (result != null && result == 0) {
            // Stock is 0 → flip the local flag on all instances
            applicationEventPublisher.publishEvent(new SaleEndedEvent(productId));
        }

        return result != null ? result : 0;
    }
}
```

### What the Numbers Look Like

```
Time 12:00:00.000 — Sale starts. Redis stock = 100.

Request #1:    DECR → stock = 99  → return 1 (SUCCESS)
Request #2:    DECR → stock = 98  → return 1 (SUCCESS)
Request #3:    DECR → stock = 97  → return 1 (SUCCESS)
...
Request #100:  DECR → stock = 0   → return 1 (SUCCESS)
Request #101:  CHECK → stock = 0  → return 0 (SOLD OUT)
Request #102:  CHECK → stock = 0  → return 0 (SOLD OUT)
...
Request #10M:  saleActive = false → return 410 (never even hits Redis)

Total time: ~200ms to sell all 100
Remaining 9,999,900 users: get "SOLD OUT" in <1ms each
```

**This guarantees EXACTLY 100 reservations — not 101, not 99.**

---

## 6. Layer 3: Order Processing

### Problem: What if the user reserves in Redis but the DB write fails?

Redis said "yes" → stock decremented → but order creation in PostgreSQL fails → one iPhone is in limbo (underselling).

### Solution: Kafka + Idempotent Order Creation

```java
// After Redis reserves successfully, publish to Kafka
@Service
public class FlashSaleOrchestrator {

    @Autowired private FlashSaleService flashSaleService;
    @Autowired private KafkaTemplate<String, OrderRequest> kafka;

    public ResponseEntity<?> attemptPurchase(String userId) {

        long result = flashSaleService.attemptReserve("iphone-100", userId);

        switch ((int) result) {
            case 1 -> {
                // Reserved in Redis! Now create order asynchronously.
                String orderId = "ORD-" + UUID.randomUUID();
                OrderRequest orderReq = new OrderRequest(
                    orderId, userId, "iphone-100", 1,
                    new BigDecimal("100"), Instant.now()
                );

                // Publish to Kafka — guaranteed delivery
                kafka.send("flash-sale-orders", userId, orderReq);

                // Return immediately — user sees "Processing your order..."
                return ResponseEntity.accepted()
                    .body(new SaleResponse("RESERVED", orderId,
                        "You got one! Complete payment within 10 minutes."));
            }
            case 0 -> {
                return ResponseEntity.status(410)
                    .body(new SaleResponse("SOLD_OUT",
                        "Sorry, all iPhones have been sold."));
            }
            case -1 -> {
                return ResponseEntity.status(409)
                    .body(new SaleResponse("ALREADY_PURCHASED",
                        "You have already reserved one."));
            }
            default -> {
                return ResponseEntity.status(500)
                    .body(new SaleResponse("ERROR", "Please try again."));
            }
        }
    }
}
```

### Kafka Consumer — Idempotent Order Creation

```java
@Component
public class OrderCreationConsumer {

    @Autowired private OrderRepository orderRepo;
    @Autowired private InventoryRepository inventoryRepo;

    @KafkaListener(topics = "flash-sale-orders", groupId = "order-service")
    @Transactional
    public void createOrder(OrderRequest request) {

        // IDEMPOTENCY: Check if order already exists (Kafka may deliver twice)
        if (orderRepo.existsById(request.getOrderId())) {
            log.info("Duplicate order detected, skipping. orderId={}",
                request.getOrderId());
            return;
        }

        // Create order in DB
        Order order = Order.builder()
            .id(request.getOrderId())
            .userId(request.getUserId())
            .productId(request.getProductId())
            .quantity(1)
            .amount(request.getAmount())
            .state(OrderState.RESERVED)
            .reservedAt(Instant.now())
            .expiresAt(Instant.now().plus(10, ChronoUnit.MINUTES))
            .build();

        orderRepo.save(order);

        // Reserve in database (double-check against Redis)
        int updated = inventoryRepo.reserveStock(request.getProductId(), 1);
        if (updated == 0) {
            // Should never happen (Redis already checked), but defensive
            log.error("DB stock reservation failed for order={}",
                request.getOrderId());
            order.setState(OrderState.FAILED);
            orderRepo.save(order);
            // Restore Redis stock
            flashSaleService.restoreStock(request.getProductId(), request.getUserId());
        }
    }
}
```

### Database-Level Atomic Stock Reservation

```java
@Repository
public interface InventoryRepository extends JpaRepository<Inventory, String> {

    // Atomic: decrement only if stock > 0
    // Returns 1 if successful, 0 if no stock
    @Modifying
    @Query(value = """
        UPDATE inventory
        SET reserved = reserved + :qty,
            available = available - :qty,
            updated_at = NOW()
        WHERE product_id = :productId
          AND available >= :qty
        """, nativeQuery = true)
    int reserveStock(@Param("productId") String productId,
                     @Param("qty") int qty);
}
```

---

## 7. Layer 4: Payment and Confirmation

### The Reservation Timer Problem

User reserves an iPhone but never pays → that unit is stuck forever → underselling.

**Solution: TTL-based reservation with auto-release.**

```java
// Scheduled job: release expired reservations
@Scheduled(fixedRate = 30_000)  // Every 30 seconds
@Transactional
public void releaseExpiredReservations() {
    List<Order> expired = orderRepo.findByStateAndExpiresAtBefore(
        OrderState.RESERVED, Instant.now()
    );

    for (Order order : expired) {
        log.info("Releasing expired reservation. orderId={}, userId={}",
            order.getId(), order.getUserId());

        // 1. Cancel the order
        order.setState(OrderState.EXPIRED);
        orderRepo.save(order);

        // 2. Restore DB stock
        inventoryRepo.releaseStock(order.getProductId(), 1);

        // 3. Restore Redis stock (so someone else can buy it)
        redisTemplate.opsForValue().increment(
            "flash_sale:" + order.getProductId() + ":stock");

        // 4. Remove user from buyers set (they can try again)
        redisTemplate.opsForSet().remove(
            "flash_sale:" + order.getProductId() + ":buyers",
            order.getUserId());

        // 5. Re-activate sale if it was marked ended
        saleController.markSaleActive();
    }
}
```

### Payment Flow

```java
@Service
public class PaymentService {

    @Transactional
    public PaymentResult processPayment(String orderId, PaymentDetails details) {

        Order order = orderRepo.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException(orderId));

        // Check order hasn't expired
        if (order.getState() != OrderState.RESERVED) {
            return PaymentResult.failed("Order is no longer reserved");
        }
        if (order.getExpiresAt().isBefore(Instant.now())) {
            return PaymentResult.failed("Reservation expired. Please try again.");
        }

        // Process payment (call payment gateway)
        try {
            GatewayResponse response = paymentGateway.charge(
                details, order.getAmount());

            if (response.isSuccess()) {
                order.setState(OrderState.CONFIRMED);
                order.setPaymentId(response.getTransactionId());
                order.setPaidAt(Instant.now());
                orderRepo.save(order);

                // Convert reserved to sold in inventory
                inventoryRepo.confirmSale(order.getProductId(), 1);

                // Send confirmation
                notificationService.sendOrderConfirmation(order);

                return PaymentResult.success(order.getId());
            } else {
                // Payment failed — keep reservation (user can retry within TTL)
                return PaymentResult.failed(response.getDeclineReason());
            }
        } catch (Exception e) {
            log.error("Payment processing error for order={}", orderId, e);
            return PaymentResult.failed("Payment error. Please retry.");
        }
    }
}
```

---

## 8. The Complete Flow

```
User clicks "BUY NOW"
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 1. API Gateway: Rate limit check (1 req/user/5s)       │ <1ms
│    └─ If duplicate → 429 Too Many Requests              │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│ 2. Controller: Check local saleActive flag              │ <1ms
│    └─ If false → 410 "SOLD OUT" (instant, no Redis)     │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│ 3. Redis Lua Script: Atomic stock check + decrement     │ ~2ms
│    ├─ Already purchased? → 409 "ALREADY_PURCHASED"      │
│    ├─ Stock = 0? → 410 "SOLD OUT"                       │
│    └─ Stock > 0? → DECR + SADD → return SUCCESS         │
└────────────────────────┬────────────────────────────────┘
                         │ (Only ~100 requests reach here)
┌────────────────────────▼────────────────────────────────┐
│ 4. Kafka: Publish order creation event                  │ ~5ms
│    └─ Return 202 "RESERVED — complete payment in 10min" │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│ 5. Order Consumer: Create order + DB stock reservation  │ ~20ms
│    └─ Idempotent: skip if order already exists          │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│ 6. User completes payment (within 10-minute window)     │
│    ├─ Payment SUCCESS → Order CONFIRMED                 │
│    ├─ Payment FAILED → User retries (still within TTL)  │
│    └─ Timer expires → Release reservation → restock     │
└─────────────────────────────────────────────────────────┘
```

**Total latency for user who gets an iPhone: ~10ms**
**Total latency for user who doesn't: <3ms**

---

## 9. Database Schema

```sql
-- Inventory table (source of truth)
CREATE TABLE inventory (
    product_id   VARCHAR(64) PRIMARY KEY,
    product_name VARCHAR(255) NOT NULL,
    total        INT NOT NULL,          -- 100 (never changes)
    available    INT NOT NULL,          -- Starts at 100, decreases
    reserved     INT NOT NULL DEFAULT 0, -- Soft-reserved, not yet paid
    sold         INT NOT NULL DEFAULT 0, -- Confirmed purchases
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- INVARIANT: total = available + reserved + sold (ALWAYS)
    CONSTRAINT stock_balance CHECK (total = available + reserved + sold),
    CONSTRAINT non_negative CHECK (available >= 0 AND reserved >= 0 AND sold >= 0)
);

-- Insert initial stock
INSERT INTO inventory (product_id, product_name, total, available)
VALUES ('iphone-100', 'iPhone 16 (Flash Sale)', 100, 100);

-- Orders table
CREATE TABLE orders (
    id           VARCHAR(64) PRIMARY KEY,
    user_id      VARCHAR(64) NOT NULL,
    product_id   VARCHAR(64) NOT NULL REFERENCES inventory(product_id),
    quantity     INT NOT NULL DEFAULT 1,
    amount       DECIMAL(10,2) NOT NULL,
    state        VARCHAR(20) NOT NULL,  -- RESERVED, CONFIRMED, EXPIRED, FAILED
    payment_id   VARCHAR(64),
    reserved_at  TIMESTAMPTZ NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    paid_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One purchase per user per product
    CONSTRAINT unique_user_product UNIQUE (user_id, product_id)
);

CREATE INDEX idx_orders_expired ON orders (state, expires_at)
    WHERE state = 'RESERVED';
```

**The CHECK constraint `total = available + reserved + sold` is your safety net.** If ANY bug causes inconsistency, the database itself will reject the write. This is your last line of defense.

---

## 10. Handling Edge Cases

### Edge Case 1: Redis Goes Down

```java
// Fallback: use database-level atomic decrement
public long attemptReserveFallback(String productId, String userId) {
    try {
        // Atomic DB operation — slower but correct
        int updated = inventoryRepo.reserveStock(productId, 1);
        return updated > 0 ? 1 : 0;
    } catch (DataIntegrityViolationException e) {
        // Unique constraint violation → user already bought
        return -1;
    }
}
```

### Edge Case 2: Server Crashes After Redis DECR but Before Kafka Publish

```
Redis stock: 99 (decremented)
Kafka: never received the order
DB: no order created
→ One iPhone is lost! (underselling)
```

**Solution: Reconciliation job.**

```java
@Scheduled(fixedRate = 60_000)  // Every minute during sale
public void reconcileRedisWithDB() {
    int redisStock = getRedisStock("iphone-100");
    int dbAvailable = inventoryRepo.getAvailable("iphone-100");
    int dbReserved = inventoryRepo.getReserved("iphone-100");
    int dbSold = inventoryRepo.getSold("iphone-100");

    int redisAccountedFor = 100 - redisStock;           // How many Redis gave out
    int dbAccountedFor = dbReserved + dbSold;            // How many DB knows about

    int drift = redisAccountedFor - dbAccountedFor;      // Should be 0

    if (drift > 0) {
        // Redis gave out more than DB recorded → some orders were lost
        log.warn("Stock drift detected: {} unaccounted reservations. " +
                 "Restoring Redis stock.", drift);
        redis.opsForValue().increment("flash_sale:iphone-100:stock", drift);
    }
}
```

### Edge Case 3: User Gets Reservation but Doesn't Pay

Already handled by the TTL-based auto-release (Section 7). Reservation expires after 10 minutes, stock is restored to Redis and DB, another user can buy.

### Edge Case 4: Double-Click / Network Retry

Already handled:
1. Redis Lua script checks `SISMEMBER` — same user can't reserve twice
2. API Gateway rate limits: 1 request per user per 5 seconds
3. DB unique constraint on `(user_id, product_id)`

### Edge Case 5: Exactly 100 Users Pay — Verification

```java
// Final verification after sale ends
@Scheduled(cron = "0 0 1 * * *")  // 1 AM daily
public void verifySaleIntegrity() {
    Inventory inv = inventoryRepo.findById("iphone-100").orElseThrow();

    // The CHECK constraint ensures: total = available + reserved + sold
    assert inv.getTotal() == inv.getAvailable() + inv.getReserved() + inv.getSold();

    long confirmedOrders = orderRepo.countByProductIdAndState("iphone-100",
        OrderState.CONFIRMED);

    if (confirmedOrders != inv.getSold()) {
        alertOps("CRITICAL: Order count mismatch! " +
                 "DB sold=" + inv.getSold() +
                 " confirmed_orders=" + confirmedOrders);
    }

    log.info("Sale verification: total={}, available={}, reserved={}, sold={}, " +
             "confirmed_orders={}",
             inv.getTotal(), inv.getAvailable(), inv.getReserved(),
             inv.getSold(), confirmedOrders);
}
```

---

## 11. Why Not Just Use Database Locking?

| Approach | Can Handle 10M req/s? | Oversell Risk | Complexity |
|----------|----------------------|---------------|------------|
| No locking (naive) | Yes | HIGH (race conditions) | Low |
| Pessimistic lock (`SELECT FOR UPDATE`) | No — 100-500 TPS max | None | Low |
| Optimistic lock (`@Version`) | 1000-5000 TPS | None (but high retry rate) | Medium |
| **Redis atomic counter** | **100K+ TPS** | **None** | **Medium** |
| Redis + DB + Kafka (our solution) | **10M+ TPS** | **None** | High |

**Database locking at 10M requests/second = database death.**

The key insight: Use Redis to handle the 10M-to-100 reduction. The database only sees ~100 writes. This is why the layered architecture matters.

---

## 12. Senior-Level Talking Points

**What a mid-level says:**
> "I'd use a database transaction with SELECT FOR UPDATE to lock the row."

**What a senior says:**
> "Database locks can't handle 10M concurrent requests. I'd use a multi-layered approach: CDN and rate limiting shed 99% of traffic, Redis atomic counters handle the stock reservation in sub-millisecond time, Kafka decouples order creation from the hot path, and the database only sees the ~100 confirmed orders. Redis Lua scripts ensure atomicity without race conditions, TTL-based reservations prevent underselling from abandoned checkouts, and a reconciliation job catches any drift between Redis and the database."

### Key Phrases That Impress Interviewers

1. **"Funnel pattern"** — Shed load at each layer, cheapest layer first
2. **"Atomic operations in Redis"** — Lua scripts for check-and-decrement
3. **"Reservation with TTL"** — Solves underselling from abandoned carts
4. **"Reconciliation"** — Catches any inconsistency between systems
5. **"Database CHECK constraint as last defense"** — `total = available + reserved + sold`
6. **"Idempotent consumers"** — Kafka at-least-once is fine with deduplication
7. **"Eventual consistency between Redis and DB, but strong consistency for the count"**

---

## 13. Interview Follow-Up Questions

### "What if the user needs a guaranteed position in the queue instead of instant rejection?"

Use a virtual queue:
```
1. All 10M users enter a Kafka-backed queue
2. Assign position numbers
3. Process first 100 in order
4. Notify position to user: "You're #47 in line"
5. Users #101+ get "Sorry, sold out" after processing
```
This is fairer but slower. Trade-off: fairness vs speed.

### "What if we're selling across multiple regions (India + US)?"

Two approaches:

**Approach 1: Centralized Redis (simpler)**
- Single Redis cluster (Mumbai region)
- All regions talk to it
- Problem: latency for US users (~200ms round trip)

**Approach 2: Pre-allocated stock per region**
```
Total: 100 iPhones
India: 70 units (Redis in Mumbai)
US: 30 units (Redis in Virginia)
```
- Each region manages its own stock independently
- If one region sells out, remaining stock from other region can be re-allocated
- More complex but lower latency

### "How would you test this system?"

```
1. Unit test:     Redis Lua script with concurrent threads (100 threads, 100 stock)
2. Integration:   Testcontainers with Redis + PostgreSQL
3. Load test:     Gatling/K6 simulating 10M requests in 2 seconds
4. Chaos test:    Kill Redis mid-sale → verify fallback to DB works
5. Reconciliation test: Inject drift → verify reconciliation job fixes it
6. Edge case:     101st request must get SOLD OUT, not success
```

### "What if it's not 100 iPhones but 100,000?"

Same architecture, but:
- Redis can handle it (DECR is O(1) regardless of count)
- DB needs partitioned orders table
- Kafka needs more partitions for parallel consumer processing
- Payment service needs to scale horizontally

### "What about fairness? First-come-first-served?"

Redis processes commands in order (single-threaded), so it IS first-come-first-served at the Redis level. But network latency means users closer to the data center have an advantage. For strict fairness:
- Use a lottery system: accept entries for 30 seconds, then randomly select 100 winners
- This is what some companies do for high-demand limited sales

---

## Summary: The One-Page Answer

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXACTLY 100 iPhones                          │
│                                                                 │
│  1. CDN + Rate Limiter shed 99% of traffic before backend      │
│                                                                 │
│  2. Redis Lua script: ATOMIC check + decrement + buyer record  │
│     └─ Guarantees exactly 100 reservations (not 101)           │
│                                                                 │
│  3. Kafka → Order Service: idempotent order creation in DB     │
│     └─ Database CHECK constraint: total = avail + resv + sold  │
│                                                                 │
│  4. 10-minute payment window with TTL auto-release             │
│     └─ Prevents underselling (restocks expired reservations)   │
│                                                                 │
│  5. Reconciliation job catches any Redis↔DB drift              │
│     └─ Belt AND suspenders approach                            │
│                                                                 │
│  Result: Exactly 100 sold. Not 101. Not 99.                   │
└─────────────────────────────────────────────────────────────────┘
```
