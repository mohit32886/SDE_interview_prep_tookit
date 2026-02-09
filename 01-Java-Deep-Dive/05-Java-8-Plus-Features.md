# Java 8+ Features - Deep Dive

## Table of Contents
1. [Lambda Expressions](#lambda-expressions)
2. [Functional Interfaces](#functional-interfaces)
3. [Method References](#method-references)
4. [Stream API](#stream-api)
5. [Optional](#optional)
6. [Interface Enhancements](#interface-enhancements)
7. [Java 9 Modules](#java-9-modules)
8. [Java 10 var Keyword](#java-10-var-keyword)
9. [Java 14 Records](#java-14-records)
10. [Java 17 Sealed Classes](#java-17-sealed-classes)
11. [Java 21 Virtual Threads](#java-21-virtual-threads)
12. [Performance and Anti-Patterns](#performance-and-anti-patterns)
13. [Interview Questions](#interview-questions)

---

## Lambda Expressions

### Syntax and Basics

```java
public class LambdaExpressions {
    public void basicSyntax() {
        // Lambda expression: concise anonymous function
        // Syntax: (parameters) -> expression or (parameters) -> { statements }

        // Traditional anonymous class
        Runnable runnable1 = new Runnable() {
            @Override
            public void run() {
                System.out.println("Running");
            }
        };

        // Lambda equivalent
        Runnable runnable2 = () -> System.out.println("Running");
        // Shorter, more readable, same behavior

        // Parameter types
        List<String> list = Arrays.asList("a", "b", "c");

        // Single parameter, no type
        list.forEach(item -> System.out.println(item));

        // Multiple parameters with types
        BinaryOperator<Integer> add = (Integer a, Integer b) -> a + b;

        // Or without types (inferred)
        BinaryOperator<Integer> multiply = (a, b) -> a * b;

        // Multiple statements
        Runnable complex = () -> {
            int value = 10;
            System.out.println(value);
            System.out.println("Done");
        };
    }

    public void effectivelyFinal() {
        int outerVar = 10;

        // Lambda can access outer variables if effectively final
        Runnable r = () -> {
            System.out.println(outerVar); // OK: outerVar never modified
        };

        // outerVar = 20; // Error: would make it non-effectively final

        // Reason: lambda captured at definition time
        // If variable later changes, lambda's understanding becomes wrong
    }

    public void variableClosure() {
        List<Runnable> tasks = new ArrayList<>();

        for (int i = 0; i < 3; i++) {
            // tasks.add(() -> System.out.println(i));
            // ERROR: i must be effectively final
            // But loop variable i changes each iteration

            final int j = i; // Make final copy
            tasks.add(() -> System.out.println(j)); // Now OK
        }

        tasks.forEach(Runnable::run); // 0, 1, 2
    }
}
```

### This Reference in Lambda

```java
public class LambdaThisReference {
    public void demonstrateThis() {
        class OuterClass {
            private int outerVar = 10;

            public void createLambda() {
                Runnable lambda = () -> {
                    System.out.println(this.outerVar); // 'this' refers to OuterClass
                    System.out.println(this);
                };

                // Compare to anonymous class
                Runnable anon = new Runnable() {
                    @Override
                    public void run() {
                        System.out.println(this.outerVar); // ERROR: this is Runnable, not OuterClass
                    }
                };
            }
        }

        // Key difference:
        // Lambda: 'this' refers to enclosing class
        // Anonymous class: 'this' refers to anonymous instance
    }
}
```

---

## Functional Interfaces

### Core Functional Interfaces

```java
public class FunctionalInterfaces {
    public void functionInterface() {
        // Function<T, R>: takes T, returns R
        Function<Integer, String> intToString = x -> "Value: " + x;
        String result = intToString.apply(42); // "Value: 42"

        // Chaining
        Function<String, Integer> stringLength = String::length;
        Function<Integer, String> intToString2 = x -> "Length: " + x;
        Function<String, String> composed = intToString2.compose(stringLength);
        String composed_result = composed.apply("hello"); // "Length: 5"
    }

    public void predicateInterface() {
        // Predicate<T>: takes T, returns boolean
        Predicate<Integer> isEven = x -> x % 2 == 0;
        System.out.println(isEven.test(4)); // true
        System.out.println(isEven.test(5)); // false

        // Combining predicates
        Predicate<Integer> isPositive = x -> x > 0;
        Predicate<Integer> evenAndPositive = isEven.and(isPositive);
        Predicate<Integer> evenOrPositive = isEven.or(isPositive);
        Predicate<Integer> notEven = isEven.negate();
    }

    public void consumerInterface() {
        // Consumer<T>: takes T, returns void
        Consumer<String> printer = System.out::println;
        printer.accept("Hello"); // Prints: Hello

        Consumer<Integer> printTwice = x -> {
            System.out.println(x);
            System.out.println(x);
        };

        // Chaining
        Consumer<Integer> add10Then = printTwice.andThen(x -> System.out.println(x + 10));
    }

    public void supplierInterface() {
        // Supplier<T>: takes nothing, returns T
        Supplier<String> helloSupplier = () -> "Hello";
        String value = helloSupplier.get(); // "Hello"

        // Useful for lazy evaluation
        Supplier<List<String>> lazyList = ArrayList::new;
        List<String> list1 = lazyList.get(); // New list
        List<String> list2 = lazyList.get(); // Different list

        // vs
        List<String> list3 = new ArrayList<>();
        List<String> list4 = list3; // Same list
    }

    public void biFunctionInterface() {
        // BiFunction<T, U, R>: takes T and U, returns R
        BiFunction<Integer, Integer, Integer> add = (a, b) -> a + b;
        int result = add.apply(5, 3); // 8

        // BiPredicate<T, U>
        BiPredicate<String, String> equals = String::equals;
        System.out.println(equals.test("hello", "hello")); // true

        // BiConsumer<T, U>
        BiConsumer<Integer, Integer> printSum = (a, b) -> System.out.println(a + b);
        printSum.accept(5, 3); // Prints: 8
    }

    public void customFunctionalInterface() {
        @FunctionalInterface
        public interface Converter<T, R> {
            R convert(T value);

            // Can have default/static methods (don't count to functional count)
            default void printOriginal(T value) {
                System.out.println("Original: " + value);
            }
        }

        // Implement with lambda
        Converter<Integer, String> intToHex = x -> Integer.toHexString(x);
        System.out.println(intToHex.convert(255)); // "ff"
    }
}
```

### Functional Composition

```java
public class FunctionalComposition {
    public void functionComposition() {
        Function<Integer, Integer> add5 = x -> x + 5;
        Function<Integer, Integer> multiplyBy2 = x -> x * 2;

        // Compose: apply add5 then multiplyBy2
        Function<Integer, Integer> composed1 = add5.andThen(multiplyBy2);
        System.out.println(composed1.apply(10)); // (10 + 5) * 2 = 30

        // Compose: apply multiplyBy2 then add5
        Function<Integer, Integer> composed2 = add5.compose(multiplyBy2);
        System.out.println(composed2.apply(10)); // (10 * 2) + 5 = 25

        // Order matters!
        // f.compose(g) -> f(g(x)) -> apply g first
        // f.andThen(g) -> g(f(x)) -> apply f first
    }

    public void predicateLogic() {
        Predicate<Integer> isEven = x -> x % 2 == 0;
        Predicate<Integer> isPositive = x -> x > 0;
        Predicate<Integer> lessThan10 = x -> x < 10;

        Predicate<Integer> complex = isEven.and(isPositive).and(lessThan10);

        System.out.println(complex.test(4)); // true (even, positive, < 10)
        System.out.println(complex.test(-2)); // false (not positive)
        System.out.println(complex.test(11)); // false (not < 10)
    }
}
```

---

## Method References

### Types of Method References

```java
public class MethodReferences {
    public void staticMethodReference() {
        // ClassName::staticMethod

        // Traditional lambda
        Function<String, Integer> parseInt1 = s -> Integer.parseInt(s);

        // Method reference (more readable)
        Function<String, Integer> parseInt2 = Integer::parseInt;

        System.out.println(parseInt2.apply("42")); // 42
    }

    public void instanceMethodReference() {
        // instance::instanceMethod

        String str = "hello";

        // Lambda
        Function<String, Boolean> startsWith1 = prefix -> str.startsWith(prefix);

        // Method reference
        Function<String, Boolean> startsWith2 = str::startsWith;

        System.out.println(startsWith2.apply("he")); // true
    }

    public void classInstanceMethodReference() {
        // ClassName::instanceMethod

        // Lambda
        Function<String, Integer> length1 = s -> s.length();

        // Method reference - parameter becomes receiver
        Function<String, Integer> length2 = String::length;

        System.out.println(length2.apply("hello")); // 5
    }

    public void constructorReference() {
        // ClassName::new

        // Lambda
        Supplier<ArrayList> supplier1 = () -> new ArrayList();

        // Constructor reference
        Supplier<ArrayList> supplier2 = ArrayList::new;

        // With arguments
        Function<Integer, ArrayList> create = ArrayList::new;
        ArrayList<String> list = create.apply(10); // new ArrayList<>(10)

        // More specific
        BiFunction<Collection, Integer, ArrayList> copySized = ArrayList::new;
    }

    public void allTypesComparison() {
        List<Integer> numbers = Arrays.asList(3, 1, 4, 1, 5);

        // Static method reference
        Collections.sort(numbers, Integer::compare);

        // Instance method reference (static-like but uses parameter)
        List<String> strings = Arrays.asList("hello", "world");
        strings.forEach(System.out::println);

        // Constructor reference
        List<List<Integer>> lists = Arrays.asList(
            1, 2, 3
        );
        // (not directly, but you get the idea)
    }

    public void whenToUseMethodReferences() {
        // Use method references when:
        // 1. Already have method matching signature
        // 2. More readable than lambda
        // 3. Want to emphasize method being used

        // Prefer lambda when:
        // 1. Logic is simple, inline
        // 2. No existing method matches
        // 3. Logic is method-specific

        // Examples
        List<String> list = Arrays.asList("apple", "banana", "cherry");

        // Good use of method reference: clear method name
        list.forEach(System.out::println);

        // Good use of lambda: simple inline logic
        list.forEach(s -> System.out.println(s.toUpperCase()));

        // Method reference for complex logic: name explains intent
        list.stream()
            .filter(String::isEmpty)
            .forEach(System.out::println);
    }
}
```

---

## Stream API

### Intermediate vs Terminal Operations

```java
public class StreamOperations {
    public void intermediateOperations() {
        List<Integer> numbers = Arrays.asList(1, 2, 3, 4, 5);

        // Intermediate: return new stream, lazy evaluation
        Stream<Integer> doubled = numbers.stream()
            .filter(n -> n % 2 == 0) // Lazy: not executed yet
            .map(n -> n * 2); // Lazy: not executed yet

        // Nothing printed - stream not consumed
        // Elements not processed

        // Terminal operation triggers actual processing
        doubled.forEach(System.out::println); // Now processes: 4, 8
    }

    public void commonIntermediateOps() {
        List<String> words = Arrays.asList("apple", "banana", "cherry", "date");

        // filter: keep elements matching predicate
        words.stream()
            .filter(w -> w.length() > 4)
            .forEach(System.out::println); // apple, banana, cherry

        // map: transform each element
        words.stream()
            .map(String::toUpperCase)
            .forEach(System.out::println); // APPLE, BANANA, ...

        // flatMap: flatten streams
        List<List<Integer>> nested = Arrays.asList(
            Arrays.asList(1, 2),
            Arrays.asList(3, 4)
        );
        nested.stream()
            .flatMap(Collection::stream)
            .forEach(System.out::println); // 1, 2, 3, 4

        // distinct: remove duplicates
        Arrays.asList(1, 2, 2, 3, 3, 3).stream()
            .distinct()
            .forEach(System.out::println); // 1, 2, 3

        // sorted: order elements
        words.stream()
            .sorted(Comparator.comparingInt(String::length))
            .forEach(System.out::println); // date, apple, banana, cherry

        // limit: take first n
        Arrays.asList(1, 2, 3, 4, 5).stream()
            .limit(2)
            .forEach(System.out::println); // 1, 2

        // skip: skip first n
        Arrays.asList(1, 2, 3, 4, 5).stream()
            .skip(2)
            .forEach(System.out::println); // 3, 4, 5
    }

    public void commonTerminalOps() {
        List<Integer> numbers = Arrays.asList(1, 2, 3, 4, 5);

        // forEach: execute for each element
        numbers.stream().forEach(System.out::println);

        // collect: gather into collection
        List<Integer> evens = numbers.stream()
            .filter(n -> n % 2 == 0)
            .collect(Collectors.toList()); // [2, 4]

        // collect to map
        Map<Integer, Integer> squares = numbers.stream()
            .collect(Collectors.toMap(
                Function.identity(),
                n -> n * n
            )); // {1=1, 2=4, 3=9, ...}

        // count: count elements
        long count = numbers.stream()
            .filter(n -> n > 3)
            .count(); // 2

        // reduce: combine elements into single value
        int sum = numbers.stream()
            .reduce(0, Integer::sum); // 15

        int product = numbers.stream()
            .reduce(1, (a, b) -> a * b); // 120

        // Optional for reduction
        int max = numbers.stream()
            .reduce(Integer::max) // No default value
            .orElse(Integer.MIN_VALUE);

        // findFirst: get first element
        int firstEven = numbers.stream()
            .filter(n -> n % 2 == 0)
            .findFirst()
            .orElse(-1); // 2

        // anyMatch, allMatch, noneMatch
        boolean hasEven = numbers.stream()
            .anyMatch(n -> n % 2 == 0); // true

        boolean allPositive = numbers.stream()
            .allMatch(n -> n > 0); // true

        boolean noNegative = numbers.stream()
            .noneMatch(n -> n < 0); // true
    }
}
```

### Lazy Evaluation

```java
public class LazyEvaluation {
    public void demonstrateLaziness() {
        List<Integer> numbers = Arrays.asList(1, 2, 3, 4, 5);

        // No sout printed yet - stream created but not consumed
        Stream<Integer> stream = numbers.stream()
            .filter(n -> {
                System.out.println("Filtering: " + n);
                return n % 2 == 0;
            })
            .map(n -> {
                System.out.println("Mapping: " + n);
                return n * 2;
            });

        // Still nothing printed
        System.out.println("Stream created");

        // Now elements are actually processed (short-circuit)
        stream.forEach(System.out::println);

        // OUTPUT:
        // Stream created
        // Filtering: 1
        // Filtering: 2
        // Mapping: 2
        // 4
        // Filtering: 3
        // Filtering: 4
        // Mapping: 4
        // 8
        // Filtering: 5
    }

    public void shortCircuitEvaluation() {
        List<Integer> numbers = Arrays.asList(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);

        // limit short-circuits: stops once 2 elements found
        int result = numbers.stream()
            .filter(n -> {
                System.out.println("Checking: " + n);
                return n > 3;
            })
            .limit(2) // Stops after 2 matches
            .mapToInt(Integer::intValue)
            .sum();

        // OUTPUT: Checks 1, 2, 3, 4, 5 (not 6-10)
        // Stops early because limit reached
    }

    public void sortingBreaksLaziness() {
        List<Integer> numbers = Arrays.asList(3, 1, 4, 1, 5, 9);

        // sorted() is eager: must see all elements before emitting any
        numbers.stream()
            .sorted()
            .limit(2)
            .forEach(System.out::println); // 1, 1

        // If no limit:
        numbers.stream()
            .sorted()
            .forEach(System.out::println); // 1, 1, 3, 4, 5, 9
    }
}
```

### Performance: Streams vs Loops

```java
public class StreamPerformance {
    public void performanceComparison() {
        List<Integer> numbers = new ArrayList<>();
        for (int i = 0; i < 1000000; i++) {
            numbers.add(i);
        }

        // Traditional loop
        long start = System.nanoTime();
        int sum = 0;
        for (int i = 0; i < numbers.size(); i++) {
            if (numbers.get(i) % 2 == 0) {
                sum += numbers.get(i);
            }
        }
        long loopTime = System.nanoTime() - start;

        // Stream
        start = System.nanoTime();
        int streamSum = numbers.stream()
            .filter(n -> n % 2 == 0)
            .mapToInt(Integer::intValue)
            .sum();
        long streamTime = System.nanoTime() - start;

        // Usually streams are slower:
        // - Autoboxing (Integer -> int)
        // - Intermediate object creation
        // - Overhead of stream machinery

        // But readability might be worth it
        System.out.println("Loop time: " + loopTime);
        System.out.println("Stream time: " + streamTime);
        System.out.println("Ratio: " + (streamTime / (float) loopTime));
        // Often: stream is 1.5-2x slower for simple operations
    }

    public void whenStreamsShine() {
        List<String> words = Arrays.asList("apple", "banana", "cherry");

        // Complex transformations: streams more readable
        words.stream()
            .filter(w -> w.length() > 4)
            .map(String::toUpperCase)
            .sorted()
            .forEach(System.out::println);

        // vs
        List<String> filtered = new ArrayList<>();
        for (String w : words) {
            if (w.length() > 4) {
                filtered.add(w.toUpperCase());
            }
        }
        filtered.sort(String::compareTo);
        for (String w : filtered) {
            System.out.println(w);
        }

        // Streams more declarative and concise
    }

    public void parallelStreams() {
        List<Integer> numbers = new ArrayList<>();
        for (int i = 0; i < 10000000; i++) {
            numbers.add(i);
        }

        // Sequential
        long start = System.nanoTime();
        int sum = numbers.stream()
            .filter(n -> n % 2 == 0)
            .mapToInt(Integer::intValue)
            .sum();
        long sequentialTime = System.nanoTime() - start;

        // Parallel
        start = System.nanoTime();
        int parallelSum = numbers.parallelStream()
            .filter(n -> n % 2 == 0)
            .mapToInt(Integer::intValue)
            .sum();
        long parallelTime = System.nanoTime() - start;

        // Parallel has overhead:
        // - Thread pool management
        // - Work distribution
        // - Result combination

        // Not always faster, especially for:
        // - Small datasets
        // - Simple operations
        // - High-latency operations (sort)

        // Use parallel only if:
        // - Large dataset (millions+)
        // - Expensive operation
        // - CPU-bound (not I/O)
    }
}
```

---

## Optional

### Proper Usage

```java
public class OptionalUsage {
    public void containsAndGet() {
        Optional<String> opt = Optional.of("hello");

        // Old way (can throw)
        if (opt.isPresent()) {
            String value = opt.get();
            System.out.println(value);
        }

        // Modern way (no throw)
        opt.ifPresent(System.out::println);

        // With action if absent
        opt.ifPresentOrElse(
            System.out::println,
            () -> System.out.println("Not present")
        );

        // Get with default
        String value = opt.orElse("default");
        String value2 = opt.orElseGet(() -> "default");
        String value3 = opt.orElseThrow(() -> new RuntimeException("Empty"));
    }

    public void filteringAndMapping() {
        Optional<String> opt = Optional.of("hello");

        // filter: keep if matches, empty if not
        Optional<String> filtered = opt.filter(s -> s.length() > 3);
        System.out.println(filtered.isPresent()); // true

        // map: transform if present
        Optional<Integer> length = opt.map(String::length);
        System.out.println(length.get()); // 5

        // flatMap: flatten nested optionals
        Optional<Optional<String>> nested = Optional.of(Optional.of("hello"));
        Optional<String> flattened = nested.flatMap(Function.identity());
        System.out.println(flattened.get()); // hello
    }

    public void chainOperations() {
        Optional<String> name = Optional.of("john");

        String result = name
            .filter(n -> !n.isEmpty())
            .map(String::toUpperCase)
            .map(n -> "Hello, " + n)
            .orElse("Hello, Unknown");

        System.out.println(result); // Hello, JOHN
    }

    public void antiPatterns() {
        Optional<String> opt = Optional.of("hello");

        // WRONG: if (opt.isPresent()) is like null check
        if (opt.isPresent()) { // Defeating purpose
            System.out.println(opt.get());
        }

        // WRONG: opt.orElse(null) defeats null safety
        String value = opt.orElse(null); // Now value can be null!

        // WRONG: Optional as field
        public class Data {
            Optional<String> field; // Don't use as field
        }

        // CORRECT: Use ifPresent, ifPresentOrElse, map
        opt.ifPresent(System.out::println);
        opt.map(String::toUpperCase).ifPresent(System.out::println);
    }

    public void optionalInAPIs() {
        public Optional<User> findUserById(int id) {
            // Return Optional instead of null
            if (userExists(id)) {
                return Optional.of(new User(id));
            }
            return Optional.empty();
        }

        Optional<User> user = findUserById(1);
        String name = user.map(User::getName)
            .map(String::toUpperCase)
            .orElse("Unknown");

        // vs
        User user2 = findUserById2(1); // Returns null if not found
        String name2 = user2 != null ? user2.getName() : "Unknown";
        // Less clear, more verbose
    }
}
```

---

## Interface Enhancements

### Default Methods

```java
public class DefaultMethods {
    public void defaultMethodsBasic() {
        interface Animal {
            void makeSound();

            default void sleep() {
                System.out.println("Zzz"); // Concrete implementation
            }
        }

        class Dog implements Animal {
            @Override
            public void makeSound() {
                System.out.println("Woof");
            }
            // sleep() inherited from interface
        }

        Animal dog = new Dog();
        dog.makeSound(); // Woof
        dog.sleep(); // Zzz - uses default
    }

    public void overridingDefaults() {
        interface Animal {
            default void move() {
                System.out.println("Moving");
            }
        }

        interface Flyer {
            default void move() {
                System.out.println("Flying");
            }
        }

        class Bird implements Animal, Flyer {
            @Override
            public void move() {
                // Must resolve conflict
                Flyer.super.move(); // Choose which to use
            }
        }
    }

    public void whyDefaultMethods() {
        // Before Java 8: adding method to interface breaks all implementations
        // Solution: new interface for backwards compatibility

        // After Java 8: default methods allow interface evolution
        interface Collection {
            // Old methods
            int size();
            void add(Object o);

            // Java 8+ added methods with defaults
            default boolean isEmpty() {
                return size() == 0;
            }

            default void clear() {
                // Default implementation
            }
        }

        // Old implementations automatically get new methods
        // Don't have to update all implementations
    }
}
```

### Static Methods in Interfaces

```java
public class StaticMethodsInInterfaces {
    public void staticMethodsExample() {
        interface Logger {
            static Logger create(String name) {
                // Factory method in interface
                return new ConsoleLogger(name);
            }

            void log(String message);

            static void info(String message) {
                System.out.println("[INFO] " + message);
            }
        }

        // Called on interface, not instance
        Logger logger = Logger.create("MyLogger");
        Logger.info("Test"); // Static method

        // Before Java 8:
        // Had to use separate class LoggerFactory
        // After Java 8: can put in interface
    }
}
```

---

## Java 9+ Features

### Java 9 Modules (JPMS)

```java
public class ModulesExample {
    /*
    Module: named collection of related packages

    Example structure:
    myapp/
      src/
        module-info.java
        com/example/myapp/
          App.java
      classes/
        module-info.class
        com/example/myapp/App.class

    module-info.java:
    module com.example.myapp {
        requires java.base; // Always implicitly required
        requires java.logging;

        exports com.example.myapp;
        exports com.example.myapp.api to com.example.client;

        opens com.example.myapp.internal for reflection;
    }

    Benefits:
    1. Encapsulation: only exported packages visible
    2. Explicit dependencies
    3. Faster startup (only load needed modules)
    4. Security: restrict reflection, etc.

    Drawbacks:
    - Complexity
    - Adoption rate low (many apps still use classpath)
    - Tooling slower to catch up
    */
}
```

### Java 10 var Keyword

```java
public class VarKeyword {
    public void varBasics() {
        // var: local variable type inference
        var name = "John"; // Inferred as String
        var age = 30; // Inferred as int
        var numbers = List.of(1, 2, 3); // Inferred as List<Integer>

        // Equivalent to:
        String name2 = "John";
        int age2 = 30;
        List<Integer> numbers2 = List.of(1, 2, 3);

        // Benefits:
        // - Reduces verbosity
        // - Type inference
        // - Easier refactoring

        // Limitations:
        // - Only for local variables (not fields, parameters, return types)
        // - Type must be inferrable from assignment
    }

    public void varWithStreams() {
        var list = List.of("apple", "banana", "cherry");
        var result = list.stream()
            .filter(s -> s.length() > 4)
            .map(String::toUpperCase)
            .collect(Collectors.toList());
        // Type of result inferred as List<String>

        // Less clutter than:
        List<String> list2 = List.of("apple", "banana", "cherry");
        List<String> result2 = list2.stream()
            .filter(s -> s.length() > 4)
            .map(String::toUpperCase)
            .collect(Collectors.toList());
    }

    public void varDoesNotMeanDynamic() {
        var value = 42;
        // value = "string"; // ERROR: value is int, can't assign string
        // var doesn't mean dynamic typing, just type inference
    }

    public void whenToUseVar() {
        // DO use var: clear from context
        var names = List.of("alice", "bob"); // Obviously List<String>
        var count = items.size(); // Obviously int

        // DON'T use var: unclear
        var x = getValue(); // What type is this? Must look at getValue()

        // AVOID: reduces readability
        var result = processData(input).transform(mapper).filter(predicate);
        // Can't tell types at glance
    }
}
```

### Java 14 Records

```java
public class RecordsExample {
    // Record: immutable data carrier
    public record Person(String name, int age) {
        // Automatically generated:
        // - Constructor
        // - Getters (name(), age())
        // - equals(), hashCode()
        // - toString()
    }

    public void recordsBasic() {
        Person person = new Person("John", 30);
        System.out.println(person.name()); // John
        System.out.println(person.age()); // 30

        Person person2 = new Person("John", 30);
        System.out.println(person.equals(person2)); // true

        // Benefits:
        // - Less boilerplate
        // - Clear intent: immutable data
        // - Pattern matching support

        // vs class:
        public final class PersonClass {
            private final String name;
            private final int age;

            public PersonClass(String name, int age) {
                this.name = name;
                this.age = age;
            }

            public String name() { return name; }
            public int age() { return age; }

            @Override
            public boolean equals(Object obj) { /* ... */ }

            @Override
            public int hashCode() { /* ... */ }

            @Override
            public String toString() { /* ... */ }
        }

        // Record version much shorter
    }

    public void recordCustomization() {
        public record Point(double x, double y) {
            // Compact constructor
            public Point {
                if (x < 0 || y < 0) {
                    throw new IllegalArgumentException("Coordinates must be non-negative");
                }
            }

            // Can add custom methods
            public double distance() {
                return Math.sqrt(x * x + y * y);
            }

            // Static methods
            public static Point origin() {
                return new Point(0, 0);
            }
        }
    }
}
```

### Java 17 Sealed Classes

```java
public class SealedClassesExample {
    // Sealed class: restrict which classes can extend it
    sealed abstract class Shape permits Circle, Rectangle {
        abstract double area();
    }

    final class Circle extends Shape {
        private double radius;

        @Override
        double area() {
            return Math.PI * radius * radius;
        }
    }

    final class Rectangle extends Shape {
        private double width, height;

        @Override
        double area() {
            return width * height;
        }
    }

    // This won't compile:
    // class Triangle extends Shape { } // ERROR: not permitted

    public void sealedBenefits() {
        // Benefits:
        // 1. Compile-time exhaustiveness checking
        // 2. Domain modeling: explicit hierarchy
        // 3. Pattern matching: compiler knows all subtypes

        Shape shape = new Circle();
        // With sealed classes, pattern matching can be exhaustive:
        String type = switch(shape) {
            case Circle c -> "Circle";
            case Rectangle r -> "Rectangle";
            // Compiler knows these are all possibilities
        };
    }
}
```

### Java 21 Virtual Threads (Project Loom)

```java
public class VirtualThreadsExample {
    public void virtualThreadsBasic() throws InterruptedException {
        // Virtual thread: lightweight thread managed by JVM (not OS)
        // Can create millions without resource issues

        Thread virtualThread = Thread.ofVirtual()
            .start(() -> {
                System.out.println("Running on virtual thread");
                try { Thread.sleep(1000); } catch (InterruptedException e) {}
            });

        virtualThread.join();

        // With traditional threads:
        Thread osThread = new Thread(() -> {
            System.out.println("Running on OS thread");
        });
        // OS threads are expensive: ~1MB each, max ~10k per process

        // With virtual threads:
        // Can create millions, used for async programming
    }

    public void structuredConcurrency() throws InterruptedException {
        // Structured concurrency: parent waits for all children

        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
            var future1 = scope.fork(() -> fetchFromAPI1());
            var future2 = scope.fork(() -> fetchFromAPI2());

            scope.join(); // Wait for all to complete
            var result1 = future1.resultNow();
            var result2 = future2.resultNow();
            // Both results available
        }

        // Benefits:
        // - Parent-child relationship clear
        // - Cancellation automatic
        // - Exception handling easier
    }

    public void whyVirtualThreadsAreBetter() {
        // Traditional approach: ThreadPoolExecutor
        ExecutorService executor = Executors.newFixedThreadPool(10);
        // Limited to 10 concurrent requests
        // If requests wait on I/O: pool blocks, can't handle others

        // Virtual thread approach:
        // for (int i = 0; i < 1000000; i++) {
        //     Thread.ofVirtual().start(() -> handleRequest());
        // }
        // Can handle 1 million concurrent requests
        // Each virtual thread can block without blocking others

        // Behind the scenes:
        // Virtual threads use ForkJoinPool (carrier threads)
        // When virtual thread blocks, carrier thread runs other virtual threads
        // Efficient use of OS threads
    }
}
```

---

## Performance and Anti-Patterns

### Stream Anti-Patterns

```java
public class StreamAntiPatterns {
    public void multipleIterations() {
        List<String> words = Arrays.asList("apple", "banana", "cherry");

        // WRONG: creating multiple streams
        long count = words.stream().count();
        long filtered = words.stream().filter(w -> w.length() > 5).count();
        // Streams used twice, repeated processing

        // CORRECT: single stream with multiple operations
        long total = words.stream().count();
        long above5 = words.stream().filter(w -> w.length() > 5).count();
    }

    public void collectingThenProcessing() {
        List<Integer> numbers = Arrays.asList(1, 2, 3, 4, 5);

        // WRONG: collect then iterate
        List<Integer> evens = numbers.stream()
            .filter(n -> n % 2 == 0)
            .collect(Collectors.toList()); // Intermediate list
        long count = evens.stream().count(); // Second pass

        // CORRECT: continue with stream
        long count2 = numbers.stream()
            .filter(n -> n % 2 == 0)
            .count(); // Single pass
    }

    public void parallelStreamMisuse() {
        List<Integer> numbers = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            numbers.add(i);
        }

        // WRONG: parallel on small dataset
        numbers.parallelStream()
            .filter(n -> n % 2 == 0)
            .forEach(System.out::println);
        // Parallel overhead greater than benefit

        // WRONG: parallel with stateful operations
        List<Integer> result = new ArrayList<>();
        numbers.parallelStream()
            .filter(n -> n % 2 == 0)
            .forEach(result::add); // Race condition!
        // result might miss elements due to concurrency

        // CORRECT: collect with parallel streams
        List<Integer> correct = numbers.parallelStream()
            .filter(n -> n % 2 == 0)
            .collect(Collectors.toList()); // Thread-safe

        // CORRECT: use parallel only for large datasets
        // and CPU-bound operations
    }

    public void terminalOperationsMissing() {
        List<String> words = Arrays.asList("apple", "banana");

        // WRONG: intermediate operation creates stream but doesn't consume
        words.stream()
            .filter(w -> w.length() > 4)
            .map(String::toUpperCase);
        // Nothing happens! No terminal operation

        // CORRECT: add terminal operation
        words.stream()
            .filter(w -> w.length() > 4)
            .map(String::toUpperCase)
            .forEach(System.out::println); // Terminal operation
    }
}
```

---

## Interview Questions

### Q1: Explain the difference between filter and map in streams

**Answer:**
```java
// filter: keeps elements matching condition, returns same type
List<Integer> numbers = Arrays.asList(1, 2, 3, 4, 5);
numbers.stream()
    .filter(n -> n % 2 == 0) // Keep only even
    .forEach(System.out::println); // 2, 4

// map: transforms each element, can change type
numbers.stream()
    .map(n -> n * 2) // Transform each
    .forEach(System.out::println); // 2, 4, 6, 8, 10

// flatMap: flatten nested streams
List<List<Integer>> nested = Arrays.asList(
    Arrays.asList(1, 2),
    Arrays.asList(3, 4)
);
nested.stream()
    .flatMap(Collection::stream) // Flatten
    .forEach(System.out::println); // 1, 2, 3, 4
```

### Q2: When would you use var keyword?

**Answer:** Use `var` when type is clear from context (e.g., `var count = list.size()`). Don't use when type is unclear (e.g., `var result = someComplexMethod()`). Only for local variables, not fields or parameters.

### Q3: What's the benefit of Optional?

**Answer:** Explicit nullability. Instead of `String result = method()` (could be null), use `Optional<String> result = method()` (explicitly nullable). Enables functional composition with `map`, `filter`, `ifPresent`.

---

**Key Takeaway Summary:**

1. **Lambdas:** Concise syntax for functional interfaces. Captured variables must be effectively final.
2. **Streams:** Lazy evaluation, composable operations. Use for readable code, but not always fastest.
3. **Method References:** More readable than lambdas when method exists. Types: static, instance, constructor.
4. **Optional:** Better than null checking. Use map/filter/ifPresent. Avoid using as field.
5. **Java 8+:** Default methods in interfaces, var keyword, records, sealed classes, virtual threads.
6. **Performance:** Streams slower for simple operations. Parallel streams have overhead. Use loops for performance-critical code.

