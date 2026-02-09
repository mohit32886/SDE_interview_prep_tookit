# Core Java Fundamentals - Deep Dive

## Table of Contents
1. [OOP Principles](#oop-principles)
2. [equals() and hashCode() Contract](#equals-and-hashcode-contract)
3. [String Internals](#string-internals)
4. [Generics Deep Dive](#generics-deep-dive)
5. [Autoboxing and Unboxing](#autoboxing-and-unboxing)
6. [final, finally, finalize](#final-finally-finalize)
7. [static Keyword](#static-keyword)
8. [Marker Interfaces vs Annotations](#marker-interfaces-vs-annotations)
9. [Cloning](#cloning)
10. [Serialization](#serialization)
11. [Interview Questions](#interview-questions)

---

## OOP Principles

### Abstraction vs Encapsulation: The Real Difference

These two terms are often confused, but they serve different purposes in OOP design:

**Abstraction** is about hiding complexity and showing only essential features. It answers: "What does the object do?"
**Encapsulation** is about bundling data and methods together and controlling access. It answers: "How do I control access to data?"

```java
// ABSTRACTION: Interface defines WHAT the object does
public interface PaymentProcessor {
    void processPayment(double amount);
    boolean validatePayment();
}

// ENCAPSULATION: Implementation controls HOW and WHO can access it
public class CreditCardProcessor implements PaymentProcessor {
    // Private data - encapsulation
    private String cardNumber;
    private String cvv;
    private double balance;

    // Encapsulation + Abstraction combined
    @Override
    public void processPayment(double amount) {
        // Client doesn't need to know internal validation logic
        if (validatePayment() && amount <= balance) {
            balance -= amount;
        }
    }

    @Override
    public boolean validatePayment() {
        // Implementation details hidden from caller
        return isCardValid() && !isExpired();
    }

    // Private helper methods - part of encapsulation
    private boolean isCardValid() {
        // Luhn algorithm or similar
        return cardNumber.length() == 16;
    }

    private boolean isExpired() {
        // Check expiration
        return false;
    }

    // Getters/Setters control encapsulation
    public double getBalance() {
        return balance;
    }

    public void setBalance(double balance) {
        if (balance >= 0) {
            this.balance = balance;
        }
    }
}

// Usage: Client cares about abstraction (interface), not encapsulation (implementation)
PaymentProcessor processor = new CreditCardProcessor();
processor.processPayment(100.0); // Don't care HOW it's done, just WHAT it does
```

**Why it matters in interviews:**
- Shows understanding of separation of concerns
- Demonstrates knowledge of SOLID principles
- Proves you can design maintainable systems

---

### Polymorphism: Compile-Time vs Runtime

**Compile-Time Polymorphism (Method Overloading):**
- Resolved during compilation
- Based on method signature (name + parameters)
- NO runtime overhead
- Cannot override with different return type (except covariant returns)

```java
public class Calculator {
    // Method overloading - compile-time polymorphism
    public int add(int a, int b) {
        return a + b;
    }

    public double add(double a, double b) {
        return a + b;
    }

    public int add(int a, int b, int c) {
        return a + b + c;
    }

    // Covariant return type is allowed (returns subtype)
    public Number addNumbers(Number a, Number b) {
        return 0;
    }
}

// How compiler sees this:
// add(int, int) -> method signature determined at compile time
// add(double, double) -> different signature
// add(int, int, int) -> yet another signature
```

**Runtime Polymorphism (Method Overriding):**
- Resolved during execution
- Based on actual object type at runtime
- Uses virtual method dispatch (v-table lookup)
- Method must be inherited, not overloaded

```java
public abstract class Animal {
    // Virtual method - resolved at runtime
    public void makeSound() {
        System.out.println("Generic animal sound");
    }

    public final void sleep() {
        System.out.println("Sleeping"); // Final methods are NOT polymorphic
    }
}

public class Dog extends Animal {
    @Override
    public void makeSound() {
        System.out.println("Woof!");
    }
}

public class Cat extends Animal {
    @Override
    public void makeSound() {
        System.out.println("Meow!");
    }
}

public class PolymorphismDemo {
    public static void main(String[] args) {
        // Runtime polymorphism in action
        Animal animal1 = new Dog();
        Animal animal2 = new Cat();

        animal1.makeSound(); // OUTPUT: Woof! (based on actual object type: Dog)
        animal2.makeSound(); // OUTPUT: Meow! (based on actual object type: Cat)

        // Method dispatch happens at runtime via v-table
        // JVM checks actual object type at runtime, not declared type
    }
}

// Performance note: JIT compilation often inlines monomorphic calls
// But polymorphic calls have lookup overhead
```

**Method Dispatch Under the Hood:**
```java
// Simplified version of what JVM does for runtime polymorphism:
public class VirtualMethodDispatch {
    // Every class has a v-table (virtual method table)
    // Animal.v-table:
    //   makeSound() -> Animal::makeSound
    //   sleep() -> Animal::sleep (final, not in v-table)

    // Dog.v-table:
    //   makeSound() -> Dog::makeSound (overridden)
    //   sleep() -> Animal::sleep (inherited)

    public void demonstrateDispatch(Animal a) {
        a.makeSound(); // JVM does: lookup a.getClass().v-table().get("makeSound")()
    }
}
```

---

### Inheritance Pitfalls

**Pitfall 1: Fragile Base Class Problem**
```java
public class BadBase {
    public void process() {
        getData(); // Assumes subclass won't override this
    }

    protected String getData() {
        return "base data";
    }
}

public class FragileSubclass extends BadBase {
    @Override
    protected String getData() {
        return "subclass data"; // Seems safe, but...
    }

    public void refresh() {
        process(); // Now this behaves differently than in BadBase
    }
}

// SOLUTION: Use composition over inheritance
public class BetterApproach {
    private DataProvider provider; // Composition, not inheritance

    public BetterApproach(DataProvider provider) {
        this.provider = provider;
    }

    public void process() {
        String data = provider.getData();
        // Process data
    }
}

public interface DataProvider {
    String getData();
}
```

**Pitfall 2: Diamond Problem (Java doesn't support multiple inheritance)**
```java
// This is NOT allowed in Java, but shows why:
// interface A { void method(); }
// interface B extends A { }
// interface C extends A { }
// class D implements B, C { } // Which method() implementation?

// SOLUTION: Use interfaces (provide default implementation if needed)
public interface A {
    default void method() {
        System.out.println("Default A");
    }
}

public interface B extends A {
    // Inherits default method from A
}

public interface C extends A {
    @Override
    default void method() {
        System.out.println("Default C");
    }
}

public class D implements B, C {
    @Override
    public void method() {
        // Must explicitly implement to resolve ambiguity
        C.super.method(); // Can choose which parent to call
    }
}
```

**Pitfall 3: Constructor Chaining Complexity**
```java
public class Base {
    private String data;

    public Base(String data) {
        System.out.println("Base constructor called");
        this.data = data;
    }
}

public class Child extends Base {
    private int value;

    public Child(String data, int value) {
        super(data); // MUST call super constructor first
        System.out.println("Child constructor called");
        this.value = value;
    }

    // Common mistake: forgetting super() call
    // Child c = new Child("test", 5);
    // OUTPUT: Base constructor called
    //         Child constructor called
}
```

**Key Takeaway:** Inheritance creates tight coupling. Use composition unless there's a true IS-A relationship.

---

## equals() and hashCode() Contract

This is one of the most important concepts in Java and frequently tested in interviews.

### The Contract

If you override `equals()`, you MUST override `hashCode()` such that:
1. **Reflexive:** `x.equals(x)` returns `true`
2. **Symmetric:** if `x.equals(y)` then `y.equals(x)`
3. **Transitive:** if `x.equals(y)` and `y.equals(z)` then `x.equals(z)`
4. **Consistent:** multiple calls return the same result (assuming data doesn't change)
5. **Null handling:** `x.equals(null)` always returns `false`

**Critical Rule:** If `a.equals(b)` then `a.hashCode() == b.hashCode()`. But the reverse is NOT true.

### Breaking the Contract - Real Consequences

```java
// WRONG: equals() without hashCode()
public class BrokenPerson {
    private String name;
    private int age;

    public BrokenPerson(String name, int age) {
        this.name = name;
        this.age = age;
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;
        BrokenPerson other = (BrokenPerson) obj;
        return age == other.age && Objects.equals(name, other.name);
    }

    // NO hashCode() override - BIG MISTAKE!
}

public class HashMapBroken {
    public static void main(String[] args) {
        BrokenPerson p1 = new BrokenPerson("John", 30);
        BrokenPerson p2 = new BrokenPerson("John", 30);

        System.out.println("p1.equals(p2): " + p1.equals(p2)); // true - CORRECT
        System.out.println("p1.hashCode() == p2.hashCode(): "
            + (p1.hashCode() == p2.hashCode())); // false - WRONG!

        // This breaks HashMap!
        Map<BrokenPerson, String> map = new HashMap<>();
        map.put(p1, "John's data");

        System.out.println("map.get(p1): " + map.get(p1)); // Works: "John's data"
        System.out.println("map.get(p2): " + map.get(p2)); // NULL! - BROKEN
        // Different hash codes cause HashMap to look in different bucket

        // This breaks HashSet too!
        Set<BrokenPerson> set = new HashSet<>();
        set.add(p1);
        set.add(p2);
        System.out.println("set.size(): " + set.size()); // 2 - WRONG! Should be 1
        // Both objects in set even though they're equal
    }
}
```

### Correct Implementation

```java
// CORRECT: Both equals() and hashCode()
public class CorrectPerson {
    private String name;
    private int age;

    public CorrectPerson(String name, int age) {
        this.name = name;
        this.age = age;
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true; // Reflexive + performance
        if (obj == null || getClass() != obj.getClass()) return false; // Null check
        CorrectPerson other = (CorrectPerson) obj;
        return age == other.age && Objects.equals(name, other.name); // Transitive + consistent
    }

    @Override
    public int hashCode() {
        // Same fields used in equals() must be used in hashCode()
        return Objects.hash(name, age); // Java 7+, much safer than manual calculation
    }

    // Alternative manual hashCode (for education):
    public int hashCodeManual() {
        int result = 31 * 1 + (name == null ? 0 : name.hashCode());
        result = 31 * result + age;
        return result;
        // Uses prime number 31 (chosen for hashCode distribution)
        // Must be consistent with equals() fields
    }
}

public class HashMapCorrect {
    public static void main(String[] args) {
        CorrectPerson p1 = new CorrectPerson("John", 30);
        CorrectPerson p2 = new CorrectPerson("John", 30);

        System.out.println("p1.equals(p2): " + p1.equals(p2)); // true
        System.out.println("p1.hashCode() == p2.hashCode(): "
            + (p1.hashCode() == p2.hashCode())); // true

        Map<CorrectPerson, String> map = new HashMap<>();
        map.put(p1, "John's data");
        System.out.println("map.get(p2): " + map.get(p2)); // "John's data" - CORRECT!

        Set<CorrectPerson> set = new HashSet<>();
        set.add(p1);
        set.add(p2);
        System.out.println("set.size(): " + set.size()); // 1 - CORRECT!
    }
}
```

### Why Collections Fail Without Proper hashCode()

```java
public class HashMapInternals {
    // Simplified HashMap behavior
    public static void main(String[] args) {
        Map<BrokenPerson, String> map = new HashMap<>();
        BrokenPerson p1 = new BrokenPerson("John", 30);

        // HashMap internally:
        // 1. Calls p1.hashCode() -> returns some random object hash
        // 2. Calculates bucket index: hash % bucketSize
        // 3. Stores at that bucket: bucket[index] = (key, value)

        map.put(p1, "data");

        BrokenPerson p2 = new BrokenPerson("John", 30); // equals p1 but different hashCode

        // On retrieval:
        // 1. Calls p2.hashCode() -> returns DIFFERENT random hash
        // 2. Calculates different bucket index
        // 3. Looks in wrong bucket -> key not found
        // 4. Returns null

        System.out.println(map.get(p2)); // null - DATA LOSS!
    }
}
```

**Key Takeaway:** Always use IDE-generated equals() and hashCode() methods. The contract is non-negotiable for data structure correctness.

---

## String Internals

### String Pool and Immutability

```java
public class StringPoolExample {
    public static void main(String[] args) {
        // String literals are automatically pooled
        String s1 = "hello";
        String s2 = "hello";
        System.out.println(s1 == s2); // true - SAME reference (pooled)

        // Strings created with new() are NOT automatically pooled
        String s3 = new String("hello");
        System.out.println(s1 == s3); // false - different objects
        System.out.println(s1.equals(s3)); // true - same content

        // intern() forces entry into pool
        String s4 = new String("hello").intern();
        System.out.println(s1 == s4); // true - intern() returns pooled reference

        // String concatenation at compile time is optimized
        String s5 = "hello" + " " + "world"; // Compiled to single literal

        // String concatenation at runtime creates new objects
        String prefix = "hello";
        String s6 = prefix + " world"; // New String object created at runtime
    }
}
```

### Why Immutability Matters

```java
public class ImmutabilityBenefits {
    // 1. Thread safety without synchronization
    // Multiple threads can share String safely
    public void threadSafeSharing(String immutableString) {
        // No synchronization needed - String can't change
    }

    // 2. Used as HashMap keys safely
    public void hashMapKeyUse() {
        Map<String, String> map = new HashMap<>();
        String key = "important_key";
        map.put(key, "value");
        // Even if we could modify the key, HashMap would still find it
        // (But we can't modify it because String is immutable)
    }

    // 3. Security - prevents hacker modification
    public class SecurityExample {
        private String password; // Even if password is exposed, can't be modified

        public SecurityExample(String password) {
            this.password = password; // Safe because String is immutable
            // If someone had reference to password string, can't change it
        }
    }

    // 4. String pool efficiency - deduplication
    public void poolingBenefits() {
        // 1 million "hello" strings all point to same object
        // Memory efficiency through sharing
    }
}
```

### String Pool Internals

```java
public class StringPoolInternals {
    public static void main(String[] args) {
        // String pool is essentially a HashMap inside JVM
        // Simplified: Map<String content, String reference> pool

        String s1 = "hello"; // JVM: check if "hello" in pool
                              // Not found, create and add
                              // Return reference

        String s2 = "hello"; // JVM: check if "hello" in pool
                              // Found! Return same reference

        // Java 8+: String pool is in Heap (used to be in PermGen)
        // Can observe impact with -XX:StringTableSize JVM flag

        // Dangerous: intern() on user input can cause memory leak
        String userInput = readUserInput(); // "a_" repeated many times
        userInput = userInput.intern(); // Could fill up string pool
                                        // Interned strings are never garbage collected
    }
}
```

### StringBuilder vs StringBuffer

```java
public class StringBuilderVsStringBuffer {
    // Both are mutable and avoid String concatenation overhead

    // StringBuffer: Synchronized (thread-safe)
    public void stringBufferUse() {
        StringBuffer buffer = new StringBuffer();
        buffer.append("Hello");
        buffer.append(" ");
        buffer.append("World");
        // All methods synchronized - prevents concurrent modification
        // Performance: slower due to synchronization overhead
    }

    // StringBuilder: NOT synchronized (not thread-safe)
    public void stringBuilderUse() {
        StringBuilder builder = new StringBuilder();
        builder.append("Hello");
        builder.append(" ");
        builder.append("World");
        // No synchronization - faster if used in single thread
        // Performance: significantly faster than StringBuffer
    }

    public void performanceComparison() {
        // String concatenation with + operator
        long start = System.nanoTime();
        String result = "";
        for (int i = 0; i < 10000; i++) {
            result += "x"; // Creates new String object each iteration
        }
        long stringTime = System.nanoTime() - start;

        // StringBuilder
        start = System.nanoTime();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 10000; i++) {
            sb.append("x"); // Modifies internal char array
        }
        String result2 = sb.toString();
        long builderTime = System.nanoTime() - start;

        // StringBuilder is typically 100x-1000x faster for this pattern
        System.out.println("String concatenation time: " + stringTime);
        System.out.println("StringBuilder time: " + builderTime);
    }

    // When NOT to use StringBuilder
    public void wrongUseOfStringBuilder() {
        // DON'T: Creating StringBuilder in loop - defeats purpose
        String result = "";
        for (int i = 0; i < 1000; i++) {
            StringBuilder sb = new StringBuilder(); // Created every iteration
            sb.append("x");
            result += sb.toString(); // Back to String concatenation
        }

        // DO: Create StringBuilder outside loop
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 1000; i++) {
            sb.append("x"); // Single StringBuilder instance
        }
        result = sb.toString();
    }
}
```

### String.intern() - Careful!

```java
public class StringInternWarning {
    public static void main(String[] args) {
        // Good use: known, controlled strings
        String s1 = new String("config_key");
        String s2 = "config_key";
        System.out.println(s1 == s2); // false without intern
        System.out.println(s1 == s2.intern()); // true with intern

        // BAD use: User-generated content
        Set<String> interned = new HashSet<>();
        for (int i = 0; i < 1000000; i++) {
            String userInput = getUserInput(); // User can send unique strings
            interned.add(userInput.intern()); // MEMORY LEAK RISK
            // Interned strings never garbage collected
            // Eventually OutOfMemoryError
        }

        // Java 8.242+: intern() strings get garbage collected
        // But still not recommended for untrusted input
    }
}
```

**Key Takeaway:** Strings are immutable for thread-safety and security. Use StringBuilder for concatenation in loops. Avoid intern() on user input.

---

## Generics Deep Dive

### Type Erasure - The Core Concept

```java
public class TypeErasureDemo {
    // Java generics are implemented via TYPE ERASURE
    // Generic type info is removed at compile time

    public static void main(String[] args) {
        // What you write
        List<String> strings = new ArrayList<String>();
        strings.add("hello");

        // What gets compiled (type erasure)
        List strings_compiled = new ArrayList(); // <String> is removed
        strings_compiled.add((String) "hello"); // Casts added where necessary

        // Consequence: Generics are compile-time only
        List<String> stringList = new ArrayList<>();
        List<Integer> intList = new ArrayList<>();

        System.out.println(stringList.getClass() == intList.getClass());
        // true - At runtime, both are just List
        // No way to distinguish at runtime
    }

    // Can't do this - type info erased
    // public <T> void doSomething(List<String> list) { }
    // public <T> void doSomething(List<Integer> list) { }
    // ERROR: Erasure makes these identical at runtime

    // Can do this - different raw types
    public void overload(List<String> strings) { }
    public void overload(Set<String> strings) { } // Different raw types

    // No primitives in generics - consequence of type erasure
    // List<int> list = new ArrayList<>(); // ERROR
    List<Integer> list = new ArrayList<>(); // Must use wrapper
}
```

### Bounded Type Parameters

```java
public class BoundedTypeParameters {
    // Upper Bound: ? extends T (covariant)
    public void upperBoundExample() {
        List<Integer> intList = Arrays.asList(1, 2, 3);

        // Can read from ? extends Number
        List<? extends Number> numbers = intList;
        Number n = numbers.get(0); // Safe to read

        // Can't write to ? extends Number (except null)
        // numbers.add(1); // ERROR - can't guarantee type safety
        // Why? List could be List<Double> underneath, adding Integer would be wrong

        // Practical use: reading from heterogeneous collection
        public double sum(List<? extends Number> numbers) {
            double sum = 0;
            for (Number n : numbers) {
                sum += n.doubleValue();
            }
            return sum;
        }

        sum(Arrays.asList(1, 2, 3)); // List<Integer>
        sum(Arrays.asList(1.5, 2.5, 3.5)); // List<Double>
    }

    // Lower Bound: ? super T (contravariant)
    public void lowerBoundExample() {
        List<Number> numberList = new ArrayList<>();

        // Can write to ? super Integer
        List<? super Integer> integers = numberList;
        integers.add(1); // Safe - Integer is subtype of Number

        // Can't reliably read (except as Object)
        // Integer i = integers.get(0); // ERROR
        Object o = integers.get(0); // Must use Object

        // Practical use: writing to collection
        public void copyIntegers(List<Integer> from, List<? super Integer> to) {
            for (Integer i : from) {
                to.add(i); // Can safely add Integer to ? super Integer
            }
        }
    }
}
```

### PECS Principle - Producer Extends, Consumer Super

```java
public class PECSPrinciple {
    // PECS: Producer Extends, Consumer Super

    // Producer (reading): Use ? extends T
    public <T> double sum(List<? extends Number> numbers) {
        // Think of this as "producing" numbers from the list
        double sum = 0;
        for (Number n : numbers) {
            sum += n.doubleValue();
        }
        return sum;
    }

    // Consumer (writing): Use ? super T
    public <T> void fill(List<? super Integer> list, Integer value) {
        // Think of this as "consuming" integers into the list
        for (int i = 0; i < 10; i++) {
            list.add(value);
        }
    }

    // Real-world example: Collections.copy()
    public class CollectionsCopyExample {
        public static <T> void copy(List<? super T> dest, List<? extends T> src) {
            // src is producer - use ? extends T
            // dest is consumer - use ? super T
            for (T item : src) {
                dest.add(item);
            }
        }

        public void demonstratePECS() {
            List<Number> numbers = new ArrayList<>();
            List<Integer> integers = Arrays.asList(1, 2, 3);

            copy(numbers, integers); // Works perfectly
        }
    }
}
```

### Generic Methods

```java
public class GenericMethods {
    // Generic method: type parameter defined at method level
    public <T> T getFirst(List<T> list) {
        return list.isEmpty() ? null : list.get(0);
    }

    // Type parameter inferred from argument
    public void testGenericMethod() {
        List<String> strings = Arrays.asList("a", "b");
        String first = getFirst(strings); // T inferred as String

        List<Integer> integers = Arrays.asList(1, 2);
        Integer first2 = getFirst(integers); // T inferred as Integer
    }

    // Multiple type parameters
    public <K, V> Map<K, V> createMap(K key, V value) {
        Map<K, V> map = new HashMap<>();
        map.put(key, value);
        return map;
    }

    // Recursive type bound (advanced)
    public <T extends Comparable<T>> T max(List<T> list) {
        // T must extend Comparable<T>
        if (list.isEmpty()) return null;
        T max = list.get(0);
        for (T t : list) {
            if (t.compareTo(max) > 0) {
                max = t;
            }
        }
        return max;
    }

    // Wildcard vs Type Parameter
    public void wildcardVsTypeParameter() {
        // Use type parameter when you need to relate multiple arguments
        public <T> void swap(List<T> list, int i, int j) {
            // T connects both positions in list
            T temp = list.get(i);
            list.set(i, list.get(j));
            list.set(j, temp);
        }

        // Use wildcard when you don't need to relate arguments
        public void printList(List<?> list) {
            // <?> is sufficient, no need for type parameter
            for (Object item : list) {
                System.out.println(item);
            }
        }
    }
}
```

**Key Takeaway:** Type erasure is why generics are a compile-time feature. Use bounded wildcards wisely with PECS principle.

---

## Autoboxing and Unboxing

### How Autoboxing Works

```java
public class AutoboxingDemo {
    public static void main(String[] args) {
        // Autoboxing: primitive -> wrapper object (compiler magic)
        Integer wrapped = 5; // Compiled to: Integer.valueOf(5)

        // Unboxing: wrapper object -> primitive (compiler magic)
        int unwrapped = wrapped; // Compiled to: wrapped.intValue()

        // Practical implications:
        Integer a = 5; // autoboxed
        Integer b = 5; // autoboxed
        System.out.println(a == b); // true - Integer caching (-128 to 127)

        Integer c = 200; // autoboxed
        Integer d = 200; // autoboxed
        System.out.println(c == d); // false - outside cache range!
    }

    // Autoboxing in collections
    public void collectionsAutoboxing() {
        List<Integer> list = new ArrayList<>();
        list.add(5); // autoboxing: Integer.valueOf(5)
        int value = list.get(0); // unboxing: value.intValue()

        // Dangerous: unboxing null
        List<Integer> nullList = new ArrayList<>();
        nullList.add(null);
        int val = nullList.get(0); // NullPointerException!
    }
}
```

### Integer Caching (-128 to 127)

```java
public class IntegerCaching {
    public static void main(String[] args) {
        // Java caches Integer objects from -128 to 127
        // Optimization to reduce memory usage

        Integer i1 = 127;
        Integer i2 = 127;
        System.out.println(i1 == i2); // true - cached

        Integer i3 = 128;
        Integer i4 = 128;
        System.out.println(i3 == i4); // false - not cached

        Integer i5 = Integer.valueOf(127);
        Integer i6 = Integer.valueOf(127);
        System.out.println(i5 == i6); // true - valueOf uses cache

        Integer i7 = new Integer(127);
        Integer i8 = new Integer(127);
        System.out.println(i7 == i8); // false - new creates separate objects

        // Cache range configurable: -XX:AutoBoxCacheMax=1000
    }

    public void whyComparisonMatters() {
        List<Integer> list1 = Arrays.asList(1, 2, 3);
        List<Integer> list2 = Arrays.asList(1, 2, 3);

        // WRONG: comparing with ==
        for (int i = 0; i < list1.size(); i++) {
            if (list1.get(i) == list2.get(i)) { // Might fail for values > 127
                // relies on caching, fragile
            }
        }

        // CORRECT: comparing with equals()
        for (int i = 0; i < list1.size(); i++) {
            if (list1.get(i).equals(list2.get(i))) { // Always correct
                // Compares values, not references
            }
        }
    }
}
```

### Performance Implications

```java
public class AutoboxingPerformance {
    public static void main(String[] args) {
        // Autoboxing adds overhead

        // Inefficient: ArrayList of Integer
        List<Integer> list = new ArrayList<>();
        long start = System.nanoTime();
        for (int i = 0; i < 1000000; i++) {
            list.add(i); // autoboxing overhead
        }
        long listTime = System.nanoTime() - start;

        // Efficient: direct array of int
        int[] array = new int[1000000];
        start = System.nanoTime();
        for (int i = 0; i < 1000000; i++) {
            array[i] = i; // no boxing
        }
        long arrayTime = System.nanoTime() - start;

        System.out.println("ArrayList<Integer> time: " + listTime);
        System.out.println("int[] time: " + arrayTime);
        // array is typically 10-20x faster due to no autoboxing overhead
    }

    // Double wrapping - dangerous
    public void doubleWrappingDanger() {
        Integer a = 5; // autoboxed once
        Integer b = Integer.valueOf(a); // unnecessary boxing (already boxed)
        // Creates extra object unnecessarily
    }
}
```

**Key Takeaway:** Autoboxing is convenient but has performance cost. Use == only on primitives or when you understand caching. Always use .equals() for wrapper object comparison.

---

## final, finally, finalize

### final Keyword

```java
public class FinalKeyword {
    // 1. Final variable: can't be reassigned
    public void finalVariable() {
        final int value = 10;
        // value = 20; // ERROR - can't reassign

        // Effective final (Java 8+)
        int effectivelyFinal = 10;
        // effectivelyFinal = 20; // ERROR - can't reassign
        new Runnable() { // Can use in anonymous class
            public void run() {
                System.out.println(effectivelyFinal);
            }
        };
    }

    // 2. Final method: can't be overridden
    public class Parent {
        public final void criticalMethod() {
            // Implementation can't be overridden by subclass
        }
    }

    // 3. Final class: can't be subclassed
    public final class ImmutableClass {
        // No subclass can extend this
    }

    // Why make String final?
    // public final class String { }
    // Reasons:
    // - Immutability guarantee
    // - Security (can't subclass to add mutable behavior)
    // - Performance (JVM can optimize better)
    // - String pool efficiency
}
```

### finally Block

```java
public class FinallyBlock {
    // finally: Always executes (except JVM exit, infinite loop, OS kills)

    public void basicFinally() {
        try {
            System.out.println("Try block");
        } catch (Exception e) {
            System.out.println("Catch block");
        } finally {
            System.out.println("Finally block"); // ALWAYS executes
        }
        // OUTPUT: Try block
        //         Finally block
    }

    public void finallyWithReturn() {
        try {
            return "from try";
        } finally {
            // Executes even if returning from try
            System.out.println("Finally with return");
        }
        // OUTPUT: Finally with return
        //         Method returns "from try"
    }

    public void finallyWithException() {
        try {
            throw new RuntimeException("Error!");
        } catch (RuntimeException e) {
            System.out.println("Caught: " + e.getMessage());
        } finally {
            System.out.println("Finally executes");
        }
        // OUTPUT: Caught: Error!
        //         Finally executes
    }

    // Try-with-resources (better than finally for cleanup)
    public void trialWithResources() throws IOException {
        try (BufferedReader reader = new BufferedReader(new FileReader("file.txt"))) {
            String line = reader.readLine();
        } // reader automatically closed here
        // No finally needed - compiler adds it
    }
}
```

### finalize() Method

```java
public class FinalizeMethod {
    // finalize(): Called by GC before object is reclaimed (DEPRECATED)

    public class ResourceHolder {
        private FileInputStream fis;

        @Deprecated
        @Override
        protected void finalize() throws Throwable {
            try {
                if (fis != null) {
                    fis.close(); // Try to cleanup
                }
            } finally {
                super.finalize();
            }
        }

        // Problems with finalize:
        // 1. Unpredictable when called (depends on GC)
        // 2. Can cause performance issues (finalizer thread)
        // 3. Objects with finalizers take longer to garbage collect
        // 4. Not guaranteed to execute before JVM shutdown
        // 5. Can resurrect objects (access this in finalize)
    }

    // BETTER: Use try-with-resources or explicit cleanup
    public class BetterResourceHolder implements AutoCloseable {
        private FileInputStream fis;

        @Override
        public void close() throws IOException {
            // Explicitly close resources
            if (fis != null) {
                fis.close();
            }
        }
    }

    public void demonstrateCleanup() throws IOException {
        try (BetterResourceHolder holder = new BetterResourceHolder()) {
            // Use holder
        } // close() automatically called here
    }

    // Object resurrection - dangerous
    public class ResurrectionDanger {
        private static ResurrectionDanger instance;

        @Deprecated
        @Override
        protected void finalize() {
            instance = this; // Resurrect object!
        }

        public void doThis() {
            ResurrectionDanger obj = new ResurrectionDanger();
            // obj eligible for GC
            // But finalize() might resurrect it
        }
    }
}
```

### Differences Summary

| Feature | Purpose | Executes |
|---------|---------|----------|
| **final** | Prevent modification/override | Compile-time |
| **finally** | Guaranteed cleanup code | Always (except JVM exit) |
| **finalize()** | Pre-GC cleanup (DEPRECATED) | Before GC reclaims object (unpredictable) |

**Key Takeaway:** Use final for immutability and security. Use finally (or try-with-resources) for cleanup. Avoid finalize() - use AutoCloseable instead.

---

## static Keyword

### Static Variables

```java
public class StaticVariables {
    public static int counter = 0; // Class variable - shared across instances
    private int instanceVar = 0; // Instance variable - one per object

    public StaticVariables() {
        counter++; // Incremented for every object created
    }

    public void demonstrateStatic() {
        StaticVariables obj1 = new StaticVariables();
        StaticVariables obj2 = new StaticVariables();

        System.out.println("counter: " + StaticVariables.counter); // 2

        obj1.counter = 100; // Modifies class variable, affects all instances
        System.out.println("obj2.counter: " + obj2.counter); // 100 - same variable!
    }

    // Problem: mutable static state
    public class MutableStaticDanger {
        public static List<String> sharedList = new ArrayList<>(); // Mutable!

        public void addName(String name) {
            sharedList.add(name); // Modifies shared state
        }
    }

    // Better: immutable static
    public class ImmutableStaticGood {
        public static final List<String> CONSTANT_LIST =
            Collections.unmodifiableList(Arrays.asList("a", "b"));
    }
}
```

### Static Methods

```java
public class StaticMethods {
    public static void staticMethod() {
        // Can't access instance variables
        // Can only access static variables and other static methods
        // Called on class, not instance
    }

    private int instanceVar = 10;

    public void callStaticFromInstance() {
        // Can call static from instance (but not recommended)
        staticMethod(); // OK but confusing
        StaticMethods.staticMethod(); // Better - clear it's static
    }

    // Common pattern: utility methods
    public class MathUtil {
        public static int add(int a, int b) {
            return a + b;
        }

        // Prevent instantiation of utility class
        private MathUtil() {
            throw new AssertionError("Can't instantiate");
        }
    }

    public void usage() {
        int result = MathUtil.add(5, 3); // Don't need object instance
    }
}
```

### Static Blocks

```java
public class StaticBlocks {
    private static int value;
    public static final String CONSTANT;

    // Static initializer block - executed once when class loads
    static {
        System.out.println("Static block executed");
        value = 10;
    }

    // Static block for complex initialization
    static {
        // Can have multiple static blocks - executed in order
        int temp = 20;
        value += temp;
    }

    static {
        // Initialize constants
        CONSTANT = "constant value";
    }

    public static void main(String[] args) {
        // OUTPUT: Static block executed
        //         (printed when class loads, before main)
        System.out.println("Main method");
    }

    // Instance initializer block (rarely used)
    private int instanceValue;

    {
        // Executed every time instance created, BEFORE constructor
        instanceValue = 100;
    }

    public StaticBlocks() {
        System.out.println("Constructor, instanceValue: " + instanceValue);
    }
}
```

### Static Inner Classes

```java
public class StaticInnerClasses {
    private int outerVar = 10;
    private static int staticVar = 20;

    // Static inner class - doesn't have implicit reference to outer instance
    public static class StaticInnerClass {
        public void method() {
            // Can access static members of outer class
            System.out.println(staticVar);

            // Can't access instance members without instance reference
            // System.out.println(outerVar); // ERROR
        }
    }

    // Non-static inner class - has implicit reference to outer instance
    public class InstanceInnerClass {
        public void method() {
            // Can access both instance and static members
            System.out.println(outerVar); // OK
            System.out.println(staticVar); // OK
        }
    }

    public void demonstrateUsage() {
        StaticInnerClass static_inner = new StaticInnerClass(); // No outer reference needed
        InstanceInnerClass inner = new InstanceInnerClass(); // Implicitly captures outer
    }
}
```

### Static Gotchas

```java
public class StaticGotchas {
    public static void main(String[] args) {
        // Gotcha 1: Static variables in interfaces (implicit public static final)
        public interface Constants {
            String KEY = "value"; // public static final String KEY
        }

        // Gotcha 2: Static method hiding (not overriding)
        class Parent {
            public static void method() {
                System.out.println("Parent");
            }
        }

        class Child extends Parent {
            public static void method() { // Hides parent method, doesn't override
                System.out.println("Child");
            }
        }

        Parent p = new Child();
        p.method(); // Prints "Parent" (based on declared type, not runtime type)
        Child.method(); // Prints "Child"
        // This violates Liskov Substitution Principle!

        // Gotcha 3: Class loading for static initialization
        // Static blocks execute when class first loads, not when object created
        // If you never load the class, static block never executes
    }
}
```

**Key Takeaway:** Static variables are shared across all instances. Static methods can't access instance state. Use static sparingly - it creates tight coupling and makes testing harder.

---

## Marker Interfaces vs Annotations

### Marker Interfaces

```java
public class MarkerInterfaces {
    // Marker interface: no methods, just marks a type
    public interface Serializable {
        // No methods
    }

    public interface Cloneable {
        // No methods
    }

    public class Person implements Serializable {
        // Compiler checks: "This class is marked as Serializable"
        // JVM uses this information at runtime
    }

    public void usage() {
        Object obj = new Person();
        if (obj instanceof Serializable) {
            // Object has been marked as Serializable
            // Can perform serialization
        }
    }

    // Problems with marker interfaces:
    // 1. Can't tell if class implements interface without instanceof checks
    // 2. Violated at compile time only if explicitly checked
    // 3. Subclasses automatically inherit marker
    public class Child extends Person {
        // Automatically implements Serializable
        // Even if this subclass shouldn't be Serializable
    }
}
```

### Annotations

```java
public class AnnotationsApproach {
    // Annotation: more powerful alternative to marker interfaces
    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.TYPE)
    public @interface Serializable {
        // Can include metadata
    }

    @Serializable
    public class Person {
        // Marked with annotation
    }

    public void usageWithReflection() {
        Class<?> personClass = Person.class;
        if (personClass.isAnnotationPresent(Serializable.class)) {
            // Check annotation at runtime
        }

        Serializable annotation = personClass.getAnnotation(Serializable.class);
    }

    // Advantages of annotations over marker interfaces:
    // 1. Can be processed by tools (compile-time or runtime)
    // 2. Can include metadata values
    // 3. Can be applied to specific elements (methods, fields, parameters)
    // 4. Don't get inherited to subclasses (unless specified)
    // 5. More flexible retention policies
}
```

### Comparison

| Feature | Marker Interface | Annotation |
|---------|------------------|------------|
| **Syntax** | Explicit interface implementation | @ syntax |
| **Inheritance** | Automatic to subclasses | Can be configured |
| **Metadata** | Can't add metadata | Can include metadata |
| **Type-checking** | Compile-time with instanceof | Runtime with reflection |
| **Tool processing** | Limited | Rich support (APT, frameworks) |
| **Discoverability** | Must check explicitly | Visible in documentation tools |

```java
public class Choosing {
    // Use marker interface if:
    // 1. Need compile-time type checking
    // 2. Want to extend a type hierarchy
    // 3. Need instanceof checks to be meaningful

    public interface Drawable {
        // This type is drawable
    }

    // Use annotation if:
    // 1. No type hierarchy needed
    // 2. Want tool/framework processing
    // 3. Need metadata values
    // 4. Want selective inheritance

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.TYPE)
    public @interface TestClass {
        String author() default "unknown";
        int priority() default 0;
    }

    @TestClass(author = "John", priority = 1)
    public class TestExample {
        // Annotations can be processed by test frameworks
    }
}
```

**Key Takeaway:** Modern Java prefers annotations over marker interfaces. Annotations are more flexible and integrate better with frameworks.

---

## Cloning

### Shallow vs Deep Copy

```java
public class ShallowVsDeepCopy {
    public class Person implements Cloneable {
        public String name;
        public Address address; // Mutable object

        // Shallow copy: default clone() from Object
        @Override
        public Person clone() throws CloneNotSupportedException {
            return (Person) super.clone(); // BitBlast copy
        }
    }

    public class Address {
        public String city;
        public String country;
    }

    public void demonstrateShallowCopy() throws CloneNotSupportedException {
        Person original = new Person();
        original.name = "John";
        original.address = new Address();
        original.address.city = "NYC";

        Person cloned = original.clone(); // Shallow copy

        // Primitives and immutable objects are safe
        cloned.name = "Jane"; // Doesn't affect original
        System.out.println(original.name); // Still "John"

        // Mutable objects are shared!
        cloned.address.city = "LA";
        System.out.println(original.address.city); // Also "LA" - SHARED!

        System.out.println(original.address == cloned.address); // true - SAME object
    }

    // Deep copy: manually clone all mutable fields
    public class PersonDeepCopy implements Cloneable {
        private String name;
        private Address address;

        @Override
        public PersonDeepCopy clone() throws CloneNotSupportedException {
            PersonDeepCopy cloned = (PersonDeepCopy) super.clone();

            // Deep copy mutable fields
            if (this.address != null) {
                cloned.address = new Address();
                cloned.address.city = this.address.city;
                cloned.address.country = this.address.country;
            }

            return cloned;
        }
    }

    public void demonstrateDeepCopy() throws CloneNotSupportedException {
        PersonDeepCopy original = new PersonDeepCopy();
        original.address = new Address();
        original.address.city = "NYC";

        PersonDeepCopy cloned = original.clone(); // Deep copy

        cloned.address.city = "LA";
        System.out.println(original.address.city); // Still "NYC" - independent
        System.out.println(original.address == cloned.address); // false - different objects
    }
}
```

### Cloneable Pitfalls

```java
public class CloneablePitfalls {
    // Pitfall 1: Cloneable interface is empty - misleading
    // Implementing Cloneable doesn't override clone()
    public class WrongClone implements Cloneable {
        public String data;

        // Must override clone() explicitly
        // Implementing Cloneable alone does nothing
    }

    // Pitfall 2: clone() throws checked exception
    public void pitfall2() throws CloneNotSupportedException {
        WrongClone obj = new WrongClone();
        // obj.clone(); // ERROR - CloneNotSupportedException possible
    }

    // Pitfall 3: Not all objects support cloning
    // ArrayList is Cloneable
    // But ArrayList<MutableObject> shallow clones the objects

    // Pitfall 4: Cloning bypasses constructor
    public class Person implements Cloneable {
        private String name;
        private int age;

        public Person(String name, int age) {
            if (name == null || name.isEmpty()) {
                throw new IllegalArgumentException("Invalid name");
            }
            this.name = name;
            this.age = age;
        }

        @Override
        public Person clone() {
            try {
                return (Person) super.clone(); // Bypasses constructor validation!
            } catch (CloneNotSupportedException e) {
                throw new RuntimeException(e);
            }
        }
    }

    // Better alternative: Copy constructor
    public class BetterPerson {
        private String name;
        private int age;

        public BetterPerson(String name, int age) {
            if (name == null || name.isEmpty()) {
                throw new IllegalArgumentException("Invalid name");
            }
            this.name = name;
            this.age = age;
        }

        // Copy constructor - goes through validation
        public BetterPerson(BetterPerson other) {
            this(other.name, other.age); // Calls main constructor
        }
    }

    // Even better: Immutable objects
    public final class ImmutablePerson {
        private final String name;
        private final int age;

        public ImmutablePerson(String name, int age) {
            this.name = name;
            this.age = age;
        }

        // No cloning needed - object can't be modified anyway
    }
}
```

**Key Takeaway:** Avoid Cloneable. Use copy constructors or immutability instead. If you must clone, implement deep copy for mutable fields.

---

## Serialization

### Serializable and serialVersionUID

```java
public class SerializationFundamentals {
    // Serializable: marker interface for ObjectInputStream/ObjectOutputStream
    public class Person implements Serializable {
        // serialVersionUID: version ID for class evolution
        private static final long serialVersionUID = 1L;

        private String name;
        private int age;

        // Non-serializable field must be marked transient
        private transient byte[] encryptedData;
    }

    public void serializeObject() throws IOException {
        Person person = new Person();
        person.name = "John";
        person.age = 30;

        // Serialize
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ObjectOutputStream oos = new ObjectOutputStream(baos);
        oos.writeObject(person);
        byte[] serialized = baos.toByteArray();

        // Deserialize
        ByteArrayInputStream bais = new ByteArrayInputStream(serialized);
        ObjectInputStream ois = new ObjectInputStream(bais);
        Person deserialized = (Person) ois.readObject();
    }

    // serialVersionUID: controls compatibility across versions
    public class PersonV1 implements Serializable {
        private static final long serialVersionUID = 1L;

        private String name;
        private int age;
        // version 1
    }

    public class PersonV2 implements Serializable {
        private static final long serialVersionUID = 1L; // Same ID = compatible

        private String name;
        private int age;
        private String email; // New field - adds null during deserialization
    }

    // If you change serialVersionUID, old serialized objects can't be deserialized
    public class PersonV3 implements Serializable {
        private static final long serialVersionUID = 2L; // Different ID = incompatible

        private String name;
        private int age;
    }
}
```

### transient Keyword

```java
public class TransientKeyword {
    public class SecureData implements Serializable {
        private String username;
        private transient String password; // NOT serialized
        private int balance;

        // When deserialized, password will be null (or default for type)
    }

    public void demonstrateTransient() throws IOException, ClassNotFoundException {
        SecureData data = new SecureData();
        data.username = "john";
        data.password = "secret123"; // Won't be serialized
        data.balance = 1000;

        // Serialize
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ObjectOutputStream oos = new ObjectOutputStream(baos);
        oos.writeObject(data);

        // Deserialize
        ByteArrayInputStream bais = new ByteArrayInputStream(baos.toByteArray());
        ObjectInputStream ois = new ObjectInputStream(bais);
        SecureData restored = (SecureData) ois.readObject();

        System.out.println("username: " + restored.username); // "john"
        System.out.println("password: " + restored.password); // null
        System.out.println("balance: " + restored.balance); // 1000
    }
}
```

### Custom Serialization

```java
public class CustomSerialization {
    public class Person implements Serializable {
        private String name;
        private int age;
        private List<String> hobbies;

        // Custom serialization logic
        private void writeObject(ObjectOutputStream oos) throws IOException {
            // writeObject() called during serialization
            oos.defaultWriteObject(); // Write default fields

            // Custom serialization for hobbies (encrypt if needed)
            oos.writeInt(hobbies.size());
            for (String hobby : hobbies) {
                oos.writeUTF(hobby);
            }
        }

        private void readObject(ObjectInputStream ois) throws IOException, ClassNotFoundException {
            // readObject() called during deserialization
            ois.defaultReadObject(); // Read default fields

            // Custom deserialization for hobbies
            int size = ois.readInt();
            hobbies = new ArrayList<>();
            for (int i = 0; i < size; i++) {
                hobbies.add(ois.readUTF());
            }
        }

        private Object writeReplace() throws ObjectStreamException {
            // Serialize as different class if needed
            return this; // or return new SerializationProxy(this)
        }

        private void readResolve() throws ObjectStreamException {
            // Called after deserialization - can return different object
            // Useful for ensuring singletons survive serialization
        }
    }
}
```

### Serialization Versioning

```java
public class SerializationVersioning {
    // Version 1
    public class ConfigV1 implements Serializable {
        private static final long serialVersionUID = 1L;

        private String appName;
        private String version;
    }

    // Version 2: Added field
    public class ConfigV2 implements Serializable {
        private static final long serialVersionUID = 1L; // Keep same for compatibility

        private String appName;
        private String version;
        private String author; // New field

        private void readObject(ObjectInputStream ois) throws IOException, ClassNotFoundException {
            ois.defaultReadObject();
            // author will be null if deserializing from V1
            if (author == null) {
                author = "Unknown"; // Default value
            }
        }
    }

    // Version 3: Removed field, reordered
    public class ConfigV3 implements Serializable {
        private static final long serialVersionUID = 1L; // Keep same

        private String appName;
        private String author; // Moved here
        // version removed

        private void readObject(ObjectInputStream ois) throws IOException, ClassNotFoundException {
            ois.defaultReadObject();
            // Will fail because serialized object still has 'version' field
            // This is why versioning is important!
        }
    }
}
```

### Serialization Pitfalls

```java
public class SerializationPitfalls {
    // Pitfall 1: Singleton not preserved during serialization
    public class Singleton implements Serializable {
        private static final long serialVersionUID = 1L;
        private static final Singleton INSTANCE = new Singleton();

        private Singleton() {}

        public static Singleton getInstance() {
            return INSTANCE;
        }

        public static void main(String[] args) throws Exception {
            Singleton s1 = Singleton.getInstance();

            // Serialize
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ObjectOutputStream oos = new ObjectOutputStream(baos);
            oos.writeObject(s1);

            // Deserialize
            ByteArrayInputStream bais = new ByteArrayInputStream(baos.toByteArray());
            ObjectInputStream ois = new ObjectInputStream(bais);
            Singleton s2 = (Singleton) ois.readObject();

            System.out.println(s1 == s2); // false! - different instance
            // BROKEN SINGLETON!
        }

        // Fix: implement readResolve()
        private Object readResolve() throws ObjectStreamException {
            return INSTANCE; // Return singleton instead of new instance
        }
    }
}
```

**Key Takeaway:** Serialization is complex and fragile. Prefer JSON/protobuf for data exchange. Use serialVersionUID carefully. Implement readResolve() for singletons.

---

## Interview Questions

### Q1: What's the difference between `==` and `.equals()` for Strings?

**Answer:**
```java
String s1 = "hello"; // Literal - in string pool
String s2 = "hello"; // Literal - same pool reference
String s3 = new String("hello"); // Different object

System.out.println(s1 == s2); // true - same reference
System.out.println(s1 == s3); // false - different objects
System.out.println(s1.equals(s3)); // true - same content

// For Strings, always use .equals() unless checking if same object
// For other objects, must override equals() and hashCode() for semantic equality
```

### Q2: Why are wrapper types cached only between -128 and 127?

**Answer:** This is a performance optimization. These values are commonly used, so Java caches them to reduce object creation. For values outside this range, each autoboxing creates a new object. Always use `.equals()` for wrapper comparison, not `==`.

### Q3: Explain the relationship between `equals()` and `hashCode()`

**Answer:** If two objects are equal (per `equals()`), they must have the same hash code. This contract ensures HashMap/HashSet correctness. Breaking it causes data loss - you can put an object in a HashMap but not retrieve it with an equal object.

### Q4: What happens if you don't implement `hashCode()` when you override `equals()`?

**Answer:** Objects will work correctly in reference-based comparisons, but fail catastrophically in hash-based collections (HashMap, HashSet) because they might be placed in the wrong bucket during insertion but looked up in wrong bucket during retrieval.

### Q5: Why is String immutable?

**Answer:**
- Thread-safety without synchronization
- Safe use as HashMap keys (hash code never changes)
- String pooling efficiency (deduplication)
- Security (prevents malicious modification of strings like passwords or URLs)

---

**Key Takeaway Summary:**

1. **OOP:** Abstraction hides complexity, encapsulation hides data. Use composition over inheritance.
2. **equals()/hashCode():** Non-negotiable contract. Breaking it causes HashMap/HashSet failures.
3. **Strings:** Immutable for thread-safety and security. Use StringBuilder in loops.
4. **Generics:** Type erasure means generics are compile-time only. Use PECS for wildcards.
5. **Autoboxing:** Automatic but has performance cost. Use arrays for large collections of primitives.
6. **final/finally/finalize:** Different purposes - final prevents modification, finally guarantees execution, finalize is deprecated.
7. **static:** Shared across instances, creates coupling. Use sparingly.
8. **Cloning:** Problematic - use copy constructors or immutability instead.
9. **Serialization:** Complex and fragile - prefer JSON. Use serialVersionUID for versioning.

