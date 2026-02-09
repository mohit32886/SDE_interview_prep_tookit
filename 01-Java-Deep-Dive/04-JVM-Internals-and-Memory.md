# JVM Internals and Memory Management - Deep Dive

## Table of Contents
1. [JVM Architecture](#jvm-architecture)
2. [Memory Areas](#memory-areas)
3. [Garbage Collection Algorithms](#garbage-collection-algorithms)
4. [GC Tuning](#gc-tuning)
5. [Class Loading](#class-loading)
6. [JIT Compilation](#jit-compilation)
7. [Memory Leaks](#memory-leaks)
8. [OutOfMemoryError Types](#outofmemoryerror-types)
9. [Advanced Features](#advanced-features)
10. [Interview Questions](#interview-questions)

---

## JVM Architecture

### JVM Execution Model

```java
public class JVMArchitectureOverview {
    /*
    JVM Architecture:

    ┌─────────────────────────────────────────────────┐
    │ Java Source Code (.java files)                  │
    └────────────────┬────────────────────────────────┘
                     │ javac compiler
                     ▼
    ┌─────────────────────────────────────────────────┐
    │ Bytecode (.class files)                         │
    └────────────────┬────────────────────────────────┘
                     │ JVM classloader
                     ▼
    ┌─────────────────────────────────────────────────┐
    │ JVM                                             │
    │ ┌───────────────────────────────────────────┐  │
    │ │ Execution Engine                          │  │
    │ │ - Interpreter (slower)                    │  │
    │ │ - JIT Compiler (faster)                   │  │
    │ │   - C1 (client compiler)                  │  │
    │ │   - C2 (server compiler)                  │  │
    │ └───────────────────────────────────────────┘  │
    │ ┌───────────────────────────────────────────┐  │
    │ │ Memory Management                         │  │
    │ │ - Garbage Collector                       │  │
    │ │ - Heap                                    │  │
    │ │ - Metaspace                               │  │
    │ └───────────────────────────────────────────┘  │
    └─────────────────────────────────────────────────┘
                     │
                     ▼
    ┌─────────────────────────────────────────────────┐
    │ Native Machine Code (executed by OS)            │
    └─────────────────────────────────────────────────┘
    */
}
```

### Key Components

```java
public class JVMComponents {
    public void classLoaderHierarchy() {
        /*
        Bootstrap ClassLoader (loads JDK classes)
        ↓
        Extension ClassLoader (loads JDK extensions)
        ↓
        Application ClassLoader (loads application classes)

        Each delegates to parent (except Bootstrap)
        */
    }

    public void bytecodeInterpreter() {
        // Interpreter: reads bytecode instruction by instruction
        // Slow: 100-200 bytecode instructions per second
        // But immediate startup (no compilation time)

        // Used for:
        // - Startup (before JIT kicks in)
        // - Complex methods (not worth compiling)
        // - Rarely-used code
    }

    public void jitCompilation() {
        // JIT: Just-In-Time compilation
        // Converts bytecode to native machine code

        // When: After ~1500 method invocations (threshold)
        // Result: 10-100x faster execution
        // Cost: Compilation time (amortized by reuse)

        // Hotspot detection: identifies frequently-called methods
        // Tracks call count and loop iterations
    }

    public void memoryManagement() {
        // GC: Garbage Collector
        // Automatically frees unused memory
        // JVM decides when to run GC (affects latency)

        // Mark-sweep: identify live objects, remove dead
        // Multiple algorithms available (Serial, Parallel, CMS, G1, ZGC)
    }
}
```

---

## Memory Areas

### Heap Structure

```java
public class HeapStructure {
    /*
    Heap Layout (generational):

    ┌─────────────────────────────────────────────┐
    │ Young Generation (GC frequently)            │
    │ ┌─────────────────────────────────────────┐ │
    │ │ Eden Space (new objects allocated)      │ │
    │ └─────────────────────────────────────────┘ │
    │ ┌──────────────┬──────────────────────────┐ │
    │ │ Survivor 1   │ Survivor 2                │ │
    │ │ (from/to)    │ (from/to)                │ │
    │ └──────────────┴──────────────────────────┘ │
    └─────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────┐
    │ Old Generation (GC infrequently)            │
    │ (Long-lived objects)                        │
    └─────────────────────────────────────────────┘
    */

    public void generationalHypothesis() {
        // Weak generational hypothesis:
        // Most objects die young
        // Few references from old to young

        // Implication:
        // Collect young generation frequently (fast, little trash)
        // Collect old generation rarely (slow, lots of data)
    }

    public void edenSurvivor() {
        // Most objects allocated in Eden
        // Few survive first GC -> moved to Survivor
        // Multiple collections in Survivor -> moved to Old Gen

        // Survivor has two spaces (from/to):
        // Objects in 'from' space are moved to 'to'
        // Then spaces swap roles

        // Multiple copies:
        // Object might be copied multiple times before reaching Old Gen
    }
}
```

### Other Memory Areas

```java
public class MemoryAreas {
    public void heapMemory() {
        // Shared: all threads can access
        // Garbage collected: objects no longer referenced are freed
        // Size: -Xms (initial), -Xmx (maximum)

        // Allocation: Eden space (fast)
        // Deallocation: GC (pause application)
    }

    public void metaspace() {
        // Stores class metadata: code, field names, method signatures
        // Java 8+: native memory (was PermGen before)

        // Pros of Metaspace:
        // - No fixed size limit (uses native memory)
        // - Doesn't cause OutOfMemoryError as easily
        // - Automatic sizing (grows/shrinks)

        // Can still cause OutOfMemoryError:
        // If too many classes loaded (impossible to unload)
    }

    public void stackMemory() {
        // Per-thread: each thread has own stack
        // Not garbage collected: freed when method returns
        // Fixed size: -Xss

        // Stores: local variables, method calls, references
        // Each method call: new stack frame
        // Stack frame popped when method returns

        // Stack overflow: too deep recursion
    }

    public void programCounterRegister() {
        // Per-thread: one per thread
        // Stores: address of currently executing bytecode instruction
        // If native method: undefined (not applicable)

        // Allows: JVM knows which instruction executing
        // Important for: exception handling, debugging
    }

    public void nativeMethodStack() {
        // Per-thread: one per thread
        // Stores: information for native methods (JNI)

        // Native: C/C++ code called from Java
        // Stack: allocation for native method calls
    }
}
```

---

## Garbage Collection Algorithms

### Serial GC (Single-threaded)

```java
public class SerialGC {
    public void serialGCBehavior() {
        /*
        Serial GC: single thread collects garbage

        Mark phase:
        - One thread marks live objects from roots
        - Root: stack variables, static fields, JNI references
        - Walk object graph: mark all reachable objects

        Sweep phase:
        - One thread sweeps heap
        - Frees memory of unmarked objects
        - Compacts memory (optional)

        Pause time: can be very long (whole heap)
        */
    }

    public void enableSerialGC() {
        // Java command line: -XX:+UseSerialGC
        // Use when: single processor, small heap, low latency not critical
    }
}
```

### Parallel GC (Multi-threaded)

```java
public class ParallelGC {
    public void parallelGCBehavior() {
        /*
        Parallel GC: multiple threads collect garbage

        Mark phase:
        - Multiple threads mark live objects in parallel
        - Faster than serial

        Sweep/Compact phase:
        - Multiple threads work on different parts
        - Overall faster than serial

        Pause time: shorter than serial (parallel work)
        Throughput: high (GC happens in parallel, app paused during GC)
        */
    }

    public void enableParallelGC() {
        // Java 9+: default GC
        // Flag: -XX:+UseParallelGC
        // Configure: -XX:ParallelGCThreads=N
    }
}
```

### CMS GC (Mostly Concurrent Mark Sweep)

```java
public class CMSGC {
    public void cmsBehavior() {
        /*
        CMS: concurrent collection (doesn't pause entire app)

        Phases:
        1. Initial Mark (pause): mark roots only (short pause)
        2. Concurrent Mark (no pause): mark rest of graph
        3. Remark (pause): find objects created during concurrent mark
        4. Concurrent Sweep (no pause): clean up unmarked objects

        Pause time: shorter than Parallel GC (split into parts)
        Throughput: lower (concurrent marking has overhead)
        */
    }

    public void enableCMS() {
        // Flag: -XX:+UseConcMarkSweepGC
        // Deprecated in Java 9, removed in Java 14
    }

    public void tradeoffsOfCMS() {
        // Pros:
        // - Lower latency (shorter pauses)
        // - Good for interactive apps

        // Cons:
        // - Fragmentation (no compaction)
        // - Concurrent marking overhead
        // - Can't handle full heap

        // Concurrent mode failure: if heap fills during concurrent mark
        // Falls back to serial full collection (very long pause)
    }
}
```

### G1 GC (Garbage-First)

```java
public class G1GC {
    public void g1Behavior() {
        /*
        G1: divides heap into regions

        Heap: divided into many ~2MB regions
        No separate Eden/Survivor/Old Gen
        Each region can be any generation

        Collection:
        - Young-only collection: collects young regions
        - Mixed collection: collects young + some old regions
        - Selects regions with most garbage (Garbage-First)

        Predictable pause time: targets max pause time
        */
    }

    public void enableG1() {
        // Flag: -XX:+UseG1GC
        // Java 9+: default for heaps > 4GB
        // Configure pause time: -XX:MaxGCPauseMillis=200
    }

    public void g1Advantages() {
        // Pros:
        // - Predictable pause time (can target max pause)
        // - Automatic region sizing
        // - Compacts (no fragmentation)
        // - Scales to large heaps

        // Cons:
        // - Higher overhead than Parallel GC
        // - Latency can spike if target pause hard to meet
    }
}
```

### ZGC and Shenandoah (Low-Latency)

```java
public class LowLatencyGCs {
    public void zgc() {
        // ZGC: Ultra-low latency
        // Pause time: < 10ms (even for multi-TB heaps)

        // How: concurrent marking and compaction
        // Colored pointers: track object state in pointer
        // Doesn't stop whole application for collection

        // Drawback: higher CPU overhead, more memory
        // Use: when latency critical (trading throughput)
    }

    public void shenandoah() {
        // Shenandoah: similar to ZGC
        // Pause time: < 10ms
        // Available: OpenJDK

        // How: concurrent evacuation
        // Moves objects while application runs
        // Uses write barriers to track moves
    }

    public void enableLowLatencyGCs() {
        // ZGC: -XX:+UseZGC
        // Shenandoah: -XX:+UseShenandoahGC
        // Use when: latency critical, can afford CPU/memory overhead
    }
}
```

---

## GC Tuning

### Key JVM Flags

```java
public class GCTuningFlags {
    public void heapSizing() {
        // -Xms: initial heap size (e.g., -Xms1G)
        // -Xmx: max heap size (e.g., -Xmx4G)
        // -Xmn: young generation size (e.g., -Xmn512M)

        // Rule: -Xms = -Xmx (avoid heap growing during runtime)
        // Young gen: typically 1/4 to 1/3 of heap
    }

    public void gcSelection() {
        // -XX:+UseSerialGC: low latency, small heaps
        // -XX:+UseParallelGC: high throughput
        // -XX:+UseG1GC: balanced, predictable pause time
        // -XX:+UseZGC: ultra-low latency
    }

    public void pauseTimeControl() {
        // -XX:MaxGCPauseMillis=200
        // G1 will try to keep pauses under 200ms
        // If can't meet target: may reduce young gen
    }

    public void logging() {
        // -Xlog:gc*:file=gc.log:time,level,tags
        // Java 9+: unified logging

        // Java 8 style:
        // -XX:+PrintGCDetails
        // -XX:+PrintGCTimeStamps
        // -Xloggc:gc.log
    }

    public void diagnosticFlags() {
        // These require -XX:+UnlockDiagnosticVMOptions

        // -XX:+PrintFlagsFinal: print all flags with final values
        // -XX:+PrintTenuringDistribution: show survivor aging
        // -XX:+G1SummarizeRSetStatsPeriod=0: G1 RSet stats
    }
}
```

### Monitoring and Analysis Tools

```java
public class GCMonitoringTools {
    public void jstat() {
        /*
        jstat: command-line monitoring

        Example: jstat -gcutil <pid> 1000 10
        - Shows GC statistics every 1000ms, 10 times
        - Columns: S0, S1, E (Eden), O (Old), M (Metaspace), CCS, YGC, YGCT, FGC, FGCT

        jstat -gccapacity <pid>: shows capacity of each generation
        jstat -gccause <pid>: shows last GC cause
        */
    }

    public void jmap() {
        /*
        jmap: heap dump

        Example: jmap -dump:live,format=b,file=heap.bin <pid>
        - Creates heap dump for offline analysis

        jmap -histo <pid>: shows object histogram
        - Lists count and size of each class
        */
    }

    public void jstack() {
        /*
        jstack: thread dump

        Example: jstack <pid> > threads.txt
        - Shows all thread stacks
        - Useful for finding blocked threads
        */
    }

    public void jvisualvm() {
        /*
        JVisualVM: GUI monitoring tool

        Features:
        - Real-time heap usage graph
        - CPU profiling
        - Memory leak detection
        - Thread visualization
        - GC analysis

        Better than: jconsole (older)
        */
    }

    public void gcLogAnalysis() {
        /*
        Analyze GC logs:

        1. Pause time: how long each GC took
        2. Frequency: how often GC runs
        3. Heap size: is it growing? (memory leak indicator)
        4. Old gen: is it filling up? (needs larger young gen or more frequent collection)

        Tools:
        - GCeasy (online analyzer)
        - GC Viewer
        - Chrome DevTools (for distributed tracing)
        */
    }
}
```

---

## Class Loading

### Class Loader Hierarchy

```java
public class ClassLoaderHierarchy {
    public void classLoaderChain() {
        /*
        Bootstrap ClassLoader:
        - Loads core JDK classes (java.lang, java.util, etc.)
        - Implemented in C++, not Java
        - No Java parent

        Extension ClassLoader:
        - Loads classes from JDK extensions
        - Parent: Bootstrap ClassLoader
        - Directory: jdk/jre/lib/ext (Java 8) or jdk/conf/modules (Java 9+)

        Application ClassLoader:
        - Loads application classes
        - Parent: Extension ClassLoader
        - Classpath: application .jars and .classes
        */
    }

    public void parentDelegationModel() {
        // When class loader loads class:
        // 1. Check if class already loaded -> return it
        // 2. Ask parent to load -> parent follows same process
        // 3. If parent can't load -> this loader tries

        // Benefits:
        // - Prevents duplicates (class loaded only once)
        // - Security (core classes loaded by Bootstrap, can't override)
        // - Isolation (application classes loaded last, highest priority)
    }

    public void demoClassLoaderHierarchy() {
        String[] classLoaders = new String[3];

        // Find what loaded String class (core class)
        ClassLoader stringLoader = String.class.getClassLoader();
        System.out.println("String loader: " + stringLoader); // null (Bootstrap ClassLoader)

        // Find what loaded ArrayList (core class)
        ClassLoader listLoader = java.util.ArrayList.class.getClassLoader();
        System.out.println("ArrayList loader: " + listLoader); // null (Bootstrap ClassLoader)

        // Find what loaded our class (application class)
        ClassLoader ourLoader = this.getClass().getClassLoader();
        System.out.println("Our class loader: " + ourLoader); // sun.misc.Launcher$AppClassLoader

        // Bootstrap ClassLoader is null (not Java object)
        ClassLoader parent = ourLoader.getParent();
        System.out.println("Parent of App loader: " + parent); // sun.misc.Launcher$ExtClassLoader

        parent = parent.getParent();
        System.out.println("Parent of Ext loader: " + parent); // null (Bootstrap is parent)
    }

    public void customClassLoader() {
        class CustomClassLoader extends ClassLoader {
            @Override
            protected Class<?> findClass(String name) throws ClassNotFoundException {
                // Load bytecode from custom location
                // Maybe from database, encrypted file, generated

                // Read bytecode
                byte[] classBytes = readBytecodeFromCustomSource(name);

                // Define class
                return defineClass(name, classBytes, 0, classBytes.length);
            }

            private byte[] readBytecodeFromCustomSource(String name) {
                // Custom logic: read from database, network, etc.
                return new byte[0]; // Placeholder
            }
        }

        // Use custom loader
        CustomClassLoader loader = new CustomClassLoader();
        // loader.loadClass("com.example.MyClass");
    }
}
```

### Class Loading Phases

```java
public class ClassLoadingPhases {
    public void loadingPhase() {
        // Find and load bytecode

        // Bootstrap loader: searches %JAVA_HOME%/lib
        // App loader: searches classpath

        // Multiple .jar files with same class:
        // First one in classpath wins (others ignored)
    }

    public void linkingPhase() {
        // Verification: ensure bytecode is valid
        // Check: doesn't have invalid instructions, type errors, etc.

        // Preparation: allocate static fields, create method tables
        // Static fields get default values (0, null, false)

        // Resolution: resolve symbolic references to actual references
        // E.g., class reference -> actual Class object
        // Can be lazy (on first use) or eager
    }

    public void initializationPhase() {
        // Execute static initializers and static blocks

        public class Example {
            static int value = 10; // Set during preparation (default value 0)

            static {
                value = 20; // Executed during initialization
            }

            static int other = value; // 20 (static block ran first)
        }

        // Order of initialization:
        // 1. Parent class (if not already initialized)
        // 2. Static initializers (in order of appearance)
        // 3. Static blocks (in order of appearance)
    }

    public void lazyClassLoading() {
        // Class loaded when:
        // 1. Class instantiated: new MyClass()
        // 2. Static method accessed: MyClass.staticMethod()
        // 3. Static field accessed: MyClass.staticField
        // 4. Explicitly: Class.forName("com.example.MyClass")
        // 5. Subclass loaded

        // Class NOT loaded when:
        // - Method on interface implemented (interface doesn't implement)
        // - Inner class mentioned (only when used)
        // - Annotation referenced (depends on retention)
    }
}
```

---

## JIT Compilation

### When JIT Activates

```java
public class JITCompilation {
    public void jitThresholds() {
        // By default:
        // Methods called ~1500 times before compilation
        // Loops: ~15000 iterations before compilation (on method entry)

        // Can be tuned:
        // -XX:CompileThreshold=10000
        // -XX:OnStackReplacePercentage=200 (for loops)

        // Why not compile everything?
        // Compilation time is expensive
        // For code called once or twice, not worth it
    }

    public void countingMechanism() {
        // JVM counts method invocations and loop iterations
        // Stored in method metadata

        // When threshold reached:
        // Method added to compilation queue
        // Compiler thread compiles in background
        // Once compiled, JIT'd version is used

        // Meanwhile: interpreter still runs (for user-facing threads)
    }

    public void tieredCompilation() {
        // Modern Java: multiple compilation tiers

        // Tier 0: Interpreter (no compilation)
        // Tier 1: C1 Compiler (lightweight, fast)
        // Tier 2: C2 Compiler (heavy, optimized)

        // Method path:
        // 1. Interpreter (counts invocations)
        // 2. C1 compilation (quick optimization, get baseline perf)
        // 3. C2 compilation (aggressive optimization, best perf)

        // Can reduce time to peak performance
        // Trade-off: more compilation overhead
    }

    public void c1VsC2() {
        // C1 (Client Compiler):
        // - Fast compilation (seconds to milliseconds)
        // - Moderate optimization
        // - Used in older Java/low-latency apps

        // C2 (Server Compiler):
        // - Slow compilation (can be seconds)
        // - Aggressive optimization (profiling, speculation)
        // - Much faster final code
        // - Used in servers/long-running apps
    }

    public void inlining() {
        // JIT aggressive optimization: method inlining

        public void example() {
            String result = getResult(); // getResult() might be inlined
        }

        public String getResult() {
            return "value";
        }

        // If getResult() called many times:
        // JIT inlines it: result = "value"
        // Saves method call overhead

        // JIT profiling: if method always throws:
        // Eliminate error handling code (speculative)
        // If assumption breaks: fallback to interpreter
    }
}
```

### Code Cache

```java
public class CodeCache {
    public void codeCacheExplanation() {
        // JIT'd native code stored in Code Cache
        // Separate from Java heap
        // Size: -XX:ReservedCodeCacheSize=256M (default varies)

        // Code Cache full:
        // - No more compilation possible
        // - Application stuck with partially-optimized code
        // - Performance degrades

        // Indicator: compilation disabled message in logs
    }

    public void codeCacheTuning() {
        // Monitor:
        // jstat -codercache <pid>

        // Increase if hitting limit:
        // -XX:ReservedCodeCacheSize=512M

        // Methods per code cache entry:
        // -XX:NonTieredCompileQueueSize=1000
    }

    public void codeElimination() {
        // Dead code elimination: JIT removes unused branches
        // Loop unrolling: expand small loops
        // Escape analysis: stack allocate objects instead of heap

        // Result: significant performance improvements
        // But: takes compilation time
    }
}
```

---

## Memory Leaks

### Common Leak Patterns

```java
public class MemoryLeakPatterns {
    public void staticCollectionLeak() {
        // LEAK 1: Static collection that grows indefinitely
        static List<String> cache = new ArrayList<>();

        public void addToCache(String data) {
            cache.add(data); // Grows forever
            // If application runs long enough, OutOfMemoryError
        }
    }

    public void threadLocalLeak() {
        // LEAK 2: ThreadLocal not removed
        static ThreadLocal<byte[]> buffer = ThreadLocal.withInitial(() -> new byte[1024 * 1024]);

        public void processInThreadPool() {
            ExecutorService executor = Executors.newFixedThreadPool(4);
            for (int i = 0; i < 1000; i++) {
                executor.submit(() -> {
                    byte[] data = buffer.get(); // Set on thread
                    // Never removed -> persists in thread
                    // Thread returns to pool
                    // Value still there for next task
                });
            }
        }

        // Fix: buffer.remove() in finally
    }

    public void listenerLeak() {
        // LEAK 3: Listeners not unregistered
        class Observable {
            List<Listener> listeners = new ArrayList<>();

            public void subscribe(Listener listener) {
                listeners.add(listener); // Added but never removed
            }
        }

        Observable observable = new Observable();
        for (int i = 0; i < 10000; i++) {
            observable.subscribe(() -> {}); // Lambdas accumulate
        }
        // listeners list grows, all kept in memory
    }

    public void fileHandleLeak() {
        // LEAK 4: Resources not closed
        public void readFile(String path) throws IOException {
            FileInputStream fis = new FileInputStream(path);
            BufferedReader reader = new BufferedReader(new InputStreamReader(fis));
            String line = reader.readLine();
            // File handle never closed
            // System has limited file descriptors
        }

        // Fix: try-with-resources
        public void readFileCorrect(String path) throws IOException {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(new FileInputStream(path)))) {
                String line = reader.readLine();
            } // Automatically closed
        }
    }

    public void circularReferenceLeak() {
        // LEAK 5: Parent-child circular reference (with listener)
        class Parent {
            Child child;

            public Parent() {
                child = new Child(this); // Parent referenced by child
            }
        }

        class Child {
            Parent parent;

            public Child(Parent parent) {
                this.parent = parent; // Child referenced by parent
            }
        }

        Parent parent = new Parent();
        // Even if parent = null:
        // parent -> child -> parent (cycle)
        // Both kept alive (can't be garbage collected)

        // GC can handle cycles, but:
        // If strong external reference remains, cycle is kept
    }
}
```

### Detecting Memory Leaks

```java
public class DetectingMemoryLeaks {
    public void heapDumpAnalysis() {
        // Take heap dump:
        // jmap -dump:live,format=b,file=heap.bin <pid>

        // Analyze with:
        // - Eclipse MAT (Memory Analyzer Tool) - free
        // - JProfiler - commercial
        // - YourKit - commercial

        // Look for:
        // - Large objects accumulating
        // - Unexpected class instances
        // - Retained objects from past operations
    }

    public void gcLogAnalysis() {
        // Monitor heap size trend:
        // - If Old Gen never decreases after Full GC -> leak
        // - If Full GC frequency increasing -> leak

        // Parse logs:
        // Each Full GC should free memory
        // If Old Gen size after Full GC keeps growing -> leak likely
    }

    public void programmaticDetection() {
        // Monitor in application:
        Runtime runtime = Runtime.getRuntime();

        long freeMemory = runtime.freeMemory();
        long totalMemory = runtime.totalMemory();
        long usedMemory = totalMemory - freeMemory;

        // If usedMemory keeps growing despite Full GC:
        // Possible memory leak

        // Better: use monitoring tools (GCeasy, New Relic, Datadog)
    }
}
```

---

## OutOfMemoryError Types

### Java Heap Out Of Memory

```java
public class JavaHeapOutOfMemory {
    public void outOfMemoryDemo() {
        // Most common: Java heap space full

        List<byte[]> list = new ArrayList<>();
        try {
            while (true) {
                list.add(new byte[1024 * 1024]); // Allocate 1MB
                // Eventually: OutOfMemoryError: Java heap space
            }
        } catch (OutOfMemoryError e) {
            System.err.println("Heap full: " + e.getMessage());
        }

        // Causes:
        // 1. Memory leak (most common)
        // 2. Heap too small for workload (-Xmx too low)
        // 3. Large object allocation (single array > heap)
    }

    public void diagnosis() {
        // Take heap dump at OutOfMemoryError:
        // -XX:+HeapDumpOnOutOfMemoryError
        // -XX:HeapDumpPath=/tmp/heapdump.bin

        // Analyze: which classes taking memory?
        // Which objects have references?
    }
}
```

### Metaspace Out Of Memory

```java
public class MetaspaceOutOfMemory {
    public void metaspaceDemo() {
        // Java 8+: class metadata in Metaspace (native memory)

        // Can occur:
        // - Too many classes loaded (e.g., code generation)
        // - Class loader leak (classloader not garbage collected)

        try {
            ClassLoader loader = new URLClassLoader(
                new URL[] { new File("classes").toURI().toURL() }
            );
            // Load classes
            // If classloader not garbage collected: held in memory
        } catch (Exception e) {
            e.printStackTrace();
        }

        // OutOfMemoryError: Metaspace
        // OutOfMemoryError: Compressed class space

        // Fix:
        // - Limit class generation
        // - Fix classloader leak
        // - Increase Metaspace: -XX:MetaspaceSize=128M -XX:MaxMetaspaceSize=512M
    }
}
```

### Stack Overflow

```java
public class StackOverflow {
    public void stackOverflowDemo() {
        // Per-thread stack too small or infinite recursion

        void recursion() {
            recursion(); // No base case
        }

        try {
            recursion();
        } catch (StackOverflowError e) {
            System.err.println("Stack overflow: " + e.getMessage());
        }

        // Causes:
        // 1. Infinite recursion (bug in code)
        // 2. Very deep recursion (legitimate but stack too small)
        // 3. Stack size too small (-Xss)

        // Fix:
        // - Fix recursion base case
        // - Use iteration instead
        // - Increase stack size: -Xss2M (rarely needed)
    }
}
```

---

## Advanced Features

### String Deduplication

```java
public class StringDeduplication {
    public void g1StringDedup() {
        // G1 GC feature: automatically deduplicate equal strings

        String s1 = new String("hello");
        String s2 = new String("hello");

        // Without dedup:
        // Two separate String objects in heap
        // char[] arrays both contain [h,e,l,l,o]
        // Wasted memory if many duplicates

        // With G1 dedup:
        // Both String objects point to same char[]
        // Significant memory savings for string-heavy apps

        // Enable: -XX:+UseStringDeduplication

        // How: G1 tracks strings, during GC detects equal strings
        // Points both to same char[] array
    }
}
```

### Escape Analysis

```java
public class EscapeAnalysis {
    public void stackAllocation() {
        /*
        Escape Analysis: JIT determines if object escapes method

        Doesn't escape:
        - Created locally
        - Not stored in field
        - Not returned
        - Not passed to other method

        Example:
        */
        public void localOnly() {
            Point p = new Point(1, 2); // Created
            int distance = p.distance(); // Used locally only
            // p never escapes method
        }

        // Without escape analysis:
        // Point allocated on heap
        // Expensive: heap allocation, GC tracking

        // With escape analysis:
        // Point allocated on stack
        // Automatic deallocation, no GC overhead
        // Significant performance improvement

        // Enable: -XX:+DoEscapeAnalysis (usually default)
    }

    public void lockElision() {
        // Lock elision: unnecessary locks removed

        public synchronized int getValue() {
            return 42;
        }

        public void caller() {
            getValue(); // Lock not needed (object doesn't escape)
        }

        // With escape analysis:
        // JIT sees object doesn't escape
        // Removes monitor lock/unlock instructions
        // Faster code
    }
}
```

---

## Interview Questions

### Q1: What's the difference between Parallel GC and G1GC?

**Answer:**
```java
// Parallel GC:
// - Divides heap into fixed generations (Young/Old)
// - Collects entire generation at once
// - Pause time: proportional to heap size
// - Throughput: high (parallel marking)
// Use: batch processing, high throughput needed

// G1GC:
// - Divides heap into regions
// - Collects regions with most garbage
// - Pause time: targets max pause time limit
// - Throughput: lower than parallel (more management overhead)
// Use: interactive apps, predictable latency needed
```

### Q2: How to detect if application has memory leak?

**Answer:**
1. Monitor Old Gen size after Full GC - should decrease
2. Take heap dumps at different times - compare
3. Use tools: GCeasy, Eclipse MAT, JProfiler
4. Monitor GC frequency - increasing frequency indicates leak
5. Check for static collections, ThreadLocal, listener not removed

### Q3: What happens when Code Cache is full?

**Answer:**
```java
// Code Cache holds JIT'd native code
// When full:
// - No more methods can be compiled
// - Application must run with partially-optimized bytecode
// - Performance degrades
// - Logs show: compilation disabled

// Prevention:
// -XX:ReservedCodeCacheSize=512M (increase size)
// -XX:TieredStopAtLevel=3 (limit compilation depth)
```

### Q4: Explain ClassLoader delegation model

**Answer:**
```java
// When loading class:
// App ClassLoader -> Extension ClassLoader -> Bootstrap ClassLoader
// Each asks parent first

// Benefits:
// - Core classes always come from Bootstrap (security)
// - Prevents duplicates (class loaded only once)
// - Proper isolation

// Custom ClassLoader example:
// Can load from database, decrypt, or generate classes
// Useful for frameworks like Spring, Hibernate
```

---

**Key Takeaway Summary:**

1. **JVM:** Bytecode interpreter + JIT compiler + GC. JIT kicks in after ~1500 invocations.
2. **Memory:** Heap (Young/Old Gen), Metaspace, Stack (per-thread). Stack freed automatically, Heap via GC.
3. **GC Algorithms:** Serial (slow, simple), Parallel (fast), CMS (low latency, fragmented), G1 (balanced), ZGC (ultra-low latency).
4. **Memory Leaks:** Static collections, ThreadLocal, listeners, resource leak, circular refs. Detect with heap dumps.
5. **Class Loading:** Bootstrap -> Extension -> App. Delegation model ensures security. Custom loaders for frameworks.
6. **Tuning:** Match GC to workload. Monitor with jstat/jmap. Increase heap if GC pauses high. Set -Xms = -Xmx.
7. **OutOfMemory:** Usually heap leak. Could be Metaspace (too many classes), Stack (deep recursion).

