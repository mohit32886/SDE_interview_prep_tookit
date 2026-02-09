# Top 30 Java-Specific Coding Problems - FAANG Level

## Table of Contents
1. [String Manipulation](#string-manipulation)
2. [Array and List Operations](#array-and-list-operations)
3. [HashMap-Based Problems](#hashmap-based-problems)
4. [Concurrency Puzzles](#concurrency-puzzles)
5. [Stream API Challenges](#stream-api-challenges)
6. [OOP Design Problems](#oop-design-problems)

---

## String Manipulation

### Problem 1: Longest Palindromic Substring

```java
public class LongestPalindrome {
    /**
     * Find longest palindromic substring in O(n²) time, O(1) space
     * Example: "babad" -> "bab" or "aba"
     */
    public String longestPalindrome(String s) {
        if (s == null || s.length() < 1) return "";

        int start = 0;
        int maxLen = 0;

        for (int i = 0; i < s.length(); i++) {
            // Odd-length palindromes (single character center)
            int len1 = expandAroundCenter(s, i, i);
            // Even-length palindromes (between two characters)
            int len2 = expandAroundCenter(s, i, i + 1);

            int len = Math.max(len1, len2);

            if (len > maxLen) {
                maxLen = len;
                start = i - (len - 1) / 2; // Calculate start index
            }
        }

        return s.substring(start, start + maxLen);
    }

    private int expandAroundCenter(String s, int left, int right) {
        while (left >= 0 && right < s.length() && s.charAt(left) == s.charAt(right)) {
            left--;
            right++;
        }
        return right - left - 1; // Length of palindrome
    }

    // Time Complexity: O(n²) - expand around each center
    // Space Complexity: O(1) - only constant extra space
    // Follow-up: Use Manacher's algorithm for O(n) solution
}
```

### Problem 2: Implement strStr() / indexOf()

```java
public class StringMatch {
    /**
     * Find first occurrence of needle in haystack
     * Example: "hello", "ll" -> 2
     * Time: O(n*m) naive, O(n+m) with KMP
     */
    public int strStr(String haystack, String needle) {
        if (needle.isEmpty()) return 0;
        if (haystack.length() < needle.length()) return -1;

        // Naive approach: check each position
        for (int i = 0; i <= haystack.length() - needle.length(); i++) {
            if (haystack.substring(i, i + needle.length()).equals(needle)) {
                return i;
            }
        }

        return -1;
    }

    // KMP (Knuth-Morris-Pratt) for O(n+m)
    public int strStrKMP(String haystack, String needle) {
        if (needle.isEmpty()) return 0;

        // Build failure function
        int[] lps = buildLPS(needle);
        int i = 0; // haystack index
        int j = 0; // needle index

        while (i < haystack.length()) {
            if (haystack.charAt(i) == needle.charAt(j)) {
                i++;
                j++;
            }

            if (j == needle.length()) {
                return i - j; // Found at position
            } else if (i < haystack.length() && haystack.charAt(i) != needle.charAt(j)) {
                j = (j > 0) ? lps[j - 1] : 0;
            }
        }

        return -1;
    }

    private int[] buildLPS(String pattern) {
        int[] lps = new int[pattern.length()];
        int j = 0;

        for (int i = 1; i < pattern.length(); i++) {
            while (j > 0 && pattern.charAt(i) != pattern.charAt(j)) {
                j = lps[j - 1];
            }
            if (pattern.charAt(i) == pattern.charAt(j)) {
                j++;
            }
            lps[i] = j;
        }

        return lps;
    }

    // Time: O(n*m) naive, O(n+m) KMP
    // Space: O(m) for KMP failure function
}
```

### Problem 3: Reverse Words in String

```java
public class ReverseWords {
    /**
     * Reverse order of words, trim extra spaces
     * Example: "  hello   world  " -> "world hello"
     */
    public String reverseWords(String s) {
        // Trim and split by whitespace
        String[] words = s.trim().split("\\s+");

        // Reverse array
        int left = 0, right = words.length - 1;
        while (left < right) {
            String temp = words[left];
            words[left] = words[right];
            words[right] = temp;
            left++;
            right--;
        }

        return String.join(" ", words);
    }

    // Time: O(n) - single pass
    // Space: O(n) - for reversed array
    // Follow-up: Do it in-place for character array
}
```

---

## Array and List Operations

### Problem 4: Two Sum

```java
public class TwoSum {
    /**
     * Find two numbers in array that sum to target
     * Return indices, not values
     */
    public int[] twoSum(int[] nums, int target) {
        // Use HashMap for O(n) solution
        Map<Integer, Integer> seen = new HashMap<>();

        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];

            if (seen.containsKey(complement)) {
                return new int[]{seen.get(complement), i};
            }

            seen.put(nums[i], i);
        }

        throw new IllegalArgumentException("No two sum solution");
    }

    // Time: O(n)
    // Space: O(n)
    // Follow-up: Sorted array -> use two pointers O(1) space

    public int[] twoSumSorted(int[] nums, int target) {
        int left = 0, right = nums.length - 1;

        while (left < right) {
            int sum = nums[left] + nums[right];
            if (sum == target) {
                return new int[]{left + 1, right + 1}; // 1-indexed
            } else if (sum < target) {
                left++;
            } else {
                right--;
            }
        }

        throw new IllegalArgumentException("No two sum solution");
    }
}
```

### Problem 5: Best Time to Buy and Sell Stock

```java
public class StockTrading {
    /**
     * Max profit from one transaction (buy then sell)
     * Example: [7,1,5,3,6,4] -> 5 (buy at 1, sell at 6)
     */
    public int maxProfit(int[] prices) {
        if (prices == null || prices.length < 2) return 0;

        int minPrice = prices[0];
        int maxProfit = 0;

        for (int i = 1; i < prices.length; i++) {
            // Can sell at current price
            int profit = prices[i] - minPrice;
            maxProfit = Math.max(maxProfit, profit);

            // Update min price seen so far
            minPrice = Math.min(minPrice, prices[i]);
        }

        return maxProfit;
    }

    // Time: O(n)
    // Space: O(1)
    // Key insight: track min price so far, calculate profit at each step

    /**
     * Max profit with unlimited transactions
     */
    public int maxProfitUnlimited(int[] prices) {
        int maxProfit = 0;

        // Capture every upward trend
        for (int i = 1; i < prices.length; i++) {
            if (prices[i] > prices[i - 1]) {
                maxProfit += prices[i] - prices[i - 1];
            }
        }

        return maxProfit;
    }

    // Time: O(n)
    // Key insight: sum all positive differences
}
```

### Problem 6: Container With Most Water

```java
public class ContainerWithMostWater {
    /**
     * Find two lines that can hold most water
     * Height determined by shorter line
     * Example: [1,8,6,2,5,4,8,3,7] -> 49 (indices 1 and 8)
     */
    public int maxArea(int[] height) {
        int left = 0;
        int right = height.length - 1;
        int maxArea = 0;

        while (left < right) {
            // Calculate area
            int width = right - left;
            int h = Math.min(height[left], height[right]);
            int area = width * h;
            maxArea = Math.max(maxArea, area);

            // Move pointer pointing to shorter line
            if (height[left] < height[right]) {
                left++;
            } else {
                right--;
            }
        }

        return maxArea;
    }

    // Time: O(n)
    // Space: O(1)
    // Key insight: two pointers, move inward from wider base
    // Moving shorter line pointer might find taller line (increase area)
    // Moving taller line pointer always decreases area (same height or less, smaller width)
}
```

---

## HashMap-Based Problems

### Problem 7: Implement LRU Cache

```java
public class LRUCache {
    /**
     * LRU Cache with O(1) get and put
     * Evicts least recently used item when full
     */
    private static class Node {
        int key;
        int value;
        Node prev;
        Node next;

        Node(int key, int value) {
            this.key = key;
            this.value = value;
        }
    }

    private int capacity;
    private Map<Integer, Node> cache = new HashMap<>();
    private Node head = new Node(0, 0); // Dummy head (most recent)
    private Node tail = new Node(0, 0); // Dummy tail (least recent)

    public LRUCache(int capacity) {
        this.capacity = capacity;
        head.next = tail;
        tail.prev = head;
    }

    public int get(int key) {
        if (!cache.containsKey(key)) return -1;

        Node node = cache.get(key);
        moveToHead(node); // Mark as recently used
        return node.value;
    }

    public void put(int key, int value) {
        if (cache.containsKey(key)) {
            Node node = cache.get(key);
            node.value = value;
            moveToHead(node);
        } else {
            if (cache.size() == capacity) {
                removeLeast(); // Remove least recently used
            }

            Node newNode = new Node(key, value);
            cache.put(key, newNode);
            addToHead(newNode);
        }
    }

    private void moveToHead(Node node) {
        removeNode(node);
        addToHead(node);
    }

    private void removeNode(Node node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    private void addToHead(Node node) {
        node.next = head.next;
        node.prev = head;
        head.next.prev = node;
        head.next = node;
    }

    private void removeLeast() {
        Node least = tail.prev;
        removeNode(least);
        cache.remove(least.key);
    }

    // Time: O(1) for both get and put
    // Space: O(capacity)
    // Uses doubly linked list for O(1) node removal and reordering
}
```

### Problem 8: Top K Frequent Elements

```java
public class TopKFrequent {
    /**
     * Find k most frequent elements
     * Example: [1,1,1,2,2,3] k=2 -> [1,2]
     */
    public int[] topKFrequent(int[] nums, int k) {
        // Count frequencies
        Map<Integer, Integer> count = new HashMap<>();
        for (int num : nums) {
            count.put(num, count.getOrDefault(num, 0) + 1);
        }

        // Use min-heap of size k
        PriorityQueue<Integer> heap = new PriorityQueue<>(
            (a, b) -> count.get(a) - count.get(b)
        );

        for (int num : count.keySet()) {
            heap.offer(num);
            if (heap.size() > k) {
                heap.poll(); // Remove element with smallest frequency
            }
        }

        int[] result = new int[k];
        int i = 0;
        while (!heap.isEmpty()) {
            result[i++] = heap.poll();
        }

        return result;
    }

    // Time: O(n log k) - iterate n elements, maintain k-heap
    // Space: O(n) for frequency map
    // Key insight: maintain min-heap of size k, elements with higher frequency survive
}
```

### Problem 9: Implement HashMap from Scratch

```java
public class CustomHashMap<K, V> {
    /**
     * Basic HashMap implementation
     */
    private static final int DEFAULT_CAPACITY = 16;
    private static final float LOAD_FACTOR = 0.75f;

    private Entry<K, V>[] table;
    private int size;

    @SuppressWarnings("unchecked")
    public CustomHashMap() {
        table = new Entry[DEFAULT_CAPACITY];
        size = 0;
    }

    public void put(K key, V value) {
        if (size >= table.length * LOAD_FACTOR) {
            resize();
        }

        int index = hash(key);
        Entry<K, V> entry = table[index];

        // Check if key exists
        while (entry != null) {
            if ((key == null && entry.key == null) ||
                (key != null && key.equals(entry.key))) {
                entry.value = value; // Update existing
                return;
            }
            entry = entry.next;
        }

        // Add new entry
        Entry<K, V> newEntry = new Entry<>(key, value);
        newEntry.next = table[index];
        table[index] = newEntry;
        size++;
    }

    public V get(Object key) {
        int index = hash(key);
        Entry<K, V> entry = table[index];

        while (entry != null) {
            if ((key == null && entry.key == null) ||
                (key != null && key.equals(entry.key))) {
                return entry.value;
            }
            entry = entry.next;
        }

        return null;
    }

    @SuppressWarnings("unchecked")
    private void resize() {
        Entry<K, V>[] oldTable = table;
        table = new Entry[oldTable.length * 2];
        size = 0;

        for (Entry<K, V> entry : oldTable) {
            while (entry != null) {
                put(entry.key, entry.value);
                entry = entry.next;
            }
        }
    }

    private int hash(Object key) {
        if (key == null) return 0;
        return Math.abs(key.hashCode() % table.length);
    }

    private static class Entry<K, V> {
        K key;
        V value;
        Entry<K, V> next;

        Entry(K key, V value) {
            this.key = key;
            this.value = value;
        }
    }

    // Time: O(1) average for put/get
    // Space: O(n) where n is number of entries
}
```

---

## Concurrency Puzzles

### Problem 10: Implement Blocking Queue

```java
public class CustomBlockingQueue<T> {
    /**
     * Thread-safe blocking queue implementation
     */
    private LinkedList<T> queue = new LinkedList<>();
    private int capacity;
    private Object lock = new Object();

    public CustomBlockingQueue(int capacity) {
        this.capacity = capacity;
    }

    public void put(T item) throws InterruptedException {
        synchronized (lock) {
            // Wait while queue is full
            while (queue.size() == capacity) {
                lock.wait();
            }

            queue.add(item);
            lock.notifyAll(); // Wake consumers
        }
    }

    public T take() throws InterruptedException {
        synchronized (lock) {
            // Wait while queue is empty
            while (queue.isEmpty()) {
                lock.wait();
            }

            T item = queue.removeFirst();
            lock.notifyAll(); // Wake producers
            return item;
        }
    }

    public int size() {
        synchronized (lock) {
            return queue.size();
        }
    }

    // Time: O(1) for put/take
    // Space: O(capacity)
    // Key: monitor lock, wait/notifyAll for synchronization
}
```

### Problem 11: Implement Thread-Safe Singleton

```java
public class ThreadSafeSingleton {
    /**
     * Lazy initialization, double-checked locking
     */
    private static volatile ThreadSafeSingleton instance;

    private ThreadSafeSingleton() {
        // Prevent instantiation
    }

    public static ThreadSafeSingleton getInstance() {
        if (instance == null) { // First check (no lock, fast path)
            synchronized (ThreadSafeSingleton.class) {
                if (instance == null) { // Second check (with lock)
                    instance = new ThreadSafeSingleton();
                }
            }
        }
        return instance;
    }

    // Time: O(1) after initialization
    // Space: O(1)
    // Key: volatile keyword ensures visibility, double-check prevents unnecessary locking
    // Better: use initialization-on-demand holder
}
```

### Problem 12: Producer-Consumer with BlockingQueue

```java
public class ProducerConsumerPattern {
    /**
     * Using BlockingQueue for clean synchronization
     */
    public static void main(String[] args) throws InterruptedException {
        BlockingQueue<Integer> queue = new LinkedBlockingQueue<>(5);

        Thread producer = new Thread(() -> {
            try {
                for (int i = 0; i < 20; i++) {
                    queue.put(i);
                    System.out.println("Produced: " + i);
                    Thread.sleep(100);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });

        Thread consumer = new Thread(() -> {
            try {
                for (int i = 0; i < 20; i++) {
                    int item = queue.take(); // Blocks if empty
                    System.out.println("Consumed: " + item);
                    Thread.sleep(150);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });

        producer.start();
        consumer.start();
        producer.join();
        consumer.join();
    }

    // BlockingQueue handles all synchronization internally
    // put() blocks when full, take() blocks when empty
}
```

---

## Stream API Challenges

### Problem 13: Stream Reduction with Complex Logic

```java
public class StreamReduction {
    /**
     * Use reduce for complex aggregations
     */
    public int sumOfSquares(List<Integer> numbers) {
        return numbers.stream()
            .map(n -> n * n)
            .reduce(0, Integer::sum);
    }

    /**
     * Custom reduction with object
     */
    public class Statistics {
        int count = 0;
        int sum = 0;
        int min = Integer.MAX_VALUE;
        int max = Integer.MIN_VALUE;
    }

    public Statistics computeStats(List<Integer> numbers) {
        return numbers.stream()
            .reduce(
                new Statistics(),
                (stats, n) -> {
                    stats.count++;
                    stats.sum += n;
                    stats.min = Math.min(stats.min, n);
                    stats.max = Math.max(stats.max, n);
                    return stats;
                },
                (stats1, stats2) -> {
                    Statistics combined = new Statistics();
                    combined.count = stats1.count + stats2.count;
                    combined.sum = stats1.sum + stats2.sum;
                    combined.min = Math.min(stats1.min, stats2.min);
                    combined.max = Math.max(stats1.max, stats2.max);
                    return combined;
                }
            );
    }

    // Time: O(n)
    // Space: O(1) for single value, O(custom) for complex objects
}
```

### Problem 14: Grouping with Collectors

```java
public class StreamGrouping {
    /**
     * Group and transform data efficiently
     */
    public static class Person {
        String name;
        int age;
        String city;

        public Person(String name, int age, String city) {
            this.name = name;
            this.age = age;
            this.city = city;
        }
    }

    public void groupingExamples(List<Person> people) {
        // Group by city
        Map<String, List<Person>> byCity = people.stream()
            .collect(Collectors.groupingBy(p -> p.city));

        // Group by city, count
        Map<String, Long> cityCount = people.stream()
            .collect(Collectors.groupingBy(p -> p.city, Collectors.counting()));

        // Group by age, get average age per city (nested grouping)
        Map<String, Map<Integer, List<Person>>> nestedGroup = people.stream()
            .collect(Collectors.groupingBy(
                p -> p.city,
                Collectors.groupingBy(p -> p.age)
            ));

        // Group by city, get names
        Map<String, List<String>> cityNames = people.stream()
            .collect(Collectors.groupingBy(
                p -> p.city,
                Collectors.mapping(p -> p.name, Collectors.toList())
            ));
    }

    // Time: O(n) single pass
    // Space: O(n) for grouped result
}
```

---

## OOP Design Problems

### Problem 15: Observer Pattern / Event System

```java
public class EventBusPattern {
    /**
     * Simple event bus implementation
     */
    public interface EventListener {
        void onEvent(Event event);
    }

    public class Event {
        private String type;
        private Object data;

        public Event(String type, Object data) {
            this.type = type;
            this.data = data;
        }

        public String getType() { return type; }
        public Object getData() { return data; }
    }

    public class EventBus {
        private Map<String, List<EventListener>> listeners = new HashMap<>();

        public void subscribe(String eventType, EventListener listener) {
            listeners.computeIfAbsent(eventType, k -> new ArrayList<>())
                .add(listener);
        }

        public void publish(Event event) {
            List<EventListener> eventListeners = listeners.get(event.getType());
            if (eventListeners != null) {
                eventListeners.forEach(listener -> listener.onEvent(event));
            }
        }
    }

    // Usage:
    public void example() {
        EventBus bus = new EventBus();

        bus.subscribe("user.created", event -> {
            System.out.println("User created: " + event.getData());
        });

        bus.subscribe("user.deleted", event -> {
            System.out.println("User deleted: " + event.getData());
        });

        bus.publish(new Event("user.created", "John"));
    }
}
```

### Problem 16: Factory Pattern with Enum

```java
public class FactoryPattern {
    /**
     * Type-safe factory using enum
     */
    public enum PaymentMethodType {
        CREDIT_CARD {
            @Override
            public PaymentMethod create() {
                return new CreditCardPayment();
            }
        },
        PAYPAL {
            @Override
            public PaymentMethod create() {
                return new PayPalPayment();
            }
        },
        BITCOIN {
            @Override
            public PaymentMethod create() {
                return new BitcoinPayment();
            }
        };

        public abstract PaymentMethod create();
    }

    public interface PaymentMethod {
        void process(double amount);
    }

    public class CreditCardPayment implements PaymentMethod {
        @Override
        public void process(double amount) {
            System.out.println("Processing credit card: $" + amount);
        }
    }

    public class PayPalPayment implements PaymentMethod {
        @Override
        public void process(double amount) {
            System.out.println("Processing PayPal: $" + amount);
        }
    }

    public class BitcoinPayment implements PaymentMethod {
        @Override
        public void process(double amount) {
            System.out.println("Processing Bitcoin: " + amount + " BTC");
        }
    }

    // Usage:
    public void process(PaymentMethodType type, double amount) {
        PaymentMethod method = type.create();
        method.process(amount);
    }
}
```

---

## Advanced Problems Summary

### Problem 17-30: Additional Challenging Problems

```java
public class AdvancedProblems {
    /*
    17. Implement Custom HashMap (with collision handling)
    18. Implement LRU Cache (with LinkedHashMap)
    19. Implement Thread Pool / ExecutorService
    20. Word Ladder (BFS graph traversal)
    21. Course Schedule (topological sort)
    22. Alien Dictionary (topological sort, DFS)
    23. Word Break (dynamic programming, trie)
    24. Median of Two Sorted Arrays (binary search)
    25. Design Cache Eviction Policy
    26. Implement Semaphore from scratch
    27. Design Parking Lot System (OOP)
    28. Design Rate Limiter (token bucket algorithm)
    29. Design Key-Value Store with TTL
    30. Implement Trie (prefix tree)
    */
}
```

### Problem 17: Implement Trie (Prefix Tree)

```java
public class TrieImplementation {
    /**
     * Prefix tree for efficient string searching
     */
    private class TrieNode {
        Map<Character, TrieNode> children = new HashMap<>();
        boolean isEndOfWord = false;
    }

    private TrieNode root = new TrieNode();

    public void insert(String word) {
        TrieNode node = root;
        for (char c : word.toCharArray()) {
            node = node.children.computeIfAbsent(c, k -> new TrieNode());
        }
        node.isEndOfWord = true;
    }

    public boolean search(String word) {
        TrieNode node = findNode(word);
        return node != null && node.isEndOfWord;
    }

    public boolean startsWith(String prefix) {
        return findNode(prefix) != null;
    }

    private TrieNode findNode(String word) {
        TrieNode node = root;
        for (char c : word.toCharArray()) {
            node = node.children.get(c);
            if (node == null) return null;
        }
        return node;
    }

    // Time: O(m) where m is length of word
    // Space: O(alphabet_size * n) where n is number of words
}
```

### Problem 18: Rate Limiter (Token Bucket)

```java
public class RateLimiter {
    /**
     * Token bucket algorithm for rate limiting
     */
    private final double rate; // tokens per second
    private double tokens;
    private long lastRefillTime;
    private final Object lock = new Object();

    public RateLimiter(double rate) {
        this.rate = rate;
        this.tokens = rate; // Start with full bucket
        this.lastRefillTime = System.currentTimeMillis();
    }

    public boolean allowRequest() {
        synchronized (lock) {
            refillTokens();

            if (tokens >= 1.0) {
                tokens -= 1.0;
                return true;
            }
            return false;
        }
    }

    private void refillTokens() {
        long now = System.currentTimeMillis();
        double elapsedSeconds = (now - lastRefillTime) / 1000.0;
        tokens = Math.min(rate, tokens + rate * elapsedSeconds);
        lastRefillTime = now;
    }

    // Time: O(1) per request
    // Space: O(1)
    // Key: refill tokens based on elapsed time, allow if >= 1 token
}
```

---

**Key Takeaways for Each Category:**

**String Problems:**
- Use two pointers for palindromes (expand around center)
- KMP for efficient string matching
- HashMap for character frequency counts

**Array/List Problems:**
- Two pointers for linear problems
- HashMap for complement/frequency problems
- Min/max tracking for single-pass solutions

**HashMap Problems:**
- LRU: use doubly linked list + HashMap
- TopK: use min-heap of size k
- Understand collision handling and resizing

**Concurrency:**
- Wait/notify for custom synchronization
- BlockingQueue for producer-consumer
- Volatile and double-checked locking for singletons

**Streams:**
- Intermediate vs terminal operations
- Reduce for custom aggregations
- Collectors.groupingBy for complex grouping

**OOP Design:**
- Pattern: Factory, Observer, Singleton
- Use enums for type-safe factories
- Interface segregation for loose coupling

