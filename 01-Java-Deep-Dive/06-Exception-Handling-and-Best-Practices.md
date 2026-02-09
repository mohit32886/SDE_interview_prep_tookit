# Exception Handling and Best Practices - Deep Dive

## Table of Contents
1. [Exception Hierarchy](#exception-hierarchy)
2. [Checked vs Unchecked](#checked-vs-unchecked)
3. [Custom Exceptions](#custom-exceptions)
4. [Try-With-Resources](#try-with-resources)
5. [Best Practices](#best-practices)
6. [Exception Chaining](#exception-chaining)
7. [Performance Impact](#performance-impact)
8. [SOLID Principles](#solid-principles)
9. [Clean Code](#clean-code)
10. [Effective Java Items](#effective-java-items)
11. [Interview Questions](#interview-questions)

---

## Exception Hierarchy

### Java Exception Hierarchy

```java
public class ExceptionHierarchy {
    /*
    Throwable (checked and unchecked)
    ├── Error (serious, don't catch)
    │   ├── OutOfMemoryError
    │   ├── StackOverflowError
    │   ├── LinkageError
    │   └── ...
    │
    └── Exception
        ├── IOException (checked)
        ├── SQLException (checked)
        ├── RuntimeException (unchecked)
        │   ├── NullPointerException
        │   ├── IllegalArgumentException
        │   ├── IndexOutOfBoundsException
        │   └── ...
        └── ...
    */

    public void exceptionCategories() {
        // Error: serious problems, don't catch
        // - OutOfMemoryError: heap exhausted
        // - StackOverflowError: stack full
        // - ThreadDeath: thread terminating
        // JVM will terminate or thread will die

        // Checked Exception: must be caught or declared
        // - IOException, SQLException, FileNotFoundException
        // - Checked at compile time
        // - Code won't compile if not handled

        // Unchecked Exception (RuntimeException subclasses):
        // - NullPointerException, ArrayIndexOutOfBoundsException
        // - Don't have to catch
        // - Often indicate programming errors
    }
}
```

---

## Checked vs Unchecked

### Checked Exceptions

```java
public class CheckedExceptions {
    public void checkedExampleIO() throws IOException {
        // FileReader might throw FileNotFoundException (checked)
        FileReader reader = new FileReader("file.txt");
        // Must either:
        // 1. Catch: try/catch
        // 2. Declare: throws IOException

        reader.close();
    }

    public void mustCatchOrDeclare() {
        // COMPILE ERROR: FileReader throws checked exception
        // FileReader reader = new FileReader("file.txt");

        // MUST catch:
        try {
            FileReader reader = new FileReader("file.txt");
            reader.close();
        } catch (FileNotFoundException e) {
            e.printStackTrace();
        }

        // OR declare in signature:
        // public void someMethod() throws FileNotFoundException { }
    }

    public void problematicCheckedExceptions() {
        // Checked exceptions force declaration/catching
        // Can lead to throws chains:
        public void method1() throws IOException, SQLException {
            // throws lots of exceptions
        }

        // OR catch-and-rethrow patterns:
        try {
            // ...
        } catch (IOException | SQLException e) {
            throw new RuntimeException(e); // Convert to unchecked
        }

        // This defeats checked exception purpose
    }
}
```

### Unchecked Exceptions

```java
public class UncheckedExceptions {
    public void uncheckedExamples() {
        // NullPointerException: no null check
        String str = null;
        // int length = str.length(); // NullPointerException

        // ArrayIndexOutOfBoundsException: bad index
        int[] arr = {1, 2, 3};
        // int value = arr[10]; // IndexOutOfBoundsException

        // IllegalArgumentException: bad argument
        // public void setAge(int age) {
        //     if (age < 0) {
        //         throw new IllegalArgumentException("Age must be positive");
        //     }
        // }

        // Unchecked: programmer's responsibility
        // If null/bad argument, it's programming error
    }

    public void bestPractices() {
        // Avoid NullPointerException with null checks
        String name = getName();
        if (name != null) {
            System.out.println(name.length());
        }

        // Or use Optional
        Optional<String> nameOpt = Optional.ofNullable(getName());
        nameOpt.map(String::length).ifPresent(System.out::println);

        // Validate arguments early
        public void setAge(int age) {
            if (age < 0 || age > 150) {
                throw new IllegalArgumentException("Invalid age: " + age);
            }
            this.age = age;
        }
    }
}
```

### Checked Exception Controversies

```java
public class CheckedExceptionControversy {
    public void problemsWithChecked() {
        // Problem 1: Forces throws chains
        public void method1() throws IOException {
            method2();
        }

        public void method2() throws IOException {
            method3();
        }

        public void method3() throws IOException {
            // Actual work
        }

        // Callers must handle IOException all the way up
        // Even if they can't recover from it

        // Problem 2: Causes catch-and-convert anti-pattern
        try {
            // IOException thrown
        } catch (IOException e) {
            throw new RuntimeException(e); // Defeats purpose
        }

        // Problem 3: API versioning issues
        public interface DatabaseAPI {
            void save() throws SQLException; // Can't change to add exception
        }

        // If implementation wants to throw new exception:
        // Can't add to throws clause (breaks API contract)
    }

    public void advantagesOfChecked() {
        // Advantage: Forces thinking about recovery
        public void readFile(String path) throws IOException {
            // Developer must consider: what if file doesn't exist?
            // Forces explicit handling

            try {
                FileReader reader = new FileReader(path);
                // ...
            } catch (FileNotFoundException e) {
                // Handle missing file
            }
        }

        // Advantage: API clarity
        // Signature shows what can go wrong:
        // public void transfer(Account from, Account to) throws InsufficientFundsException { }
        // Callers know they might get this exception
    }

    public void whenToUseChecked() {
        // Use checked exceptions when:
        // 1. Caller can reasonably recover
        // 2. Exception is not programming error
        // 3. Want to force handling

        // IOException: caller can provide alternate path
        // try { file1 } catch { file2 }

        // Don't use checked for programming errors:
        // IllegalArgumentException (unchecked) - programming error
    }
}
```

---

## Custom Exceptions

### Creating Custom Exceptions

```java
public class CustomExceptions {
    // For checked exceptions: extend Exception
    public class InsufficientFundsException extends Exception {
        private double required;
        private double available;

        public InsufficientFundsException(String message, double required, double available) {
            super(message);
            this.required = required;
            this.available = available;
        }

        public double getRequired() { return required; }
        public double getAvailable() { return available; }
        public double getShortfall() { return required - available; }
    }

    // For unchecked exceptions: extend RuntimeException
    public class InvalidAccountException extends RuntimeException {
        public InvalidAccountException(String message) {
            super(message);
        }

        public InvalidAccountException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public void usingCustomExceptions() throws InsufficientFundsException {
        Account account = new Account(100);

        try {
            account.withdraw(200);
        } catch (InsufficientFundsException e) {
            System.err.println("Insufficient funds");
            System.err.println("Required: " + e.getRequired());
            System.err.println("Available: " + e.getAvailable());
            System.err.println("Shortfall: " + e.getShortfall());
        }
    }

    public void throwingCustomExceptions() throws InsufficientFundsException {
        public void withdraw(double amount) throws InsufficientFundsException {
            if (amount > balance) {
                throw new InsufficientFundsException(
                    "Not enough funds to withdraw " + amount,
                    amount,
                    balance
                );
            }
            balance -= amount;
        }
    }

    public void customExceptionBestPractices() {
        // Include relevant data
        public class OrderException extends RuntimeException {
            private final String orderId;
            private final OrderStatus status;

            public OrderException(String message, String orderId, OrderStatus status) {
                super(message);
                this.orderId = orderId;
                this.status = status;
            }

            public String getOrderId() { return orderId; }
            public OrderStatus getStatus() { return status; }
        }

        // Preserve cause
        try {
            // Database operation
        } catch (SQLException e) {
            throw new OrderException(
                "Failed to update order: " + e.getMessage(),
                orderId,
                status
            );
            // Original exception is lost!
        }

        // BETTER: include cause
        try {
            // Database operation
        } catch (SQLException e) {
            throw new OrderException(
                "Failed to update order",
                orderId,
                status
            );
            // Cause not preserved, but at least message explains
        }
    }
}
```

---

## Try-With-Resources

### AutoCloseable

```java
public class TryWithResources {
    public void traditionalTryFinally() {
        BufferedReader reader = null;
        try {
            reader = new BufferedReader(new FileReader("file.txt"));
            String line = reader.readLine();
            System.out.println(line);
        } catch (IOException e) {
            e.printStackTrace();
        } finally {
            if (reader != null) {
                try {
                    reader.close(); // Can throw IOException
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
        // Verbose, easy to make mistakes
    }

    public void tryWithResourcesClean() {
        try (BufferedReader reader = new BufferedReader(new FileReader("file.txt"))) {
            String line = reader.readLine();
            System.out.println(line);
        } catch (IOException e) {
            e.printStackTrace();
        }
        // Much cleaner, reader automatically closed
    }

    public void multipleResources() {
        try (
            FileInputStream fis = new FileInputStream("input.txt");
            FileOutputStream fos = new FileOutputStream("output.txt");
            InputStreamReader reader = new InputStreamReader(fis);
            OutputStreamWriter writer = new OutputStreamWriter(fos)
        ) {
            // Use resources
        } catch (IOException e) {
            e.printStackTrace();
        }
        // All resources closed automatically in reverse order
    }

    public void customAutoCloseable() {
        class DatabaseConnection implements AutoCloseable {
            private boolean open = true;

            public void query(String sql) {
                if (!open) throw new IllegalStateException("Connection closed");
                System.out.println("Executing: " + sql);
            }

            @Override
            public void close() {
                System.out.println("Closing database connection");
                open = false;
            }
        }

        try (DatabaseConnection conn = new DatabaseConnection()) {
            conn.query("SELECT * FROM users");
        } catch (Exception e) {
            e.printStackTrace();
        }
        // close() called automatically

        // Important: close() is guaranteed to be called
        // Even if query throws exception
    }

    public void suppressedExceptions() {
        try (
            Resource1 r1 = new Resource1();
            Resource2 r2 = new Resource2()
        ) {
            r1.use(); // Throws Exception1
        } catch (Exception e) {
            System.out.println("Primary: " + e);

            // Check suppressed exceptions
            Throwable[] suppressed = e.getSuppressed();
            for (Throwable t : suppressed) {
                System.out.println("Suppressed: " + t);
            }
        }

        // If use() throws, close() might also throw
        // Exception from close() added as suppressed exception
        // Primary exception propagates
    }
}
```

---

## Best Practices

### Exception Handling Patterns

```java
public class ExceptionHandlingPatterns {
    public void specificsVsGeneral() {
        // DON'T: catch generic Exception
        try {
            somethingRisky();
        } catch (Exception e) { // Too broad
            // Catches everything: programming errors, runtime errors, etc.
        }

        // DO: catch specific exceptions
        try {
            readFile("file.txt");
        } catch (FileNotFoundException e) {
            // File doesn't exist, provide alternative
            readFile("default.txt");
        } catch (IOException e) {
            // I/O error, log and fail
            logger.error("Failed to read file", e);
        }
    }

    public void loggingExceptions() {
        // DON'T: just print and ignore
        try {
            riskyOperation();
        } catch (Exception e) {
            e.printStackTrace(); // Lost in console output
        }

        // DO: log with context
        try {
            riskyOperation();
        } catch (Exception e) {
            logger.error("Failed to perform operation for user: " + userId, e);
        }

        // DO: include context in exception message
        try {
            transfer(accountId, amount);
        } catch (InsufficientFundsException e) {
            logger.error("Transfer failed: insufficient funds in account " + accountId +
                         ", required: " + e.getRequired() + ", available: " + e.getAvailable(), e);
        }
    }

    public void failFast() {
        // DON'T: ignore exceptions
        try {
            process();
        } catch (Exception e) {
            // Silently continue
        }

        // DO: fail fast
        public void withdraw(double amount) {
            if (amount <= 0) {
                throw new IllegalArgumentException("Amount must be positive");
            }
            if (amount > balance) {
                throw new InsufficientFundsException("Insufficient balance");
            }
            // Only if valid, proceed
        }

        // Catch and convert to meaningful exception
        try {
            transfer();
        } catch (SQLException e) {
            throw new TransferException("Database error during transfer", e);
        }
    }

    public void dontReturnNullForErrors() {
        // DON'T: return null on error
        public User findUser(int id) {
            try {
                return loadFromDB(id);
            } catch (SQLException e) {
                return null; // Error hidden
            }
        }

        // Caller doesn't know if null means "not found" or error

        // DO: throw exception
        public User findUser(int id) throws UserNotFoundException {
            try {
                return loadFromDB(id);
            } catch (SQLException e) {
                throw new UserNotFoundException("User not found: " + id, e);
            }
        }

        // Or return Optional
        public Optional<User> findUser(int id) {
            try {
                return Optional.of(loadFromDB(id));
            } catch (SQLException e) {
                logger.error("Database error", e);
                return Optional.empty();
            }
        }
    }

    public void catchAndConvert() {
        try {
            query(); // Throws checked exception
        } catch (SQLException e) {
            // Don't throw raw SQLException from business logic
            throw new DataAccessException("Query failed", e);
        }

        // Preserve cause chain but wrap in meaningful exception
        public class DataAccessException extends RuntimeException {
            public DataAccessException(String message, Throwable cause) {
                super(message, cause);
            }
        }
    }
}
```

---

## Exception Chaining

### Causes and Stack Traces

```java
public class ExceptionChaining {
    public void chainedExceptions() {
        try {
            try {
                // Low-level operation
                throw new SQLException("Database connection failed");
            } catch (SQLException e) {
                // Wrap in domain exception
                throw new UserServiceException("Failed to load user", e);
            }
        } catch (UserServiceException e) {
            e.printStackTrace();
            // OUTPUT shows both exceptions:
            // UserServiceException: Failed to load user
            //   Caused by: SQLException: Database connection failed
        }
    }

    public void preservingContext() {
        public void transferMoney(String fromId, String toId, double amount) {
            try {
                Account from = getAccount(fromId);
                Account to = getAccount(toId);
                from.withdraw(amount);
                to.deposit(amount);
            } catch (SQLException e) {
                throw new TransferException(
                    "Failed to transfer " + amount + " from " + fromId + " to " + toId,
                    e
                );
            }
        }

        // When exception occurs:
        // - Original cause preserved (e.getCause())
        // - Context added to message
        // - Stack trace shows both low-level and high-level errors
    }

    public void multiCatch() {
        try {
            somethingRisky();
        } catch (IOException | SQLException e) {
            // Handle multiple exceptions same way
            logger.error("Operation failed", e);
            throw new OperationException("Failed", e);
        }

        // Before Java 7:
        try {
            somethingRisky();
        } catch (IOException e) {
            logger.error("Operation failed", e);
            throw new OperationException("Failed", e);
        } catch (SQLException e) {
            logger.error("Operation failed", e);
            throw new OperationException("Failed", e);
        }
    }

    public void suppressedExceptions() {
        public void closeResources(Resource... resources) {
            Exception primaryException = null;

            for (Resource r : resources) {
                try {
                    r.close();
                } catch (Exception e) {
                    if (primaryException == null) {
                        primaryException = e;
                    } else {
                        primaryException.addSuppressed(e);
                    }
                }
            }

            if (primaryException != null) {
                throw primaryException;
            }
        }

        // Multiple exceptions from try-with-resources automatically suppressed
        try (Resource1 r1 = new Resource1(); Resource2 r2 = new Resource2()) {
            // Both exceptions propagate as suppressed if thrown
        }
    }
}
```

---

## Performance Impact

### Exception Handling Overhead

```java
public class ExceptionPerformance {
    public void exceptionCreationCost() {
        // Creating exception is expensive: captures stack trace
        long start = System.nanoTime();
        for (int i = 0; i < 100000; i++) {
            try {
                throw new RuntimeException("Error");
            } catch (RuntimeException e) {
                // Ignore
            }
        }
        long exceptionTime = System.nanoTime() - start;

        // Throwing/catching exception is slow
        System.out.println("Exception time: " + exceptionTime / 1000000.0 + "ms");
        // Typically: 100-1000ms for 100k exceptions (1-10 microseconds each)

        // Normal code without exceptions:
        start = System.nanoTime();
        for (int i = 0; i < 100000; i++) {
            // Just assignment
            RuntimeException e = null;
        }
        long normalTime = System.nanoTime() - start;
        // Typically: < 1ms

        // Exceptions are 1000x slower than normal code!
    }

    public void dontUseExceptionsForControl() {
        // SLOW: control flow with exceptions
        public int findIndex(int[] arr, int value) {
            try {
                for (int i = 0; i < 1000000; i++) {
                    if (i == value) {
                        throw new Exception("Found");
                    }
                }
            } catch (Exception e) {
                return -1;
            }
            return -1;
        }

        // FAST: normal control flow
        public int findIndexFast(int[] arr, int value) {
            for (int i = 0; i < arr.length; i++) {
                if (arr[i] == value) {
                    return i;
                }
            }
            return -1;
        }

        // Exceptions should be exceptional (rare)
        // Not normal control flow
    }

    public void validationNotExceptions() {
        // DON'T: use exceptions for validation
        public void setAge(int age) {
            if (age < 0) throw new IllegalArgumentException("Invalid");
            this.age = age;
        }

        public void callMany() {
            for (int i = -1000; i < 1000; i++) {
                try {
                    setAge(i); // Throws exception half the time
                } catch (IllegalArgumentException e) {
                    // Half the calls throw exceptions (slow)
                }
            }
        }

        // Better: return boolean or Optional
        public boolean setAgeIfValid(int age) {
            if (age < 0) return false;
            this.age = age;
            return true;
        }

        public void callManyFast() {
            for (int i = -1000; i < 1000; i++) {
                if (setAgeIfValid(i)) {
                    // Fast, no exceptions
                }
            }
        }
    }

    public void cacheStackTraces() {
        // JVM can optimize exceptions it recognizes
        try {
            riskyOperation();
        } catch (OutOfMemoryError e) {
            // OutOfMemoryError might be cached
            // Stack trace not always filled
            // JVM optimization: avoids expensive stack capture
        }
    }
}
```

---

## SOLID Principles

### Single Responsibility Principle

```java
public class SolidSRP {
    // BAD: class doing too much
    public class UserService {
        public void createUser(String name, String email) throws SQLException {
            // Validation
            if (name == null) throw new IllegalArgumentException("Name required");

            // Database operation
            Connection conn = getConnection();
            PreparedStatement stmt = conn.prepareStatement("INSERT INTO users ...");
            // ... execute

            // Email sending (not related to user service)
            sendEmail(email, "Welcome");

            // Logging
            System.out.println("User created: " + name);
        }
    }

    // GOOD: separated concerns
    public class UserService {
        private UserRepository userRepository;
        private EmailService emailService;
        private Logger logger;

        public void createUser(String name, String email) {
            userValidator.validate(name, email);
            User user = userRepository.save(new User(name, email));
            emailService.sendWelcomeEmail(email);
            logger.info("User created: " + name);
        }
    }

    public class UserValidator {
        public void validate(String name, String email) {
            if (name == null || name.isEmpty()) {
                throw new IllegalArgumentException("Name required");
            }
            if (email == null || email.isEmpty()) {
                throw new IllegalArgumentException("Email required");
            }
        }
    }
}
```

### Open-Closed Principle

```java
public class SolidOCP {
    // BAD: closed to extension
    public class PaymentProcessor {
        public void process(String paymentType, double amount) {
            if (paymentType.equals("credit")) {
                processCreditCard(amount);
            } else if (paymentType.equals("paypal")) {
                processPayPal(amount);
            } else if (paymentType.equals("bitcoin")) {
                processBitcoin(amount);
            }
            // Adding new payment type requires modifying this class
        }
    }

    // GOOD: open for extension, closed for modification
    public interface PaymentMethod {
        void process(double amount);
    }

    public class CreditCardPayment implements PaymentMethod {
        @Override
        public void process(double amount) {
            // Credit card logic
        }
    }

    public class PayPalPayment implements PaymentMethod {
        @Override
        public void process(double amount) {
            // PayPal logic
        }
    }

    public class PaymentProcessor {
        public void process(PaymentMethod method, double amount) {
            method.process(amount); // Works with any payment method
            // New payment types don't require modification
        }
    }
}
```

### Dependency Inversion Principle

```java
public class SolidDIP {
    // BAD: depends on concrete class
    public class OrderService {
        private DatabaseOrderRepository repository = new DatabaseOrderRepository();

        public void placeOrder(Order order) {
            repository.save(order);
        }
    }

    // GOOD: depends on abstraction
    public interface OrderRepository {
        void save(Order order);
    }

    public class OrderService {
        private OrderRepository repository;

        public OrderService(OrderRepository repository) {
            this.repository = repository;
        }

        public void placeOrder(Order order) {
            repository.save(order);
        }
    }

    // Can use any implementation
    public class DatabaseOrderRepository implements OrderRepository {
        @Override
        public void save(Order order) {
            // Save to database
        }
    }

    public class InMemoryOrderRepository implements OrderRepository {
        @Override
        public void save(Order order) {
            // Save to memory (for testing)
        }
    }
}
```

---

## Clean Code

### Exception Messages

```java
public class CleanExceptionMessages {
    // BAD: vague message
    throw new RuntimeException("Error"); // What error?

    // GOOD: specific message with context
    throw new IllegalArgumentException(
        "Email must be valid (provided: " + email + ")"
    );

    // BAD: sensitive data in message
    throw new AuthException("Wrong password for user: " + username + ", " + password);

    // GOOD: log sensitive data, exception has safe message
    logger.error("Authentication failed for user: " + username + ", password: " + password);
    throw new AuthException("Authentication failed");

    // BAD: error code without explanation
    throw new BusinessException("ERR_001");

    // GOOD: human-readable error
    throw new BusinessException(
        "Insufficient funds: required " + required + ", available " + available
    );
}
```

### Documentation

```java
public class DocumentExceptions {
    // DON'T: fail to document exceptions
    public void someMethod() {
        // Caller doesn't know what can go wrong
    }

    // DO: document exceptions in JavaDoc
    /**
     * Transfers money from source to destination account.
     *
     * @param source source account ID
     * @param destination destination account ID
     * @param amount transfer amount
     * @throws InsufficientFundsException if source account doesn't have enough balance
     * @throws AccountNotFoundException if either account doesn't exist
     * @throws TransferException if database error occurs
     */
    public void transfer(String source, String destination, double amount)
            throws InsufficientFundsException, AccountNotFoundException, TransferException {
        // Implementation
    }

    // DO: document what you expect caller to do
    /**
     * Attempts to find user by ID.
     *
     * @param id user ID
     * @return user, or empty Optional if not found
     * @throws DataAccessException if database error (caller should log and retry)
     */
    public Optional<User> findUser(int id) throws DataAccessException {
        // Implementation
    }
}
```

---

## Effective Java Items

### Item 72: Favor the Use of Standard Exceptions

```java
public class EffectiveJavaItem72 {
    // Use standard exceptions for standard situations

    // DON'T: create custom exception for standard situation
    public class DivideByZeroException extends RuntimeException {}

    public int divide(int a, int b) throws DivideByZeroException {
        if (b == 0) throw new DivideByZeroException("Division by zero");
        return a / b;
    }

    // DO: use standard ArithmeticException (or IllegalArgumentException)
    public int divideGood(int a, int b) {
        if (b == 0) throw new IllegalArgumentException("Divisor cannot be zero");
        return a / b;
    }

    // Common standard exceptions:
    public void standardExceptions() {
        // IllegalArgumentException: bad argument value
        // IllegalStateException: object in wrong state for operation
        // NullPointerException: required argument is null
        // IndexOutOfBoundsException: index out of range
        // ConcurrentModificationException: modification during iteration
        // UnsupportedOperationException: operation not supported
    }
}
```

### Item 73: Throw Exceptions Appropriate to the Abstraction

```java
public class EffectiveJavaItem73 {
    // Exception translation: catch low-level, throw high-level

    public class DAO {
        public User getUser(int id) {
            try {
                // Low-level database operation
                return queryDatabase(id);
            } catch (SQLException e) {
                // SQLException inappropriate here (leaks database impl detail)
                // Translate to application-level exception
                throw new DataAccessException("Failed to load user: " + id, e);
            }
        }
    }

    // DON'T: let SQLException propagate
    // Caller shouldn't know about SQL

    // DO: translate to appropriate exception
    public class DataAccessException extends RuntimeException {
        public DataAccessException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
```

### Item 75: Include Failure-Capture Information in Detail Messages

```java
public class EffectiveJavaItem75 {
    // Exception message should help diagnose problem

    // BAD: vague message
    throw new ArrayIndexOutOfBoundsException("Bad index");

    // GOOD: include relevant values
    throw new ArrayIndexOutOfBoundsException(
        "Index " + index + " out of bounds for array length " + array.length
    );

    // BAD: no context
    throw new InvalidConfigException("Invalid value");

    // GOOD: show what was expected
    throw new InvalidConfigException(
        "Port must be between 1-65535, got: " + port
    );

    // DO: include all parameters involved in computation
    public void withdraw(double amount) {
        if (amount > balance) {
            throw new InsufficientFundsException(
                String.format("Insufficient funds: required %.2f, available %.2f",
                    amount, balance)
            );
        }
        balance -= amount;
    }
}
```

---

## Interview Questions

### Q1: What's the difference between checked and unchecked exceptions?

**Answer:**
- **Checked:** Must be caught or declared. Compiler enforces. Examples: IOException, SQLException. Use when caller can reasonably recover.
- **Unchecked:** Don't have to catch. Indicate programming errors. Examples: NullPointerException, IllegalArgumentException. Use for validation, logic errors.

### Q2: When should you use try-with-resources?

**Answer:** Always use try-with-resources for AutoCloseable resources (streams, connections, readers). It automatically closes resources even if exception thrown, and suppressed exceptions are preserved. Better than try-finally.

### Q3: How should you design exception hierarchies?

**Answer:**
```java
// Create domain-specific exception base class
public abstract class ApplicationException extends RuntimeException {
    public ApplicationException(String message) {
        super(message);
    }

    public ApplicationException(String message, Throwable cause) {
        super(message, cause);
    }
}

// Extend for specific domains
public class UserServiceException extends ApplicationException {}
public class PaymentException extends ApplicationException {}

// Allows catching all app exceptions: catch (ApplicationException e)
// But still specific when needed
```

---

**Key Takeaway Summary:**

1. **Hierarchy:** Error (don't catch), Checked (must catch), Unchecked (indicates bugs).
2. **Design:** Throw specific exceptions. Catch specific exceptions. Translate to abstraction level.
3. **Try-With-Resources:** Use for AutoCloseable. Automatic close and suppressed exception handling.
4. **Best Practices:** Fail fast. Include context in messages. Preserve cause chains. Don't hide exceptions.
5. **Performance:** Exceptions expensive (stack trace capture). Don't use for control flow.
6. **Standards:** Use standard exceptions for standard situations. Create custom for domain-specific.

