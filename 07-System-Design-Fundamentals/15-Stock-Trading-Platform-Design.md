# Stock Trading Platform Design
### A Comprehensive System Design Guide for Mid-Level Java Engineers

**Target Audience:** Mid-level Java engineer (5 YOE), Barclays investment banking background, targeting FAANG/fintech
**Document Length:** Visual Study Guide (Complete Reference)
**Last Updated:** 2026-02-09

---

## Table of Contents

1. [Problem Statement & Requirements](#problem-statement--requirements)
2. [High-Level Architecture](#high-level-architecture)
3. [Order Types Explained](#order-types-explained)
4. [The Order Matching Engine](#the-order-matching-engine)
5. [Order Book Data Structure](#order-book-data-structure)
6. [Market Data Streaming](#market-data-streaming)
7. [Risk Management & Pre-Trade Checks](#risk-management--pre-trade-checks)
8. [Low-Latency Architecture](#low-latency-architecture)
9. [Settlement & Clearing](#settlement--clearing)
10. [Database & Storage Design](#database--storage-design)
11. [Scaling & Fault Tolerance](#scaling--fault-tolerance)
12. [Senior vs Mid-Level Comparison](#senior-vs-mid-level-comparison)
13. [Interview Follow-Up Questions & Answers](#interview-follow-up-questions--answers)

---

## Problem Statement & Requirements

### The Business Problem

Design a **stock trading platform** like Zerodha/Robinhood that enables:
- Retail and institutional investors to place, modify, and cancel orders
- Real-time matching of buy and sell orders
- Live market data streaming
- Portfolio tracking and trade history
- Sub-10ms order execution latency
- Handling 100,000+ orders per second during market open

**Why This Matters for Your Career:** As someone with Barclays investment banking background, you understand the complexity of financial markets. Trading platforms are THE critical infrastructure — a 100ms delay in order execution can cost millions in algorithmic trading. This design showcases your understanding of both business logic AND systems engineering.

### Functional Requirements

1. **Order Management:**
   - Place new orders (market, limit, stop-loss, stop-limit)
   - Cancel orders (before execution)
   - Modify orders (price, quantity)
   - View order history and current orders
   - Batch order placement for institutional clients

2. **Order Matching:**
   - Match buy and sell orders based on price-time priority
   - Execute orders at best available price
   - Partial fill handling (order not fully executed, remainder stays in book)
   - Self-trade prevention (user's buy order shouldn't match their own sell order)
   - IOC, FOK, GTC order duration types

3. **Real-Time Market Data:**
   - Live price feeds (bid/ask/last trade price)
   - OHLCV candles (1-min, 5-min, hourly, daily)
   - Order book depth (top 5-10 price levels)
   - Trade stream (every transaction)
   - Market statistics (52-week high/low, volume, etc.)

4. **Portfolio Management:**
   - View holdings (quantities, average cost, current value)
   - View realized/unrealized P&L
   - Cash balance tracking
   - Margin utilization

5. **Audit & Compliance:**
   - Every order/trade logged with timestamp
   - Trade audit trail for regulatory reporting
   - User activity history

### Non-Functional Requirements

| Requirement | Target | Why It Matters |
|---|---|---|
| **Order Matching Latency** | < 10ms (p99) | Faster execution = competitive advantage, attract HFT clients |
| **Order Throughput** | 100K orders/second | Market open generates massive order volume |
| **Availability** | 99.99% (market hours) | 52 minutes/year downtime acceptable |
| **Data Consistency** | Exactly-once execution | No double-fills, no missing orders |
| **Price Feed Latency** | < 1ms per tick | Lag in price data = stale orders |
| **Scalability** | Linear with # symbols | Can handle 500+ symbols simultaneously |

### Back-of-Envelope Calculations

**Order Volume During Market Open (9:30 AM - 4:00 PM):**
```
Market hours: 6.5 hours = 23,400 seconds
Average orders per second: 100,000 (this is peak during opening)
Total orders per day: ~1-2 billion
Order book size per symbol: ~10,000 active orders on each side

Storage for 1 day:
- 2 billion orders × 500 bytes (order record) = 1 TB (before compression)
- Keep in hot storage: last 1 year = 365 TB minimum
- Keep in cold storage: 7 years for regulatory = 2.5 PB (S3 archive)
```

**Market Data Volume:**
```
Stock symbols: 10,000 (assume major markets)
Ticks per symbol per second: 1000+ (during high volatility)
Total market data ticks: 10M ticks/second
Each tick: ~100 bytes
Data per second: 1 GB/second
Per day: 86 TB/day
```

**Memory Footprint (Production Estimate):**
```
Order book (in-memory): 10,000 symbols × 10,000 orders per side = 200M orders
Each order object: ~200 bytes = 40 GB minimum
Cache for recent trades: ~1 billion trades/day in memory = 50 GB
Price ticks cache: 10M/sec × 100 bytes = 1 GB per 10 seconds buffer
Total hot memory: ~100-150 GB per matching engine cluster
```

---

## High-Level Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Web Browser     │  │  Mobile App      │  │  Algo Trader     │  │
│  │  (REST + WS)     │  │  (REST + WS)     │  │  (FIX Protocol)  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│           │                     │                     │             │
└───────────┼─────────────────────┼─────────────────────┼─────────────┘
            │                     │                     │
    ┌───────▼─────────────────────▼─────────────────────▼──────────┐
    │            API GATEWAY & LOAD BALANCER                        │
    │  (Nginx/F5, SSL termination, rate limiting, auth)            │
    └─────────────────────────────┬──────────────────────────────────┘
                                  │
    ┌─────────────────────────────▼────────────────────────────────┐
    │              HOT PATH (Synchronous)                           │
    │  ┌──────────────────┐  ┌──────────────────────────────────┐  │
    │  │  ORDER SERVICE   │  │  RISK CHECK SERVICE              │  │
    │  │  - Parse order   │  │  - Balance check                 │  │
    │  │  - Validate      │  │  - Position limits               │  │
    │  │  - Route to      │──│  - Price bands                   │  │
    │  │    matching      │  │  - Circuit breakers              │  │
    │  └────────┬─────────┘  │  - Duplicate detection           │  │
    │           │             └──────────────────────────────────┘  │
    │  ┌────────▼──────────────────────────────────────────────┐   │
    │  │        MATCHING ENGINE (Single-Threaded)             │   │
    │  │  ┌──────────────────────────────────────────────────┐ │   │
    │  │  │  TreeMap<Price, LinkedList<Order>>              │ │   │
    │  │  │  - Buy side (bids): Price DESC                  │ │   │
    │  │  │  - Sell side (asks): Price ASC                  │ │   │
    │  │  │  - Price-Time Priority matching                 │ │   │
    │  │  │  - Partial fills, self-trade prevention         │ │   │
    │  │  └──────────────────────────────────────────────────┘ │   │
    │  │  Response time: < 10ms (p99)                           │   │
    │  └────────┬──────────────────────────────────────────────┘   │
    │           │                                                   │
    └───────────┼───────────────────────────────────────────────────┘
                │
    ┌───────────▼──────────────────────────────────────────────────┐
    │              COLD PATH (Asynchronous)                        │
    │  ┌──────────────────────────────────────────────────────┐   │
    │  │  KAFKA CLUSTER                                       │   │
    │  │  Topics:                                             │   │
    │  │  - trades (matched orders)                           │   │
    │  │  - order-events (NEW, FILLED, CANCELLED)            │   │
    │  │  - market-data-ticks                                │   │
    │  └────┬──────────────────┬──────────────────┬───────────┘   │
    │       │                  │                  │                │
    │  ┌────▼────┐     ┌───────▼─────┐   ┌──────▼──────┐         │
    │  │SETTLEMENT│    │MARKET DATA   │   │PORTFOLIO    │         │
    │  │SERVICE   │    │SERVICE       │   │SERVICE      │         │
    │  │(T+1 batch)    │(OHLCV,       │   │(Positions,  │         │
    │  │              │ AGGREGATION)  │   │ P&L)        │         │
    │  └────┬────┘     └───────┬─────┘   └──────┬──────┘         │
    │       │                  │                  │                │
    └───────┼──────────────────┼──────────────────┼────────────────┘
            │                  │                  │
    ┌───────▼──────────────────▼──────────────────▼─────────────┐
    │           PERSISTENCE LAYER                              │
    │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
    │  │ PostgreSQL   │  │ TimescaleDB  │  │ S3 / Archive  │  │
    │  │ (Hot: Trades,│  │ (Time-series │  │ (7-year audit │  │
    │  │  Positions)  │  │  data, OHLCV)│  │  trail)       │  │
    │  └──────────────┘  └──────────────┘  └───────────────┘  │
    │                                                           │
    │  Write-Ahead Log (WAL):                                 │
    │  - Matching engine state snapshots every 1 second       │
    │  - Recovery: replay WAL on standby after primary fails  │
    └───────────────────────────────────────────────────────────┘

    ┌───────────────────────────────────────────────────────────┐
    │         EXTERNAL DATA SOURCES                            │
    │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
    │  │ Stock Exchange│  │ Market Data  │  │ Regulatory   │  │
    │  │ Feed (FIX)    │  │ Feed (Nasdaq)│  │ Data (SEC)   │  │
    │  └──────────────┘  └──────────────┘  └───────────────┘  │
    └───────────────────────────────────────────────────────────┘
```

### Why This Architecture?

**1. The Matching Engine is the HEART**
- Everything else is supporting infrastructure
- It must be blazingly fast (< 10ms)
- Single-threaded to avoid locks (counter-intuitive but faster)
- All other services are non-blocking and async

**2. Hot Path vs Cold Path Separation**
- **Hot path:** Order placement → Risk checks → Matching (synchronous, must be fast)
- **Cold path:** Settlement, audit logging, portfolio updates (async via Kafka, can be slow)
- Client doesn't wait for settlement (T+1 anyway), only waits for order confirmation

**3. Event-Driven with Kafka**
- Every trade generates events: `TradeEvent` published to Kafka
- Multiple consumers: settlement service, market data service, portfolio service, audit logging
- Kafka guarantees: at-least-once delivery (with idempotent processing)
- Scale independently: if settlement is slow, it doesn't block order matching

**4. Partitioning by Symbol**
- Each symbol (RELIANCE, TCS, INFY) has its own matching engine instance
- Eliminates cross-symbol locks
- Scale horizontally: add more servers for more symbols
- Single-threaded per symbol is the key to achieving 100K orders/second aggregate throughput

---

## Order Types Explained

### Order Type Hierarchy

```java
// Base order interface
public interface Order {
    String getOrderId();
    String getSymbol();
    double getPrice();
    int getQuantity();
    OrderSide getSide();          // BUY or SELL
    OrderType getOrderType();     // MARKET, LIMIT, STOP_LOSS, etc.
    OrderDuration getDuration(); // GTC, IOC, FOK
    OrderStatus getStatus();      // NEW, ACCEPTED, FILLED, CANCELLED, etc.
    long getTimestamp();
}

// Enums for order properties
public enum OrderSide {
    BUY,
    SELL
}

public enum OrderType {
    MARKET,          // Execute immediately at best available price
    LIMIT,           // Execute only at specified price or better
    STOP_LOSS,       // Trigger market order when price hits level
    STOP_LIMIT,      // Trigger limit order when price hits level
    ICEBERG          // Large order hidden in batches
}

public enum OrderDuration {
    GTC,    // Good Till Cancelled (stays in market until manually cancelled)
    IOC,    // Immediate or Cancel (execute what can, cancel rest instantly)
    FOK     // Fill or Kill (all-or-nothing: execute all or cancel all)
}

public enum OrderStatus {
    NEW,             // Just created
    VALIDATED,       // Passed risk checks
    ACCEPTED,        // In matching engine
    PARTIAL_FILL,    // Partially matched
    FILLED,          // Fully matched
    CANCELLED,       // User or system cancelled
    REJECTED         // Failed validation
}
```

### Market Order

```java
public class MarketOrder implements Order {
    private final String orderId;
    private final String symbol;
    private final OrderSide side;      // BUY or SELL
    private int quantityRequested;
    private int quantityFilled = 0;
    private final long timestamp;
    private OrderStatus status = OrderStatus.NEW;
    private final String userId;

    // Market order: no price limit, execute at current best price
    private final Double priceLimit = null;  // Not used for market orders

    public MarketOrder(String orderId, String symbol, OrderSide side,
                       int quantity, long timestamp, String userId) {
        this.orderId = orderId;
        this.symbol = symbol;
        this.side = side;
        this.quantityRequested = quantity;
        this.timestamp = timestamp;
        this.userId = userId;
    }

    // Market buy: will buy at ask price (seller's asking price)
    // Market sell: will sell at bid price (buyer's bid price)
    // This is why we immediately match against opposite side
    @Override
    public double getPrice() {
        return Double.POSITIVE_INFINITY;  // Matches any price
    }

    @Override
    public OrderType getOrderType() {
        return OrderType.MARKET;
    }
}

// Example: User places market buy order for 100 shares of RELIANCE
// Order book before:
//   ASK: 2500.50 (500 shares), 2501.00 (300 shares)
//   BID: 2500.00 (200 shares), 2499.50 (100 shares)
//
// Market buy 100 shares matches against:
// - 100 @ 2500.50 (best ask) = 100 shares filled at 2500.50
// Result: Immediately filled at 2500.50
```

### Limit Order

```java
public class LimitOrder implements Order {
    private final String orderId;
    private final String symbol;
    private final OrderSide side;
    private final double priceLimit;   // Only execute at this price or better
    private int quantityRequested;
    private int quantityFilled = 0;
    private final long timestamp;
    private OrderStatus status = OrderStatus.NEW;
    private final String userId;

    public LimitOrder(String orderId, String symbol, OrderSide side,
                      int quantity, double priceLimit, long timestamp, String userId) {
        this.orderId = orderId;
        this.symbol = symbol;
        this.side = side;
        this.quantityRequested = quantity;
        this.priceLimit = priceLimit;
        this.timestamp = timestamp;
        this.userId = userId;
    }

    @Override
    public double getPrice() {
        return priceLimit;
    }

    @Override
    public OrderType getOrderType() {
        return OrderType.LIMIT;
    }
}

// Example: User places limit buy order: buy 100 shares @ 2499.00
// Order book before:
//   ASK: 2500.50 (500 shares), 2501.00 (300 shares)
//   BID: 2500.00 (200 shares), 2499.50 (100 shares)
//
// Limit buy 100 @ 2499.00:
// - Best ask is 2500.50 (> 2499.00 price limit)
// - No match possible, order stays in book
// - Added to BID side @ 2499.00
// Result: 0 shares filled, 100 shares waiting in order book
//
// If later someone sells 50 @ 2499.00:
// - Matches against our buy order
// Result: 50 shares filled @ 2499.00, 50 shares remain in book
```

### Stop-Loss Order

```java
public class StopLossOrder implements Order {
    private final String orderId;
    private final String symbol;
    private final OrderSide side;
    private final double stopPrice;    // Trigger price
    private int quantityRequested;
    private int quantityFilled = 0;
    private final long timestamp;
    private OrderStatus status = OrderStatus.NEW;
    private final String userId;
    private boolean triggered = false;

    public StopLossOrder(String orderId, String symbol, OrderSide side,
                         int quantity, double stopPrice, long timestamp, String userId) {
        this.orderId = orderId;
        this.symbol = symbol;
        this.side = side;
        this.quantityRequested = quantity;
        this.stopPrice = stopPrice;
        this.timestamp = timestamp;
        this.userId = userId;
    }

    @Override
    public double getPrice() {
        return Double.POSITIVE_INFINITY;  // Will execute as market order
    }

    @Override
    public OrderType getOrderType() {
        return OrderType.STOP_LOSS;
    }

    // This order is NOT in the order book initially
    // Market data service monitors price, triggers order when price <= stopPrice
}

// Example: User bought RELIANCE @ 2500, current price 2505
// Places stop-loss: sell 100 @ stop price 2490
//
// If price drops to 2490 or below:
// - Stop order is TRIGGERED
// - Converted to market sell order
// - Immediately sent to matching engine
// - Executes at best available bid price
// Result: Loss limited to ~250 (sold at 2490 vs bought at 2500)
```

### Stop-Limit Order

```java
public class StopLimitOrder implements Order {
    private final String orderId;
    private final String symbol;
    private final OrderSide side;
    private final double stopPrice;    // Trigger price
    private final double limitPrice;   // Execution price limit
    private int quantityRequested;
    private int quantityFilled = 0;
    private final long timestamp;
    private OrderStatus status = OrderStatus.NEW;
    private final String userId;
    private boolean triggered = false;

    public StopLimitOrder(String orderId, String symbol, OrderSide side,
                          int quantity, double stopPrice, double limitPrice,
                          long timestamp, String userId) {
        this.orderId = orderId;
        this.symbol = symbol;
        this.side = side;
        this.quantityRequested = quantity;
        this.stopPrice = stopPrice;
        this.limitPrice = limitPrice;
        this.timestamp = timestamp;
        this.userId = userId;
    }

    @Override
    public double getPrice() {
        return limitPrice;
    }

    @Override
    public OrderType getOrderType() {
        return OrderType.STOP_LIMIT;
    }
}

// Example: User bought RELIANCE @ 2500, current price 2505
// Places stop-limit: sell 100 @ stop 2490, limit price 2485
//
// If price drops to 2490:
// - Stop order is TRIGGERED
// - Converted to LIMIT SELL order @ 2485
// - Will only execute if someone bids >= 2485
// - If price crashes to 2480, order won't execute (limit price not met)
// Result: More control than stop-loss, but may not execute when needed
```

### Order Duration Types

```java
// IOC = Immediate or Cancel
// Execute as much as possible immediately, cancel remaining
public class IOCOrder implements Order {
    // Example: IOC buy 100 @ 2500
    // If only 60 shares available @ 2500:
    // - 60 shares filled
    // - 40 shares cancelled immediately (not added to order book)
}

// FOK = Fill or Kill
// All-or-nothing: execute entire order or cancel entire order
public class FOKOrder implements Order {
    // Example: FOK buy 100 @ 2500
    // If only 60 shares available @ 2500:
    // - ENTIRE order cancelled (no fill)
    // Not partially filled
}

// GTC = Good Till Cancelled
// Order stays in market until user manually cancels or end of trading day
public class GTCOrder implements Order {
    // Example: GTC buy 100 @ 2480
    // Stays in order book until:
    // 1. User cancels it
    // 2. Fully filled
    // 3. End of trading day (automatically cancelled)
}
```

### Order State Machine

```
┌─────────────────────────────────────────────────────────────┐
│                    ORDER STATE MACHINE                       │
└─────────────────────────────────────────────────────────────┘

                        ┌──────┐
                        │ NEW  │ (Just created)
                        └───┬──┘
                            │
                            ▼
                    ┌──────────────────┐
                    │ VALIDATED        │ (Passed pre-trade checks)
                    └───┬──────────────┘
                        │
                        ▼
                    ┌──────────────────┐
                    │ ACCEPTED         │ (In matching engine)
                    └───┬──────────────┘
                        │
                ┌───────┴───────┬──────────────┐
                │               │              │
                ▼               ▼              ▼
            ┌────────┐   ┌─────────────┐  ┌──────────┐
            │ FILLED │   │PARTIAL_FILL │  │CANCELLED │
            │(All 100)   │(50 of 100)  │  │(by user) │
            └────────┘   └──────┬──────┘  └──────────┘
                                │
                                │ (User cancels the remaining 50)
                                ▼
                            ┌──────────┐
                            │CANCELLED │
                            └──────────┘

             Also possible:
             NEW → REJECTED (failed validation)
             ANY STATE → CANCELLED (system error, circuit breaker)
```

---

## The Order Matching Engine

This is the CORE of the entire system. It must be:
1. **Fast:** < 10ms to match order against entire order book
2. **Correct:** Price-time priority strictly enforced
3. **Reliable:** No double-fills, no lost orders
4. **Stateful:** Maintains order book state

### Matching Algorithm: Price-Time Priority (FIFO)

The matching algorithm is surprisingly simple:

1. **New BUY order arrives:**
   - Start with best (lowest) ASK price
   - If buy price >= ask price → MATCH
   - Fill as much as possible at this price level
   - If buy quantity remaining, move to next ask price level
   - If buy price < best ask → Add to BID side (no match)

2. **New SELL order arrives:**
   - Start with best (highest) BID price
   - If sell price <= bid price → MATCH
   - Fill as much as possible at this price level
   - If sell quantity remaining, move to next bid price level
   - If sell price > best bid → Add to ASK side (no match)

### Order Book Data Structure Visualization

```
Current market price for RELIANCE: 2500.45

MATCHING ENGINE ORDER BOOK:
═════════════════════════════════════════════════════════════

ASK SIDE (Sellers, sorted ASCENDING by price):
Price      │ Quantity │ Trader   │ Order ID       │ Timestamp
───────────┼──────────┼──────────┼────────────────┼──────────
 2500.80   │   300 sh │ Alice    │ O-101          │ 10:30:45.123
 2500.90   │   200 sh │ Bob      │ O-102          │ 10:30:46.456
 2501.00   │   500 sh │ Charlie  │ O-103          │ 10:30:47.789
 2501.50   │   100 sh │ Diana    │ O-104          │ 10:31:12.234

SPREAD = 2500.80 - 2500.45 = 0.35 (tight spread = liquid market)

───────────┼──────────┼──────────┼────────────────┼──────────
 2500.45   │ LAST TRADE PRICE
───────────┼──────────┼──────────┼────────────────┼──────────

BID SIDE (Buyers, sorted DESCENDING by price):
Price      │ Quantity │ Trader   │ Order ID       │ Timestamp
───────────┼──────────┼──────────┼────────────────┼──────────
 2500.45   │   100 sh │ Eve      │ O-105          │ 10:31:13.567
 2500.30   │   400 sh │ Frank    │ O-106          │ 10:31:14.890
 2500.10   │   200 sh │ Grace    │ O-107          │ 10:31:15.234
 2499.90   │   600 sh │ Henry    │ O-108          │ 10:31:16.567

═════════════════════════════════════════════════════════════
```

### Complete Java Implementation

```java
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;

public class OrderBook {
    private final String symbol;

    // TreeMap: O(log n) price level lookup
    // Price → LinkedList of orders at that price (FIFO within level)
    private final TreeMap<BigDecimal, LinkedList<Order>> askSide;    // Sellers, ASC
    private final TreeMap<BigDecimal, LinkedList<Order>> bidSide;    // Buyers, DESC

    // Book statistics
    private volatile BigDecimal lastTradePrice = BigDecimal.ZERO;
    private volatile long lastTradeTime = 0;
    private volatile long lastUpdateTime = System.nanoTime();

    // Object pool for orders (avoid GC)
    private final Queue<Order> orderPool = new ConcurrentLinkedQueue<>();

    // All active orders by ID for quick lookup
    private final Map<String, Order> activeOrders = new ConcurrentHashMap<>();

    public OrderBook(String symbol) {
        this.symbol = symbol;
        // Natural ordering (ascending)
        this.askSide = new TreeMap<>(BigDecimal::compareTo);
        // Reverse ordering (descending)
        this.bidSide = new TreeMap<>(Collections.reverseOrder());
    }

    /**
     * Matching engine: the hot path
     * Single-threaded, must complete in < 10ms
     */
    public List<Trade> matchOrder(Order incomingOrder) {
        List<Trade> trades = new ArrayList<>();

        // Pre-fill checks
        if (incomingOrder.getOrderType() == OrderType.MARKET) {
            trades.addAll(matchMarketOrder(incomingOrder));
        } else if (incomingOrder.getOrderType() == OrderType.LIMIT) {
            trades.addAll(matchLimitOrder(incomingOrder));
        }

        // Add remaining quantity to order book (if any)
        int remaining = incomingOrder.getQuantityRequested() -
                       incomingOrder.getQuantityFilled();

        if (remaining > 0 && shouldAddToBook(incomingOrder)) {
            addToBook(incomingOrder);
        }

        return trades;
    }

    /**
     * Market order: match at ANY price
     */
    private List<Trade> matchMarketOrder(Order marketOrder) {
        List<Trade> trades = new ArrayList<>();
        int quantityRemaining = marketOrder.getQuantityRequested();

        if (marketOrder.getSide() == OrderSide.BUY) {
            // Match against ask side (sellers)
            // Start from LOWEST ask (best price for buyer)
            for (Map.Entry<BigDecimal, LinkedList<Order>> entry :
                 askSide.entrySet()) {

                if (quantityRemaining <= 0) break;

                BigDecimal askPrice = entry.getKey();
                LinkedList<Order> ordersAtPrice = entry.getValue();

                // Process all orders at this price level (FIFO)
                while (!ordersAtPrice.isEmpty() && quantityRemaining > 0) {
                    Order sellerOrder = ordersAtPrice.peek();

                    // Self-trade prevention
                    if (sellerOrder.getUserId().equals(marketOrder.getUserId())) {
                        ordersAtPrice.removeFirst();
                        continue;
                    }

                    int fillQty = Math.min(
                        quantityRemaining,
                        sellerOrder.getQuantityRequested() -
                        sellerOrder.getQuantityFilled()
                    );

                    // Create trade
                    Trade trade = new Trade(
                        UUID.randomUUID().toString(),
                        symbol,
                        fillQty,
                        askPrice,
                        marketOrder.getUserId(),      // Buyer
                        sellerOrder.getUserId(),      // Seller
                        System.currentTimeMillis()
                    );
                    trades.add(trade);

                    // Update order states
                    marketOrder.addFill(fillQty, askPrice);
                    sellerOrder.addFill(fillQty, askPrice);
                    quantityRemaining -= fillQty;

                    // Remove order if fully filled
                    if (sellerOrder.getQuantityFilled() ==
                        sellerOrder.getQuantityRequested()) {
                        ordersAtPrice.removeFirst();
                        activeOrders.remove(sellerOrder.getOrderId());
                    }
                }

                // Remove price level if empty
                if (ordersAtPrice.isEmpty()) {
                    askSide.remove(askPrice);
                }
            }
        } else {
            // SELL market order: match against bid side (buyers)
            // Start from HIGHEST bid (best price for seller)
            for (Map.Entry<BigDecimal, LinkedList<Order>> entry :
                 bidSide.entrySet()) {

                if (quantityRemaining <= 0) break;

                BigDecimal bidPrice = entry.getKey();
                LinkedList<Order> ordersAtPrice = entry.getValue();

                // Same logic as buy side
                while (!ordersAtPrice.isEmpty() && quantityRemaining > 0) {
                    Order buyerOrder = ordersAtPrice.peek();

                    if (buyerOrder.getUserId().equals(marketOrder.getUserId())) {
                        ordersAtPrice.removeFirst();
                        continue;
                    }

                    int fillQty = Math.min(
                        quantityRemaining,
                        buyerOrder.getQuantityRequested() -
                        buyerOrder.getQuantityFilled()
                    );

                    Trade trade = new Trade(
                        UUID.randomUUID().toString(),
                        symbol,
                        fillQty,
                        bidPrice,
                        buyerOrder.getUserId(),       // Buyer
                        marketOrder.getUserId(),      // Seller
                        System.currentTimeMillis()
                    );
                    trades.add(trade);

                    marketOrder.addFill(fillQty, bidPrice);
                    buyerOrder.addFill(fillQty, bidPrice);
                    quantityRemaining -= fillQty;

                    if (buyerOrder.getQuantityFilled() ==
                        buyerOrder.getQuantityRequested()) {
                        ordersAtPrice.removeFirst();
                        activeOrders.remove(buyerOrder.getOrderId());
                    }
                }

                if (ordersAtPrice.isEmpty()) {
                    bidSide.remove(bidPrice);
                }
            }
        }

        return trades;
    }

    /**
     * Limit order: match ONLY at specified price or better
     */
    private List<Trade> matchLimitOrder(Order limitOrder) {
        List<Trade> trades = new ArrayList<>();
        int quantityRemaining = limitOrder.getQuantityRequested();
        BigDecimal limitPrice = BigDecimal.valueOf(limitOrder.getPrice());

        if (limitOrder.getSide() == OrderSide.BUY) {
            // Buy limit: match against asks <= limitPrice
            for (Map.Entry<BigDecimal, LinkedList<Order>> entry :
                 askSide.entrySet()) {

                BigDecimal askPrice = entry.getKey();

                // Stop matching if ask > limit price
                if (askPrice.compareTo(limitPrice) > 0) break;

                if (quantityRemaining <= 0) break;

                LinkedList<Order> ordersAtPrice = entry.getValue();

                while (!ordersAtPrice.isEmpty() && quantityRemaining > 0) {
                    Order sellerOrder = ordersAtPrice.peek();

                    if (sellerOrder.getUserId().equals(limitOrder.getUserId())) {
                        ordersAtPrice.removeFirst();
                        continue;
                    }

                    int fillQty = Math.min(
                        quantityRemaining,
                        sellerOrder.getQuantityRequested() -
                        sellerOrder.getQuantityFilled()
                    );

                    Trade trade = new Trade(
                        UUID.randomUUID().toString(),
                        symbol,
                        fillQty,
                        askPrice,
                        limitOrder.getUserId(),
                        sellerOrder.getUserId(),
                        System.currentTimeMillis()
                    );
                    trades.add(trade);

                    limitOrder.addFill(fillQty, askPrice);
                    sellerOrder.addFill(fillQty, askPrice);
                    quantityRemaining -= fillQty;

                    if (sellerOrder.getQuantityFilled() ==
                        sellerOrder.getQuantityRequested()) {
                        ordersAtPrice.removeFirst();
                        activeOrders.remove(sellerOrder.getOrderId());
                    }
                }

                if (ordersAtPrice.isEmpty()) {
                    askSide.remove(askPrice);
                }
            }
        } else {
            // Sell limit: match against bids >= limitPrice
            for (Map.Entry<BigDecimal, LinkedList<Order>> entry :
                 bidSide.entrySet()) {

                BigDecimal bidPrice = entry.getKey();

                // Stop matching if bid < limit price
                if (bidPrice.compareTo(limitPrice) < 0) break;

                if (quantityRemaining <= 0) break;

                LinkedList<Order> ordersAtPrice = entry.getValue();

                while (!ordersAtPrice.isEmpty() && quantityRemaining > 0) {
                    Order buyerOrder = ordersAtPrice.peek();

                    if (buyerOrder.getUserId().equals(limitOrder.getUserId())) {
                        ordersAtPrice.removeFirst();
                        continue;
                    }

                    int fillQty = Math.min(
                        quantityRemaining,
                        buyerOrder.getQuantityRequested() -
                        buyerOrder.getQuantityFilled()
                    );

                    Trade trade = new Trade(
                        UUID.randomUUID().toString(),
                        symbol,
                        fillQty,
                        bidPrice,
                        buyerOrder.getUserId(),
                        limitOrder.getUserId(),
                        System.currentTimeMillis()
                    );
                    trades.add(trade);

                    limitOrder.addFill(fillQty, bidPrice);
                    buyerOrder.addFill(fillQty, bidPrice);
                    quantityRemaining -= fillQty;

                    if (buyerOrder.getQuantityFilled() ==
                        buyerOrder.getQuantityRequested()) {
                        ordersAtPrice.removeFirst();
                        activeOrders.remove(buyerOrder.getOrderId());
                    }
                }

                if (ordersAtPrice.isEmpty()) {
                    bidSide.remove(bidPrice);
                }
            }
        }

        return trades;
    }

    /**
     * Add unmatched order to order book
     */
    private void addToBook(Order order) {
        BigDecimal price = BigDecimal.valueOf(order.getPrice());
        TreeMap<BigDecimal, LinkedList<Order>> side =
            (order.getSide() == OrderSide.BUY) ? bidSide : askSide;

        side.computeIfAbsent(price, k -> new LinkedList<>()).add(order);
        activeOrders.put(order.getOrderId(), order);
    }

    /**
     * Get best bid (highest price buyers are willing to pay)
     */
    public BigDecimal getBestBid() {
        if (bidSide.isEmpty()) return null;
        return bidSide.firstKey();
    }

    /**
     * Get best ask (lowest price sellers are willing to accept)
     */
    public BigDecimal getBestAsk() {
        if (askSide.isEmpty()) return null;
        return askSide.firstKey();
    }

    /**
     * Get spread (difference between best ask and best bid)
     */
    public BigDecimal getSpread() {
        BigDecimal bid = getBestBid();
        BigDecimal ask = getBestAsk();
        if (bid == null || ask == null) return null;
        return ask.subtract(bid);
    }

    /**
     * Cancel an order
     */
    public void cancelOrder(String orderId) {
        Order order = activeOrders.remove(orderId);
        if (order == null) return;

        TreeMap<BigDecimal, LinkedList<Order>> side =
            (order.getSide() == OrderSide.BUY) ? bidSide : askSide;

        BigDecimal price = BigDecimal.valueOf(order.getPrice());
        LinkedList<Order> ordersAtPrice = side.get(price);

        if (ordersAtPrice != null) {
            ordersAtPrice.remove(order);
            if (ordersAtPrice.isEmpty()) {
                side.remove(price);
            }
        }

        order.setCancelled();
    }
}
```

### Why TreeMap + LinkedList?

**TreeMap Benefits:**
- O(log n) to find a price level
- Automatically sorted (best bid/ask is always at firstKey())
- Efficient iteration through price levels
- Memory efficient (no full sorting needed)

**LinkedList for same-price FIFO:**
- O(1) insertion at end
- O(1) removal from front
- Enforces arrival time ordering within a price level

**Time Complexity Analysis:**
```
Matching 100 orders:
- For each incoming order: O(log n) to find best price level
- Match against at most K price levels: O(K * M) where M = orders per level
- Typical: K=5, M=10 → O(5*10) = O(50) very fast
- In worst case (thin book): K=100, M=1 → O(100) still fast

Expected latency: < 1ms for typical scenarios
```

### Single-Threaded Matching: Counter-Intuitive Performance

```
MYTH: Multi-threaded matching engine would be faster (parallel processing)

REALITY: Single-threaded is MUCH faster for order matching. Here's why:

1. LOCKING OVERHEAD (Multi-threaded):
   ┌─────────────────────────────────────┐
   │ Thread 1: Buy 100 RELIANCE @ 2500   │
   │ Acquires: bidSide.lock              │ ← LOCK CONTENTION
   │ Matches against askSide             │
   │ Releases: bidSide.lock              │
   │ Total time: 1ms (includes waiting)  │
   └─────────────────────────────────────┘

   ┌─────────────────────────────────────┐
   │ Thread 2: Sell 50 TCS @ 1800        │
   │ Waits for bidSide.lock              │ ← WAITING FOR LOCK
   │ Context switch, cache miss          │
   │ Finally acquires lock               │
   │ Total time: 5ms (1ms wait + 1ms actual + 3ms overhead) │
   └─────────────────────────────────────┘

   Aggregate: 2 orders in 6ms = 333 orders/ms

2. NO LOCKING (Single-threaded):
   ┌─────────────────────────────────────┐
   │ Thread 1: Buy 100 RELIANCE @ 2500   │
   │ Direct access to bidSide            │ ← NO LOCK
   │ Matches against askSide             │
   │ Time: 0.5ms                         │
   └─────────────────────────────────────┘

   ┌─────────────────────────────────────┐
   │ Thread 1: Sell 50 TCS @ 1800        │
   │ Direct access to bidSide            │ ← NO WAIT
   │ Matches against askSide             │
   │ Time: 0.3ms                         │
   └─────────────────────────────────────┘

   Aggregate: 2 orders in 0.8ms = 2,500 orders/ms ← 7X FASTER!

THE KEY INSIGHT:
- Order matching is SEQUENTIAL by nature (one trade per symbol at a time)
- Matching BUY order A with ASK order B creates a dependency
- You CANNOT parallelize BUY A and BUY C (they both affect same order book)
- Locks add overhead (acquire, release, context switch)
- Single-threaded eliminates locks AND cache misses

SOLUTION: Partition by symbol
- RELIANCE matching engine: single-threaded, handles all RELIANCE orders
- TCS matching engine: single-threaded, handles all TCS orders
- These can run in PARALLEL (different threads) because they don't share data
- Aggregate throughput: 2,500 orders/ms per symbol × 40 symbols = 100K orders/ms!
```

---

## Order Book Data Structure

### Depth & Levels Visualization

```
LEVEL 1 (Best Bid/Ask) - What users see in "1-click trading"
┌──────────────────────────────────────────┐
│ ASK (Sell side)                          │
│ Best Ask: 2500.50 (300 shares)          │
├──────────────────────────────────────────┤
│ SPREAD: 0.15                             │
├──────────────────────────────────────────┤
│ BID (Buy side)                           │
│ Best Bid: 2500.35 (500 shares)          │
└──────────────────────────────────────────┘

LEVEL 2 (Top 5 Levels) - What serious traders see
ASKS                      │ BIDS
Price      Qty            │ Price      Qty
───────────────────────────────────────────
2500.50    300            │ 2500.35    500
2500.60    200            │ 2500.25    400
2500.70    150            │ 2500.15    300
2500.80    100            │ 2500.05    250
2500.90    250            │ 2499.95    600

LEVEL 3 (Full Order Book) - All outstanding orders
This is what the matching engine maintains internally
Total asks: ~10,000 orders
Total bids: ~10,000 orders
Memory: ~40 MB (for active orders at any time)
```

### Java: Order Book Interface & Analytics

```java
import java.math.BigDecimal;
import java.util.*;

public class OrderBookSnapshot {
    private final String symbol;
    private final long timestamp;

    // Bid side (highest prices first)
    private final List<BookLevel> bids;
    // Ask side (lowest prices first)
    private final List<BookLevel> asks;

    public OrderBookSnapshot(String symbol, long timestamp,
                             List<BookLevel> bids, List<BookLevel> asks) {
        this.symbol = symbol;
        this.timestamp = timestamp;
        this.bids = bids;
        this.asks = asks;
    }

    public static class BookLevel {
        public final BigDecimal price;
        public final int totalQuantity;  // Sum of all orders at this price
        public final int numberOfOrders; // How many orders at this price

        public BookLevel(BigDecimal price, int totalQuantity, int numberOfOrders) {
            this.price = price;
            this.totalQuantity = totalQuantity;
            this.numberOfOrders = numberOfOrders;
        }
    }

    // Get best bid
    public BigDecimal getBestBid() {
        return bids.isEmpty() ? null : bids.get(0).price;
    }

    // Get best ask
    public BigDecimal getBestAsk() {
        return asks.isEmpty() ? null : asks.get(0).price;
    }

    // Get spread
    public BigDecimal getSpread() {
        BigDecimal bid = getBestBid();
        BigDecimal ask = getBestAsk();
        if (bid == null || ask == null) return null;
        return ask.subtract(bid);
    }

    // Get bid-ask percentage
    public Double getSpreadBps() {  // basis points
        BigDecimal spread = getSpread();
        BigDecimal mid = getMidPrice();
        if (spread == null || mid == null) return null;
        return (spread.doubleValue() / mid.doubleValue()) * 10000;
    }

    // Get mid price (average of best bid and ask)
    public BigDecimal getMidPrice() {
        BigDecimal bid = getBestBid();
        BigDecimal ask = getBestAsk();
        if (bid == null || ask == null) return null;
        return bid.add(ask).divide(BigDecimal.TWO);
    }

    // Get total buy pressure (sum of quantities on bid side)
    public int getTotalBidQuantity() {
        return bids.stream().mapToInt(l -> l.totalQuantity).sum();
    }

    // Get total sell pressure (sum of quantities on ask side)
    public int getTotalAskQuantity() {
        return asks.stream().mapToInt(l -> l.totalQuantity).sum();
    }

    // Imbalance ratio: bid quantity vs ask quantity
    // > 1.0 = more buyers than sellers = bullish
    // < 1.0 = more sellers than buyers = bearish
    public double getImbalanceRatio() {
        int bidQty = getTotalBidQuantity();
        int askQty = getTotalAskQuantity();
        if (askQty == 0) return Double.POSITIVE_INFINITY;
        return (double) bidQty / askQty;
    }

    // Market depth: how much liquidity is available at each price?
    // Traders use this to determine if it's safe to place a large order
    public int getLiquidityAtPrice(BigDecimal targetPrice, OrderSide side) {
        List<BookLevel> levels = (side == OrderSide.BUY) ? asks : bids;
        int totalLiquidity = 0;

        for (BookLevel level : levels) {
            if (side == OrderSide.BUY) {
                // For buying, we go UP in price until we exceed target
                if (level.price.compareTo(targetPrice) <= 0) {
                    totalLiquidity += level.totalQuantity;
                } else {
                    break;
                }
            } else {
                // For selling, we go DOWN in price until we go below target
                if (level.price.compareTo(targetPrice) >= 0) {
                    totalLiquidity += level.totalQuantity;
                } else {
                    break;
                }
            }
        }

        return totalLiquidity;
    }
}

/**
 * Memory optimization: Object pooling for Order objects
 * Avoids GC pressure from creating millions of order objects
 */
public class OrderPool {
    private final Queue<Order> pool = new ConcurrentLinkedQueue<>();
    private final int poolSize;

    public OrderPool(int initialSize) {
        this.poolSize = initialSize;
        for (int i = 0; i < initialSize; i++) {
            pool.add(new Order());
        }
    }

    // Get order from pool, or create new if empty
    public Order acquire() {
        Order order = pool.poll();
        return order != null ? order : new Order();
    }

    // Return order to pool for reuse
    public void release(Order order) {
        order.reset();  // Clear state
        if (pool.size() < poolSize) {
            pool.add(order);
        }
    }
}
```

---

## Market Data Streaming

### Real-Time Price Feed Pipeline

```
MARKET DATA PIPELINE (Low-latency streaming):

┌─────────────────────────────────────────────────────────┐
│ Matching Engine (generates trades)                      │
│ Every matched order = 1 trade event                     │
└────────────────┬────────────────────────────────────────┘
                 │ Trade Event (symbol, qty, price, timestamp)
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Market Data Service (aggregates trades into ticks)     │
│ - Computes OHLCV (Open, High, Low, Close, Volume)     │
│ - Generates market data ticks                           │
│ - Updates level 1/2/3 order book snapshot              │
└────────────────┬────────────────────────────────────────┘
                 │ Market Data Tick (bid, ask, mid, volume)
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Kafka Topic: market-data-ticks (topic with 10 partitions)│
│ - 100K+ ticks/second during market open                │
│ - Partitioned by symbol (RELIANCE → partition 1, etc.) │
│ - Durable: keeps data for 1 hour                       │
└────────────────┬────────────────────────────────────────┘
                 │
          ┌──────┴──────┬────────────────────┐
          │             │                    │
          ▼             ▼                    ▼
    ┌─────────┐  ┌──────────┐      ┌──────────────┐
    │ WebSocket│  │ Chart    │      │ Mobile App  │
    │ Clients  │  │ Service  │      │ Push Notif  │
    │ (Real-   │  │ (OHLCV)  │      │ (Alerts)    │
    │ time     │  │          │      │             │
    │ updates) │  │          │      │             │
    └─────────┘  └──────────┘      └──────────────┘
```

### OHLCV Candle Aggregation

```java
import java.math.BigDecimal;
import java.util.*;

public class OHLCVService {
    // Symbol → Interval → OHLCV data
    // Example: RELIANCE → 1-MIN → [10:30 candle, 10:31 candle, ...]
    private final Map<String, Map<String, LinkedList<Candle>>> ohlcvData
        = new ConcurrentHashMap<>();

    public static class Candle {
        public final long startTime;
        public final long endTime;
        public BigDecimal open;     // First trade in this minute
        public BigDecimal high;     // Highest price in this minute
        public BigDecimal low;      // Lowest price in this minute
        public BigDecimal close;    // Last trade in this minute
        public long volume;         // Total shares traded in this minute

        public Candle(long startTime, long endTime) {
            this.startTime = startTime;
            this.endTime = endTime;
            this.open = null;
            this.high = null;
            this.low = null;
            this.close = null;
            this.volume = 0;
        }

        public void addTrade(BigDecimal price, long quantity) {
            if (open == null) {
                open = price;
            }

            // Update high
            if (high == null || price.compareTo(high) > 0) {
                high = price;
            }

            // Update low
            if (low == null || price.compareTo(low) < 0) {
                low = price;
            }

            close = price;
            volume += quantity;
        }
    }

    /**
     * Process a trade from matching engine
     * Update all relevant OHLCV candles
     */
    public void processTrade(String symbol, BigDecimal price, long quantity,
                             long tradeTime) {
        // 1-minute candle
        processTrade1Min(symbol, price, quantity, tradeTime);
        // 5-minute candle
        processTrade5Min(symbol, price, quantity, tradeTime);
        // Hourly candle
        processTradeHourly(symbol, price, quantity, tradeTime);
        // Daily candle
        processTradeDaily(symbol, price, quantity, tradeTime);
    }

    private void processTrade1Min(String symbol, BigDecimal price,
                                  long quantity, long tradeTime) {
        // Calculate which 1-min candle this trade belongs to
        long oneMinTime = (tradeTime / 60_000) * 60_000;  // Round down to minute
        long nextMin = oneMinTime + 60_000;

        Map<String, LinkedList<Candle>> symbolData =
            ohlcvData.computeIfAbsent(symbol, k -> new ConcurrentHashMap<>());

        LinkedList<Candle> candles =
            symbolData.computeIfAbsent("1MIN", k -> new LinkedList<>());

        // Get or create candle for this minute
        Candle candle;
        if (candles.isEmpty() || candles.getLast().endTime <= oneMinTime) {
            // New candle needed
            candle = new Candle(oneMinTime, nextMin);
            candles.add(candle);

            // Keep only last 1440 candles (1 day of 1-min data)
            while (candles.size() > 1440) {
                candles.removeFirst();
            }
        } else {
            candle = candles.getLast();
        }

        candle.addTrade(price, quantity);
    }

    // Similar for 5-min, hourly, daily...

    /**
     * Get OHLCV for a symbol and interval
     * Used by chart service to plot candlestick charts
     */
    public List<Candle> getCandles(String symbol, String interval) {
        Map<String, LinkedList<Candle>> symbolData = ohlcvData.get(symbol);
        if (symbolData == null) return Collections.emptyList();

        LinkedList<Candle> candles = symbolData.get(interval);
        return candles != null ? new ArrayList<>(candles) : Collections.emptyList();
    }

    /**
     * Get last candle (current incomplete candle)
     */
    public Candle getCurrentCandle(String symbol, String interval) {
        List<Candle> candles = getCandles(symbol, interval);
        return candles.isEmpty() ? null : candles.get(candles.size() - 1);
    }
}

/**
 * WebSocket server for pushing market data to clients
 */
public class MarketDataWebSocketHandler {
    private final OHLCVService ohlcvService;
    private final OrderBook orderBook;

    // All connected clients
    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();

    // Client subscriptions: which symbols each client is interested in
    private final Map<String, Set<WebSocketSession>> symbolSubscriptions
        = new ConcurrentHashMap<>();

    public void handleSubscribe(String clientId, String symbol,
                               WebSocketSession session) {
        sessions.add(session);
        symbolSubscriptions
            .computeIfAbsent(symbol, k -> ConcurrentHashMap.newKeySet())
            .add(session);
    }

    public void handleUnsubscribe(String clientId, String symbol,
                                  WebSocketSession session) {
        Set<WebSocketSession> subscribers = symbolSubscriptions.get(symbol);
        if (subscribers != null) {
            subscribers.remove(session);
        }
    }

    /**
     * Called when a new trade happens in matching engine
     * Push price update to all subscribed clients
     */
    public void broadcastTrade(String symbol, BigDecimal price, long quantity,
                               long timestamp) {
        Set<WebSocketSession> subscribers = symbolSubscriptions.get(symbol);
        if (subscribers == null) return;

        // Build market data tick
        OrderBookSnapshot snapshot = orderBook.getSnapshot();
        String message = new JSONBuilder()
            .put("type", "PRICE_UPDATE")
            .put("symbol", symbol)
            .put("lastPrice", price)
            .put("lastQuantity", quantity)
            .put("timestamp", timestamp)
            .put("bid", snapshot.getBestBid())
            .put("ask", snapshot.getBestAsk())
            .put("spread", snapshot.getSpread())
            .build();

        // Send to all subscribed clients (non-blocking)
        subscribers.forEach(session -> {
            if (session.isOpen()) {
                session.sendMessageAsync(message);
            }
        });
    }
}
```

---

## Risk Management & Pre-Trade Checks

### Pre-Trade Risk Check Pipeline

Risk checks MUST happen BEFORE the order reaches the matching engine. If an order fails risk checks, it's rejected immediately without consuming matching engine capacity.

```
USER PLACES ORDER
       │
       ▼
┌─────────────────────────────────────────────────┐
│ RISK CHECK PIPELINE (Must complete in < 1ms)   │
├─────────────────────────────────────────────────┤
│ 1. DUPLICATE ORDER DETECTION                    │
│    - Check if user just placed same order       │
│    - Prevent accidental duplicate orders        │
│    - Window: last 1 second                      │
├─────────────────────────────────────────────────┤
│ 2. BALANCE CHECK                                │
│    - Buy order: user has sufficient cash?       │
│    - Sell order: user owns the shares?          │
│    - Account must have margin buffer            │
├─────────────────────────────────────────────────┤
│ 3. POSITION LIMIT CHECK                         │
│    - User cannot buy more than max position     │
│    - Example: max 100,000 shares of RELIANCE    │
│    - Prevent concentration risk                 │
├─────────────────────────────────────────────────┤
│ 4. PRICE BAND CHECK (Circuit Breaker)           │
│    - Stock can't move > 20% in a day            │
│    - Prevents flash crashes                     │
│    - Trading halt if violated                   │
├─────────────────────────────────────────────────┤
│ 5. FAT-FINGER CHECK (Sanity Checks)             │
│    - Price too high/low for this stock?         │
│    - Order size too large?                      │
│    - Example: Can't buy 1M shares when average  │
│      daily volume is 10K                        │
├─────────────────────────────────────────────────┤
│ 6. MARGIN REQUIREMENT CHECK                     │
│    - Short selling requires 150% margin         │
│    - Does user have enough margin?              │
└─────────────────────────────────────────────────┘
       │
       ├─ PASS ALL CHECKS ──▶ Send to Matching Engine
       │
       └─ FAIL ANY CHECK ──▶ REJECT ORDER (return error to user)
```

### Java: Risk Check Service

```java
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;

public class RiskCheckService {
    private final UserAccountService accountService;
    private final OrderBook orderBook;
    private final MarketDataService marketDataService;

    // Track recent orders per user (for duplicate detection)
    private final Map<String, Queue<Order>> recentOrdersByUser
        = new ConcurrentHashMap<>();

    // User position limits (configurable)
    private final Map<String, Map<String, Integer>> positionLimits
        = new ConcurrentHashMap<>();

    /**
     * Run all risk checks on incoming order
     * Returns: RiskCheckResult (APPROVED, REJECTED, or REVIEW_REQUIRED)
     */
    public RiskCheckResult checkOrder(Order order) {
        // Check 1: Duplicate detection
        RiskCheckResult dupResult = checkDuplicate(order);
        if (dupResult.status == RiskStatus.REJECTED) {
            return dupResult;
        }

        // Check 2: Balance check
        RiskCheckResult balanceResult = checkBalance(order);
        if (balanceResult.status == RiskStatus.REJECTED) {
            return balanceResult;
        }

        // Check 3: Position limit
        RiskCheckResult positionResult = checkPositionLimit(order);
        if (positionResult.status == RiskStatus.REJECTED) {
            return positionResult;
        }

        // Check 4: Price band (circuit breaker)
        RiskCheckResult priceBandResult = checkPriceBand(order);
        if (priceBandResult.status == RiskStatus.REJECTED) {
            return priceBandResult;
        }

        // Check 5: Fat-finger check
        RiskCheckResult fatFingerResult = checkFatFinger(order);
        if (fatFingerResult.status == RiskStatus.REJECTED) {
            return fatFingerResult;
        }

        // Check 6: Margin requirement
        RiskCheckResult marginResult = checkMarginRequirement(order);
        if (marginResult.status == RiskStatus.REJECTED) {
            return marginResult;
        }

        // All checks passed
        return new RiskCheckResult(RiskStatus.APPROVED, "All risk checks passed");
    }

    /**
     * Prevent accidental duplicate orders
     */
    private RiskCheckResult checkDuplicate(Order order) {
        Queue<Order> recentOrders = recentOrdersByUser
            .computeIfAbsent(order.getUserId(), k -> new ConcurrentLinkedQueue<>());

        long now = System.currentTimeMillis();
        long oneSecondAgo = now - 1_000;

        // Remove orders older than 1 second
        recentOrders.removeIf(o -> o.getTimestamp() < oneSecondAgo);

        // Check if same order placed in last 1 second
        for (Order recent : recentOrders) {
            if (recent.getSymbol().equals(order.getSymbol()) &&
                recent.getSide() == order.getSide() &&
                recent.getQuantityRequested() == order.getQuantityRequested() &&
                Math.abs(recent.getPrice() - order.getPrice()) < 0.01) {

                return new RiskCheckResult(RiskStatus.REJECTED,
                    "Duplicate order detected within last 1 second");
            }
        }

        recentOrders.add(order);
        return new RiskCheckResult(RiskStatus.APPROVED, "No duplicate detected");
    }

    /**
     * Check if user has sufficient balance to place order
     */
    private RiskCheckResult checkBalance(Order order) {
        UserAccount account = accountService.getAccount(order.getUserId());

        if (order.getSide() == OrderSide.BUY) {
            // Buy order: need cash
            // Cost = price × quantity (with 10% margin buffer)
            BigDecimal orderCost = BigDecimal.valueOf(order.getPrice())
                .multiply(BigDecimal.valueOf(order.getQuantityRequested()))
                .multiply(BigDecimal.valueOf(1.1));  // 10% safety margin

            if (account.getCashBalance().compareTo(orderCost) < 0) {
                return new RiskCheckResult(RiskStatus.REJECTED,
                    String.format("Insufficient balance. Need: %s, Have: %s",
                        orderCost, account.getCashBalance()));
            }
        } else {
            // Sell order: need shares
            int currentPosition = account.getPosition(order.getSymbol());
            if (currentPosition < order.getQuantityRequested()) {
                return new RiskCheckResult(RiskStatus.REJECTED,
                    String.format("Insufficient shares. Need: %d, Have: %d",
                        order.getQuantityRequested(), currentPosition));
            }
        }

        return new RiskCheckResult(RiskStatus.APPROVED, "Sufficient balance");
    }

    /**
     * Check position limits (regulatory requirement)
     */
    private RiskCheckResult checkPositionLimit(Order order) {
        Map<String, Integer> userLimits = positionLimits
            .getOrDefault(order.getUserId(), new HashMap<>());

        int maxPosition = userLimits.getOrDefault(order.getSymbol(), 100_000);

        UserAccount account = accountService.getAccount(order.getUserId());
        int currentPosition = account.getPosition(order.getSymbol());

        if (order.getSide() == OrderSide.BUY) {
            if (currentPosition + order.getQuantityRequested() > maxPosition) {
                return new RiskCheckResult(RiskStatus.REJECTED,
                    String.format("Position limit exceeded. Max: %d, Current: %d, " +
                        "Would be: %d",
                        maxPosition, currentPosition,
                        currentPosition + order.getQuantityRequested()));
            }
        }

        return new RiskCheckResult(RiskStatus.APPROVED, "Within position limits");
    }

    /**
     * Circuit breaker: prevent trading at extreme prices
     */
    private RiskCheckResult checkPriceBand(Order order) {
        MarketData marketData = marketDataService.getMarketData(order.getSymbol());

        // Get 52-week high/low
        BigDecimal low52Week = marketData.getLow52Week();
        BigDecimal high52Week = marketData.getHigh52Week();

        // 20% circuit breaker bands
        BigDecimal upperBand = high52Week.multiply(BigDecimal.valueOf(1.20));
        BigDecimal lowerBand = low52Week.multiply(BigDecimal.valueOf(0.80));

        BigDecimal orderPrice = BigDecimal.valueOf(order.getPrice());

        if (orderPrice.compareTo(lowerBand) < 0 ||
            orderPrice.compareTo(upperBand) > 0) {

            return new RiskCheckResult(RiskStatus.REJECTED,
                String.format("Price outside circuit breaker bands. " +
                    "Lower: %s, Upper: %s, Order: %s",
                    lowerBand, upperBand, orderPrice));
        }

        return new RiskCheckResult(RiskStatus.APPROVED, "Price within circuit breaker bands");
    }

    /**
     * Fat-finger check: prevent obviously wrong orders
     */
    private RiskCheckResult checkFatFinger(Order order) {
        MarketData marketData = marketDataService.getMarketData(order.getSymbol());
        long avgDailyVolume = marketData.getAverageDailyVolume();

        // Order size > 10x average daily volume = suspicious
        if (order.getQuantityRequested() > avgDailyVolume * 10) {
            return new RiskCheckResult(RiskStatus.REVIEW_REQUIRED,
                String.format("Unusually large order. Avg daily volume: %d, " +
                    "Order size: %d",
                    avgDailyVolume, order.getQuantityRequested()));
        }

        // Price > 50% away from last trade = suspicious
        BigDecimal lastPrice = marketData.getLastTradePrice();
        BigDecimal orderPrice = BigDecimal.valueOf(order.getPrice());

        double priceDiff = Math.abs(
            orderPrice.subtract(lastPrice).doubleValue() /
            lastPrice.doubleValue()
        );

        if (priceDiff > 0.50) {
            return new RiskCheckResult(RiskStatus.REVIEW_REQUIRED,
                String.format("Price significantly different from last trade. " +
                    "Last: %s, Order: %s (%.2f%% diff)",
                    lastPrice, orderPrice, priceDiff * 100));
        }

        return new RiskCheckResult(RiskStatus.APPROVED, "Fat-finger checks passed");
    }

    /**
     * Margin requirement: short selling requires more capital
     */
    private RiskCheckResult checkMarginRequirement(Order order) {
        if (order.getSide() == OrderSide.SELL) {
            // Check if this is a short sell (selling more than they own)
            UserAccount account = accountService.getAccount(order.getUserId());
            int currentPosition = account.getPosition(order.getSymbol());

            if (order.getQuantityRequested() > currentPosition) {
                // Short selling: need 150% of order value as margin
                BigDecimal marginRequired = BigDecimal
                    .valueOf(order.getPrice())
                    .multiply(BigDecimal.valueOf(
                        order.getQuantityRequested() - currentPosition))
                    .multiply(BigDecimal.valueOf(1.50));

                BigDecimal availableMargin = account.getAvailableMargin();

                if (availableMargin.compareTo(marginRequired) < 0) {
                    return new RiskCheckResult(RiskStatus.REJECTED,
                        String.format("Insufficient margin for short selling. " +
                            "Required: %s, Available: %s",
                            marginRequired, availableMargin));
                }
            }
        }

        return new RiskCheckResult(RiskStatus.APPROVED, "Margin requirements met");
    }

    public enum RiskStatus {
        APPROVED,
        REJECTED,
        REVIEW_REQUIRED
    }

    public static class RiskCheckResult {
        public final RiskStatus status;
        public final String reason;

        public RiskCheckResult(RiskStatus status, String reason) {
            this.status = status;
            this.reason = reason;
        }
    }
}
```

---

## Low-Latency Architecture

### The Latency Problem

```
TRADING: Every 1ms of latency = Lost opportunities

Example: Stock goes from 2500 to 2505 (0.2% move)
A hedge fund with 100ms latency:
- By the time they see the price, 1000+ other trades happened
- Their 0.2% profit opportunity disappears
- They might be forced to trade at 2504.50 instead of 2500

A firm with 1ms latency:
- Sees the opportunity first
- Executes before market adjusts
- Captures the full 0.2% profit

Latency budget for order-to-execution: 10ms (p99)
This includes:
- API → Order Service: 0.5ms
- Risk checks: 1ms
- Matching engine: 0.5ms (p99)
- Response back to client: 0.5ms
- Buffer: 7.5ms (for unexpected spikes)
```

### Sub-10ms Latency Techniques

#### 1. Single-Threaded Matching (Already Covered)
- No locks = no contention
- No context switches = cache stays warm
- Throughput: 100K orders/second per symbol

#### 2. Object Pooling (Pre-allocated Memory)

```java
/**
 * Object pooling: avoid GC pauses
 * GC pause = 10-100ms latency spike = catastrophic for trading
 */
public class OrderObjectPool {
    private final BlockingQueue<OrderObject> pool;
    private final int maxSize;

    public OrderObjectPool(int size) {
        this.maxSize = size;
        this.pool = new LinkedBlockingQueue<>(size);

        // Pre-allocate all objects at startup
        for (int i = 0; i < size; i++) {
            pool.add(new OrderObject());
        }

        System.out.println(String.format(
            "OrderObjectPool initialized with %d objects (%.1f MB)",
            size,
            (size * 200.0) / (1024 * 1024)
        ));
    }

    public OrderObject acquire() throws InterruptedException {
        OrderObject obj = pool.take();  // BLOCKING if pool is empty
        return obj;
    }

    public void release(OrderObject obj) {
        obj.reset();  // Clear state
        pool.add(obj);
    }
}

/**
 * Memory-mapped files for persistent order log
 * No disk I/O latency, all I/O is through memory
 */
public class MemoryMappedOrderLog {
    private final FileChannel channel;
    private final MappedByteBuffer buffer;
    private volatile int writePosition = 0;

    public MemoryMappedOrderLog(String path, long sizeBytes) throws IOException {
        RandomAccessFile file = new RandomAccessFile(path, "rw");
        this.channel = file.getChannel();
        this.buffer = channel.map(FileChannel.MapMode.READ_WRITE, 0, sizeBytes);
    }

    /**
     * Append order to log (in-memory, very fast)
     * OS handles actual disk writes asynchronously
     */
    public void appendOrder(byte[] orderBytes) {
        if (writePosition + orderBytes.length > buffer.capacity()) {
            throw new RuntimeException("Memory-mapped buffer full");
        }

        buffer.position(writePosition);
        buffer.put(orderBytes);
        writePosition += orderBytes.length;

        // Force write to disk
        buffer.force();
    }

    /**
     * Recover all orders from log
     * Used when system restarts
     */
    public List<byte[]> recover() {
        List<byte[]> orders = new ArrayList<>();

        buffer.rewind();
        while (buffer.hasRemaining()) {
            int length = buffer.getInt();
            byte[] orderBytes = new byte[length];
            buffer.get(orderBytes);
            orders.add(orderBytes);
        }

        return orders;
    }
}
```

#### 3. LMAX Disruptor: Lock-Free Ring Buffer

```java
/**
 * LMAX Disruptor pattern: ultra-fast inter-thread communication
 * Used in: MatchingEngine → Settlement Service
 *
 * Why it's fast:
 * - No locks (wait-free data structure)
 * - Mechanical sympathy (CPU cache-friendly)
 * - Predictable latency (no GC pauses)
 */
public class DisruptorRingBuffer {
    private final int bufferSize;
    private final Trade[] trades;
    private volatile long writeIndex = 0;
    private volatile long readIndex = 0;

    public DisruptorRingBuffer(int size) {
        this.bufferSize = size;
        this.trades = new Trade[size];

        // Pre-allocate all Trade objects
        for (int i = 0; i < size; i++) {
            trades[i] = new Trade();
        }
    }

    /**
     * Publishing thread writes trade to ring buffer (lock-free)
     */
    public void publishTrade(String symbol, long quantity,
                             BigDecimal price, long timestamp) {
        long nextIndex = writeIndex;

        // Check if buffer is full (would overwrite unread data)
        if (nextIndex - readIndex >= bufferSize) {
            throw new RuntimeException("Ring buffer full");
        }

        // Place trade in buffer (lock-free write)
        Trade trade = trades[(int) (nextIndex % bufferSize)];
        trade.symbol = symbol;
        trade.quantity = quantity;
        trade.price = price;
        trade.timestamp = timestamp;

        writeIndex++;  // Volatile write signals new data
    }

    /**
     * Subscriber thread reads trades (lock-free)
     */
    public Trade[] readTrades() {
        if (readIndex >= writeIndex) {
            return new Trade[0];  // No new data
        }

        long available = writeIndex - readIndex;
        Trade[] batch = new Trade[(int) available];

        for (int i = 0; i < available; i++) {
            batch[i] = trades[(int) ((readIndex + i) % bufferSize)];
        }

        readIndex += available;
        return batch;
    }

    public static class Trade {
        public String symbol;
        public long quantity;
        public BigDecimal price;
        public long timestamp;
    }
}

/**
 * Main matching engine using Disruptor pattern
     */
public class LowLatencyMatchingEngine {
    private final DisruptorRingBuffer tradeBuffer;
    private final ExecutorService executor;

    public LowLatencyMatchingEngine() {
        this.tradeBuffer = new DisruptorRingBuffer(1_000_000);  // 1M slot buffer
        this.executor = Executors.newFixedThreadPool(4);

        // Start settlement service consumer
        executor.submit(this::settlementServiceLoop);

        // Pin threads to CPU cores (maximize cache locality)
        // This requires JNI on most JVMs
    }

    /**
     * Settlement service: reads trades asynchronously from ring buffer
     */
    private void settlementServiceLoop() {
        while (true) {
            DisruptorRingBuffer.Trade[] trades = tradeBuffer.readTrades();
            if (trades.length == 0) {
                // Spin-wait (busy loop, ultra-low latency)
                continue;
            }

            for (DisruptorRingBuffer.Trade trade : trades) {
                // Process settlement (doesn't block matching engine)
                processSettlement(trade);
            }
        }
    }

    private void processSettlement(DisruptorRingBuffer.Trade trade) {
        // TODO: settle trade asynchronously
    }
}
```

#### 4. JVM Tuning for Low-Latency

```bash
# JVM flags for sub-10ms latency trading systems

# Use ZGC (sub-1ms pause times) or Shenandoah GC
-XX:+UseZGC
# OR
-XX:-UseG1GC -XX:+UseShenandoahGC

# Pre-touch all heap pages to prevent page faults
-XX:+AlwaysPreTouch

# Use huge pages (2MB pages instead of 4KB)
-XX:+UseHugeTLBPages

# Disable biased locking (causes pause times)
-XX:-UseBiasedLocking

# Disable adaptive compilation (causes pauses)
-XX:TieredStopAtLevel=4

# Lock memory pages in RAM (prevent swapping)
-XX:+AlwaysPreTouch

# CPU binding: pin matching engine to specific cores
export JAVA_OPTS="$JAVA_OPTS -XX:+UseNUMA -XX:+UnlockDiagnosticVMOptions -XX:GuaranteedSafepointInterval=0"

# Example startup script for matching engine:
java -server \
  -XX:+UseZGC \
  -XX:+AlwaysPreTouch \
  -XX:+UseHugeTLBPages \
  -XX:-UseBiasedLocking \
  -Xms30G \
  -Xmx30G \
  -XX:ZUncommitDelay=300 \
  com.trading.MatchingEngineMain
```

#### 5. Kernel Bypass Networking (DPDK/Solarflare)

For truly extreme latency requirements (< 1ms), some firms use:

```
Traditional TCP/IP Stack:
┌──────────────┐
│ Application  │
├──────────────┤
│  Java/JVM    │
├──────────────┤
│ TCP/IP Stack │ (Kernel mode, context switch)
├──────────────┤
│ NIC Driver   │
├──────────────┤
│ Network Card │
└──────────────┘
Latency: 10-100μs (microseconds)

Kernel Bypass (DPDK):
┌──────────────┐
│ Application  │ (Userspace, no context switch)
├──────────────┤
│  Java/JVM    │
├──────────────┤
│ DPDK Library │ (Userspace networking)
├──────────────┤
│ Network Card │
└──────────────┘
Latency: 1-10μs (microseconds)

Cost: Expensive hardware + complex configuration
Benefit: For HFT firms, can be worth millions in extra profits
```

---

## Settlement & Clearing

### T+1 Settlement Cycle

```
DAY 1 (Trade Date):
9:30 AM    User buys 100 shares @ 2500
           → Matching engine matches the trade instantly
           → User's order status: FILLED
           → User sees 100 shares in portfolio (but not yet owned)

5:00 PM    Market closes
           → All trades from today go to settlement queue

DAY 2 (Settlement Date T+1):
EOD        Settlement batch job runs:
           1. Netting: aggregate all buys/sells per user
           2. Calculate net cash/shares to transfer
           3. Transfer shares to buyer's account
           4. Transfer cash from buyer to seller
           5. Update depository records
           6. Audit trail verification

AFTER EOD  Settlement complete
           → Shares are now officially in buyer's account
           → Cash is officially in seller's account
           → Both users' net worth updated
```

### Settlement Service Architecture

```java
/**
 * Settlement service: asynchronous, batch-based
 * Consumes trades from Kafka, processes T+1 settlement
 */
public class SettlementService {
    private final KafkaConsumer<String, Trade> tradeConsumer;
    private final PostgresConnection db;
    private final DepositoryAPI depositoryAPI;

    // Batch trades by date
    private final Map<LocalDate, List<Trade>> tradesBySettlementDate
        = new ConcurrentHashMap<>();

    public void start() {
        // Run settlement at EOD (4:30 PM)
        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);

        scheduler.scheduleDaily(
            LocalTime.of(16, 30),  // 4:30 PM
            this::processDailySettlement
        );

        // Consume trades from Kafka
        consumeTradesFromKafka();
    }

    private void processDailySettlement() {
        LocalDate settlementDate = LocalDate.now().plusDays(1);
        List<Trade> trades = tradesBySettlementDate.get(settlementDate);

        if (trades == null || trades.isEmpty()) {
            System.out.println("No trades to settle for " + settlementDate);
            return;
        }

        System.out.println("Starting settlement for " +
            trades.size() + " trades on " + settlementDate);

        try {
            // Step 1: Netting
            Map<String, NetPosition> netPositions = nettingEngine(trades);

            // Step 2: Validation
            validateNetPositions(netPositions);

            // Step 3: Execute settlement
            for (Map.Entry<String, NetPosition> entry : netPositions.entrySet()) {
                String userId = entry.getKey();
                NetPosition position = entry.getValue();

                settleUser(userId, position);
            }

            // Step 4: Update depository
            depositoryAPI.updateSecuritiesCustody(netPositions);

            // Step 5: Create audit trail
            createSettlementAuditTrail(trades, netPositions);

            System.out.println("Settlement completed successfully");

        } catch (Exception e) {
            System.err.println("Settlement failed: " + e.getMessage());
            // Alert ops team, don't lose trades
            alertOperations(e);
        }
    }

    /**
     * Netting: combine all buys and sells to reduce transfers
     * Example:
     * - User A: bought 100 shares at 2500, sold 50 shares at 2505
     * - Net position: +50 shares bought, cash outflow = 100*2500 - 50*2505 = ~77,725
     */
    private Map<String, NetPosition> nettingEngine(List<Trade> trades) {
        Map<String, Map<String, PositionData>> userSymbolPositions
            = new HashMap<>();

        for (Trade trade : trades) {
            // Buyer side
            userSymbolPositions
                .computeIfAbsent(trade.buyerId, k -> new HashMap<>())
                .computeIfAbsent(trade.symbol, k -> new PositionData())
                .addBuy(trade.quantity, trade.price);

            // Seller side
            userSymbolPositions
                .computeIfAbsent(trade.sellerId, k -> new HashMap<>())
                .computeIfAbsent(trade.symbol, k -> new PositionData())
                .addSell(trade.quantity, trade.price);
        }

        // Convert to net positions
        Map<String, NetPosition> netPositions = new HashMap<>();
        for (Map.Entry<String, Map<String, PositionData>> userEntry :
             userSymbolPositions.entrySet()) {

            String userId = userEntry.getKey();
            Map<String, PositionData> positions = userEntry.getValue();

            NetPosition netPos = new NetPosition(userId);
            for (Map.Entry<String, PositionData> posEntry : positions.entrySet()) {
                String symbol = posEntry.getKey();
                PositionData pos = posEntry.getValue();

                netPos.addSymbolPosition(symbol,
                    pos.netQuantity,      // +100 or -50 etc
                    pos.netCashFlow);     // Total cash in/out
            }

            netPositions.put(userId, netPos);
        }

        return netPositions;
    }

    private void settleUser(String userId, NetPosition position) {
        // Update user's holdings in database
        for (Map.Entry<String, Integer> holding : position.getSymbolHoldings().entrySet()) {
            String symbol = holding.getKey();
            int quantityChange = holding.getValue();

            db.updateUserPosition(userId, symbol, quantityChange);
        }

        // Update user's cash balance
        db.updateUserCash(userId, position.getCashFlowNet());
    }

    static class PositionData {
        int buyQuantity = 0;
        double buyCost = 0;
        int sellQuantity = 0;
        double sellProceeds = 0;

        int netQuantity;
        double netCashFlow;

        void addBuy(int quantity, double price) {
            buyQuantity += quantity;
            buyCost += quantity * price;
        }

        void addSell(int quantity, double price) {
            sellQuantity += quantity;
            sellProceeds += quantity * price;
        }

        void calculateNet() {
            netQuantity = buyQuantity - sellQuantity;
            netCashFlow = sellProceeds - buyCost;  // Positive = cash in
        }
    }

    static class NetPosition {
        String userId;
        Map<String, Integer> symbolHoldings = new HashMap<>();
        double cashFlowNet = 0;

        NetPosition(String userId) {
            this.userId = userId;
        }

        void addSymbolPosition(String symbol, int quantity, double cashFlow) {
            symbolHoldings.put(symbol, quantity);
            cashFlowNet += cashFlow;
        }

        Map<String, Integer> getSymbolHoldings() {
            return symbolHoldings;
        }

        double getCashFlowNet() {
            return cashFlowNet;
        }
    }
}
```

---

## Database & Storage Design

### Data Tiers & Retention

```
HOT TIER (Last 24 hours):
├─ Orders (in-memory + Redis)
├─ Active positions (in-memory)
└─ Recent trades (PostgreSQL)

WARM TIER (Last 3 months):
├─ All completed trades (PostgreSQL)
├─ Daily positions (PostgreSQL)
└─ OHLCV candles (TimescaleDB)

COLD TIER (1-7 years):
├─ Full audit trail (S3 + Glacier)
├─ Regulatory filings (S3)
└─ Historical market data (S3 Parquet)
```

### PostgreSQL Schema

```sql
-- Users and Accounts
CREATE TABLE users (
    user_id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    kyc_status VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE accounts (
    account_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users,
    cash_balance NUMERIC(20, 2) NOT NULL,
    available_margin NUMERIC(20, 2) NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Orders
CREATE TABLE orders (
    order_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users,
    symbol VARCHAR(10) NOT NULL,
    side VARCHAR(10) NOT NULL,  -- BUY or SELL
    order_type VARCHAR(50) NOT NULL,  -- MARKET, LIMIT, etc
    price NUMERIC(10, 4),
    quantity INT NOT NULL,
    filled_quantity INT DEFAULT 0,
    status VARCHAR(50) NOT NULL,  -- NEW, ACCEPTED, FILLED, CANCELLED
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,

    INDEX idx_user_symbol (user_id, symbol),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at DESC)
);

-- Trades (Matches)
CREATE TABLE trades (
    trade_id UUID PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    buyer_id UUID NOT NULL REFERENCES users,
    seller_id UUID NOT NULL REFERENCES users,
    quantity INT NOT NULL,
    price NUMERIC(10, 4) NOT NULL,
    trade_timestamp TIMESTAMP NOT NULL,
    trade_value NUMERIC(20, 2) GENERATED ALWAYS AS (quantity * price),

    INDEX idx_symbol_time (symbol, trade_timestamp DESC),
    INDEX idx_buyer (buyer_id),
    INDEX idx_seller (seller_id)
);

-- Current Positions
CREATE TABLE positions (
    position_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users,
    symbol VARCHAR(10) NOT NULL,
    quantity INT NOT NULL,
    average_cost NUMERIC(10, 4),
    current_value NUMERIC(20, 2),
    unrealized_pnl NUMERIC(20, 2),
    updated_at TIMESTAMP,

    UNIQUE (user_id, symbol),
    INDEX idx_user_symbol (user_id, symbol)
);

-- Trades History
CREATE TABLE trade_history (
    trade_id UUID PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    buyer_id UUID NOT NULL,
    seller_id UUID NOT NULL,
    quantity INT NOT NULL,
    price NUMERIC(10, 4) NOT NULL,
    trade_timestamp TIMESTAMP NOT NULL,
    settlement_date DATE NOT NULL,

    INDEX idx_user_symbol (buyer_id, symbol, trade_timestamp),
    INDEX idx_settlement_date (settlement_date)
) PARTITION BY RANGE (settlement_date) (
    -- Partition by month
    PARTITION p_2026_01 VALUES LESS THAN ('2026-02-01'),
    PARTITION p_2026_02 VALUES LESS THAN ('2026-03-01')
);
```

### TimescaleDB for Time-Series Data

```sql
-- Create hypertable for OHLCV candles
CREATE TABLE IF NOT EXISTS ohlcv_1min (
    time TIMESTAMP NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    open NUMERIC(10, 4),
    high NUMERIC(10, 4),
    low NUMERIC(10, 4),
    close NUMERIC(10, 4),
    volume BIGINT,

    PRIMARY KEY (symbol, time DESC)
);

SELECT create_hypertable('ohlcv_1min', 'time', if_not_exists => TRUE);

-- Create continuous aggregate for 5-min candles
CREATE MATERIALIZED VIEW ohlcv_5min WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS time,
    symbol,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume
FROM ohlcv_1min
GROUP BY 1, 2;

-- Index for fast queries
CREATE INDEX idx_ohlcv_symbol_time ON ohlcv_1min (symbol, time DESC);
```

### Write-Ahead Log (WAL) for Matching Engine Recovery

```java
/**
 * WAL ensures matching engine can recover after crash
 * Every order is written to WAL before matching
 * On restart, replay WAL to restore order book state
 */
public class WALManager {
    private final RandomAccessFile walFile;
    private final MappedByteBuffer buffer;

    public WALManager(String walPath) throws IOException {
        this.walFile = new RandomAccessFile(walPath, "rw");
        // 1GB WAL file
        this.buffer = walFile.getChannel()
            .map(FileChannel.MapMode.READ_WRITE, 0, 1_000_000_000L);
    }

    /**
     * Write order to WAL before it's matched
     */
    public void writeOrderToWAL(Order order) throws IOException {
        byte[] serialized = serializeOrder(order);

        // Write: [length][data]
        buffer.putInt(serialized.length);
        buffer.put(serialized);

        // Force to disk
        buffer.force();
    }

    /**
     * Replay WAL on startup to restore order book
     */
    public List<Order> replayWAL() throws IOException {
        List<Order> orders = new ArrayList<>();

        buffer.rewind();
        while (buffer.hasRemaining() && buffer.remaining() >= 4) {
            int length = buffer.getInt();
            if (length == 0) break;  // EOF

            byte[] data = new byte[length];
            buffer.get(data);

            Order order = deserializeOrder(data);
            orders.add(order);
        }

        System.out.println("Replayed " + orders.size() + " orders from WAL");
        return orders;
    }

    private byte[] serializeOrder(Order order) {
        // Simple serialization
        ByteBuffer bb = ByteBuffer.allocate(1024);
        bb.putLong(order.getTimestamp());
        bb.put(order.getOrderId().getBytes());
        bb.put((byte) order.getSide().ordinal());
        bb.putInt(order.getQuantityRequested());
        bb.putDouble(order.getPrice());
        // ... more fields
        return bb.array();
    }

    private Order deserializeOrder(byte[] data) {
        ByteBuffer bb = ByteBuffer.wrap(data);
        long timestamp = bb.getLong();
        // ... deserialize fields
        return new Order();  // placeholder
    }
}
```

---

## Scaling & Fault Tolerance

### Symbol-Based Partitioning

```
SCALING STRATEGY: Partition matching engines by symbol

Before (single matching engine):
┌────────────────────────────────┐
│ Matching Engine (All symbols)  │
│ - RELIANCE orders              │
│ - TCS orders                   │
│ - INFY orders                  │
│ - ... 4,000 more symbols       │
│                                │
│ Single-threaded: 100K ord/sec  │
└────────────────────────────────┘

Problem: Can't scale beyond 100K orders/sec aggregate

After (partitioned by symbol):
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Engine 1        │  │ Engine 2        │  │ Engine 3        │
│ RELIANCE orders │  │ TCS orders      │  │ INFY orders     │
│                 │  │                 │  │                 │
│ 100K ord/sec    │  │ 100K ord/sec    │  │ 100K ord/sec    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
        │                    │                     │
        └────────┬───────────┴──────────┬──────────┘
                 │                      │
        ┌────────▼──────────────────────▼────────┐
        │  Aggregate throughput: 300K+ ord/sec   │
        │  (Can scale to 10+ engines)            │
        └────────────────────────────────────────┘

Each engine:
- Single-threaded (no locks)
- Own order book (no shared state)
- Separate thread (runs on dedicated CPU core)
- Can be on different machines

Horizontal scaling: Add more servers for more symbols
```

### High Availability: Active-Passive Failover

```
PRODUCTION SETUP:
┌─────────────────────────────────────────────────────┐
│ PRIMARY DATA CENTER (Active)                        │
│                                                     │
│ ┌──────────────────────────────────┐              │
│ │ Matching Engine (RELIANCE)       │              │
│ │ - Processes orders               │              │
│ │ - Generates trades               │              │
│ │ - Streams WAL to Kafka           │              │
│ └──────────────────────────────────┘              │
│              │                                     │
│              ▼ (Async replication)                │
│         ┌─────────────┐                          │
│         │ Kafka Topic │                          │
│         │ "wal-reliance"                        │
│         └─────────────┘                          │
└─────────────────────────────────────────────────────┘
              │
              │ (Real-time sync across data centers)
              ▼
┌─────────────────────────────────────────────────────┐
│ STANDBY DATA CENTER (Passive)                       │
│                                                     │
│ ┌──────────────────────────────────┐              │
│ │ Matching Engine (RELIANCE)       │              │
│ │ - Replaying WAL in real-time     │              │
│ │ - Maintains exact copy of        │              │
│ │   primary's order book           │              │
│ │ - NOT processing new orders      │              │
│ └──────────────────────────────────┘              │
│                                                     │
│ Status: WARM STANDBY (can take over in < 1 sec)  │
└─────────────────────────────────────────────────────┘

FAILOVER SCENARIO:
Primary fails → Standby detects (no heartbeat for 100ms)
              → Takes over immediately
              → Starts accepting orders
              → Lost orders: ~0-100ms worth
              → Recovered by using WAL
```

### Failover Implementation

```java
public class MatchingEngineCluster {
    private final String symbol;
    private final MatchingEngine primary;
    private final MatchingEngine standby;
    private final KafkaProducer<String, byte[]> walProducer;
    private final ZooKeeperLeaderElection leaderElection;

    private volatile boolean isPrimary = true;
    private final AtomicReference<MatchingEngine> activeEngine;

    public MatchingEngineCluster(String symbol) throws Exception {
        this.symbol = symbol;
        this.primary = new MatchingEngine(symbol);
        this.standby = new MatchingEngine(symbol);
        this.walProducer = createKafkaProducer();
        this.leaderElection = new ZooKeeperLeaderElection(symbol);
        this.activeEngine = new AtomicReference<>(primary);

        // Start leader election
        startLeaderElection();

        // Start health check
        startHealthCheck();
    }

    private void startLeaderElection() throws Exception {
        // Use ZooKeeper to elect primary
        leaderElection.registerCandidate("primary-" + symbol, () -> {
            isPrimary = true;
            activeEngine.set(primary);
            System.out.println(symbol + " is now PRIMARY");
            startAcceptingOrders(primary);
        }, () -> {
            isPrimary = false;
            activeEngine.set(standby);
            System.out.println(symbol + " is now STANDBY");
            startReplayingWAL(standby);
        });
    }

    private void startHealthCheck() {
        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);

        scheduler.scheduleAtFixedRate(() -> {
            if (isPrimary && !isPrimaryHealthy()) {
                System.err.println("Primary health check FAILED");
                // Resign leadership, let standby take over
                leaderElection.resign();
            }
        }, 100, 100, TimeUnit.MILLISECONDS);
    }

    public void matchOrder(Order order) throws Exception {
        // Route order to currently active engine
        MatchingEngine engine = activeEngine.get();

        List<Trade> trades = engine.matchOrder(order);

        if (isPrimary) {
            // Primary: write WAL for standby to replay
            writeToWAL(order, trades);
        }

        // Return trades to client
        for (Trade trade : trades) {
            notifyClients(trade);
        }
    }

    private void writeToWAL(Order order, List<Trade> trades) {
        String key = symbol + "-" + System.nanoTime();
        byte[] value = serializeOrderAndTrades(order, trades);

        walProducer.send(new ProducerRecord<>(
            "wal-" + symbol,
            key,
            value
        ));
    }

    private void startReplayingWAL(MatchingEngine engine) {
        KafkaConsumer<String, byte[]> consumer = createKafkaConsumer();
        consumer.subscribe(Arrays.asList("wal-" + symbol));

        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.submit(() -> {
            while (true) {
                ConsumerRecords<String, byte[]> records = consumer.poll(100);

                for (ConsumerRecord<String, byte[]> record : records) {
                    Tuple2<Order, List<Trade>> orderAndTrades =
                        deserializeOrderAndTrades(record.value());

                    // Replay in standby engine
                    engine.replayOrder(orderAndTrades.t1, orderAndTrades.t2);
                }
            }
        });
    }

    private boolean isPrimaryHealthy() {
        // Check if primary is still responsive
        return primary.isHealthy();
    }
}
```

---

## Senior vs Mid-Level Comparison

| Aspect | Mid-Level (Your Goal) | Senior Engineer |
|--------|----------------------|-----------------|
| **Order Matching Engine** | Understands TreeMap + LinkedList, can implement basic matching | Optimizes for cache locality, understands mechanical sympathy, considers LMAX Disruptor |
| **Latency Analysis** | Knows single-threaded is faster than multi-threaded (why?) | Calculates exact latency: L1 cache hit = 4ns, memory hit = 100ns, disk = 100μs |
| **Scaling** | Proposes symbol-based partitioning | Proposes symbol-based + hash-based partitioning on user ID for portfolio service |
| **Fault Tolerance** | Active-passive failover with WAL | Active-passive + cross-datacenter geo-replication, Byzantine fault tolerance |
| **Database Design** | PostgreSQL for ACID, TimescaleDB for OHLCV | Proposes immutable event log (event sourcing), snapshots every 1000 events |
| **Risk Management** | Lists all risk checks | Proposes machine learning for anomaly detection, circuit breaker patterns |
| **Interview Confidence** | "I know HOW to build it" | "I can EXPLAIN WHY each piece exists and trade-offs" |

Your goal: Move from "how" to "why and trade-offs"

---

## Interview Follow-Up Questions & Answers

### Q1: "How do you handle a flash crash?"

**Situation:** Market drops 10% in 1 second due to algorithm gone wrong.

**Mid-Level Answer:**
"We have circuit breakers. We stop trading when price moves > 20% in a day."

**Senior Answer:**
"Circuit breakers happen at multiple levels:

1. **Order-level (10ms):** Fat-finger check rejects orders >50% away from last trade
2. **Stock-level (1 second):** Trading halt if stock moves >5% in 1 second
3. **Market-level (1 minute):** Exchange-wide trading halt if index drops >7%

But flash crashes are caused by correlation cascades:
- Fund A sells → price drops → Fund B's stop-loss triggers
- Fund B sells → price drops more → Fund C's stop-loss triggers
- Cascade continues until market finds equilibrium

Our defenses:
- Sliding windows (price band is dynamic, not fixed 20%)
- Mandatory minimum quotes (market makers must provide liquidity at all times)
- Order-to-cancel ratio limits (can't spam orders then cancel)
- Volume-weighted average price (VWAP) orders for algo traders
- Trading halts with 'cooling off' period (5 minutes no trading to reset)"

---

### Q2: "Why is single-threaded matching faster than multi-threaded?"

**Common Wrong Answer:**
"Because there's no lock contention, so no waiting."

**Correct Answer:**
"It's not just about locks. It's about CPU cache locality and mechanical sympathy:

With multi-threaded matching:
```
Thread 1: Reads price level 2500
          - Data loaded into L1 cache (4 cycles)
          - Acquires lock
          - Finds matching order
          → Context switch (1,000 cycles to save/restore state)

Thread 2: Wakes up
          - Data NOT in L1 cache anymore
          - Cache miss (100+ cycles to fetch from main memory)
          - Acquires lock
          - Processes order
          → Context switch

Total latency = 4 + 1000 + 100 + lock overhead = 1,100+ CPU cycles
```

With single-threaded matching:
```
Order 1: Reads price level 2500
         - Data loaded into L1 cache (4 cycles)
         - Finds matching order
         - Processes immediately

Order 2: Wakes up
         - Data STILL in L1 cache (4 cycles)
         - Finds matching order
         - Processes immediately

Total latency = 4 + 4 = 8 CPU cycles
```

**Why the difference?**
- CPU prefetcher optimizes cache hits
- No context switches = warm cache
- No lock acquisitions = no atomic operations (which flush cache)
- Branch prediction stays warm

This is 100-1000x latency difference in practice!"

---

### Q3: "How would you add iceberg orders to the matching engine?"

**Iceberg Order:** Large order (e.g., buy 1 million shares) but only shows 10,000 shares at a time. When the first 10,000 fill, the next 10,000 appears.

```java
public class IcebergOrder implements Order {
    private final String orderId;
    private final int totalQuantity;      // 1,000,000 shares
    private final int visibleQuantity;    // 10,000 shares (what shows in order book)
    private int quantityFilled = 0;

    /**
     * Only the visible quantity is added to order book
     * The rest is hidden
     */
    public void addToOrderBook(OrderBook book) {
        Order visibleOrder = new LimitOrder(
            orderId,
            symbol,
            side,
            visibleQuantity,
            priceLimit,
            timestamp,
            userId
        );

        book.addOrder(visibleOrder);
    }

    /**
     * When visible order fills, reveal next batch
     */
    public void onPartialFill(int filledQuantity) {
        quantityFilled += filledQuantity;

        if (quantityFilled < totalQuantity) {
            // Reveal next batch
            int remainingVisible = totalQuantity - quantityFilled;
            int nextVisibleQty = Math.min(visibleQuantity, remainingVisible);

            // Create new order for next batch
            Order nextBatch = new LimitOrder(
                orderId + "_" + (quantityFilled / visibleQuantity),
                symbol,
                side,
                nextVisibleQty,
                priceLimit,
                timestamp,
                userId
            );

            book.addOrder(nextBatch);
        }
    }
}

// Strategy pattern for different order behaviors
public interface OrderMatchingStrategy {
    List<Trade> match(Order order, OrderBook book);
}

public class StandardOrderMatching implements OrderMatchingStrategy {
    @Override
    public List<Trade> match(Order order, OrderBook book) {
        // ... existing matching logic
    }
}

public class IcebergOrderMatching implements OrderMatchingStrategy {
    @Override
    public List<Trade> match(Order order, OrderBook book) {
        if (!(order instanceof IcebergOrder)) {
            return new StandardOrderMatching().match(order, book);
        }

        IcebergOrder icebergOrder = (IcebergOrder) order;
        List<Trade> trades = new ArrayList<>();

        // Match only visible portion
        trades.addAll(matchVisiblePortion(icebergOrder, book));

        // If visible portion was partially filled, reveal next batch
        if (!trades.isEmpty()) {
            int filledQty = trades.stream()
                .mapToInt(Trade::getQuantity)
                .sum();
            icebergOrder.onPartialFill(filledQty);
        }

        return trades;
    }
}
```

---

### Q4: "What's different about this vs payment systems?"

**Payment System:** "Pay Bob" (one direction, one-way flow of money)

**Trading Platform:** Two-sided matching (I want to buy, you want to sell)

| Aspect | Payment | Trading Platform |
|--------|---------|------------------|
| **Core Problem** | Ensure money transfers safely | Ensure MATCHING of buyers + sellers |
| **Correctness** | Exactly-once payment | Exactly-once MATCH (no double-fills) |
| **Latency** | 10-100ms acceptable | < 10ms required |
| **State** | Account balance | Order book state |
| **Scaling Challenge** | Throughput (moving money) | MATCHING throughput (finding pairs) |
| **Concurrency** | Per-account locks acceptable | Single-threaded matching (no locks!) |
| **Failure Mode** | Lost money | Lost order or double-fill |

---

### Q5: "How do you handle order modification while matching is in progress?"

```
SCENARIO:
User places: Buy 100 @ 2500
While matching is happening, user modifies: Buy 150 @ 2510

How to prevent race condition?

SOLUTION: Version-based optimistic locking

```java
public class OrderWithVersion {
    private String orderId;
    private volatile long version = 0;

    public boolean tryModify(OrderModification mod) {
        long expectedVersion = version;

        // Make a copy for modification
        Order modified = createModifiedCopy(mod);
        modified.version = expectedVersion + 1;

        // Try to swap atomically
        return UNSAFE.compareAndSwapLong(
            this, VERSION_OFFSET,
            expectedVersion, expectedVersion + 1
        );
    }
}
```

---

This comprehensive guide covers everything needed for a FAANG-level system design interview on stock trading platforms. The emphasis on "why" over "how" and the detailed latency analysis make this suitable for a senior-level candidate or an ambitious mid-level engineer targeting senior positions.
