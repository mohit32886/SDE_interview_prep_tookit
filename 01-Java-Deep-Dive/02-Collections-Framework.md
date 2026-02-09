# Collections Framework - Deep Dive

## Table of Contents
1. [HashMap Internals](#hashmap-internals)
2. [ArrayList Internals](#arraylist-internals)
3. [LinkedList Internals](#linkedlist-internals)
4. [TreeMap: Red-Black Trees](#treemap-red-black-trees)
5. [ConcurrentHashMap](#concurrenthashmap)
6. [LinkedHashMap](#linkedhashmap)
7. [Collision Handling](#collision-handling)
8. [Comparable vs Comparator](#comparable-vs-comparator)
9. [Iterator and Fail-Fast](#iterator-and-fail-fast)
10. [PriorityQueue](#priorityqueue)
11. [Decision Matrix](#decision-matrix)
12. [Interview Questions](#interview-questions)

---

## HashMap Internals

### Core Data Structure

```java
public class HashMapStructure {
    // HashMap uses array of nodes/buckets
    // Each bucket is a linked list (or red-black tree in Java 8+)

    // Simplified internal structure:
    public class SimpleHashMap<K, V> {
        private static final int DEFAULT_CAPACITY = 16;
        private static final float LOAD_FACTOR = 0.75f;
        private static final int TREEIFY_THRESHOLD = 8; // Linked list -> tree at size 8

        private Node<K, V>[] table;
        private int size;

        // Node: can be part of linked list or tree
        public class Node<K, V> {
            final K key;
            V value;
            Node<K, V> next; // Linked list pointer
            int hash;

            public Node(int hash, K key, V value, Node<K, V> next) {
                this.hash = hash;
                this.key = key;
                this.value = value;
                this.next = next;
            }
        }

        public V put(K key, V value) {
            if (size >= table.length * LOAD_FACTOR) {
                resize(); // Rehash when load factor exceeded
            }

            int hash = hash(key);
            int index = hash & (table.length - 1); // Bucket index

            Node<K, V> node = table[index];

            // Handle collision: traverse linked list
            while (node != null) {
                if (node.hash == hash && (key == node.key || key.equals(node.key))) {
                    V oldValue = node.value;
                    node.value = value; // Update existing key
                    return oldValue;
                }
                node = node.next;
            }

            // Add new node at beginning of list
            table[index] = new Node<>(hash, key, value, table[index]);
            size++;
            return null;
        }

        public V get(Object key) {
            int hash = hash(key);
            int index = hash & (table.length - 1);

            Node<K, V> node = table[index];
            while (node != null) {
                if (node.hash == hash && (key == node.key || key.equals(node.key))) {
                    return node.value;
                }
                node = node.next;
            }
            return null;
        }

        private void resize() {
            // Create new table with 2x capacity
            // Rehash all entries into new table
            Node<K, V>[] oldTable = table;
            table = new Node[oldTable.length * 2];
            size = 0;

            for (Node<K, V> node : oldTable) {
                while (node != null) {
                    put(node.key, node.value);
                    node = node.next;
                }
            }
        }

        private int hash(Object key) {
            if (key == null) return 0; // HashMap allows null key
            int h = key.hashCode();
            return h ^ (h >>> 16); // Spread hash bits
        }
    }
}
```

### Hashing and Collision Resolution

```java
public class HashingAndCollisions {
    public void demonstrateCollisions() {
        Map<String, Integer> map = new HashMap<>();

        // Good hash function: Different strings get different hashes
        String s1 = "hello";
        String s2 = "world";
        System.out.println(s1.hashCode()); // Different hash
        System.out.println(s2.hashCode()); // Different hash

        // Bad hash function: Many collisions
        String s3 = "abc";
        String s4 = "bac";
        // These might hash to same value with poor hash function
        // (With good hash function, they hash differently)

        // Collision impact:
        // 1. Same bucket: O(1) becomes O(k) where k = collision chain length
        // 2. Performance degrades with many collisions
        // 3. Pathological case: all keys hash to same bucket -> O(n) operations
    }

    public void hashCodeQuality() {
        // Quality hash function properties:
        // 1. Deterministic: same object always gives same hash
        // 2. Uniform distribution: minimizes collisions
        // 3. Fast to compute
        // 4. Good avalanche effect: small change in input -> big change in hash

        public class BadHashCode {
            public String data;

            @Override
            public int hashCode() {
                return 1; // TERRIBLE - all objects hash to same value
                          // Forces all entries into one bucket
            }
        }

        public class GoodHashCode {
            public String data;

            @Override
            public int hashCode() {
                return data.hashCode(); // Uses string's good hash function
            }
        }
    }
}
```

### Treeification (Java 8+)

```java
public class TreeificationProcess {
    // In Java 8+, when a bucket's linked list exceeds TREEIFY_THRESHOLD (8),
    // it converts to Red-Black tree for better performance

    public void demonstrateTreeification() {
        // Linked list: O(n) search, O(1) insertion
        // Red-Black tree: O(log n) search, O(log n) insertion

        // Threshold: list size > 8 AND map size > 64
        // Back to list when tree size < 6

        Map<String, Integer> map = new HashMap<>();

        // Create many entries that hash to same bucket
        for (int i = 0; i < 1000; i++) {
            String key = "key" + i;
            map.put(key, i);
        }

        // Internal: Instead of one bucket with 1000 entries in linked list,
        // After treeification: Red-Black tree with O(log 1000) = O(10) depth
    }

    // Why not trees from start?
    // 1. Overhead: Tree nodes larger than simple node
    // 2. Memory usage: Many small buckets don't need trees
    // 3. Small arrays: Rarely have enough collisions to benefit
    // 4. Performance: Linked list has better cache locality for small n
}
```

### Load Factor and Rehashing

```java
public class LoadFactorRehashing {
    public void demonstrateLoadFactor() {
        // Load factor = size / capacity
        // Default: 0.75f

        // When size >= capacity * 0.75:
        // - Rehash (double capacity)
        // - Redistribute all entries to new buckets

        Map<String, Integer> map = new HashMap<>(16); // capacity 16

        // Load factor 0.75 means: rehash when size reaches 12

        for (int i = 0; i < 12; i++) {
            map.put("key" + i, i);
            // When 12th item added, size = 12, capacity * 0.75 = 12
            // Triggers resize to capacity 32
        }

        // Tradeoff: Load factor
        // - Too low (e.g., 0.25): More memory, fewer collisions, faster
        // - Too high (e.g., 0.99): Less memory, many collisions, slower
        // 0.75 is good compromise
    }

    public void rehashingProcess() {
        // Rehashing is expensive: O(n) operation
        // Must recalculate hash for every entry

        // Why? Hash function uses % operator:
        // index = hash % capacity
        // When capacity changes, old indices become wrong

        // Example:
        // Old capacity: 16
        // Entry hash: 100
        // Old index: 100 % 16 = 4

        // New capacity: 32
        // New index: 100 % 32 = 4 (happens same)

        // But in general:
        // Old index: 100 % 16 = 4
        // New index: 100 % 32 = 4 OR 20 (depends on hash)

        // Modern implementation uses bit manipulation:
        // index = hash & (capacity - 1) // Much faster than %
    }

    public void amortizedCostAnalysis() {
        // Put operation amortized cost: O(1)
        // Even though resize is O(n), it happens infrequently

        // With load factor 0.75:
        // After n puts, resizes happen at: 12, 24, 48, 96, ...
        // Total work: 12 + 24 + 48 + ... + n = O(n)
        // Distributed over n operations: O(n) / n = O(1) amortized
    }
}
```

---

## ArrayList Internals

### Dynamic Resizing

```java
public class ArrayListInternals {
    public class SimpleArrayList<E> {
        private static final int DEFAULT_CAPACITY = 10;
        private E[] elements;
        private int size;

        public SimpleArrayList() {
            elements = new Object[DEFAULT_CAPACITY];
            size = 0;
        }

        public void add(E e) {
            if (size >= elements.length) {
                resize(); // When full, grow array
            }
            elements[size++] = e;
        }

        private void resize() {
            // Grow by 1.5x (or 2x, depends on implementation)
            E[] newArray = new Object[elements.length + (elements.length >> 1)]; // 1.5x
            System.arraycopy(elements, 0, newArray, 0, size);
            elements = newArray;
        }

        public E get(int index) {
            if (index >= size) throw new IndexOutOfBoundsException();
            return elements[index];
        }

        public void remove(int index) {
            if (index >= size) throw new IndexOutOfBoundsException();
            // Shift all elements after index
            System.arraycopy(elements, index + 1, elements, index, size - index - 1);
            size--;
        }
    }

    public void performanceAnalysis() {
        ArrayList<String> list = new ArrayList<>(2);

        // Scenario: adding 10 items to ArrayList(2)
        // Initial capacity: 2
        list.add("0"); // size=1, capacity=2
        list.add("1"); // size=2, capacity=2
        list.add("2"); // size=3, resize triggered
                       // New capacity: 2 + 2/2 = 3
        list.add("3"); // size=4, resize triggered
                       // New capacity: 3 + 3/2 = 4
        list.add("4"); // size=5, resize triggered
                       // New capacity: 4 + 4/2 = 6
        // ...

        // Work distribution:
        // 10 items added, resizes at: 2, 3, 4, 6, 9, 13
        // Total array copy work: 2 + 3 + 4 + 6 + 9 = 24
        // Average per add: 24/10 = 2.4 operations
        // Amortized: O(1) per add
    }
}
```

### Time Complexity

```java
public class ArrayListComplexity {
    public void timeComplexity() {
        ArrayList<String> list = new ArrayList<>();

        // get(index): O(1)
        String element = list.get(5); // Direct array access

        // add(element): O(1) amortized
        list.add("new"); // Usually O(1), occasionally O(n) on resize

        // add(index, element): O(n)
        list.add(0, "at start"); // Must shift all n elements right

        // remove(index): O(n)
        list.remove(5); // Must shift all elements after index

        // contains(element): O(n)
        boolean has = list.contains("string"); // Must search entire list

        // Worst case example for add(int, E):
        for (int i = 0; i < 1000; i++) {
            list.add(0, "element " + i); // Always insert at beginning
                                          // Each insert shifts all existing elements
                                          // Total work: 1 + 2 + 3 + ... + 1000 = O(n²)
        }
    }
}
```

---

## LinkedList Internals

### Doubly Linked List Structure

```java
public class LinkedListInternals {
    public class SimpleLinkedList<E> {
        private class Node {
            E value;
            Node next;
            Node prev;

            Node(E value) {
                this.value = value;
            }
        }

        private Node head; // Points to first node
        private Node tail; // Points to last node
        private int size;

        public void add(E e) {
            Node newNode = new Node(e);
            if (tail == null) {
                head = tail = newNode;
            } else {
                tail.next = newNode;
                newNode.prev = tail;
                tail = newNode;
            }
            size++;
        }

        public E get(int index) {
            if (index < 0 || index >= size) throw new IndexOutOfBoundsException();

            Node node = head;
            for (int i = 0; i < index; i++) {
                node = node.next;
            }
            return node.value;
        }

        public void remove(int index) {
            if (index < 0 || index >= size) throw new IndexOutOfBoundsException();

            Node node = head;
            for (int i = 0; i < index; i++) {
                node = node.next;
            }

            if (node.prev != null) {
                node.prev.next = node.next;
            } else {
                head = node.next;
            }

            if (node.next != null) {
                node.next.prev = node.prev;
            } else {
                tail = node.prev;
            }

            size--;
        }
    }
}
```

### When to Use LinkedList

```java
public class LinkedListVsArrayList {
    public void useArrayListWhen() {
        // 1. Frequent random access
        ArrayList<String> list = new ArrayList<>();
        for (int i = 0; i < 1000; i++) {
            list.add("item" + i);
        }
        String element = list.get(500); // O(1)

        // 2. Appending to end
        list.add("new item"); // O(1) amortized

        // 3. Good cache locality
        // ArrayList elements are contiguous in memory
        // CPU cache benefits
    }

    public void useLinkedListWhen() {
        // 1. Frequent insertions at beginning
        LinkedList<String> list = new LinkedList<>();
        for (int i = 0; i < 100; i++) {
            list.addFirst("item" + i); // O(1)
        }
        // With ArrayList: would be O(n²) total

        // 2. Frequent removals from middle
        while (!list.isEmpty()) {
            list.removeFirst(); // O(1)
        }

        // 3. Implementing queues/deques
        // LinkedList implements both
    }

    public void avoidLinkedListWhen() {
        LinkedList<String> list = new LinkedList<>();
        for (int i = 0; i < 1000; i++) {
            list.add("item" + i);
        }

        // Avoid random access
        for (int i = 0; i < 1000; i++) {
            String element = list.get(i); // O(n) - linear search!
                                          // Total: O(n²)
        }

        // DO NOT iterate with index in LinkedList
        // Instead use iterator:
        for (String element : list) { // Iterator uses node pointers
            // O(1) amortized per element
        }
    }
}
```

---

## TreeMap: Red-Black Trees

### Red-Black Tree Basics

```java
public class RedBlackTreeBasics {
    // TreeMap uses Red-Black tree for sorted storage
    // Properties:
    // 1. Every node is red or black
    // 2. Root is always black
    // 3. Red node can't have red children
    // 4. All paths from node to leaves have same number of black nodes
    // 5. All leaves (null) are black

    public void demonstrateTreeMap() {
        TreeMap<String, Integer> map = new TreeMap<>();

        map.put("charlie", 3);
        map.put("alice", 1);
        map.put("bob", 2);

        // Sorted by key
        System.out.println(map.keySet()); // [alice, bob, charlie]

        // Balanced: height always O(log n)
        // Operations: O(log n)
    }

    public void treeMapOperations() {
        TreeMap<Integer, String> map = new TreeMap<>();
        map.put(5, "five");
        map.put(2, "two");
        map.put(8, "eight");
        map.put(1, "one");
        map.put(3, "three");

        // Sorted iteration
        for (Integer key : map.keySet()) {
            System.out.println(key); // 1, 2, 3, 5, 8
        }

        // Range queries (main advantage over HashMap)
        NavigableMap<Integer, String> subMap = map.subMap(2, 8);
        System.out.println(subMap.keySet()); // [2, 3, 5]

        Map<Integer, String> headMap = map.headMap(5); // Keys < 5
        System.out.println(headMap.keySet()); // [1, 2, 3]

        Map<Integer, String> tailMap = map.tailMap(5); // Keys >= 5
        System.out.println(tailMap.keySet()); // [5, 8]
    }

    public void navigationOperations() {
        TreeMap<String, Integer> map = new TreeMap<>();
        map.put("alice", 1);
        map.put("bob", 2);
        map.put("charlie", 3);
        map.put("david", 4);

        // ceiling: smallest key >= given key
        System.out.println(map.ceilingKey("alex")); // "alice"

        // floor: largest key <= given key
        System.out.println(map.floorKey("carol")); // "bob"

        // higher: smallest key > given key
        System.out.println(map.higherKey("alice")); // "bob"

        // lower: largest key < given key
        System.out.println(map.lowerKey("bob")); // "alice"
    }
}
```

### Time Complexity of TreeMap

```java
public class TreeMapComplexity {
    public void complexityAnalysis() {
        TreeMap<Integer, String> map = new TreeMap<>();

        // All operations: O(log n)
        map.put(5, "five"); // O(log n) - insertion with rebalancing
        String value = map.get(5); // O(log n) - search
        map.remove(5); // O(log n) - deletion with rebalancing

        // Range queries: O(log n + k) where k = results
        map.put(1, "one");
        map.put(2, "two");
        map.put(3, "three");
        map.put(4, "four");
        map.put(5, "five");

        NavigableMap<Integer, String> range = map.subMap(2, 5);
        // O(log n) to find start, then iterate k results
        // Total: O(log n + k)
    }

    public void whenToUseTreeMap() {
        // Use TreeMap when you need:
        // 1. Sorted iteration
        TreeMap<String, Integer> map = new TreeMap<>();
        map.put("zebra", 1);
        map.put("apple", 2);
        // Iterates in sorted order automatically

        // 2. Range queries
        NavigableMap<String, Integer> aToM = map.subMap("a", "m");

        // 3. Least/greatest keys
        String smallest = map.firstKey();
        String largest = map.lastKey();

        // Don't use TreeMap if:
        // - No sorting needed: use HashMap (much faster)
        // - Need concurrent access: use ConcurrentHashMap (better performance)
    }
}
```

---

## ConcurrentHashMap

### Segment-Based Locking (Pre-Java 8)

```java
public class ConcurrentHashMapSegments {
    // Pre-Java 8: ConcurrentHashMap divided into segments
    // Each segment is separately locked

    public class SimpleConcurrentHashMap<K, V> {
        private static final int SEGMENTS = 16; // Default
        private HashMapSegment<K, V>[] segments;

        public SimpleConcurrentHashMap() {
            segments = new HashMapSegment[SEGMENTS];
            for (int i = 0; i < SEGMENTS; i++) {
                segments[i] = new HashMapSegment<>();
            }
        }

        public V put(K key, V value) {
            int segmentIndex = hash(key) % SEGMENTS;
            // Only one segment locked at a time
            return segments[segmentIndex].put(key, value);
        }

        public V get(Object key) {
            int segmentIndex = hash(key) % SEGMENTS;
            return segments[segmentIndex].get(key);
        }

        private int hash(Object key) {
            return key.hashCode();
        }
    }

    public class HashMapSegment<K, V> {
        private HashMap<K, V> map = new HashMap<>();

        public synchronized V put(K key, V value) {
            return map.put(key, value);
        }

        public synchronized V get(Object key) {
            return map.get(key);
        }
    }

    public void concurrencyBenefit() {
        // With HashMap: one lock for entire map
        // Thread 1: Put key1 -> locked
        // Thread 2: Put key2 -> BLOCKED (different segment but still waiting)

        // With ConcurrentHashMap (segments): multiple locks
        // Thread 1: Put key1 -> segment 1 locked
        // Thread 2: Put key2 -> segment 2 locked (different segment)
        // Both can proceed concurrently!

        // 16 segments means up to 16 concurrent puts possible
    }
}
```

### Node-Level Locking (Java 8+)

```java
public class ConcurrentHashMapNodeLocking {
    // Java 8+: Finer-grained locking at node level
    // Each bucket has its own lock (via synchronized node)

    public void nodeVsSegmentLocking() {
        ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();

        // Java 8+: lock per bucket (when first collision)
        // More granular than segments
        // Better distribution: if hash spread is good, fewer actual locks needed

        // Before Java 8: 16 fixed segments
        // After Java 8: dynamic segments based on actual contention
    }

    public void comparisonWithSynchronizedMap() {
        // Collections.synchronizedMap() wraps all methods in synchronized
        Map<String, Integer> syncMap = Collections.synchronizedMap(new HashMap<>());
        // Every operation locks entire map

        // ConcurrentHashMap
        ConcurrentHashMap<String, Integer> concMap = new ConcurrentHashMap<>();
        // Only locks relevant bucket

        // Performance: ConcurrentHashMap much faster under contention
    }

    public void demonstratePerformance() {
        Map<String, Integer> syncMap = Collections.synchronizedMap(new HashMap<>());
        ConcurrentHashMap<String, Integer> concMap = new ConcurrentHashMap<>();

        // With 10 threads each doing 10000 puts:
        // synchronizedMap: All threads contend for one lock, slow
        // ConcurrentHashMap: Threads can update different buckets in parallel

        // ConcurrentHashMap typically 5-10x faster with high contention
    }
}
```

### Iteration Weaknesses

```java
public class ConcurrentHashMapIteration {
    public void iterationIsWeaklyConsistent() {
        ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();
        map.put("a", 1);
        map.put("b", 2);
        map.put("c", 3);

        // Weakly consistent iteration: reflects updates during iteration
        // But not strongly consistent

        Iterator<String> iterator = map.keySet().iterator();
        map.put("d", 4); // Added during iteration

        while (iterator.hasNext()) {
            String key = iterator.next();
            System.out.println(key);
            // May or may not include "d" - not guaranteed
        }

        // With HashMap: ConcurrentModificationException would be thrown
        // With ConcurrentHashMap: No exception, but iteration semantics unclear
    }

    public void whyNotStrongConsistency() {
        // Strong consistency would require:
        // - Snapshot of map at iteration start
        // - Or locking entire map during iteration

        // Both bad for ConcurrentHashMap goals:
        // - Snapshot: memory overhead, O(n) copy
        // - Locking: defeats purpose of fine-grained locking

        // Solution: if you need atomic snapshot
        List<String> snapshot = new ArrayList<>(map.keySet());
        for (String key : snapshot) {
            // Safe from concurrent modifications
        }
    }
}
```

---

## LinkedHashMap

### Insertion Order vs Access Order

```java
public class LinkedHashMapOrdering {
    public void insertionOrderMap() {
        Map<String, Integer> map = new LinkedHashMap<>();
        // Maintains insertion order

        map.put("zebra", 1);
        map.put("apple", 2);
        map.put("monkey", 3);

        for (String key : map.keySet()) {
            System.out.println(key);
            // OUTPUT: zebra, apple, monkey (insertion order)
            // Not alphabetical!
        }
    }

    public void accessOrderMap() {
        // Access-order: maintains order by last access (get or put)
        Map<String, Integer> map = new LinkedHashMap<String, Integer>(16, 0.75f, true) {
            // Third parameter: true = access-order
        };

        map.put("a", 1);
        map.put("b", 2);
        map.put("c", 3);
        map.get("a"); // Accessed, moves to end

        for (String key : map.keySet()) {
            System.out.println(key);
            // OUTPUT: b, c, a (access order)
        }
    }

    public void lruCacheImplementation() {
        // LinkedHashMap in access-order mode can implement LRU cache
        Map<String, Integer> lruCache = new LinkedHashMap<String, Integer>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Integer> eldest) {
                return size() > 3; // Keep only 3 entries
            }
        };

        lruCache.put("a", 1);
        lruCache.put("b", 2);
        lruCache.put("c", 3);
        lruCache.put("d", 4); // "a" removed (least recently used)

        System.out.println(lruCache.keySet()); // [b, c, d]

        lruCache.get("b"); // Moves to end (most recently used)
        lruCache.put("e", 5); // "c" removed (least recently used now)

        System.out.println(lruCache.keySet()); // [d, b, e]
    }
}
```

---

## Collision Handling

### Hash Function Quality

```java
public class HashFunctionQuality {
    public void badHashFunction() {
        class Person {
            String name;
            int age;

            @Override
            public int hashCode() {
                return age; // BAD: ignores name
                // Two people same age, different names hash same
            }
        }

        // All objects with age 30 hash to 30
        // Terrible collision rate
    }

    public void goodHashFunction() {
        class Person {
            String name;
            int age;

            @Override
            public int hashCode() {
                return Objects.hash(name, age);
                // Good: combines both fields
                // Distributes well
            }
        }
    }

    public void avalancheEffect() {
        // Good hash function has avalanche effect:
        // Small change in input -> big change in hash

        String s1 = "hello";
        String s2 = "hallo"; // One char different

        System.out.println(s1.hashCode()); // e.g., 99162322
        System.out.println(s2.hashCode()); // e.g., 99162303
        // Completely different hashes (bit patterns)

        // Poor hash: "hello" and "hallo" might hash close to each other
    }
}
```

### Open Addressing vs Chaining

```java
public class CollisionResolutionMethods {
    public void chainingApproach() {
        // Java HashMap uses chaining (linked list in each bucket)

        // On collision: add to linked list
        // Bucket 5: [key1 -> key2 -> key3]

        // Pros:
        // - Simple to implement
        // - Load factor > 1 possible
        // - Deletion easy

        // Cons:
        // - Extra memory for pointers
        // - Poor cache locality (nodes scattered in memory)
        // - O(n) worst case (all keys same bucket)
    }

    public void openAddressingApproach() {
        // Alternative: probe for empty slot (not used in Java HashMap)

        // Linear probing: hash -> hash+1 -> hash+2 ...
        // If bucket[5] occupied, try bucket[6], bucket[7], etc.

        // Pros:
        // - Better cache locality (contiguous memory)
        // - No pointer overhead

        // Cons:
        // - Load factor < 1 only
        // - Clustering: filled buckets cluster together
        // - Deletion complex (need tombstones)
        // - O(n) worst case with linear probing
    }
}
```

---

## Comparable vs Comparator

### Comparable: Natural Order

```java
public class ComparableExample {
    public class Student implements Comparable<Student> {
        private String name;
        private int gpa;

        @Override
        public int compareTo(Student other) {
            // Natural order: by GPA (descending)
            if (this.gpa != other.gpa) {
                return Integer.compare(other.gpa, this.gpa); // Descending
            }
            return this.name.compareTo(other.name); // Secondary: by name
        }
    }

    public void usage() {
        List<Student> students = Arrays.asList(
            new Student("Alice", 4),
            new Student("Bob", 3),
            new Student("Charlie", 3),
            new Student("David", 4)
        );

        Collections.sort(students); // Uses compareTo()
        // Order: Alice (4), David (4), Bob (3), Charlie (3)
    }

    public void stringComparable() {
        List<String> strings = Arrays.asList("apple", "banana", "cherry");
        Collections.sort(strings); // String implements Comparable<String>
        // Order: [apple, banana, cherry]
    }
}
```

### Comparator: Custom Orders

```java
public class ComparatorExample {
    public class Student {
        String name;
        int gpa;

        public Student(String name, int gpa) {
            this.name = name;
            this.gpa = gpa;
        }
    }

    public void multipleComparators() {
        List<Student> students = Arrays.asList(
            new Student("Alice", 4),
            new Student("Bob", 3),
            new Student("Charlie", 3)
        );

        // Sort by GPA descending
        students.sort((a, b) -> Integer.compare(b.gpa, a.gpa));

        // Sort by name (alphabetical)
        students.sort(Comparator.comparing(s -> s.name));

        // Chainable comparators
        students.sort(
            Comparator.comparing((Student s) -> s.gpa).reversed()
                      .thenComparing(s -> s.name)
        );
    }

    public void treeSetWithComparator() {
        // TreeSet with custom comparator
        Set<Student> students = new TreeSet<>((a, b) -> {
            if (a.gpa != b.gpa) {
                return Integer.compare(b.gpa, a.gpa);
            }
            return a.name.compareTo(b.name);
        });

        students.add(new Student("Bob", 3));
        students.add(new Student("Alice", 4));
        // Stored in custom order
    }
}
```

### Comparison Pitfalls

```java
public class ComparationPitfalls {
    public void inconsistentEqualityComparison() {
        class Student implements Comparable<Student> {
            String name;
            int id;

            @Override
            public int compareTo(Student other) {
                // Compare by ID only
                return Integer.compare(this.id, other.id);
            }

            @Override
            public boolean equals(Object obj) {
                if (!(obj instanceof Student)) return false;
                Student other = (Student) obj;
                // Compare by name (different from compareTo!)
                return this.name.equals(other.name);
            }
        }

        // Problem: CompareTo and equals are inconsistent!
        Student s1 = new Student("Alice", 1);
        Student s2 = new Student("Bob", 1);

        System.out.println(s1.compareTo(s2)); // 0 - equal by compareTo
        System.out.println(s1.equals(s2)); // false - not equal by equals
        // Violates contract: if compareTo returns 0, equals should return true

        // This breaks TreeSet/TreeMap:
        Set<Student> set = new TreeSet<>();
        set.add(s1);
        set.add(s2); // Not added (compareTo says equal)
        System.out.println(set.size()); // 1 - only one element
        System.out.println(set.contains(s2)); // false!
    }

    public void correctImplementation() {
        class Student implements Comparable<Student> {
            String name;
            int id;

            @Override
            public int compareTo(Student other) {
                return Integer.compare(this.id, other.id);
            }

            @Override
            public boolean equals(Object obj) {
                if (!(obj instanceof Student)) return false;
                Student other = (Student) obj;
                return this.id == other.id; // Consistent with compareTo
            }
        }
    }
}
```

---

## Iterator and Fail-Fast

### Fail-Fast Behavior

```java
public class FailFastIterator {
    public void demonstrateFailFast() {
        List<String> list = new ArrayList<>(Arrays.asList("a", "b", "c"));

        Iterator<String> iterator = list.iterator();
        iterator.next(); // Get "a"

        list.add("d"); // Modify list outside iterator

        try {
            iterator.next(); // Throws ConcurrentModificationException
        } catch (ConcurrentModificationException e) {
            System.out.println("Fail-fast detected modification!");
        }
    }

    public void failFastDetection() {
        // Iterator maintains modCount from collection
        // When modCount changes, iterator detects it

        List<String> list = new ArrayList<>();
        list.add("a");
        list.add("b");
        list.add("c");

        for (String item : list) { // Uses iterator internally
            if (item.equals("b")) {
                list.remove(item); // Modifies list during iteration
            }
        }
        // ConcurrentModificationException

        // Safe: use iterator.remove()
        list = new ArrayList<>(Arrays.asList("a", "b", "c"));
        Iterator<String> iter = list.iterator();
        while (iter.hasNext()) {
            String item = iter.next();
            if (item.equals("b")) {
                iter.remove(); // Safe - iterator knows about removal
            }
        }
    }
}
```

### Fail-Safe Iterator

```java
public class FailSafeIterator {
    public void copyOnWriteExample() {
        // CopyOnWriteArrayList uses fail-safe iteration
        List<String> list = new CopyOnWriteArrayList<>(
            Arrays.asList("a", "b", "c")
        );

        for (String item : list) {
            if (item.equals("b")) {
                list.add("d"); // Safe - no exception
            }
        }
        // No ConcurrentModificationException

        // Iterator works on snapshot
        // Modifications create new array, iterator still uses old
    }

    public void whenToUseFailSafe() {
        // Use CopyOnWriteArrayList when:
        // 1. More reads than writes (iteration frequent)
        // 2. Concurrent access expected
        // 3. Consistency preferred over performance

        // Avoid when:
        // 1. Frequent writes (copy overhead)
        // 2. Memory-constrained (snapshot overhead)
    }
}
```

---

## PriorityQueue

### Min-Heap Implementation

```java
public class PriorityQueueInternals {
    public void minHeapBasics() {
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        // Min-heap: parent <= children

        pq.add(5);
        pq.add(2);
        pq.add(8);
        pq.add(1);
        pq.add(3);

        // Internal array: [1, 2, 8, 5, 3]
        //       1
        //      / \
        //     2   8
        //    / \
        //   5   3

        while (!pq.isEmpty()) {
            System.out.print(pq.poll() + " "); // 1 2 3 5 8
        }
    }

    public void heapOperations() {
        PriorityQueue<String> pq = new PriorityQueue<>();

        // add/offer: O(log n) - insert then bubble up
        pq.offer("middle");
        pq.offer("top");
        pq.offer("bottom");

        // poll/remove: O(log n) - remove top, move last to top, bubble down
        String top = pq.poll(); // "bottom" (alphabetically first)

        // peek: O(1) - view minimum
        String next = pq.peek();
    }

    public void customComparator() {
        // Default: min-heap (ascending order)
        PriorityQueue<Integer> minHeap = new PriorityQueue<>();

        // Max-heap (descending order)
        PriorityQueue<Integer> maxHeap = new PriorityQueue<>(
            (a, b) -> Integer.compare(b, a)
        );

        maxHeap.add(5);
        maxHeap.add(2);
        maxHeap.add(8);

        while (!maxHeap.isEmpty()) {
            System.out.print(maxHeap.poll() + " "); // 8 5 2
        }
    }
}
```

---

## Decision Matrix

| Collection | Key Features | Use When | Avoid When |
|-----------|--------------|----------|-----------|
| **HashMap** | Fast lookup O(1), unordered, allows null | Need fast key-value access | Need sorted order |
| **TreeMap** | Sorted, O(log n) ops, range queries | Need ordering, range queries | Need O(1) lookup |
| **LinkedHashMap** | Insertion order, O(1) ops | Need insertion order, LRU cache | Don't need order |
| **ConcurrentHashMap** | Thread-safe, high concurrency | Multi-threaded, high contention | Single-threaded (overhead) |
| **ArrayList** | Fast random access O(1), dynamic | Frequent index access, appending | Frequent insertion at start |
| **LinkedList** | Fast insertion/removal at ends O(1) | Deque operations, start insertions | Random access needed |
| **TreeSet/TreeMap** | Sorted, range queries, O(log n) | Need ordering, min/max queries | Performance critical |
| **HashSet** | Fast lookup O(1), uniqueness | Need unique elements fast | Need ordering |
| **PriorityQueue** | Min/max element retrieval | Need element ordering, top-k | Frequent access to arbitrary elements |
| **CopyOnWriteArrayList** | Thread-safe iteration | Concurrent read-heavy | Frequent writes (memory overhead) |

---

## Interview Questions

### Q1: Why does HashMap allow null keys but TreeMap doesn't?

**Answer:**
```java
// HashMap uses hashCode() to place null
HashMap<String, Integer> map = new HashMap<>();
map.put(null, -1); // null.hashCode() would throw error
                    // But HashMap has special case: null -> bucket 0

// TreeMap uses compareTo() to order keys
TreeMap<String, Integer> treeMap = new TreeMap<>();
treeMap.put(null, -1); // null.compareTo(...) throws NPE
                        // No special case handling

// Reason: TreeMap needs to compare keys for ordering
// Can't compare with null meaningfully
```

### Q2: What happens if you modify a HashMap while iterating?

**Answer:**
```java
// ConcurrentModificationException thrown

// Why: Iterator checks modCount before each access
// modCount incremented on add/remove
// Iterator detects change, throws exception

// Solutions:
// 1. Use iterator.remove() - iterator aware
// 2. Collect modifications, apply after iteration
// 3. Use CopyOnWriteArrayList (fail-safe)
// 4. Synchronize externally (if must modify during iteration)
```

### Q3: Why is HashMap resizing O(n) but put() is O(1) amortized?

**Answer:**
```java
// Resizing is O(n): must rehash all entries
// But resizing is infrequent

// With load factor 0.75:
// Resizes happen at n = 12, 24, 48, 96, ...
// Total rehashing work: 12 + 24 + 48 + ... ≈ 2n
// Spread over n operations: 2n/n = O(1) amortized per operation
```

### Q4: How would you implement an LRU cache?

**Answer:**
```java
public class LRUCache<K, V> {
    private LinkedHashMap<K, V> cache;
    private final int capacity;

    public LRUCache(int capacity) {
        this.capacity = capacity;
        this.cache = new LinkedHashMap<K, V>(capacity, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                return size() > capacity;
            }
        };
    }

    public V get(K key) {
        return cache.get(key); // Moves to end (most recent)
    }

    public void put(K key, V value) {
        cache.put(key, value); // Moves to end (most recent)
    }
}
```

---

**Key Takeaway Summary:**

1. **HashMap:** O(1) average, uses hashing and linked lists, allows null key
2. **ArrayList:** O(1) get, O(n) insert/remove, dynamic array resizing
3. **LinkedList:** O(1) insert/remove at ends, O(n) random access, doubly-linked
4. **TreeMap:** O(log n) all ops, sorted, uses Red-Black tree
5. **ConcurrentHashMap:** Thread-safe with fine-grained locking, O(1) average
6. **LinkedHashMap:** Maintains insertion order, useful for LRU cache
7. **Collision Handling:** Chaining (Java uses) vs open addressing
8. **Fail-Fast vs Fail-Safe:** ArrayList throws exception, CopyOnWriteArrayList doesn't
9. **PriorityQueue:** Min-heap by default, O(log n) add/remove, O(1) peek

