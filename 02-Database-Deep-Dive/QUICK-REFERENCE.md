# Quick Reference Guide - Database Interview Topics

## SQL Execution Order (MEMORIZE THIS)
```
FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT
```

**Key Implications:**
- Can't use SELECT aliases in WHERE
- Can use SELECT aliases in ORDER BY
- Aggregate functions only in SELECT/HAVING
- WHERE filters rows, HAVING filters groups

---

## Index Types at a Glance

| Type | Use | Operators |
|------|-----|-----------|
| B-Tree | Default, range | =, <, >, <=, >=, BETWEEN, LIKE |
| Hash | Equality only | = |
| GIN | Arrays, JSON | @>, <@, ?, @@ |
| BRIN | Sorted large tables | < > <= >= = |
| GiST | Geometric, PostGIS | <@, @>, && |

---

## Isolation Levels (Severity of Anomalies)

```
READ COMMITTED (default)
├─ Prevents: Dirty reads
├─ Allows: Non-repeatable reads, phantom reads

REPEATABLE READ
├─ Prevents: Dirty reads, non-repeatable reads
├─ Allows: Phantom reads

SERIALIZABLE (safest)
├─ Prevents: All anomalies
├─ Cost: May get serialization errors (40001)
```

---

## EXPLAIN ANALYZE Red Flags

| Finding | Issue | Fix |
|---------|-------|-----|
| Seq Scan (large table) | No index | CREATE INDEX on WHERE columns |
| High nloops on Nested Loop | Inefficient join | Use Hash Join with JOIN condition |
| Est. rows >> Actual rows | Bad statistics | ANALYZE table |
| Est. rows << Actual rows | Bad statistics | ANALYZE table |
| Sort without index | No ORDER BY index | CREATE INDEX on ORDER BY columns |

---

## MVCC Core Concept

Every row has:
- **xmin**: Insert transaction ID (when was row inserted)
- **xmax**: Delete transaction ID (when was row deleted, NULL if active)

**Visibility Check:**
- Is xmin committed before my snapshot? If yes, row visible
- Is xmax set and committed? If yes, row is deleted

---

## Window Function Pattern

```sql
SELECT
    col1, col2,
    FUNCTION() OVER (PARTITION BY partition_col ORDER BY order_col) AS result
FROM table;
```

**Common Functions:**
- ROW_NUMBER() - Sequential numbering
- RANK() - With gaps for ties
- DENSE_RANK() - Without gaps
- LEAD/LAG - Access adjacent rows
- Running totals: SUM() with ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW

---

## JOIN Types

```
INNER JOIN     ← Both tables, matching only
LEFT JOIN      ← All left, matching right
RIGHT JOIN     ← All right, matching left (avoid, use LEFT)
FULL OUTER     ← All from both
CROSS JOIN     ← Cartesian product (rarely needed)
SELF JOIN      ← Table joined to itself
```

---

## Normalization Quick Rules

| Form | Rule | Problem Prevents |
|------|------|------------------|
| 1NF | No repeating groups | Inconsistent data |
| 2NF | 1NF + no partial dependencies | Redundancy |
| 3NF | 2NF + no transitive dependencies | Update anomalies |
| BCNF | Every determinant is candidate key | Complex anomalies |

---

## Database Tuning Checklist

```
[ ] shared_buffers = 25% of RAM
[ ] effective_cache_size = 50-75% of RAM
[ ] work_mem = RAM / (max_connections * 2)
[ ] random_page_cost = 1.1 for SSD (4.0 for HDD)
[ ] autovacuum enabled and tuned
[ ] Indexes on frequently filtered columns
[ ] Statistics up-to-date (ANALYZE)
[ ] No N+1 queries
[ ] Connection pooling configured
[ ] Replication/failover tested
```

---

## Deadlock Prevention

1. **Lock Order**: Always acquire locks in same order
2. **Timeouts**: SET lock_timeout = '5 seconds'
3. **Retry Logic**: Exponential backoff
4. **Short Transactions**: Release locks faster

---

## Common SQL Mistakes

```sql
-- WRONG: Correlated subquery (N+1)
SELECT e.* FROM employees e
WHERE salary > (
    SELECT AVG(salary) FROM employees e2
    WHERE e2.dept_id = e.dept_id
);

-- RIGHT: Use JOIN instead
SELECT e.* FROM employees e
JOIN (
    SELECT dept_id, AVG(salary) AS avg_sal
    FROM employees GROUP BY dept_id
) d ON e.dept_id = d.dept_id
WHERE e.salary > d.avg_sal;
```

---

## N+1 Query Anti-Pattern

**Problem:**
```java
for (Customer c : customers) {          // 1 query
    List<Order> orders = fetchOrders(c.id);  // N queries
}
```

**Solution:**
```java
Map<Long, List<Order>> orders = 
    fetchOrdersByCustomerIds(customerIds);  // 1 query
for (Customer c : customers) {
    List<Order> o = orders.get(c.id);   // Memory lookup
}
```

---

## Locking Modes in SQL

```sql
SELECT ... FOR UPDATE;        -- Exclusive lock
SELECT ... FOR SHARE;         -- Shared lock
SELECT ... FOR UPDATE NOWAIT; -- Fail if locked
SELECT ... FOR UPDATE SKIP LOCKED; -- Skip locked rows
```

---

## CTE Pattern (Always Consider)

```sql
WITH intermediate AS (
    SELECT filtered_cols FROM source_table
    WHERE condition
)
SELECT * FROM intermediate
WHERE additional_filters;
```

**Benefits:**
- Readability
- Reusable (reference multiple times)
- Performance (often materialized)

---

## Transaction Pattern (Java)

```java
try {
    em.getTransaction().begin();
    // Business logic
    em.getTransaction().commit();
} catch (Exception e) {
    em.getTransaction().rollback();
    throw e;
}
```

**Duration:** < 1 second (keep short!)

---

## Key PostgreSQL Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| shared_buffers | 25% RAM | Page cache |
| effective_cache_size | 50-75% RAM | Planner hint |
| work_mem | 256MB | Per-operation memory |
| maintenance_work_mem | 1GB | VACUUM, REINDEX |
| max_connections | 100+ | Connection limit |
| wal_level | replica | Replication support |
| autovacuum | on | Background vacuum |

---

## Interview Gold Responses

### "Explain MVCC"
"PostgreSQL keeps multiple versions of rows (xmin/xmax). Readers see snapshot at transaction start. Writers create new versions. No blocking between readers and writers. Problem: Dead tuples accumulate, need VACUUM."

### "Query is Slow"
"I'd run EXPLAIN ANALYZE to see the plan. Check for Seq Scan (missing index), bad cardinality (run ANALYZE), or correlated subqueries (N+1). Fix accordingly and re-verify with EXPLAIN ANALYZE."

### "Design Database for X"
"First, identify entities and relationships. Normalize to 3NF. Add indexes on frequent WHERE/JOIN/ORDER BY columns. Consider partitioning for large tables. Setup replication for HA. Monitor with pg_stat_*."

### "Deadlock Under Load"
"Ensure all transactions lock tables in same order. Use NOWAIT/SKIP LOCKED for queues. Keep transactions short. Implement exponential backoff retry logic. Monitor pg_stat_database.deadlocks."

---

## 60-Second Query Optimization Guide

1. **Get EXPLAIN ANALYZE output** (shows actual vs estimated)
2. **Look for Seq Scan** → CREATE INDEX
3. **Look for high row discrepancy** → ANALYZE table
4. **Look for correlated subquery** → Rewrite as JOIN
5. **Look for Sort** → CREATE INDEX on ORDER BY
6. **Verify improvement** → Re-run EXPLAIN ANALYZE

---

## Design Pattern Decision Tree

```
Repeating data for single entity?
├─ Yes → 1NF: Separate table

Data determined by part of key?
├─ Yes → 2NF: Move to separate table

Non-key attribute determines another non-key?
├─ Yes → 3NF: Separate table

Hierarchy/Tree?
├─ Many lookups → Adjacency list
├─ Path queries → Materialized path
├─ Balance needed → Nested sets

Schema changes frequently?
├─ Yes → Consider JSON/JSONB
└─ No → Strict relational

High-volume reads, few writes?
├─ Yes → Denormalize + Materialized view
└─ No → Keep normalized
```

---

## Cheat Sheet: JOINs Performance

```
Always: Create indexes on join columns
        CREATE INDEX ON table(join_column)

Composite JOIN indexes:
        CREATE INDEX ON orders(customer_id, created_at)

Covering indexes for common joins:
        CREATE INDEX ON orders(customer_id)
        INCLUDE (total, status);
```

---

## Stats You Should Know

- PostgreSQL: 6,144 transactions/sec per core (typical)
- Index lookup: O(log n), ~20 I/Os for 1B rows
- Sequential scan: O(n), ~1M rows/sec
- Page size: 8KB (fixed in PostgreSQL)
- Shared buffers default: 128MB (increase to 25% RAM)

---

## Final Interview Tips

1. Always ask "How large?" and "What's the access pattern?"
2. Explain trade-offs (consistency vs speed, simplicity vs performance)
3. Use EXPLAIN ANALYZE as your best friend
4. Mention specific PostgreSQL features (MVCC, partitioning, etc.)
5. Show Java/ORM knowledge (eager loading, prepared statements)
6. Discuss monitoring (how would you detect this in production)
7. Think about failure scenarios (what if this fails?)
8. Be honest about unknowns (better than guessing)

---

**Print this page. Review before interview. Good luck!**
