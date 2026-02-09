# Database Interview Preparation - Complete Index

## Quick Navigation

### Start Here
- **README.md** - Overview and study roadmap
- **QUICK-REFERENCE.md** - Printable cheat sheet

### Deep Dive Files
1. **01-SQL-Fundamentals-and-Advanced.md** (1,076 lines)
2. **02-PostgreSQL-Internals.md** (773 lines)
3. **03-Indexing-and-Query-Optimization.md** (874 lines)
4. **04-Transactions-and-Concurrency-Control.md** (903 lines)
5. **05-Database-Design-and-Normalization.md** (1,050 lines)
6. **06-Database-Interview-Questions.md** (1,466 lines)

---

## Content Map by Topic

### SQL & Query Writing
- File 1: SQL execution order, JOINs, window functions, CTEs
- File 6: SQL query optimization problems (Q1-Q6)

### PostgreSQL Internals
- File 2: MVCC, WAL, VACUUM, buffer management, tuning
- File 6: PostgreSQL-specific questions (Q7-Q11)

### Indexing & Performance
- File 3: Index types, EXPLAIN ANALYZE, query optimization
- File 6: Index-related questions (Q12-Q14)

### Transactions & Concurrency
- File 4: ACID, isolation levels, locking, deadlocks
- File 6: Concurrency questions (Q15-Q17)

### Database Design
- File 5: Normalization, design patterns, schema migration
- File 6: Design questions (Q18-Q20)

### Scenarios & Debugging
- File 6: Real-world scenarios (Q21-Q26), comparisons (Q27), anti-patterns (Q28)

---

## Study Tracks

### Fast Track (10-15 hours)
1. Read QUICK-REFERENCE.md (1 hour)
2. Read File 1 sections: Execution order, JOINs, window functions (2 hours)
3. Read File 3 sections: Index types, EXPLAIN ANALYZE (2 hours)
4. Read File 4 sections: Isolation levels, deadlocks (2 hours)
5. Read File 6: First 15 Q&A (3 hours)
6. Practice: Answer 10 Q&A out loud (3 hours)

### Standard Track (20-30 hours)
1. Read all 6 main files (12 hours)
2. Review README and QUICK-REFERENCE (1 hour)
3. Study File 6 Q&A (4 hours)
4. Create personal notes on key concepts (3 hours)
5. Practice explaining concepts (5 hours)

### Deep Track (40+ hours)
1. Read all files carefully (15 hours)
2. Work through SQL problems (5 hours)
3. Study File 6 every answer (6 hours)
4. Create visual diagrams of concepts (5 hours)
5. Practice mock interviews (10+ hours)

---

## Topic Quick Links

### SQL Fundamentals (File 1)
- Line 1-50: SQL execution order
- Line 50-200: JOINs with diagrams
- Line 200-400: Subqueries vs JOINs
- Line 400-600: Window functions
- Line 600-750: CTEs
- Line 750-850: Set operations
- Line 850-1076: 20 SQL problems

### PostgreSQL Internals (File 2)
- Line 1-100: Architecture
- Line 100-250: MVCC & visibility
- Line 250-400: WAL
- Line 400-550: VACUUM
- Line 550-650: Configuration
- Line 650-773: Interview Q&A

### Indexing & Optimization (File 3)
- Line 1-150: B-Tree structure
- Line 150-350: Index types
- Line 350-500: Composite indexes
- Line 500-700: EXPLAIN ANALYZE
- Line 700-850: Query optimization
- Line 850-874: Partitioning

### Transactions & Concurrency (File 4)
- Line 1-150: ACID properties
- Line 150-400: Isolation levels
- Line 400-600: Locking
- Line 600-750: Deadlocks
- Line 750-900: Optimistic vs pessimistic

### Database Design (File 5)
- Line 1-200: Normal forms (1NF-BCNF)
- Line 200-350: Normalization vs denormalization
- Line 350-500: ER modeling & keys
- Line 500-700: Design patterns
- Line 700-900: Migrations & sharding
- Line 900-1050: Design exercises

### Interview Questions (File 6)
- Q1-Q6: SQL optimization
- Q7-Q11: PostgreSQL internals
- Q12-Q14: Indexing
- Q15-Q17: Transactions & concurrency
- Q18-Q20: Database design
- Q21-Q26: Scenario-based
- Q27: Comparisons
- Q28: Anti-patterns

---

## Key Concepts Checklist

### Must Know
- [ ] SQL execution order (FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT)
- [ ] MVCC (xmin/xmax, visibility, prevents blocking)
- [ ] Index types (B-Tree, GIN, BRIN, etc.)
- [ ] Isolation levels (READ COMMITTED, REPEATABLE READ, SERIALIZABLE)
- [ ] Normal forms (1NF, 2NF, 3NF)
- [ ] EXPLAIN ANALYZE interpretation

### Should Know
- [ ] B-Tree internals
- [ ] Window functions
- [ ] Deadlock prevention
- [ ] Query optimization workflow
- [ ] Design patterns
- [ ] Partitioning and sharding

### Nice to Know
- [ ] WAL mechanics
- [ ] TOAST storage
- [ ] Two-Phase Commit
- [ ] Advisory locks
- [ ] Replication strategies

---

## Practice Problems

### SQL Problems (File 1, end section)
1. Find 2nd highest salary
2. Find Nth highest salary
3. Employees earning > department average
4. Top 3 employees by salary per department
5. Consecutive dates/login problem
6. Pivot table
7. Last login per user
8. Employees with no orders
9. Products never ordered
10. Median salary
11. Gap and islands problem
12. Ranking by amount
13. Top N customers
14. Event sequence detection
15. Attrition by cohort
16-20. More challenging problems

### Design Exercises (File 5, end section)
1. Social media database (users, posts, comments, followers)
2. E-commerce database (products, orders, inventory, payments)
3. Additional exercises to create from scratch

### Interview Questions (File 6)
50+ questions across 8 categories with full answers

---

## Time Estimates

| Activity | Time |
|----------|------|
| Read File 1 (SQL) | 3-4 hours |
| Read File 2 (Internals) | 2-3 hours |
| Read File 3 (Indexing) | 3-4 hours |
| Read File 4 (Transactions) | 2-3 hours |
| Read File 5 (Design) | 3-4 hours |
| Read File 6 (Q&A) | 4-5 hours |
| Review QUICK-REFERENCE | 30 mins |
| Practice SQL problems | 3-5 hours |
| Practice explaining (out loud) | 5-10 hours |
| Mock interviews | 3-5 hours |
| **TOTAL** | **30-40 hours** |

---

## Interview Prep Week-by-Week

### Week 1: Foundations
- **Monday**: Read File 1 (SQL)
- **Tuesday-Wednesday**: Read File 2 (Internals)
- **Thursday**: Practice SQL problems
- **Friday**: Review and consolidate

### Week 2: Optimization & Design
- **Monday**: Read File 3 (Indexing)
- **Tuesday**: Read File 4 (Transactions)
- **Wednesday-Thursday**: Read File 5 (Design)
- **Friday**: Review and consolidate

### Week 3: Interview Prep
- **Monday-Tuesday**: Read File 6 (Q&A)
- **Wednesday**: Review QUICK-REFERENCE
- **Thursday**: Practice explaining answers
- **Friday**: Mock interviews

---

## Most Important Sections

### If Only 1 Hour
1. Read QUICK-REFERENCE.md (30 min)
2. Memorize "Interview Gold Responses" section (15 min)
3. Review SQL execution order (15 min)

### If Only 5 Hours
1. File 1: SQL execution order + JOINs (1 hour)
2. File 3: Index types + EXPLAIN ANALYZE (1 hour)
3. File 4: Isolation levels + locking (1 hour)
4. File 6: Q1-Q15 (1.5 hours)
5. QUICK-REFERENCE review (0.5 hour)

### If 20+ Hours
1. Read all 6 files thoroughly (15 hours)
2. Study and practice File 6 Q&A (5 hours)
3. Create personal notes (3 hours)
4. Review QUICK-REFERENCE (1 hour)

---

## Success Indicators

### Before Interview - Can You:
- [ ] Explain SQL execution order from memory
- [ ] Draw a Venn diagram for different JOINs
- [ ] Explain MVCC without looking it up
- [ ] Read EXPLAIN ANALYZE output and identify issues
- [ ] Explain at least 3 index types and when to use each
- [ ] Describe isolation levels and their trade-offs
- [ ] Normalize a schema to 3NF
- [ ] Answer 10 of the File 6 questions confidently

### During Interview - Remember to:
- [ ] Ask clarifying questions first
- [ ] Explain trade-offs (consistency vs performance)
- [ ] Show knowledge of internals
- [ ] Use EXPLAIN ANALYZE examples
- [ ] Provide both SQL and Java code examples
- [ ] Discuss monitoring and debugging
- [ ] Consider edge cases
- [ ] Be honest about unknowns

---

## External Resources

### Official Documentation
- PostgreSQL: https://www.postgresql.org/docs/current/
- MySQL: https://dev.mysql.com/doc/
- SQLite: https://www.sqlite.org/docs.html

### Practice Platforms
- LeetCode Database (medium-hard difficulty)
- HackerRank SQL challenges
- Mode Analytics SQL Tutorial
- Stanford DB course materials

### Monitoring Tools
- pg_stat_statements (query statistics)
- EXPLAIN (query planning)
- top, iostat, vmstat (system metrics)
- pgAdmin (GUI management)

---

## Final Reminders

1. **Read actively** - Make notes, draw diagrams, ask yourself questions
2. **Practice out loud** - Pretend you're explaining to an interviewer
3. **Use real examples** - Reference databases you've actually worked with
4. **Review QUICK-REFERENCE** - 30 minutes before your interview
5. **Get good sleep** - Night before interview is more important than cramming
6. **Be confident** - You've prepared thoroughly, trust your knowledge

---

## Questions?

All content is self-contained in these files. If something is unclear:
1. Check the specific file for that topic
2. Review QUICK-REFERENCE for key concepts
3. Look at File 6 for worked examples
4. Check README for navigation help

Good luck with your FAANG interview!

---

**Last Updated:** February 2025
**Total Content:** 6,400+ lines, ~200KB
**Estimated Study Time:** 20-40 hours
**Target:** Senior/Staff Engineer level interviews
