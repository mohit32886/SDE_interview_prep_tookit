# Java Interview Preparation - Complete Deep Dive

**Target Audience:** Mid-level Java engineers with 5+ years of experience preparing for FAANG companies

**Total Content:** 9,500+ lines | ~300+ KB of comprehensive material

---

## Overview

This comprehensive interview preparation guide covers Java at a **deep, production-level** understanding rather than surface-level knowledge. Each module includes:

- **In-depth explanations** of how things work internally
- **Real-world code examples** showing correct patterns
- **Common pitfalls** and anti-patterns to avoid
- **Interview questions** with detailed answers
- **Performance implications** and trade-offs
- **Why it matters** in real systems

---

## Module Breakdown

### 1. Core Java Fundamentals (1,912 lines)
**File:** `01-Core-Java-Fundamentals.md`

Core concepts that distinguish junior from senior engineers.

**Topics:**
- **OOP Principles:** Abstraction vs Encapsulation (real differences), Polymorphism (compile-time vs runtime), Inheritance pitfalls
- **equals() and hashCode():** Contract details, real consequences of breaking it, HashMap failures
- **String Internals:** String pool, immutability rationale, StringBuilder vs StringBuffer optimization
- **Generics:** Type erasure (the core concept), bounded wildcards, PECS principle
- **Autoboxing/Unboxing:** Integer caching (-128 to 127), performance implications
- **final/finally/finalize:** Differences, use cases, gotchas
- **static Keyword:** Class variables vs instance variables, static blocks, static inner classes
- **Marker Interfaces vs Annotations:** Trade-offs and when to use each
- **Cloning:** Shallow vs deep copy, Cloneable pitfalls, better alternatives
- **Serialization:** serialVersionUID, transient, custom serialization, versioning

**Key Insight:** Understanding equals/hashCode is critical—breaking the contract causes data loss in HashMaps. This separates understanding from knowing the name.

---

### 2. Collections Framework (1,344 lines)
**File:** `02-Collections-Framework.md`

Deep dive into implementations, not just API usage.

**Topics:**
- **HashMap:** Internal array of nodes, hashing, collision handling, treeification at threshold 8 (Java 8+)
- **ArrayList:** Dynamic resizing with 1.5x growth, amortized O(1) analysis
- **LinkedList:** Doubly linked structure, when NOT to use (O(n) get)
- **TreeMap:** Red-Black tree internals, range queries, O(log n) guarantees
- **ConcurrentHashMap:** Segment locking (pre-Java 8) vs node-level locking (Java 8+), performance comparison
- **LinkedHashMap:** Insertion vs access order, LRU cache implementation
- **Comparable vs Comparator:** Contract consistency, TreeSet/TreeMap pitfalls
- **Iterator:** Fail-fast vs fail-safe, ConcurrentModificationException, CopyOnWriteArrayList
- **PriorityQueue:** Min-heap implementation, peek/poll/add complexity
- **Decision Matrix:** Which collection for which scenario

**Key Insight:** HashMap collision handling matters. Java 8+ automatically converts linked lists to Red-Black trees at size 8, improving worst-case complexity from O(n) to O(log n).

---

### 3. Concurrency and Multithreading (1,599 lines)
**File:** `03-Concurrency-and-Multithreading.md`

Production-level thread safety understanding.

**Topics:**
- **Thread Lifecycle:** 6 states, common mistakes (calling run() instead of start())
- **Runnable vs Callable:** Return values, exception handling differences
- **Thread vs ExecutorService:** Why direct thread creation is problematic, thread pooling benefits
- **synchronized Keyword:** Method-level vs block-level, monitor locks, reentrant locking
- **volatile Keyword:** Visibility guarantees, when NOT sufficient, happens-before semantics
- **java.util.concurrent:** ReentrantLock, ReadWriteLock, CountDownLatch, CyclicBarrier, Semaphore
- **CompletableFuture:** Composition, exception handling, async patterns
- **Thread Pools:** FixedThreadPool, CachedThreadPool, custom ThreadPoolExecutor tuning
- **ThreadLocal:** Use cases, memory leak risks (critical in thread pools)
- **Deadlock/Livelock/Starvation:** Causes and prevention strategies
- **AtomicInteger and CAS:** Lock-free programming, Compare-And-Swap operations
- **Java Memory Model:** Happens-before rules, memory barriers, visibility guarantees
- **Producer-Consumer:** Wait-notify patterns, BlockingQueue

**Key Insight:** volatile guarantees visibility but NOT atomicity. Many developers use volatile for counters and are surprised by race conditions. volatile is for simple flag sharing, not complex synchronization.

---

### 4. JVM Internals and Memory (1,202 lines)
**File:** `04-JVM-Internals-and-Memory.md`

Understanding JVM behavior is crucial for debugging production issues.

**Topics:**
- **JVM Architecture:** ClassLoader, Runtime Data Areas, Execution Engine
- **Memory Areas:** Heap (Young/Old Gen), Metaspace, Stack (per-thread), PC Register
- **Garbage Collection:** Serial, Parallel, CMS, G1, ZGC algorithms and trade-offs
- **GC Tuning:** Key JVM flags (-Xms, -Xmx, -Xmn), monitoring with jstat/jmap
- **Class Loading:** Delegation model, Bootstrap/Extension/Application loaders
- **JIT Compilation:** When JIT activates (~1500 invocations), C1 vs C2 compilers, tiered compilation
- **Memory Leaks:** Common patterns (static collections, ThreadLocal, listeners), detection methods
- **OutOfMemoryError Types:** Java heap, Metaspace, Stack overflow, Code cache
- **Advanced Features:** String deduplication, escape analysis, lock elision

**Key Insight:** G1GC is the modern default for heaps > 4GB. It provides predictable pause times by collecting garbage-first (most garbage-dense regions). ZGC achieves < 10ms pauses even on multi-TB heaps, critical for ultra-low-latency systems.

---

### 5. Java 8+ Features (1,293 lines)
**File:** `05-Java-8-Plus-Features.md`

Modern Java APIs that are essential in current code.

**Topics:**
- **Lambda Expressions:** Syntax, effectively final variables, this reference
- **Functional Interfaces:** Function, Predicate, Consumer, Supplier, BiFunctions
- **Method References:** Static, instance, constructor references, when to use
- **Stream API:** Intermediate vs terminal, lazy evaluation, short-circuit optimization
- **Stream Pitfalls:** Multiple iterations, collecting then processing, parallel stream misuse
- **Optional:** Proper usage (map/filter/ifPresent), anti-patterns (using as field)
- **Default Methods in Interfaces:** Enabling interface evolution without breaking implementations
- **Java 9 Modules:** JPMS for explicit dependencies and encapsulation
- **Java 10 var Keyword:** Type inference for local variables, readability trade-offs
- **Java 14 Records:** Immutable data carriers reducing boilerplate
- **Java 17 Sealed Classes:** Restrict inheritance, enable exhaustive pattern matching
- **Java 21 Virtual Threads:** Project Loom, millions of lightweight threads, structured concurrency
- **Performance:** Streams vs loops trade-offs

**Key Insight:** Streams are slower than loops for simple operations (1.5-2x overhead), but readability gains often justify the cost. Parallel streams add even more overhead and only benefit on large datasets with CPU-intensive operations.

---

### 6. Exception Handling and Best Practices (1,144 lines)
**File:** `06-Exception-Handling-and-Best-Practices.md`

Exception handling done right separates professionals from amateurs.

**Topics:**
- **Exception Hierarchy:** Error, Checked vs Unchecked, RuntimeException
- **Checked Exceptions:** When to use, problems with throws chains
- **Unchecked Exceptions:** For programming errors, argument validation
- **Custom Exceptions:** When and how to create domain-specific exceptions
- **Try-With-Resources:** AutoCloseable, automatic resource cleanup, suppressed exceptions
- **Best Practices:** Catch specific exceptions, fail fast, include context in messages
- **Exception Chaining:** Preserving cause, context addition, multi-catch (Java 7+)
- **Performance Impact:** Exceptions are 1000x slower than normal code (stack trace capture)
- **SOLID Principles:** How exceptions relate to Single Responsibility, Dependency Inversion
- **Effective Java Items:** Using standard exceptions, exception translation, failure capture
- **Anti-Patterns:** Returning null for errors, catch-and-ignore, broad exception catching

**Key Insight:** Exceptions are expensive (100+ microseconds each due to stack trace). Never use exceptions for control flow. "Exceptional" means rare; if it happens often, use return values or Optional.

---

### 7. Java Coding Problems (1,034 lines)
**File:** `07-Java-Coding-Problems.md`

30+ hands-on problems covering common FAANG interview scenarios.

**Organized by Category:**

**String Manipulation (3 problems)**
- Longest Palindromic Substring (O(n²) with expand-around-center)
- String Matching (naive vs KMP algorithm)
- Reverse Words (O(n) with trim/split)

**Array/List Operations (4 problems)**
- Two Sum (HashMap for O(n))
- Best Time to Buy/Sell Stock (min tracking for O(n))
- Container With Most Water (two pointers)

**HashMap-Based (3 problems)**
- Implement LRU Cache (doubly linked list + HashMap)
- Top K Frequent Elements (min-heap of size k)
- Implement HashMap from scratch (collision handling, resizing)

**Concurrency Puzzles (3 problems)**
- Implement Blocking Queue (wait/notify)
- Thread-Safe Singleton (double-checked locking with volatile)
- Producer-Consumer (BlockingQueue abstraction)

**Stream API Challenges (2 problems)**
- Stream reduction with complex logic
- Grouping with Collectors

**OOP Design (3+ problems)**
- Observer Pattern / Event Bus
- Factory Pattern with Enum
- Trie Implementation
- Rate Limiter (Token Bucket Algorithm)

**Each Problem Includes:**
- Problem statement and examples
- Multiple solution approaches
- Time/space complexity analysis
- Key insights and trade-offs

---

## How to Use This Guide

### For Systematic Study (2-4 weeks)
1. **Week 1:** Core Java Fundamentals (01) + Collections (02)
2. **Week 2:** Concurrency (03) + JVM Internals (04)
3. **Week 3:** Java 8+ Features (05) + Exception Handling (06)
4. **Week 4:** Coding Problems (07) + Practice with real scenarios

### For Targeted Preparation
- **Before System Design Interview:** Focus on JVM Internals (04) and Concurrency (03)
- **Before Coding Interview:** Study Coding Problems (07) + relevant sections
- **For Depth Interview:** Use all materials, emphasize "why it matters" sections

### For Refreshing Specific Topics
- Each file is self-contained with cross-references
- "Key Takeaway Summary" at end of each file provides quick reference
- Interview questions section in each file for specific scenarios

---

## Key Insights Summary

### What Separates Senior Engineers
1. **Understanding WHY:** Know not just that String is immutable, but why (thread-safety, pooling, security)
2. **Trade-offs:** Every design choice has trade-offs (GC latency vs throughput, thread safety vs performance)
3. **Production Mindset:** Thinking about monitoring, debugging, and operational aspects
4. **Performance Implications:** Understanding Big-O is good; understanding cache effects is better
5. **Patterns and Anti-Patterns:** Recognizing both correct and incorrect code in real systems

### FAANG Interview Focus Areas
- **Amazon:** Distributed systems, scalability (JVM Internals, Collections for large data)
- **Meta (Facebook):** Performance optimization (Streams, Concurrency, JVM tuning)
- **Google:** Algorithms + deep Java knowledge (Coding Problems, Concurrency)
- **Apple:** Clean code, design patterns (Exception Handling, OOP Design)
- **Netflix:** Concurrency, reactive programming (CompletableFuture, Virtual Threads)

---

## Topics NOT Covered (But Important)

These are outside the scope but important for complete mastery:
- **Spring Framework:** Dependency injection, AOP (covered in OOP principles)
- **Databases:** SQL, indexing (can apply Collections framework knowledge)
- **Design Patterns:** Gang of Four patterns (examples integrated throughout)
- **Build Tools:** Maven, Gradle (outside scope)
- **Testing:** JUnit, Mockito (mentioned in OOP)

---

## Time Estimates

| Module | Study Time | Practice | Total |
|--------|-----------|----------|-------|
| 01 Core Java | 3-4 hours | 1 hour | 4-5 hours |
| 02 Collections | 2-3 hours | 1.5 hours | 3.5-4.5 hours |
| 03 Concurrency | 3-4 hours | 2 hours | 5-6 hours |
| 04 JVM Internals | 2-3 hours | 1 hour | 3-4 hours |
| 05 Java 8+ | 2-3 hours | 1 hour | 3-4 hours |
| 06 Exceptions | 2 hours | 1 hour | 3 hours |
| 07 Coding Problems | 4-5 hours | 3-4 hours | 7-9 hours |
| **Total** | **18-24 hours** | **9-11 hours** | **27-35 hours** |

---

## Quick Reference Cheatsheets

### Collections Time Complexity
```
HashMap: get/put O(1), remove O(1)
ArrayList: get O(1), add O(1) amortized, insert O(n)
LinkedList: get O(n), add O(1) at ends, insert O(1) if at known position
TreeMap: get/put/remove O(log n)
ConcurrentHashMap: same as HashMap with fine-grained locking
```

### Thread Safety
```
synchronized: provides visibility + mutual exclusion
volatile: provides visibility only
AtomicInteger: provides visibility + atomicity (CAS-based)
ConcurrentHashMap: provides visibility + fine-grained locking
ReadWriteLock: allows multiple readers, single writer
```

### GC Algorithms
```
Serial: single-threaded, lowest overhead, high pause time
Parallel: multi-threaded, high throughput, high pause time
CMS: concurrent marking, low pause, fragmentation issues
G1: regions, predictable pause, modern default
ZGC: ultra-low pause (< 10ms), high CPU overhead
```

---

## Common Interview Tricks and Gotchas

1. **String == vs .equals():** == checks reference, equals checks value
2. **Integer caching:** -128 to 127 cached, so equality can be surprising
3. **ConcurrentModificationException:** Thrown when modifying collection during iteration
4. **hashCode() contract:** If a.equals(b), then a.hashCode() == b.hashCode(). Breaking this causes HashMap failures.
5. **volatile and atomicity:** volatile visibility but NOT atomicity for compound operations
6. **HashMap null key:** HashMap allows one null key (stored at bucket 0), TreeMap doesn't
7. **Thread.sleep() in synchronized:** Doesn't release lock, can cause deadlock
8. **wait() without while loop:** Another thread might wake you, but condition might not be true
9. **Stream terminal operators:** Forgetting terminal operator means stream never executes
10. **var keyword limitations:** Only for local variables, type must be inferrable

---

## Additional Resources

- **Official Documentation:** Java API docs, JVM Specification
- **Tools:** JProfiler, YourKit, Eclipse MAT (memory analyzer)
- **Monitoring:** GCeasy (online GC log analyzer), New Relic, Datadog
- **References:** Effective Java (Joshua Bloch), Java Concurrency in Practice (Brian Goetz)

---

## Versions Covered

- **Core Java:** 5-21
- **Main Focus:** Java 8-17 (industry standard)
- **Latest:** Java 21 (Virtual Threads, Pattern Matching)

---

## Feedback and Improvements

This guide is comprehensive but never complete. Interview scenarios vary by company and team. Focus on understanding concepts deeply rather than memorizing facts.

**Good Luck!** Remember: FAANG companies test depth of understanding, not breadth of knowledge. A single well-explained answer about why HashMap works is better than surface-level knowledge of many topics.

---

**Created:** February 2026
**Total Lines:** 9,500+
**Total Size:** ~300 KB
**Audience:** Mid-level engineers preparing for senior roles at top tech companies
