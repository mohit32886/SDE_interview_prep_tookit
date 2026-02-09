# Database & PostgreSQL Deep-Dive Interview Preparation

## Overview

This comprehensive interview preparation package contains 6 detailed markdown files covering database fundamentals, PostgreSQL internals, optimization, and real-world scenarios. Total: 6,100+ lines of content across ~170KB.

**Target Audience:** Mid-level Java engineers (5+ years) preparing for FAANG company technical interviews.

---

## File Breakdown

### 1. **01-SQL-Fundamentals-and-Advanced.md** (1,076 lines)
Deep dive into SQL with focus on execution and optimization.

**Key Topics:**
- SQL execution order (FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT)
- JOINs (INNER, LEFT, RIGHT, FULL, CROSS, SELF) with Venn diagrams and performance implications
- Subqueries vs JOINs, correlated subqueries
- Window Functions: ROW_NUMBER, RANK, DENSE_RANK, LEAD, LAG, NTILE, running totals
- CTEs and recursive CTEs
- Set operations (UNION, INTERSECT, EXCEPT)
- CASE expressions, COALESCE, NULLIF
- Aggregate functions and GROUP BY
- EXISTS vs IN (performance differences)
- String and date/time functions
- **20 solved SQL interview problems** (2nd highest salary, Nth highest, consecutive dates, pivoting, etc.)

---

### 2. **02-PostgreSQL-Internals.md** (773 lines)
PostgreSQL architecture and internal mechanisms.

**Key Topics:**
- Process architecture (Postmaster, backends, auxiliary processes)
- MVCC: xmin/xmax, tuple versioning, visibility determination
- WAL (Write-Ahead Logging): Durability, segments, crash recovery
- VACUUM and AUTOVACUUM: Dead tuples, bloat, tuning
- TOAST (Oversized-Attribute Storage)
- Buffer management and shared_buffers tuning
- Data types: Choosing right types, jsonb vs json, arrays, enums
- Tablespaces for multi-disk setup
- PostgreSQL-specific features: LISTEN/NOTIFY, COPY, UPSERT (ON CONFLICT), LATERAL, materialized views
- Configuration tuning: shared_buffers, work_mem, effective_cache_size
- PgBouncer connection pooling
- Common interview Q&A

---

### 3. **03-Indexing-and-Query-Optimization.md** (874 lines)
Indexing strategies and query optimization techniques.

**Key Topics:**
- B-Tree internals: Structure, page splits, search algorithm
- Index types: B-Tree, Hash, GiST, SP-GiST, GIN, BRIN (when to use each)
- Composite indexes and leftmost prefix rule
- Covering indexes (INCLUDE clause)
- Partial indexes, expression indexes
- EXPLAIN and EXPLAIN ANALYZE: Reading execution plans, node types
- Query optimization strategies (avoiding full table scans, statistics)
- N+1 query problem and solutions
- Index bloat, REINDEX
- Slow query identification workflow
- Partitioning: Range, list, hash with examples
- Performance anti-patterns
- Interview scenario: "Your query is slow"

---

### 4. **04-Transactions-and-Concurrency-Control.md** (903 lines)
ACID properties, isolation, and concurrency management.

**Key Topics:**
- ACID properties: Detailed explanation of each
- Isolation levels: READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, SERIALIZABLE
- Anomalies: Dirty reads, non-repeatable reads, phantom reads, serialization anomalies
- PostgreSQL locking: Row-level (FOR UPDATE, FOR SHARE, SKIP LOCKED), table-level, advisory
- Deadlock detection and prevention strategies
- Optimistic vs pessimistic locking in Java/JPA
- Two-Phase Commit (2PC)
- Savepoints and nested transactions
- Long-running transaction problems and solutions
- Connection pooling and transaction management
- Interview scenarios: Deadlock, slow writes, connection exhaustion

---

### 5. **05-Database-Design-and-Normalization.md** (1,050 lines)
Database design principles and patterns.

**Key Topics:**
- Normal forms: 1NF, 2NF, 3NF, BCNF with examples
- Denormalization trade-offs and when to use
- Entity-Relationship modeling and cardinality types
- Primary keys: Natural vs surrogate, UUID vs serial
- Foreign keys and cascading actions, deferred constraints
- Database design patterns:
  - Polymorphic associations (EAV)
  - Adjacency list (tree hierarchies)
  - Materialized path
  - Nested sets
- Schema migrations: Zero-downtime strategies, expand-contract pattern
- Sharding: Horizontal partitioning, sharding keys, challenges
- Replication: Streaming vs logical, synchronous vs asynchronous
- CAP theorem and implications
- **Interview exercises:** Social media database, e-commerce system design

---

### 6. **06-Database-Interview-Questions.md** (1,466 lines)
Comprehensive Q&A covering 50+ interview questions across all categories.

**Question Categories:**
1. **SQL Query Optimization** (Q1-Q6)
   - 2nd highest salary, department averages, consecutive dates, pivoting, etc.

2. **PostgreSQL-Specific** (Q7-Q11)
   - MVCC explained, WAL & durability, VACUUM, buffer management, slow query debugging

3. **Indexing & Performance** (Q12-Q14)
   - Index types, covering indexes, composite index column order

4. **Transactions & Concurrency** (Q15-Q17)
   - Isolation levels, deadlock prevention, optimistic vs pessimistic locking

5. **Database Design** (Q18-Q20)
   - Twitter/X database design, e-commerce system, normalization vs denormalization

6. **Scenario-Based** (Q21-Q26)
   - Database slowness debugging, outage handling, handling millions of inserts
   - "What happens when..." scenarios (query execution, xid wraparound, small buffers)

7. **Comparison Questions** (Q27)
   - PostgreSQL vs MySQL vs NoSQL (when to use each)

8. **Red Flags & Anti-Patterns** (Q28)
   - 10 common mistakes to avoid (N+1, missing indexes, correlated subqueries, etc.)

**Bonus:** Interview tips and best practices

---

## How to Use This Material

### Week 1: Fundamentals
- Read files 1-2 (SQL + PostgreSQL Internals)
- Take notes on key concepts
- Attempt SQL challenges in file 1

### Week 2: Optimization & Design
- Read files 3-5 (Indexing, Transactions, Design)
- Study design patterns
- Review EXPLAIN ANALYZE examples

### Week 3: Interview Prep
- Read file 6 (Interview Questions)
- Practice explaining concepts out loud
- Mock interviews covering scenarios
- Review red flags/anti-patterns

### Interview Day
- Review "Interview Tips" section
- Focus on explaining trade-offs
- Be ready with concrete examples
- Show knowledge of internals

---

## Key Concepts to Master

### Must Know:
1. SQL execution order and optimization
2. How MVCC prevents locking
3. Index types and when to use each
4. Isolation levels and anomalies
5. Database design patterns
6. Normalization vs denormalization

### Should Know:
1. EXPLAIN ANALYZE interpretation
2. Deadlock prevention
3. Query optimization workflow
4. Schema migration strategies
5. Partitioning and sharding

### Nice to Know:
1. WAL internals
2. Buffer management details
3. TOAST mechanism
4. Replication types
5. Advisory locks

---

## Interview Question Quick Index

| Topic | Q# | Difficulty |
|-------|-----|-----------|
| SQL Basics | Q1-Q6 | Easy-Medium |
| MVCC | Q7 | Medium |
| WAL | Q8 | Medium |
| VACUUM | Q9 | Medium |
| Tuning | Q10-Q11 | Medium |
| Indexes | Q12-Q14 | Medium |
| Isolation | Q15 | Hard |
| Deadlock | Q16-Q17 | Hard |
| Design | Q18-Q20 | Hard |
| Scenarios | Q21-Q26 | Hard |
| Comparison | Q27 | Medium |
| Anti-Patterns | Q28 | Easy |

---

## File Stats

```
Total Lines: 6,100+
Total Size: ~170KB
Avg File: ~1,000 lines

Code Examples: 300+
SQL Queries: 150+
Interview Q&A: 50+
Diagrams: Text-based Venn, tree structures, process flows
```

---

## Success Metrics

After studying this material, you should be able to:

✓ Write complex SQL queries with JOINs, window functions, CTEs
✓ Read and interpret EXPLAIN ANALYZE output
✓ Explain MVCC, isolation levels, and locking mechanisms
✓ Design normalized database schemas
✓ Identify and optimize N+1 queries
✓ Discuss index strategies for various scenarios
✓ Handle concurrency and transaction design
✓ Reason about trade-offs (consistency vs performance)
✓ Debug slow queries systematically
✓ Discuss distributed database concepts

---

## Additional Resources

### PostgreSQL Official Documentation
- https://www.postgresql.org/docs/current/
- SQL syntax reference
- Configuration parameters
- System administration

### Performance Tuning
- Use `pg_stat_statements` to find slow queries
- Enable `log_min_duration_statement` for logging
- Run `EXPLAIN (ANALYZE, BUFFERS)` on slow queries
- Monitor `pg_stat_user_tables` for bloat

### Practice Resources
- LeetCode Database Problems (medium-hard difficulty)
- HackerRank SQL challenges
- Local PostgreSQL setup for experiments
- Real schema from work projects

---

## Interview Tips Recap

1. **Ask clarifying questions** before diving into solutions
2. **Explain trade-offs** (consistency vs availability, performance vs maintenance)
3. **Show knowledge of internals** (mention MVCC, indexes, explain plans)
4. **Demonstrate problem-solving** (EXPLAIN ANALYZE is your best friend)
5. **Provide code examples** (both SQL and Java/ORM patterns)
6. **Discuss monitoring** (how to detect and prevent issues)
7. **Consider edge cases** (NULLs, empty sets, concurrency)
8. **Be ready to design** (schema for unknown domains)

---

Good luck with your FAANG interview!

**Last Updated:** February 2025
**Target Companies:** Google, Amazon, Meta, Apple, Netflix, Microsoft
**Difficulty Level:** Senior/Staff Engineer level
