# Concurrency and Multithreading - Deep Dive

## Table of Contents
1. [Thread Lifecycle](#thread-lifecycle)
2. [Runnable vs Callable](#runnable-vs-callable)
3. [Thread vs ExecutorService](#thread-vs-executorservice)
4. [synchronized Keyword](#synchronized-keyword)
5. [volatile Keyword](#volatile-keyword)
6. [java.util.concurrent Tools](#javautilconcurrent-tools)
7. [CompletableFuture](#completablefuture)
8. [Thread Pools](#thread-pools)
9. [ThreadLocal](#threadlocal)
10. [Deadlock, Livelock, Starvation](#deadlock-livelock-starvation)
11. [Atomic Variables and CAS](#atomic-variables-and-cas)
12. [Java Memory Model](#java-memory-model)
13. [Producer-Consumer Pattern](#producer-consumer-pattern)
14. [Interview Questions](#interview-questions)

---

## Thread Lifecycle

### Thread States

```java
public class ThreadLifecycle {
    public void demonstrateThreadStates() {
        // Thread has 6 states:
        // 1. NEW: Created but not started
        // 2. RUNNABLE: Running or ready to run
        // 3. BLOCKED: Waiting for monitor lock
        // 4. WAITING: Waiting indefinitely for another thread
        // 5. TIMED_WAITING: Waiting for specified time
        // 6. TERMINATED: Execution complete

        Thread thread = new Thread(() -> {
            System.out.println("Running");
        });

        System.out.println(thread.getState()); // NEW

        thread.start();
        System.out.println(thread.getState()); // RUNNABLE or RUNNING

        // Wait for completion
        try {
            thread.join(); // Main thread waits
        } catch (InterruptedException e) {
            e.printStackTrace();
        }

        System.out.println(thread.getState()); // TERMINATED
    }

    public void blockingExample() {
        Object lock = new Object();

        Thread t1 = new Thread(() -> {
            synchronized (lock) {
                System.out.println("T1 has lock");
                try { Thread.sleep(1000); } catch (InterruptedException e) {}
            }
        });

        Thread t2 = new Thread(() -> {
            System.out.println("T2 waiting for lock");
            synchronized (lock) {
                System.out.println("T2 acquired lock");
            }
        });

        t1.start();
        try { Thread.sleep(10); } catch (InterruptedException e) {}
        t2.start();

        // T2 is BLOCKED while T1 holds lock
    }

    public void waitingExample() {
        Object monitor = new Object();

        Thread waiter = new Thread(() -> {
            synchronized (monitor) {
                try {
                    System.out.println("T1 waiting");
                    monitor.wait(); // WAITING state
                    System.out.println("T1 resumed");
                } catch (InterruptedException e) {}
            }
        });

        Thread notifier = new Thread(() -> {
            try { Thread.sleep(500); } catch (InterruptedException e) {}
            synchronized (monitor) {
                System.out.println("T2 notifying");
                monitor.notifyAll(); // Wakes waiter
            }
        });

        waiter.start();
        notifier.start();
    }
}
```

### Starting Threads - Common Mistakes

```java
public class ThreadStartingMistakes {
    public void wrongWay() {
        // MISTAKE 1: Calling run() instead of start()
        Thread thread = new Thread(() -> {
            System.out.println("Running on: " + Thread.currentThread().getName());
        });

        thread.run(); // WRONG - executes in current thread (main)
                      // Not in separate thread!

        thread.start(); // CORRECT - executes in new thread
    }

    public void wrongWay2() {
        // MISTAKE 2: Restarting thread
        Thread thread = new Thread(() -> {
            System.out.println("Running");
        });

        thread.start();
        // thread.start(); // ILLEGAL - throws IllegalThreadStateException
                          // Can't start same thread twice
    }

    public void wrongWay3() {
        // MISTAKE 3: Sleeping in main thread
        Thread thread = new Thread(() -> {
            System.out.println("Task");
        });

        thread.start();

        try {
            thread.sleep(1000); // WRONG - main thread sleeps, not worker
        } catch (InterruptedException e) {}

        // Correct:
        thread.start();
        try {
            thread.join(); // Main waits for worker to finish
        } catch (InterruptedException e) {}
    }
}
```

---

## Runnable vs Callable

### Runnable: No Return Value

```java
public class RunnableExample {
    public void demonstrateRunnable() {
        // Runnable: no return value, can't throw checked exceptions
        Runnable task = () -> {
            System.out.println("Task executing");
            // Can't return anything
            // Can throw only unchecked exceptions
        };

        Thread thread = new Thread(task);
        thread.start();
    }

    public void runnableWithException() {
        Runnable task = () -> {
            try {
                Thread.sleep(100);
                // throw new IOException("Error"); // Must catch or wrap
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt(); // Re-interrupt if needed
            }
        };

        new Thread(task).start();
    }
}
```

### Callable: Returns Value, Throws Exception

```java
public class CallableExample {
    public void demonstrateCallable() {
        // Callable: returns value, can throw checked exceptions
        Callable<Integer> task = () -> {
            System.out.println("Computing");
            return 42; // Can return value
        };

        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<Integer> future = executor.submit(task);

            // Block until result available
            Integer result = future.get(); // Returns 42

            System.out.println("Result: " + result);
        } catch (ExecutionException | InterruptedException e) {
            e.printStackTrace();
        } finally {
            executor.shutdown();
        }
    }

    public void callableWithException() throws Exception {
        Callable<String> task = () -> {
            if (Math.random() > 0.5) {
                throw new IOException("Simulated error"); // Can throw checked exception
            }
            return "Success";
        };

        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<String> future = executor.submit(task);
            String result = future.get(); // Throws ExecutionException if task failed
            System.out.println(result);
        } catch (ExecutionException e) {
            // Task threw exception
            Throwable cause = e.getCause();
            System.err.println("Task failed: " + cause.getMessage());
        } finally {
            executor.shutdown();
        }
    }
}
```

### Comparison Table

| Feature | Runnable | Callable |
|---------|----------|----------|
| **Return Value** | No | Yes (T) |
| **Exception Handling** | Unchecked only | Checked + Unchecked |
| **Used With** | Thread | ExecutorService |
| **Method** | run() | call() |

---

## Thread vs ExecutorService

### Direct Thread Creation Issues

```java
public class ThreadCreationIssues {
    public void directThreadProblems() {
        // Creating threads directly is problematic

        // Problem 1: Each thread is expensive (memory: ~1MB per thread)
        List<Thread> threads = new ArrayList<>();
        for (int i = 0; i < 10000; i++) {
            Thread t = new Thread(() -> {
                try { Thread.sleep(1000); } catch (InterruptedException e) {}
            });
            threads.add(t);
            t.start();
        }
        // Creates 10,000 threads - OutOfMemoryError likely

        // Problem 2: No control over thread creation
        // OS might limit threads before you want

        // Problem 3: No way to reuse threads
        // Create, run, destroy - inefficient
    }
}
```

### ExecutorService: Thread Pooling

```java
public class ExecutorServiceExample {
    public void threadPoolBenefits() {
        // ExecutorService maintains pool of reusable threads

        // Create pool with fixed number of threads
        ExecutorService executor = Executors.newFixedThreadPool(4);

        // Submit tasks - reuses threads from pool
        for (int i = 0; i < 100; i++) {
            final int taskId = i;
            executor.submit(() -> {
                System.out.println("Task " + taskId + " on " +
                    Thread.currentThread().getName());
                try { Thread.sleep(100); } catch (InterruptedException e) {}
            });
        }

        // Only 4 threads created, but 100 tasks handled
        // Threads reused for multiple tasks

        executor.shutdown(); // Stop accepting new tasks
        try {
            executor.awaitTermination(1, TimeUnit.MINUTES); // Wait for completion
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public void executorServiceVsThread() {
        // With threads: Create 10 threads
        long start = System.currentTimeMillis();
        List<Thread> threads = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            Thread t = new Thread(() -> {
                try { Thread.sleep(100); } catch (InterruptedException e) {}
            });
            threads.add(t);
            t.start();
        }
        for (Thread t : threads) {
            try { t.join(); } catch (InterruptedException e) {}
        }
        long directTime = System.currentTimeMillis() - start;

        // With ExecutorService: Create pool once
        start = System.currentTimeMillis();
        ExecutorService executor = Executors.newFixedThreadPool(10);
        for (int i = 0; i < 10; i++) {
            executor.submit(() -> {
                try { Thread.sleep(100); } catch (InterruptedException e) {}
            });
        }
        executor.shutdown();
        try {
            executor.awaitTermination(1, TimeUnit.MINUTES);
        } catch (InterruptedException e) {}
        long executorTime = System.currentTimeMillis() - start;

        // Similar time, but executor has less overhead
        // Executor scales better with multiple task batches
    }
}
```

---

## synchronized Keyword

### Method-Level vs Block-Level

```java
public class SynchronizedMechanics {
    public class Counter {
        private int count = 0;

        // Method-level synchronization: locks entire method
        public synchronized void increment() {
            count++;
        }

        public synchronized int getCount() {
            return count;
        }

        // Block-level synchronization: locks only critical section
        public void incrementBlock() {
            synchronized (this) {
                count++;
            }
        }
    }

    public void methodVsBlock() {
        Counter counter = new Counter();

        // Method-level: entire method locked
        // Thread waiting for increment() can't call getCount()

        // Block-level: only critical section locked
        // More fine-grained control
        public void efficientSync() {
            synchronized (this) {
                // Only this part locked
            }
            // Rest of method not locked - other threads can run
        }
    }
}
```

### Monitor Lock Mechanism

```java
public class MonitorLock {
    public void howMonitorWorks() {
        Object lock = new Object();

        new Thread(() -> {
            synchronized (lock) {
                // Thread acquires monitor lock on 'lock'
                System.out.println("T1 has lock");
                try { Thread.sleep(1000); } catch (InterruptedException e) {}
                System.out.println("T1 releasing lock");
                // Monitor lock automatically released
            }
        }).start();

        new Thread(() -> {
            synchronized (lock) {
                // Thread waits for monitor lock
                System.out.println("T2 has lock");
                // Can't start until T1 releases
            }
        }).start();
    }

    public void staticSync() {
        // Synchronization on class method: locks class object
        public class Counter {
            private static int count = 0;

            public static synchronized void increment() {
                // Locks Counter.class object
                // Only one thread can execute static synchronized method
                count++;
            }
        }

        // Different from synchronized on instance
        Counter c1 = new Counter();
        Counter c2 = new Counter();

        // These DON'T interfere (different objects):
        c1.increment(); // Locks c1
        c2.increment(); // Locks c2 (concurrent possible)

        // But static:
        Counter.increment(); // Locks Counter.class
        Counter.increment(); // Must wait for first to complete
    }
}
```

### Reentrancy

```java
public class ReentrantExample {
    public class ReentrantLock {
        private int count = 0;

        public synchronized void outer() {
            count++;
            inner(); // Reentrant: can acquire same lock again
        }

        public synchronized void inner() {
            count++; // Can access synchronized method
        }

        public void testReentrant() {
            // No deadlock because lock is reentrant
            outer(); // Works fine
        }
    }

    public void manualReentrant() {
        Object lock = new Object();

        new Thread(() -> {
            synchronized (lock) {
                System.out.println("T1 first lock");

                // Same thread can acquire lock again
                synchronized (lock) {
                    System.out.println("T1 second lock"); // No deadlock
                }

                System.out.println("T1 exiting");
            }
        }).start();

        // Java's monitor lock is automatically reentrant
        // JVM tracks which thread owns lock
        // Same thread acquiring again increments counter
    }
}
```

---

## volatile Keyword

### Visibility Guarantee

```java
public class VolatileVisibility {
    public void withoutVolatile() {
        class Data {
            private boolean flag = false; // NOT volatile
            private int value = 0;

            public void writeData() {
                value = 42;
                flag = true;
                // Compiler might reorder:
                // flag = true;
                // value = 42;
                // (Reordering legal because writes to different variables)
            }

            public void readData() {
                if (flag) { // Reads stale value from cache
                    System.out.println("value: " + value); // Might be 0, not 42
                    // Thread has cached value in register
                }
            }
        }

        // Multiple threads, unpredictable behavior
    }

    public void withVolatile() {
        class Data {
            private volatile boolean flag = false; // Volatile ensures visibility
            private volatile int value = 0;

            public void writeData() {
                value = 42;
                flag = true;
                // volatile writes create memory barrier
                // All writes before volatile write become visible to other threads
            }

            public void readData() {
                if (flag) {
                    System.out.println("value: " + value); // Always 42
                    // volatile read creates memory barrier
                    // Reads fresh value from main memory
                }
            }
        }
    }
}
```

### volatile is NOT Enough

```java
public class VolatileNotEnough {
    public class UnsafeIncrement {
        private volatile int count = 0; // volatile NOT sufficient

        public void increment() {
            count++; // NOT atomic!
            // Read count, increment, write back
            // Race condition between read and write
        }

        public int getCount() {
            return count; // Reads fresh value
        }
    }

    public void demonstrateRaceCondition() throws InterruptedException {
        UnsafeIncrement counter = new UnsafeIncrement();

        // Two threads incrementing
        Thread t1 = new Thread(() -> {
            for (int i = 0; i < 1000; i++) {
                counter.increment();
            }
        });

        Thread t2 = new Thread(() -> {
            for (int i = 0; i < 1000; i++) {
                counter.increment();
            }
        });

        t1.start();
        t2.start();
        t1.join();
        t2.join();

        System.out.println("Count: " + counter.getCount());
        // Expect 2000, but often less due to race condition
        // volatile ensures visibility, but not atomicity
    }

    public void whenVolatileWorks() {
        class Status {
            private volatile boolean running = true; // Simple flag assignment atomic

            public void stop() {
                running = false; // Atomic
            }

            public boolean isRunning() {
                return running; // Atomic
            }
        }

        // Volatile works for:
        // - Simple assignments (flags)
        // - Reads when writes happen elsewhere
        // - Visibility guarantees without needing full synchronization
    }
}
```

### Happens-Before Relationship

```java
public class HappensBeforeSemantic {
    public void volatileHappensBefore() {
        class SharedData {
            private int value1 = 0;
            private volatile int value2 = 0;

            public void write() {
                value1 = 42; // Regular write
                value2 = 100; // Volatile write - memory barrier here
                // All writes (including value1) before volatile write must complete
            }

            public void read() {
                if (value2 == 100) { // Volatile read - memory barrier here
                    // All reads after volatile read see fresh memory
                    System.out.println("value1: " + value1); // Guaranteed 42
                }
            }
        }

        // Happens-before rule:
        // If write to volatile happens before read of same volatile,
        // Then all operations before write are visible to read
    }
}
```

---

## java.util.concurrent Tools

### ReentrantLock

```java
public class ReentrantLockExample {
    public void basicUsage() {
        Lock lock = new ReentrantLock();

        lock.lock();
        try {
            // Critical section
            System.out.println("Executing critical section");
        } finally {
            lock.unlock(); // Always unlock in finally
        }

        // Advantages over synchronized:
        // 1. Try-lock with timeout
        // 2. Interruptible locks
        // 3. Multiple conditions
        // 4. Fair locking option
    }

    public void tryLockWithTimeout() throws InterruptedException {
        Lock lock = new ReentrantLock();

        if (lock.tryLock(1, TimeUnit.SECONDS)) {
            try {
                System.out.println("Acquired lock");
            } finally {
                lock.unlock();
            }
        } else {
            System.out.println("Couldn't acquire lock in time");
        }
    }

    public void fairness() {
        Lock lock = new ReentrantLock(true); // Fair lock

        // Fair: threads acquire lock in FIFO order
        // Unfair: threads might be starved
        // Fairness has performance cost
    }
}
```

### ReadWriteLock

```java
public class ReadWriteLockExample {
    public class Cache {
        private Map<String, String> data = new HashMap<>();
        private ReadWriteLock lock = new ReentrantReadWriteLock();

        public String read(String key) {
            lock.readLock().lock(); // Multiple readers allowed
            try {
                return data.get(key);
            } finally {
                lock.readLock().unlock();
            }
        }

        public void write(String key, String value) {
            lock.writeLock().lock(); // Exclusive lock
            try {
                data.put(key, value);
            } finally {
                lock.writeLock().unlock();
            }
        }

        // Multiple readers can run concurrently
        // But writer blocks all readers
        // This improves performance when reads >> writes
    }
}
```

### CountDownLatch

```java
public class CountDownLatchExample {
    public void demonstrateCountDownLatch() throws InterruptedException {
        CountDownLatch latch = new CountDownLatch(3);

        // Start 3 workers
        for (int i = 0; i < 3; i++) {
            final int id = i;
            new Thread(() -> {
                System.out.println("Worker " + id + " starting");
                try { Thread.sleep(100 * (id + 1)); } catch (InterruptedException e) {}
                System.out.println("Worker " + id + " done");
                latch.countDown(); // Decrement counter
            }).start();
        }

        System.out.println("Main waiting for workers");
        latch.await(); // Wait for counter to reach 0
        System.out.println("All workers done");

        // Key difference from Thread.join():
        // join() waits for specific thread
        // CountDownLatch waits for N tasks (could be many threads)
    }
}
```

### CyclicBarrier

```java
public class CyclicBarrierExample {
    public void demonstrateCyclicBarrier() throws BrokenBarrierException, InterruptedException {
        CyclicBarrier barrier = new CyclicBarrier(3, () -> {
            System.out.println("All threads reached barrier");
        });

        for (int i = 0; i < 3; i++) {
            final int id = i;
            new Thread(() -> {
                try {
                    System.out.println("Thread " + id + " starting");
                    Thread.sleep(100 * (id + 1));
                    System.out.println("Thread " + id + " reaching barrier");
                    barrier.await(); // Wait for all threads
                    System.out.println("Thread " + id + " resuming");
                } catch (InterruptedException | BrokenBarrierException e) {
                    e.printStackTrace();
                }
            }).start();
        }

        Thread.sleep(1000); // Let all finish

        // Key difference from CountDownLatch:
        // CyclicBarrier is reusable - can await multiple times
        // CountDownLatch is one-time - can't reset
    }
}
```

### Semaphore

```java
public class SemaphoreExample {
    public void demonstrateSemaphore() throws InterruptedException {
        Semaphore semaphore = new Semaphore(2); // Allow 2 concurrent accesses

        for (int i = 0; i < 5; i++) {
            final int id = i;
            new Thread(() -> {
                try {
                    System.out.println("Thread " + id + " acquiring");
                    semaphore.acquire(); // Decrement permit count
                    System.out.println("Thread " + id + " executing");
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                } finally {
                    System.out.println("Thread " + id + " releasing");
                    semaphore.release(); // Increment permit count
                }
            }).start();
        }

        Thread.sleep(3000);
        // Output shows only 2 threads running at a time
        // Others wait for permit
    }

    public void binarySemanticAsLock() {
        Semaphore lock = new Semaphore(1); // Binary semaphore

        // Can be used like a lock
        // But less efficient than actual locks
        // Semaphores useful when need more than 1 concurrent access
    }
}
```

---

## CompletableFuture

### Basic Completion

```java
public class CompletableFutureBasics {
    public void completedFuture() throws ExecutionException, InterruptedException {
        // Create already-completed future
        CompletableFuture<String> future = CompletableFuture.completedFuture("Hello");

        String result = future.get(); // Immediately returns "Hello"
        System.out.println(result);
    }

    public void supplyAsync() throws ExecutionException, InterruptedException {
        // Create future that runs in thread pool
        CompletableFuture<Integer> future = CompletableFuture.supplyAsync(() -> {
            System.out.println("Computing on: " + Thread.currentThread().getName());
            try { Thread.sleep(1000); } catch (InterruptedException e) {}
            return 42;
        });

        System.out.println("Main continuing");
        Integer result = future.get(); // Blocks until computation done
        System.out.println("Result: " + result);
    }

    public void runAsync() {
        // Fire-and-forget task (no return value)
        CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
            System.out.println("Running task");
            try { Thread.sleep(1000); } catch (InterruptedException e) {}
        });

        // Do other work while task runs
    }
}
```

### Composition

```java
public class CompletableFutureComposition {
    public void thenApply() throws ExecutionException, InterruptedException {
        CompletableFuture<Integer> future = CompletableFuture.supplyAsync(() -> 5)
            .thenApply(x -> x * 2) // Transform result
            .thenApply(x -> x + 10); // Chain transformations

        System.out.println(future.get()); // (5 * 2) + 10 = 20
    }

    public void thenCompose() throws ExecutionException, InterruptedException {
        // Compose futures (flatMap equivalent)
        CompletableFuture<Integer> future = CompletableFuture.supplyAsync(() -> 5)
            .thenCompose(x ->
                CompletableFuture.supplyAsync(() -> x * 2)
            );

        System.out.println(future.get()); // 10
    }

    public void thenCombine() throws ExecutionException, InterruptedException {
        // Combine results from two futures
        CompletableFuture<Integer> future1 = CompletableFuture.supplyAsync(() -> 5);
        CompletableFuture<Integer> future2 = CompletableFuture.supplyAsync(() -> 3);

        CompletableFuture<Integer> combined = future1.thenCombine(future2, (a, b) -> a + b);
        System.out.println(combined.get()); // 8
    }

    public void whenComplete() {
        CompletableFuture.supplyAsync(() -> {
            if (Math.random() > 0.5) {
                throw new RuntimeException("Error!");
            }
            return "Success";
        }).whenComplete((result, exception) -> {
            if (exception != null) {
                System.err.println("Failed: " + exception.getMessage());
            } else {
                System.out.println("Completed: " + result);
            }
        });
    }
}
```

### Exception Handling

```java
public class CompletableFutureExceptionHandling {
    public void exceptionallyExample() throws ExecutionException, InterruptedException {
        CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
            if (Math.random() > 0.5) {
                throw new RuntimeException("Something went wrong");
            }
            return "Success";
        }).exceptionally(exception -> {
            System.err.println("Error: " + exception.getMessage());
            return "Default value"; // Fallback
        });

        String result = future.get(); // "Success" or "Default value"
    }

    public void handleExample() throws ExecutionException, InterruptedException {
        CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
            if (Math.random() > 0.5) {
                throw new RuntimeException("Error");
            }
            return "Success";
        }).handle((result, exception) -> {
            if (exception != null) {
                return "Failed: " + exception.getMessage();
            }
            return "Result: " + result;
        });

        System.out.println(future.get());
    }
}
```

---

## Thread Pools

### Types of Thread Pools

```java
public class ThreadPoolTypes {
    public void fixedThreadPool() {
        ExecutorService executor = Executors.newFixedThreadPool(4);

        // Fixed number of threads
        // Queue tasks that exceed thread count
        // Good for: predictable workload
        // Risk: unbounded queue (OutOfMemoryError on many tasks)
    }

    public void cachedThreadPool() {
        ExecutorService executor = Executors.newCachedThreadPool();

        // Creates threads as needed, reuses idle threads
        // Threads timeout after 60 seconds of idleness
        // Good for: unpredictable workload, bursty
        // Risk: unbounded thread creation (thread limit)
    }

    public void scheduledThreadPool() {
        ScheduledExecutorService executor = Executors.newScheduledThreadPool(2);

        // Scheduled task execution
        executor.schedule(() -> System.out.println("Delayed task"), 5, TimeUnit.SECONDS);
        executor.scheduleAtFixedRate(
            () -> System.out.println("Periodic task"),
            0, 10, TimeUnit.SECONDS
        );
    }

    public void forkJoinPool() {
        ForkJoinPool pool = ForkJoinPool.commonPool();

        // Work-stealing pool for recursive tasks
        // Good for: divide-and-conquer algorithms
    }
}
```

### Custom ThreadPoolExecutor

```java
public class CustomThreadPoolExample {
    public void configureThreadPool() {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
            4,                              // corePoolSize
            8,                              // maxPoolSize
            60,                             // keepAliveTime
            TimeUnit.SECONDS,               // keepAliveTimeUnit
            new LinkedBlockingQueue<>(100), // workQueue
            Executors.defaultThreadFactory(),
            new ThreadPoolExecutor.AbortPolicy() // rejection policy
        );

        // Core threads: always kept alive (minimum)
        // Max threads: created when queue full
        // Keep-alive: excess threads timeout after this duration
        // Queue: holds pending tasks
        // Rejection policy: what to do when queue full and max threads reached
    }

    public void rejectionPolicies() {
        // AbortPolicy: throw RejectedExecutionException (default)
        // CallerRunsPolicy: execute on calling thread
        // DiscardPolicy: silently discard task
        // DiscardOldestPolicy: discard oldest pending task

        ThreadPoolExecutor executor1 = new ThreadPoolExecutor(
            1, 1, 0, TimeUnit.SECONDS,
            new SynchronousQueue<>(),
            new ThreadPoolExecutor.CallerRunsPolicy() // If queue full, main thread executes
        );

        ThreadPoolExecutor executor2 = new ThreadPoolExecutor(
            1, 1, 0, TimeUnit.SECONDS,
            new SynchronousQueue<>(),
            new ThreadPoolExecutor.DiscardPolicy() // If queue full, discard silently
        );
    }

    public void resizingPoolDynamically() {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
            2, 5, 60, TimeUnit.SECONDS, new LinkedBlockingQueue<>()
        );

        // Adjust at runtime
        executor.setCorePoolSize(4); // Increase core threads
        executor.setMaximumPoolSize(10); // Increase max threads
    }
}
```

---

## ThreadLocal

### Basic Usage

```java
public class ThreadLocalExample {
    // Thread-local variable: each thread has own value
    private static ThreadLocal<String> threadLocalVar = ThreadLocal.withInitial(() -> "default");

    public void demonstrateThreadLocal() {
        Thread t1 = new Thread(() -> {
            threadLocalVar.set("Value from T1");
            System.out.println("T1: " + threadLocalVar.get()); // "Value from T1"
        });

        Thread t2 = new Thread(() -> {
            threadLocalVar.set("Value from T2");
            System.out.println("T2: " + threadLocalVar.get()); // "Value from T2"
        });

        t1.start();
        t2.start();

        // Each thread sees its own value
        // No synchronization needed
    }

    public void userContextExample() {
        ThreadLocal<User> userContext = new ThreadLocal<>();

        class RequestHandler {
            void handleRequest(long userId) {
                User user = loadUser(userId);
                userContext.set(user); // Store in thread-local

                // Any method in this thread can access:
                processRequest(); // Accesses userContext
            }

            void processRequest() {
                User user = userContext.get(); // Retrieved from thread-local
                System.out.println("Processing for: " + user.name);
            }
        }

        // Web framework: each request in separate thread
        // userContext available throughout request lifecycle
    }
}
```

### Memory Leak Risk

```java
public class ThreadLocalMemoryLeak {
    private static ThreadLocal<byte[]> buffer = ThreadLocal.withInitial(() -> new byte[1024 * 1024]);

    public void memoryLeakInThreadPool() {
        ExecutorService executor = Executors.newFixedThreadPool(4);

        for (int i = 0; i < 100; i++) {
            executor.submit(() -> {
                byte[] data = buffer.get(); // Set value
                // Thread returns to pool
                // ThreadLocal value PERSISTS!
                // Next task reuses thread but inherits ThreadLocal value
            });
        }

        // If thread pool is long-lived and many tasks use ThreadLocal,
        // Values accumulate and are never garbage collected
        // Memory leak!
    }

    public void preventMemoryLeak() {
        ExecutorService executor = Executors.newFixedThreadPool(4);

        for (int i = 0; i < 100; i++) {
            executor.submit(() -> {
                try {
                    byte[] data = buffer.get();
                    // Use data
                } finally {
                    buffer.remove(); // CRITICAL: remove after use
                }
            });
        }

        // Always remove ThreadLocal values when done
    }
}
```

---

## Deadlock, Livelock, Starvation

### Deadlock Example

```java
public class DeadlockExample {
    public void classicDeadlock() {
        Object lock1 = new Object();
        Object lock2 = new Object();

        Thread t1 = new Thread(() -> {
            synchronized (lock1) {
                System.out.println("T1 has lock1");
                try { Thread.sleep(100); } catch (InterruptedException e) {}
                synchronized (lock2) { // Waiting for lock2
                    System.out.println("T1 has lock2");
                }
            }
        });

        Thread t2 = new Thread(() -> {
            synchronized (lock2) { // Acquires lock2 first
                System.out.println("T2 has lock2");
                try { Thread.sleep(100); } catch (InterruptedException e) {}
                synchronized (lock1) { // Waiting for lock1
                    System.out.println("T2 has lock1");
                }
            }
        });

        t1.start();
        t2.start();

        // DEADLOCK:
        // T1 holds lock1, waiting for lock2
        // T2 holds lock2, waiting for lock1
        // Neither can proceed
    }

    public void deadlockPrevention() {
        Object lock1 = new Object();
        Object lock2 = new Object();

        // Always acquire locks in same order
        Thread t1 = new Thread(() -> {
            synchronized (lock1) {
                synchronized (lock2) {
                    System.out.println("T1 executed");
                }
            }
        });

        Thread t2 = new Thread(() -> {
            synchronized (lock1) { // Same order as T1
                synchronized (lock2) {
                    System.out.println("T2 executed");
                }
            }
        });

        // Prevention strategies:
        // 1. Lock ordering: Always acquire in same order
        // 2. Timeout: tryLock with timeout instead of blocking lock
        // 3. Use higher-level constructs (ConcurrentHashMap, atomic)
    }
}
```

### Livelock and Starvation

```java
public class LivelockStarvation {
    public void livelockExample() {
        class LivelockDemo {
            private boolean working = true;

            void workerThread() {
                while (working) {
                    if (shouldYield()) {
                        // "Polite" thread yields to other thread
                        // But other thread also yields
                        // Both keep yielding, nothing gets done
                        Thread.yield();
                    } else {
                        // Do work
                    }
                }
            }

            // Livelock: threads not blocked, but not making progress
            // Constantly responding to each other
        }
    }

    public void starvationExample() {
        Object lock = new Object();

        Thread t1 = new Thread(() -> {
            while (true) {
                synchronized (lock) {
                    System.out.println("T1 executing");
                }
            }
        });

        Thread t2 = new Thread(() -> {
            while (true) {
                synchronized (lock) {
                    System.out.println("T2 executing");
                }
            }
        });

        Thread t3 = new Thread(() -> {
            while (true) {
                synchronized (lock) {
                    System.out.println("T3 executing");
                }
            }
        });

        // Starvation: a thread can never acquire lock because others always have it
        // One thread might never get CPU time (OS scheduling)
        // Unfair lock distribution (but Java synchronized is fair enough usually)

        // Prevention: Use fair locks
        // Lock fairLock = new ReentrantLock(true); // Fair
    }
}
```

---

## Atomic Variables and CAS

### AtomicInteger

```java
public class AtomicVariablesExample {
    public void atomicVsVolatile() {
        // Volatile: visibility only
        volatile int volatileCount = 0;
        // volatileCount++; // NOT atomic - race condition

        // Atomic: visibility + atomic operations
        AtomicInteger atomicCount = new AtomicInteger(0);
        atomicCount.incrementAndGet(); // Atomic increment

        // Other atomic operations:
        atomicCount.compareAndSet(1, 2); // CAS
        atomicCount.getAndAdd(5); // Atomic add
        atomicCount.decrementAndGet(); // Atomic decrement
    }

    public void performanceComparisonDemonstration() throws InterruptedException {
        // Synchronized version
        class SyncCounter {
            private int count = 0;
            public synchronized void increment() { count++; }
            public int getCount() { return count; }
        }

        // Atomic version
        class AtomicCounter {
            private AtomicInteger count = new AtomicInteger(0);
            public void increment() { count.incrementAndGet(); }
            public int getCount() { return count.get(); }
        }

        // Atomic usually faster under high contention
        // Because it uses CAS instead of blocking lock
    }
}
```

### Compare-And-Swap (CAS)

```java
public class CompareAndSwapExample {
    public void demonstrateCAS() {
        // CAS: atomic operation that compares and swaps
        AtomicInteger value = new AtomicInteger(10);

        // compareAndSet(expectedValue, newValue)
        boolean success = value.compareAndSet(10, 20);
        System.out.println(success); // true

        success = value.compareAndSet(10, 30);
        System.out.println(success); // false (value is now 20)

        // CAS is non-blocking - returns immediately
        // Retries are responsibility of caller
    }

    public void spinLockUsingCAS() {
        AtomicBoolean lock = new AtomicBoolean(false);

        // Spin-lock: keep trying until acquire lock
        while (!lock.compareAndSet(false, true)) {
            // Keep spinning - high CPU usage!
        }

        // Critical section
        System.out.println("Lock acquired");

        lock.set(false); // Release lock

        // Spin-locks wasteful compared to blocking locks
        // But useful in some scenarios (very short critical sections)
    }

    public void whyCASIsEfficient() {
        // CAS implemented as single CPU instruction (no thread context switch)
        // Synchronized keyword requires:
        // 1. Context switch to acquire lock
        // 2. Context switch to release lock
        // CAS: no context switch needed

        // Under low contention: CAS faster (no lock overhead)
        // Under high contention: CAS slower (many retries)
    }
}
```

---

## Java Memory Model

### Happens-Before Rules

```java
public class HappensBeforeRules {
    public void memoryBarriers() {
        // Key happens-before rules:

        // 1. Volatile write happens-before volatile read
        volatile int x = 0;
        // write x = 1;
        // read y = x;
        // read guaranteed to see write

        // 2. Monitor lock: unlock happens-before next lock
        Object lock = new Object();
        synchronized (lock) {
            // write to shared variable
        } // unlock here

        synchronized (lock) {
            // read guaranteed to see previous writes
        }

        // 3. Thread start: actions in thread happen-before thread execution
        Thread t = new Thread(() -> {
            // Guaranteed to see all assignments before thread.start()
        });
        // Do some work
        t.start(); // All previous work visible to thread

        // 4. Thread termination: thread actions happen-before join returns
        try {
            t.join(); // Returns after thread finishes
            // Guaranteed to see all thread actions
        } catch (InterruptedException e) {}
    }
}
```

---

## Producer-Consumer Pattern

### Wait-Notify Implementation

```java
public class ProducerConsumerWaitNotify {
    public class BoundedBuffer<T> {
        private Queue<T> buffer = new LinkedList<>();
        private final int capacity;

        public BoundedBuffer(int capacity) {
            this.capacity = capacity;
        }

        public synchronized void put(T item) throws InterruptedException {
            while (buffer.size() >= capacity) {
                wait(); // Producer waits until space available
            }
            buffer.add(item);
            notifyAll(); // Wake consumers
        }

        public synchronized T take() throws InterruptedException {
            while (buffer.isEmpty()) {
                wait(); // Consumer waits until item available
            }
            T item = buffer.poll();
            notifyAll(); // Wake producers
            return item;
        }
    }

    public void demonstrateProducerConsumer() throws InterruptedException {
        BoundedBuffer<Integer> buffer = new BoundedBuffer<>(5);

        Thread producer = new Thread(() -> {
            try {
                for (int i = 0; i < 20; i++) {
                    buffer.put(i);
                    System.out.println("Produced: " + i);
                    Thread.sleep(100);
                }
            } catch (InterruptedException e) {}
        });

        Thread consumer = new Thread(() -> {
            try {
                for (int i = 0; i < 20; i++) {
                    Integer item = buffer.take();
                    System.out.println("Consumed: " + item);
                    Thread.sleep(150);
                }
            } catch (InterruptedException e) {}
        });

        producer.start();
        consumer.start();
        producer.join();
        consumer.join();
    }
}
```

### BlockingQueue Implementation

```java
public class ProducerConsumerBlockingQueue {
    public void blockingQueueExample() throws InterruptedException {
        BlockingQueue<Integer> queue = new LinkedBlockingQueue<>(5);

        Thread producer = new Thread(() -> {
            try {
                for (int i = 0; i < 20; i++) {
                    queue.put(i); // Blocks if queue full
                    System.out.println("Produced: " + i);
                    Thread.sleep(100);
                }
            } catch (InterruptedException e) {}
        });

        Thread consumer = new Thread(() -> {
            try {
                for (int i = 0; i < 20; i++) {
                    Integer item = queue.take(); // Blocks if queue empty
                    System.out.println("Consumed: " + item);
                    Thread.sleep(150);
                }
            } catch (InterruptedException e) {}
        });

        producer.start();
        consumer.start();
        producer.join();
        consumer.join();

        // BlockingQueue handles synchronization internally
        // Much cleaner than wait-notify
    }
}
```

---

## Interview Questions

### Q1: Explain the difference between synchronized and volatile

**Answer:**
- **synchronized:** Provides mutual exclusion (lock) and visibility guarantees. Ensures only one thread executes block at a time.
- **volatile:** Provides only visibility guarantees. Multiple threads can access simultaneously, but see fresh values. No atomicity.

### Q2: What causes deadlock and how to prevent it?

**Answer:**
```java
// Deadlock occurs when:
// - Threads hold locks and wait for other locks
// - Circular waiting: T1 holds L1 waits L2, T2 holds L2 waits L1

// Prevention:
// 1. Always acquire locks in same order
// 2. Use timeouts: tryLock(timeout)
// 3. Use higher-level constructs (ConcurrentHashMap, atomic variables)
// 4. Minimize critical sections
// 5. Avoid nested locks when possible
```

### Q3: What's the difference between wait() and sleep()?

**Answer:**
```java
// wait():
// - Releases lock on monitor
// - Must be in synchronized block
// - Woken by notify/notifyAll
// - Used for inter-thread communication

// sleep():
// - Doesn't release any lock
// - Can be called anywhere
// - After timeout, wakes automatically
// - Used for delays
```

### Q4: How would you implement a thread-safe singleton?

**Answer:**
```java
public class ThreadSafeSingleton {
    private static volatile ThreadSafeSingleton instance;

    private ThreadSafeSingleton() {}

    public static ThreadSafeSingleton getInstance() {
        if (instance == null) {
            synchronized (ThreadSafeSingleton.class) {
                if (instance == null) {
                    instance = new ThreadSafeSingleton();
                }
            }
        }
        return instance;
    }
}

// Double-checked locking:
// First check (no lock): fast path for existing instance
// Lock + second check: ensure only one thread creates
// volatile: ensures memory visibility of assignment
```

---

**Key Takeaway Summary:**

1. **Threads:** Use ExecutorService, not direct Thread creation. Manage thread lifecycle carefully.
2. **Synchronization:** Use synchronized for simple cases, Lock for advanced features. Be aware of deadlock risks.
3. **Visibility:** volatile guarantees visibility but not atomicity. Use when simple flag sharing needed.
4. **Atomics:** Use AtomicInteger/Long for counters instead of volatile + manual synchronization.
5. **Concurrent Collections:** Prefer ConcurrentHashMap over Collections.synchronizedMap - much faster.
6. **ExecutorService:** Always use thread pools. Configure appropriate core/max threads and queue size.
7. **Composition:** Use CompletableFuture for composing async operations. Much cleaner than manual thread management.
8. **Avoid:** volatile without understanding happens-before. ThreadLocal without removing. Sleep in synchronized blocks.

