# Transactions and Concurrency Control

## ACID Properties (Fundamental Interview Topic)

### A — Atomicity

A transaction is "all or nothing". Either all operations succeed, or none do.

```sql
-- Bank transfer example
BEGIN;
  UPDATE accounts SET balance = balance - 100 WHERE id = 1;
  UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;

-- If power fails after first UPDATE:
-- - Transaction not committed
-- - Both updates rolled back
-- - No partial transfer occurred

-- If COMMIT fails:
-- - No acknowledgment to client
-- - Next query starts new transaction
-- - Previous work automatically rolled back on connection close
```

**Implementation:** PostgreSQL uses WAL (Write-Ahead Logging). All changes logged to disk before COMMIT returns. On crash, uncommitted transactions are rolled back.

### C — Consistency

Database moves from one valid state to another. All constraints, triggers, and rules enforced.

```sql
-- Example: Foreign key constraint
CREATE TABLE departments (id serial PRIMARY KEY);
CREATE TABLE employees (
    id serial PRIMARY KEY,
    dept_id int REFERENCES departments(id)
);

-- INSERT with invalid dept_id is rejected
INSERT INTO employees (id, dept_id) VALUES (1, 999);
-- ERROR: insert or update on table "employees" violates foreign key constraint

-- Transaction is rolled back, database stays consistent
```

**Implementation:** PostgreSQL enforces constraints at transaction end. If any constraint violated, entire transaction rolled back.

### I — Isolation

Transactions cannot interfere with each other. Each transaction sees a consistent snapshot.

```sql
-- Transaction 1 (xid=100)
BEGIN;
SELECT * FROM accounts WHERE id = 1;  -- balance = 1000
-- Do some business logic

-- Transaction 2 (xid=101)
BEGIN;
UPDATE accounts SET balance = 900 WHERE id = 1;
COMMIT;

-- Back to Transaction 1
SELECT * FROM accounts WHERE id = 1;  -- balance = ?
-- Depends on isolation level (see below)
```

**Isolation Levels:** PostgreSQL implements READ UNCOMMITTED (treated as READ COMMITTED), READ COMMITTED (default), REPEATABLE READ, SERIALIZABLE.

### D — Durability

Once committed, data survives hardware failures.

```sql
-- Client sends COMMIT
COMMIT;

-- Internally:
-- 1. WAL entry written to buffer
-- 2. WAL buffer fsync'd to disk (DURABILITY POINT)
-- 3. Return OK to client

-- Even if PostgreSQL crashes immediately:
// On restart, replay WAL from checkpoint
// Reconstruct committed transactions
// Data is safe
```

**synchronous_commit Setting:**
- `on` (default): Wait for WAL fsync before returning OK
- `remote_apply`: Wait for replica confirmation (HA)
- `off`: Return OK before fsync (faster, less safe)

---

## Transaction Isolation Levels

### 1. READ UNCOMMITTED (PostgreSQL treats as READ COMMITTED)

```sql
-- Theoretically: Read uncommitted changes from other transactions
-- PostgreSQL: Actually READ COMMITTED (safer default)

-- Set isolation level
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

-- No dirty reads in PostgreSQL (reads only committed data)
```

### 2. READ COMMITTED (Default)

Each statement sees only committed data at statement start.

```sql
-- Session 1
BEGIN;
SELECT balance FROM accounts WHERE id = 1;  -- 1000
-- ... other work ...
SELECT balance FROM accounts WHERE id = 1;  -- 900 (sees update from Session 2)

-- Session 2
UPDATE accounts SET balance = 900 WHERE id = 1;
COMMIT;

-- In READ COMMITTED:
-- Each SELECT statement gets fresh snapshot of committed data
-- So Session 1's second SELECT sees Session 2's update (non-repeatable read)
```

**Use Case:** Most applications. Balances safety and performance.

**Problems:**
- Non-repeatable reads (same query returns different results)
- Phantom reads (new rows appear between queries)

### 3. REPEATABLE READ

Each transaction has consistent snapshot from transaction start.

```sql
-- Session 1
BEGIN;  -- Snapshot taken here
SELECT COUNT(*) FROM orders;  -- 1000

-- Session 2
INSERT INTO orders VALUES (...);
INSERT INTO orders VALUES (...);
COMMIT;

-- Back to Session 1
SELECT COUNT(*) FROM orders;  -- Still 1000 (doesn't see Session 2's inserts)

-- In REPEATABLE READ:
-- Transaction sees consistent snapshot
// Session 2's commits are invisible until Session 1 commits
```

**Use Case:** When you need consistent data throughout transaction (reports, calculations).

**Prevents:**
- Dirty reads
- Non-repeatable reads

**Still allows:**
- Phantom reads (usually not problem with consistent snapshot)

### 4. SERIALIZABLE

Full isolation as if transactions ran one at a time.

```sql
-- Session 1
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT SUM(amount) FROM orders WHERE product_id = 5;  -- 5000

-- Session 2
BEGIN ISOLATION LEVEL SERIALIZABLE;
INSERT INTO orders (product_id, amount) VALUES (5, 100);
COMMIT;  -- Gets serialization error!

-- Back to Session 1
-- Session 1's transaction must be restarted because
// Session 2 violated the apparent serial ordering

-- Error: SQLSTATE 40001 (serialization_failure)
```

**Implementation:** PostgreSQL uses **Serializable Snapshot Isolation (SSI)** with rw-conflicts. Detects conflicts at commit time.

**Use Case:** High-value transactions (financial, inventory reservations).

**Cost:** May get serialization errors, need retry logic.

---

## Isolation Anomalies

### Dirty Read

Transaction reads uncommitted changes from other transaction.

```sql
-- Session 1
BEGIN;
UPDATE accounts SET balance = -1000 WHERE id = 1;
-- (Invalid state, would violate constraint)

-- Session 2 (READ UNCOMMITTED)
SELECT balance FROM accounts WHERE id = 1;  -- -1000 (uncommitted!)

-- Session 1
ROLLBACK;  -- Oops, invalid!

-- Session 2 saw data that never really existed (dirty read)
```

**PostgreSQL:** Prevents dirty reads (even in READ UNCOMMITTED).

### Non-Repeatable Read

Same row returns different values within same transaction.

```sql
-- Session 1 (READ COMMITTED)
BEGIN;
SELECT salary FROM employees WHERE id = 1;  -- 50000

-- Session 2
UPDATE employees SET salary = 55000 WHERE id = 1;
COMMIT;

-- Session 1
SELECT salary FROM employees WHERE id = 1;  -- 55000 (changed!)
-- Same query, different result (non-repeatable read)
```

**PostgreSQL:** Allowed in READ COMMITTED, prevented in REPEATABLE READ.

### Phantom Read

New rows appear that match transaction's WHERE clause.

```sql
-- Session 1 (REPEATABLE READ)
BEGIN;
SELECT COUNT(*) FROM orders WHERE status = 'pending';  -- 100

-- Session 2
INSERT INTO orders (status) VALUES ('pending');
INSERT INTO orders (status) VALUES ('pending');
COMMIT;

// Session 1 (REPEATABLE READ)
SELECT COUNT(*) FROM orders WHERE status = 'pending';  // Still 100 (old snapshot)

// But if Session 1 tries to update:
UPDATE orders SET priority = 1 WHERE status = 'pending';
// Updated 102 rows! (including Session 2's inserts)
// This is phantom read (rows appeared)
```

**PostgreSQL:** Prevents with consistent snapshot (but update sees new rows).

### Serialization Anomaly

Transactions interleave in way that violates dependency ordering.

```sql
-- Session 1 (SERIALIZABLE)
BEGIN;
SELECT SUM(balance) FROM accounts;  -- 10000

-- Session 2 (SERIALIZABLE)
BEGIN;
UPDATE accounts SET balance = balance * 1.1 WHERE account_type = 'checking';
COMMIT;

// Session 1
UPDATE accounts SET balance = balance / 0.99 WHERE account_type = 'savings';
COMMIT;  // ERROR: serialization_failure

// If both committed: financial calculations would be inconsistent
// PostgreSQL detects and rejects Session 1
```

---

## PostgreSQL Locking

### Row-Level Locks

```sql
-- FOR UPDATE: Exclusive lock (no other transaction can read with FOR UPDATE)
SELECT * FROM employees WHERE id = 1 FOR UPDATE;
-- Blocks other transactions trying: FOR UPDATE, FOR NO KEY UPDATE

-- FOR NO KEY UPDATE: Exclusive, but allows foreign key lookups
SELECT * FROM employees WHERE id = 1 FOR NO KEY UPDATE;

-- FOR SHARE: Shared lock (multiple transactions can hold)
SELECT * FROM employees WHERE id = 1 FOR SHARE;
-- Blocks FOR UPDATE, but multiple FOR SHARE OK

-- FOR KEY SHARE: Shared, but FOR UPDATE still blocked
SELECT * FROM employees WHERE id = 1 FOR KEY SHARE;
```

### Locking in Transactions

```sql
-- Pattern: Read-modify-write safely
BEGIN;
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
-- Row is locked, cannot be modified by others

-- Do calculations
-- Process in application

-- Write
UPDATE accounts SET balance = 1500 WHERE id = 1;
COMMIT;
-- Lock released
```

### NOWAIT and SKIP LOCKED

```sql
-- NOWAIT: Fail immediately if row locked
SELECT * FROM jobs WHERE id = 1 FOR UPDATE NOWAIT;
-- ERROR: could not obtain lock immediately

-- SKIP LOCKED: Skip locked rows (useful for queue processing)
SELECT * FROM jobs WHERE status = 'pending' FOR UPDATE SKIP LOCKED LIMIT 10;
-- Returns up to 10 unlocked pending jobs
// (Perfect for job queue: multiple workers grab different jobs)
```

### Table-Level Locks

PostgreSQL uses table locks automatically, but can be explicit:

```sql
-- ACCESS SHARE: Concurrent reads
SELECT ... FROM table_name;

-- ROW SHARE: Intent to read rows (FOR SHARE)
SELECT ... FOR SHARE;

-- ROW EXCLUSIVE: Intent to modify rows (FOR UPDATE)
SELECT ... FOR UPDATE;

-- SHARE: Concurrent SHAREs, blocks exclusives
LOCK TABLE table_name IN SHARE MODE;

-- EXCLUSIVE: Blocks all access
LOCK TABLE table_name IN EXCLUSIVE MODE;

-- EXCLUSIVE blocks even reads
```

### Advisory Locks (Application-Level Locking)

```sql
-- Explicit application-level locks (not tied to rows)
SELECT pg_advisory_lock(123);
-- Acquire lock on resource ID 123 (any int)
// Other sessions blocked on pg_advisory_lock(123)

-- Do critical work
UPDATE accounts SET balance = balance - 100 WHERE id = 123;
UPDATE accounts SET balance = balance + 100 WHERE id = 456;

-- Release lock
SELECT pg_advisory_unlock(123);

// Useful for:
// - Distributed locks across multiple databases
// - Complex business logic requiring app-level locking
// - Coordination between batch jobs
```

---

## Deadlock Detection and Prevention

### What is a Deadlock?

```sql
-- Session 1
BEGIN;
SELECT * FROM employees WHERE id = 1 FOR UPDATE;
-- Waits for lock on employees row 1

-- Session 2
BEGIN;
SELECT * FROM departments WHERE id = 1 FOR UPDATE;
// Waits for lock on departments row 1

// Back to Session 1
SELECT * FROM departments WHERE id = 1 FOR UPDATE;
// DEADLOCK! Waiting for Session 2 to release

// Session 2
SELECT * FROM employees WHERE id = 1 FOR UPDATE;
// DEADLOCK! Waiting for Session 1 to release

// PostgreSQL detects and kills one transaction:
// ERROR: deadlock detected
```

### Deadlock Prevention Strategies

```sql
-- 1. Always lock tables in SAME ORDER
-- Session 1
BEGIN;
SELECT * FROM employees WHERE id = 1 FOR UPDATE;
SELECT * FROM departments WHERE id = 1 FOR UPDATE;
COMMIT;

// Session 2
BEGIN;
SELECT * FROM employees WHERE id = 2 FOR UPDATE;
SELECT * FROM departments WHERE id = 1 FOR UPDATE;
COMMIT;

// No deadlock: both go employees first, then departments

// 2. Use timeouts
SET lock_timeout = '5 seconds';
BEGIN;
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
// If waited > 5s, ERROR: canceling statement due to lock timeout

// 3. Short transactions
// Long transactions hold locks longer, increase deadlock probability
// Break into smaller transactions if possible

// 4. Catch deadlock, retry with backoff
catch (PSQLException e) {
    if (e.getSQLState().equals("40P01")) {  // Deadlock
        // Exponential backoff and retry
        Thread.sleep(Math.random() * 1000);  // random backoff
        retryTransaction();
    }
}
```

---

## Optimistic vs Pessimistic Locking

### Pessimistic Locking (Lock Early)

```java
// Assume conflicts likely, lock immediately
public class BankTransfer {
    public void transfer(int fromId, int toId, BigDecimal amount) {
        em.getTransaction().begin();

        // Lock early
        Account from = em.find(Account.class, fromId, LockModeType.PESSIMISTIC_WRITE);
        Account to = em.find(Account.class, toId, LockModeType.PESSIMISTIC_WRITE);

        // Guaranteed no other transaction can modify
        from.setBalance(from.getBalance().subtract(amount));
        to.setBalance(to.getBalance().add(amount));

        em.getTransaction().commit();
        // Locks released
    }
}

-- SQL: SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
```

**Use When:**
- High contention (many concurrent transactions)
- Data consistency critical
- Acceptable to have some transactions wait

### Optimistic Locking (Check on Update)

```java
// Assume conflicts rare, use version/timestamp
@Entity
class Account {
    @Id
    private int id;
    private BigDecimal balance;

    @Version  // Optimistic lock column
    private int version;  // Incremented on each update
}

public class BankTransfer {
    public void transfer(int fromId, int toId, BigDecimal amount) {
        // Read (no lock)
        Account from = em.find(Account.class, fromId);
        Account to = em.find(Account.class, toId);

        // Version: from.version=5, to.version=3

        // Modify
        from.setBalance(from.getBalance().subtract(amount));
        to.setBalance(to.getBalance().add(amount));

        // Update (checks version)
        em.getTransaction().begin();
        try {
            em.merge(from);  // UPDATE ... WHERE id=1 AND version=5
            em.merge(to);    // UPDATE ... WHERE id=2 AND version=3
            em.getTransaction().commit();
        } catch (OptimisticLockException e) {
            // Version mismatch! Another transaction modified
            em.getTransaction().rollback();
            // Retry transaction
            transfer(fromId, toId, amount);
        }
    }
}

-- SQL: UPDATE accounts SET balance=200, version=6 WHERE id=1 AND version=5;
-- If row updated by another transaction: no rows affected, OptimisticLockException
```

**Use When:**
- Low contention
- Many read operations
- Can tolerate occasional retries

**Interview Comparison:**
| Aspect | Pessimistic | Optimistic |
|--------|-------------|-----------|
| Lock Duration | Long (held during transaction) | Short (checked on update) |
| Throughput | Lower (waits) | Higher (fewer waits) |
| Contention | Handles well | Can thrash under high contention |
| Implementation | Complex (manage locks) | Simple (version field) |
| Good For | Financial, inventory | Social media, analytics |

---

## Two-Phase Commit (2PC)

Coordinate commits across multiple databases.

```sql
-- Coordinator (XA Transaction Manager)

-- Phase 1: Prepare
PREPARE TRANSACTION 'xid_12345';
-- All participants flush to log, respond "ready"

-- Phase 2: Commit
COMMIT PREPARED 'xid_12345';
-- All participants commit

-- Or rollback:
ROLLBACK PREPARED 'xid_12345';
-- All participants rollback
```

### 2PC Example in Java

```java
// Using Atomikos or Narayana XA Transaction Manager
@Transactional(Transactional.TxType.REQUIRED)
public void transferAcrossDBs(int accountAId, int accountBId, BigDecimal amount) {
    // DataSource1 and DataSource2 are XA-enabled

    // Transaction automatically coordinated:
    // 1. Prepare phase: Both databases prepared
    // 2. Commit phase: Both databases committed or both rolled back

    // SQL on Database 1
    accountA.setBalance(accountA.getBalance().subtract(amount));

    // SQL on Database 2
    accountB.setBalance(accountB.getBalance().add(amount));

    // Automatic commit coordinates both
}
```

**Problems with 2PC:**
- Slow (two rounds of network communication)
- Blocking (participants locked during prepare)
- Not reliable under network partition
- Rarely used in distributed systems (prefer eventual consistency)

**Modern Alternative:** Event sourcing + sagas for distributed transactions.

---

## Savepoints and Nested Transactions

### Savepoints (Partial Rollback)

```sql
BEGIN;
  INSERT INTO orders (customer_id, amount) VALUES (1, 100);
  SAVEPOINT before_items;

  INSERT INTO order_items (order_id, item_id, qty) VALUES (1, 5, 2);
  -- Oops, item doesn't exist!
  -- ROLLBACK to savepoint, not entire transaction

  ROLLBACK TO before_items;
  -- order_items rolled back, order still exists

  INSERT INTO order_items (order_id, item_id, qty) VALUES (1, 6, 3);
COMMIT;
-- Transaction contains 1 order + 1 item
```

### Nested Transactions with Exception Handling

```java
public void complexTransaction() {
    em.getTransaction().begin();

    try {
        // Main work
        Order order = createOrder(customerId);

        try {
            // Risky sub-work
            applyDiscount(order, discountCode);
        } catch (InvalidDiscountException e) {
            // Rollback discount only, continue with order
            // Internally uses SAVEPOINT
            em.getTransaction().rollback();
            em.getTransaction().begin();
            // Order still exists, discount not applied
        }

        em.getTransaction().commit();
    } catch (Exception e) {
        em.getTransaction().rollback();
    }
}
```

---

## Long-Running Transaction Problems and Solutions

### Problems

```sql
-- Long transaction holds locks
BEGIN;
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
-- ... 30 minutes of business logic ...
COMMIT;

// Problems:
// 1. Row locked for 30 minutes
// 2. Other transactions waiting
// 3. MVCC keeps old versions (bloats storage)
// 4. Vacuum can't remove old versions (transaction still open)
// 5. Clog/xid wraparound risk
```

### Solution 1: Batch Into Smaller Transactions

```java
public void processManyOrders() {
    for (Order order : orders) {
        em.getTransaction().begin();
        try {
            processOrder(order);  // Quick transaction
            em.getTransaction().commit();
        } catch (Exception e) {
            em.getTransaction().rollback();
        }
    }
}

// SQL:
// BEGIN; ... UPDATE order SET status='processed'; COMMIT;  (100ms)
// BEGIN; ... UPDATE order SET status='processed'; COMMIT;  (100ms)
// ...
// vs
// BEGIN; ... all updates ... COMMIT;  (10+ seconds holding locks)
```

### Solution 2: Offline Processing + Async

```java
// Instead of blocking, queue work
public void handleOrderRequest(Order order) {
    // Quick: save order, queue for processing
    order.setStatus("QUEUED");
    em.persist(order);
    em.getTransaction().commit();  // Quick!

    // Async worker processes
    messageQueue.send(new ProcessOrderMessage(order.id));
}

// Separate consumer
@MessageDriven
public void processOrder(ProcessOrderMessage msg) {
    Order order = em.find(Order.class, msg.orderId);
    // Long-running work in background
    em.getTransaction().begin();
    // ... heavy processing ...
    em.getTransaction().commit();
}
```

### Solution 3: Read-Only Transactions

```java
@Transactional(readOnly = true, timeout = 30)
public OrderReport generateReport() {
    // Read-only: no locks, can run long without blocking others
    // timeout: 30 seconds max
    return buildComplexReport();
}

-- SQL: SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- No locks acquired, consistent snapshot
```

---

## Connection Pooling and Transaction Management

### Transaction Per Request Pattern (Web Apps)

```java
@WebFilter("/*")
public class TransactionFilter extends HttpFilter {
    @Inject
    EntityManager em;

    @Override
    protected void doFilter(HttpRequest req, HttpResponse res, FilterChain chain) {
        em.getTransaction().begin();
        try {
            chain.doFilter(req, res);
            em.getTransaction().commit();
        } catch (Exception e) {
            em.getTransaction().rollback();
            throw e;
        }
    }
}

// Per HTTP request: 1 transaction, 1 database connection
// From pool: acquire connection, associate with transaction
// Response sent: commit (or rollback), return connection to pool
```

### Connection Pooling Configuration (HikariCP)

```java
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:postgresql://localhost/mydb");
config.setUsername("user");
config.setPassword("pass");
config.setMaximumPoolSize(20);              // Max concurrent connections
config.setMinimumIdle(5);                   // Keep-alive connections
config.setConnectionTimeout(30000);         // Wait 30s for available connection
config.setIdleTimeout(600000);              // Close connection after 10min idle
config.setMaxLifetime(1800000);             // Max 30 min per connection
config.setAutoCommit(false);                // Manual transaction control

HikariDataSource ds = new HikariDataSource(config);

// Usage:
Connection conn = ds.getConnection();  // Borrow from pool
try {
    // Execute SQL
} finally {
    conn.close();  // Return to pool
}
```

**Interview Tip:** "With 100 concurrent users, 20 database connections sufficient. Each user's request borrows one connection (avg 100ms), returns it. 5 keep-alive minimum prevents connection churn."

---

## Common Interview Scenarios

### Scenario 1: "Database Deadlock Under Load"

```
Question: "Your e-commerce system deadlocks during checkout. How do you debug?"

Answer:
1. Check PostgreSQL logs for deadlock messages
   - Find victim transaction and lock holder
   - Identify which queries/tables involved

2. Reproduce with stress test to understand pattern

3. Common causes:
   - Locking tables in different order
   - Too many locks in single transaction
   - Batch job locking while users also lock

4. Solutions:
   - Standardize lock order across app
   - Use NOWAIT/SKIP LOCKED for queues
   - Break into smaller transactions
   - Implement exponential backoff retry

5. Code example:
   ```java
   int maxRetries = 3;
   for (int i = 0; i < maxRetries; i++) {
       try {
           checkout(orderId);
           return;
       } catch (DeadlockException e) {
           if (i == maxRetries - 1) throw e;
           Thread.sleep((long)Math.pow(2, i) * 100);  // Exponential backoff
       }
   }
   ```
```

### Scenario 2: "Slow Writes Under Concurrent Reads"

```
Question: "Batch inserts (1M/min) causing read queries to slow. Why?"

Answer:
1. Problem: MVCC overhead
   - Each insert creates new row version
   - Reads check visibility (xmin/xmax)
   - Many concurrent versions slow down MVCC checks
   - Vacuum lag: dead tuples accumulate

2. Check statistics:
   SELECT * FROM pg_stat_user_tables
   WHERE n_dead_tup > 1000;

3. Solutions:
   a. Aggressive autovacuum on high-churn table:
      ALTER TABLE high_churn_table SET (
          autovacuum_vacuum_scale_factor = 0.01,
          autovacuum_vacuum_threshold = 100
      );

   b. Partition inserts and reads:
      INSERT into INSERT table → later UNION to read table
      (e.g., nightly batch vs live query)

   c. Use multiple writers (sharding):
      Table hash(id) % 10 → 10 partition tables
      Reduces contention, faster inserts

4. Verify with EXPLAIN ANALYZE:
   SELECT * FROM orders WHERE status = 'pending';
   // Check: heap_blks_read vs total blocks
   // High ratio = many old versions to scan
```

### Scenario 3: "Connection Pool Exhaustion"

```
Question: "Intermittent failures: 'Cannot get a connection. Waited X seconds.'"

Answer:
1. Diagnosis:
   - Check pool utilization: HikariCP dashboard
   - Check database: SELECT count(*) FROM pg_stat_activity;
   - Look for long-running queries holding connections

2. Root causes:
   a. Slow queries not releasing connections
      SELECT query FROM pg_stat_activity
      WHERE state = 'active'
      ORDER BY query_start;

   b. Code not closing connections
      Connection conn = pool.getConnection();
      // Missing try-finally conn.close()!

   c. Too few connections for peak load
      Max connections insufficient

   d. Connection leak: connections not returned to pool

3. Solutions:
   - Set query timeouts
   - Increase pool size (monitor DB limits)
   - Fix slow queries
   - Add connection leak detector
   - Monitor connection usage over time

4. Configuration:
   HikariConfig config = new HikariConfig();
   config.setMaximumPoolSize(30);  // Increase
   config.setLeakDetectionThreshold(15000);  // 15s leak alert
```

