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

Java roots all throwable objects at `java.lang.Throwable`. Only `Throwable` and its subclasses can be thrown by the JVM or a `throw` statement, or caught in a `catch` clause.

```mermaid
flowchart TD
    T["Throwable (Root - Checked base)"]
    ERR["Error (Unchecked - JVM Fatal, Do Not Catch)"]
    EXC["Exception (Checked Base)"]

    OOM["OutOfMemoryError (Heap Exhausted)"]
    SOE["StackOverflowError (Call Stack Full)"]
    LNK["LinkageError (Class or Binary Mismatch)"]
    THD["ThreadDeath (Thread Terminating)"]

    CHK["Checked Exceptions (Compile-Time Verified)"]
    IO["IOException"]
    FNF["FileNotFoundException"]
    SQL["SQLException"]

    RT["RuntimeException (Unchecked - Bugs and Preconditions)"]
    NPE["NullPointerException"]
    IAE["IllegalArgumentException"]
    IOB["IndexOutOfBoundsException"]
    AIOB["ArrayIndexOutOfBoundsException"]

    T --> ERR
    T --> EXC
    ERR --> OOM
    ERR --> SOE
    ERR --> LNK
    ERR --> THD

    EXC --> CHK
    EXC --> RT
    CHK --> IO
    IO --> FNF
    CHK --> SQL

    RT --> NPE
    RT --> IAE
    RT --> IOB
    IOB --> AIOB

    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534

    class T purple
    class ERR,OOM,SOE,LNK,THD red
    class EXC,CHK,IO,FNF,SQL amber
    class RT blue
    class NPE,IAE,IOB,AIOB green
```

### Category Breakdown

| Category | Base Class | Verification | Typical Examples | Recommended Action |
| :--- | :--- | :--- | :--- | :--- |
| **Error** | `java.lang.Error` | Unchecked (runtime) | `OutOfMemoryError`, `StackOverflowError`, `LinkageError`, `ThreadDeath` | **Do not catch** — JVM or thread cannot reliably recover |
| **Checked Exception** | `Exception` (excluding `RuntimeException`) | **Compile-time enforced** | `IOException`, `FileNotFoundException`, `SQLException` | Catch and recover, or declare via `throws` |
| **Unchecked Exception** | `RuntimeException` | Unchecked (runtime) | `NullPointerException`, `IllegalArgumentException`, `ArrayIndexOutOfBoundsException` | Fix the bug or fail fast on invalid input |

```mermaid
flowchart LR
    C1["Checked: Throwable and Exception"] --> C2["Compiler Enforces catch or throws"] --> C3["Recoverable External Failure"]
    U1["Unchecked: RuntimeException"] --> U2["No throws Required"] --> U3["Programming Bug or Contract Violation"]
    E1["Fatal: Error"] --> E2["Bypasses Normal Recovery"] --> E3["JVM Termination or Thread Death"]

    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b

    class C1,C2,C3 amber
    class U1,U2,U3 blue
    class E1,E2,E3 red
```

> [!WARNING]
> **Interview Gotcha — Is `Throwable` Checked or Unchecked?**
> By the Java Language Specification (JLS), **`Throwable` itself and `Exception` (non-`RuntimeException` subclasses) are checked**. Only `Error`, `RuntimeException`, and their subclasses are unchecked. Catching `Throwable` accidentally traps `OutOfMemoryError` and `StackOverflowError`, which can leave your JVM in a corrupted state.

---

## Checked vs Unchecked

Choosing between checked and unchecked exceptions is one of the most consequential API design decisions in Java.

```mermaid
flowchart TD
    S["Failure Condition Occurs"] --> Q1{"Programming bug or bad caller input?"}
    Q1 -->|Yes| UNK["Throw Unchecked RuntimeException (NPE, IAE, ISE)"]
    Q1 -->|No| Q2{"Is absence an expected normal outcome?"}
    Q2 -->|Yes| OPT["Return Optional or Empty Collection"]
    Q2 -->|No| Q3{"Can immediate caller reasonably recover?"}
    Q3 -->|No| DOM["Throw Unchecked Domain Exception (Avoid throws chains)"]
    Q3 -->|Yes| Q4{"Used in Lambdas, Streams, or Evolving Interface?"}
    Q4 -->|Yes| LAM["Prefer Unchecked or Result Type (Avoid API breakage)"]
    Q4 -->|No| CHK["Use Checked Exception (Explicit throws Contract)"]

    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b

    class S purple
    class Q1,Q2,Q3,Q4 blue
    class OPT,CHK green
    class UNK,DOM,LAM amber
```

### Checked Exceptions: Contract, Advantages & Controversies

- **Compile-time enforcement**: Calling `new FileReader("file.txt")` throws `FileNotFoundException` (checked). Code will not compile unless wrapped in `try/catch` or declared with `throws`.
- **Advantages**:
  - **Forces recovery thinking**: Developers must explicitly handle foreseeable external failures (e.g., trying an alternate file path when `FileNotFoundException` occurs).
  - **Self-documenting API clarity**: `transfer(Account from, Account to) throws InsufficientFundsException` communicates domain failure modes directly in the signature.
- **Controversies & Friction in Modern Java**:
  - **Forced `throws` chains**: `method1() -> method2() -> method3()` forces intermediate layers to declare `throws IOException` even when they cannot recover.
  - **Catch-and-convert anti-pattern**: Wrapping `IOException | SQLException` inside `new RuntimeException(e)` everywhere defeats the checked contract.
  - **API versioning breakage**: Adding a new checked exception to an interface like `DatabaseAPI.save() throws SQLException` breaks every existing caller and implementation.
  - **Lambda / Stream friction**: Standard functional interfaces (`Function`, `Consumer`, `Supplier`) do not declare checked exceptions.

### Unchecked Exceptions & Defensive Prevention

Unchecked exceptions indicate **programmer responsibility** (null dereference, out-of-bounds index, invalid argument).

```java
// 1. Checked: Must catch or declare
public void readFile(String path) throws IOException {
    try (FileReader reader = new FileReader(path)) {
        // Read primary file; fallback on FileNotFoundException if recoverable
    }
}

// 2. Unchecked prevention: null-safe Optional & fail-fast argument validation
public void printNameLength(String name) {
    Optional.ofNullable(name)
        .map(String::length)
        .ifPresent(System.out::println);
}

public void setAge(int age) {
    if (age < 0 || age > 150) {
        throw new IllegalArgumentException("Invalid age: " + age);
    }
    this.age = age;
}
```

> [!IMPORTANT]
> **30-Second Rule of Thumb**
> Use **Checked** exceptions only when the caller can take meaningful local recovery action (retry, alternate path, prompt user). Use **Unchecked** exceptions for programming errors, invariant violations, unrecoverable infrastructure faults, and modern Spring/functional architectures.

---

## Custom Exceptions

Custom exceptions model domain semantics cleanly and carry structured failure metadata (`orderId`, `required`, `available`, `errorCode`) for callers, logs, and API boundaries.

```mermaid
classDiagram
    class Exception {
        +String message
        +Throwable cause
    }
    class RuntimeException {
        +String message
        +Throwable cause
    }
    class ApplicationException {
        <<abstract>>
        -ErrorCode errorCode
        +ApplicationException(message, errorCode, cause)
        +getErrorCode() ErrorCode
    }
    class ErrorCode {
        <<enumeration>>
        INVALID_ACCOUNT
        ORDER_FAILED
        INSUFFICIENT_FUNDS
    }
    class InsufficientFundsException {
        -double required
        -double available
        +getRequired() double
        +getAvailable() double
        +getShortfall() double
    }
    class InvalidAccountException {
        +InvalidAccountException(message)
        +InvalidAccountException(message, cause)
    }
    class OrderException {
        -String orderId
        -OrderStatus status
        +getOrderId() String
        +getStatus() OrderStatus
    }
    class GlobalExceptionHandler {
        <<RestControllerAdvice>>
        +handleApplication(ApplicationException) ProblemDetail
        +handleInsufficientFunds(InsufficientFundsException) ProblemDetail
    }

    Exception <|-- InsufficientFundsException
    RuntimeException <|-- ApplicationException
    ApplicationException <|-- InvalidAccountException
    ApplicationException <|-- OrderException
    ApplicationException --> ErrorCode : carries
    GlobalExceptionHandler ..> ApplicationException : maps to HTTP 4xx or 5xx
    GlobalExceptionHandler ..> InsufficientFundsException : maps to HTTP 422
```

### Domain Exception Implementation & Boundary Translation

```mermaid
flowchart LR
    DOM["Domain Method Throws InsufficientFundsException or OrderException"] --> META["Carries Domain Fields: orderId, status, required, available, ErrorCode"]
    META --> CAUSE["Preserves Original Throwable Cause"]
    CAUSE --> ADV["Global RestControllerAdvice Boundary"]
    ADV --> LOG["Logs Internal Stack Trace and Cause Once"]
    ADV --> HTTP["Returns RFC 9457 ProblemDetail with Safe Error Code"]

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef green fill:#dcfce7,stroke:#166534,color:#166534

    class DOM,META blue
    class CAUSE amber
    class ADV purple
    class LOG,HTTP green
```

### Key Design Guidelines

- **Extend `Exception` for checked**, `RuntimeException` for unchecked (`InvalidAccountException`, `OrderException`).
- **Provide standard constructors**: Always support `(String message)` and `(String message, Throwable cause)` so callers never drop the underlying root cause.
- **Attach domain diagnostics**: Expose immutable getters (`getRequired()`, `getAvailable()`, `getShortfall()`, `getOrderId()`, `getStatus()`, `getErrorCode()`).

```java
// Checked domain exception with rich diagnostic fields
public class InsufficientFundsException extends Exception {
    private final double required;
    private final double available;

    public InsufficientFundsException(String message, double required, double available) {
        super(message);
        this.required = required;
        this.available = available;
    }

    public double getRequired() { return required; }
    public double getAvailable() { return available; }
    public double getShortfall() { return required - available; }
}

// Unchecked domain exception ALWAYS preserving Throwable cause
public class OrderException extends RuntimeException {
    private final String orderId;
    private final OrderStatus status;

    public OrderException(String message, String orderId, OrderStatus status, Throwable cause) {
        super(message, cause); // Never omit cause when wrapping SQLException!
        this.orderId = orderId;
        this.status = status;
    }

    public String getOrderId() { return orderId; }
    public OrderStatus getStatus() { return status; }
}
```

> [!WARNING]
> **Trap: Message-Only Wrapping Loses the Root Cause**
> Calling `throw new OrderException("Failed: " + e.getMessage(), orderId, status)` without passing `e` to `super(message, cause)` **destroys the original `SQLException` stack trace**. Always pass `e` as the `cause` parameter.

---

## Try-With-Resources

Introduced in Java 7, `try-with-resources` manages any object implementing `java.lang.AutoCloseable` (and its sub-interface `Closeable`), guaranteeing deterministic cleanup without `try-finally` boilerplate or exception masking.

```mermaid
sequenceDiagram
    participant C as Caller
    participant R1 as Resource 1 (fis)
    participant R2 as Resource 2 (fos)

    C->>R1: open Resource 1
    C->>R2: open Resource 2
    C->>R1: use() throws PrimaryException
    Note over C,R2: Closed automatically in reverse declaration order
    C->>R2: close() throws CloseEx2
    Note over C: PrimaryException.addSuppressed(CloseEx2)
    C->>R1: close() succeeds
    R1-->>C: Propagates PrimaryException with getSuppressed()
```

### `try-finally` vs `try-with-resources` Suppression

```mermaid
flowchart LR
    T1["Traditional try-finally"] --> T2["try throws Ex1"] --> T3["finally close() throws Ex2"] --> T4["Ex2 Silently Masks and Loses Ex1"]
    W1["try-with-resources"] --> W2["try throws Ex1"] --> W3["AutoCloseable.close() throws Ex2"] --> W4["Ex1 Propagates with Ex2 in getSuppressed()"]

    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e

    class T1,T2,T3 amber
    class T4 red
    class W1,W2,W3,W4 green
```

### Multi-Resource Order & Custom `AutoCloseable`

- **Reverse close order**: In `try (FileInputStream fis = ...; FileOutputStream fos = ...; InputStreamReader reader = ...; OutputStreamWriter writer = ...)`, resources close in order: `writer` -> `reader` -> `fos` -> `fis`.
- **Java 9+ enhancement**: Effectively `final` pre-existing resource variables can be referenced directly (`try (reader)`).
- **Suppressed exceptions**: When both the `try` body and `close()` throw, the `try` block's exception wins as the **primary** exception, and `close()` exceptions are attached via `addSuppressed()`.

```java
class DatabaseConnection implements AutoCloseable {
    private boolean open = true;

    public void query(String sql) {
        if (!open) throw new IllegalStateException("Connection closed");
        System.out.println("Executing: " + sql);
    }

    @Override
    public void close() {
        open = false; // Guaranteed to execute even if query() throws
    }
}

public void runWithSuppressionCheck() {
    try (
        Resource1 r1 = new Resource1();
        Resource2 r2 = new Resource2() // Closed BEFORE r1
    ) {
        r1.use(); // Throws primary exception
    } catch (Exception e) {
        System.err.println("Primary: " + e);
        for (Throwable suppressed : e.getSuppressed()) {
            System.err.println("Suppressed: " + suppressed);
        }
    }
}
```

> [!IMPORTANT]
> **30-Second Revision — Reverse Order & `getSuppressed()`**
> `try-with-resources` closes resources in **reverse order of declaration** so outer wrappers (like `BufferedWriter` / `OutputStreamWriter`) flush before inner streams (`FileOutputStream`) close. Unlike `try-finally`—where an exception inside `finally` **overwrites** the original exception—`try-with-resources` preserves the primary exception and attaches cleanup errors via `getSuppressed()`.

---

## Best Practices

Effective exception handling balances precision, observability, and clean abstraction boundaries.

```mermaid
flowchart TD
    EX["Exception Thrown"] --> SP{"Caught Specific Type?"}
    SP -->|No - catch Exception| BAD1["Anti-Pattern: Hides Bugs and Programming Errors"]
    SP -->|Yes| REC{"Can Recover Locally?"}
    REC -->|Yes| FB["Execute Fallback e.g. Read default.txt"]
    REC -->|No| WR{"Crossing Layer Boundary?"}
    WR -->|Yes| TR["Wrap with Context and Preserve Cause"]
    WR -->|No| PR["Let Propagate Cleanly"]
    TR --> BND["Boundary Handler"]
    PR --> BND
    BND --> LOG["Log Once with Full Context and Cause"]
    LOG --> FAIL["Fail Fast or Return Safe Response - Never Return Null on Error"]

    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e

    class EX purple
    class SP,REC,WR blue
    class BAD1 red
    class TR,PR amber
    class FB,BND,LOG,FAIL green
```

### Do's vs Don'ts Comparison

| Practice | Anti-Pattern (Don't) | Best Practice (Do) |
| :--- | :--- | :--- |
| **Catch Specificity** | `catch (Exception e)` — traps unrelated runtime bugs | Catch narrow types first (`FileNotFoundException` -> fallback `default.txt`, then `IOException`) |
| **Logging** | `e.printStackTrace()` (lost in stdout) or log-and-rethrow (duplicate log noise) | **Log once** at the handling boundary with contextual IDs (`userId`, `accountId`, `required`, `available`) |
| **Failure Mode** | Silent `catch (Exception e) {}` swallowing errors | **Fail fast** on invalid state (`amount <= 0` -> `IllegalArgumentException`) |
| **Error Signaling** | Returning `null` on `SQLException` (ambiguous: missing vs DB down?) | Throw meaningful domain exception (`UserNotFoundException` / `DataAccessException`), or return `Optional<User>` when absence is valid |
| **Abstraction Leaks** | Propagating raw `SQLException` into service/UI layers | Catch and convert to `DataAccessException(message, cause)` preserving root cause |

```java
public User findUser(int id) throws DataAccessException {
    try {
        return loadFromDB(id);
    } catch (SQLException e) {
        // Translate low-level exception; preserve cause; don't return null!
        throw new DataAccessException("Failed to load user id=" + id, e);
    }
}

public void withdraw(double amount) throws InsufficientFundsException {
    if (amount <= 0) {
        throw new IllegalArgumentException("Amount must be positive: " + amount);
    }
    if (amount > balance) {
        throw new InsufficientFundsException("Insufficient balance", amount, balance);
    }
    balance -= amount;
}
```

> [!WARNING]
> **Log-and-Rethrow Anti-Pattern**
> Never log an exception in a lower layer and then rethrow it up the stack—each layer logs the same stack trace again, polluting production logs. Either **handle + log** at the boundary, or **wrap + rethrow** silently with added context.

---

## Exception Chaining

Exception chaining wraps low-level failures inside higher-level domain exceptions without losing the original stack trace, while multi-catch and suppression keep recovery blocks DRY.

```mermaid
flowchart LR
    DAO["DAO Layer: SQLException (Connection Refused)"] -->|wrap with cause| SVC["Service Layer: OrderProcessingException (orderId + cause)"]
    SVC -->|translated at API boundary| ADV["Global Handler: RestControllerAdvice"]
    ADV -->|client response| API["HTTP 500 RFC 9457 ProblemDetail (Safe Payload)"]
    ADV -->|server observability| LOG["Structured Log: Full Caused by Chain and getSuppressed()"]

    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534

    class DAO red
    class SVC amber
    class ADV purple
    class API blue
    class LOG green
```

### Multi-Catch & Manual Suppression Pattern

```mermaid
flowchart TD
    MC["Java 7+ Multi-Catch: catch IOException or SQLException e"] --> FIN["Variable e is Implicitly final; Types Must Be Disjoint"]
    FIN --> WRAP["Logs Once or Wraps in OperationException with Cause e"]
    LP["Manual Close Loop over Resources"] --> FIRST{"First Exception?"}
    FIRST -->|Yes| SET["primaryException = e"]
    FIRST -->|No| SUP["primaryException.addSuppressed(e)"]

    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef green fill:#dcfce7,stroke:#166534,color:#166534

    class MC,LP blue
    class FIRST amber
    class FIN,WRAP,SET,SUP green
```

- **Cause chains**: `throw new UserServiceException("Failed to load user", e)` prints `UserServiceException` followed by `Caused by: SQLException: Database connection failed`, accessible via `e.getCause()`.
- **Operational context**: In `transferMoney(fromId, toId, amount)`, enrich the message with IDs and amount while keeping `e` as the cause.
- **Multi-catch (Java 7+)**: `catch (IOException | SQLException e)` removes duplicated catch blocks; the caught parameter `e` is **implicitly `final`**, and union types cannot share an inheritance relationship (e.g., `FileNotFoundException | IOException` is a compile error).
- **Manual suppression aggregation**: When closing variable numbers of resources manually (`closeResources(Resource... resources)`), capture the first exception as `primaryException` and attach later exceptions via `primaryException.addSuppressed(e)`.

```java
public void transferMoney(String fromId, String toId, double amount) {
    try {
        Account from = getAccount(fromId);
        Account to = getAccount(toId);
        from.withdraw(amount);
        to.deposit(amount);
    } catch (IOException | SQLException e) {
        throw new TransferException(
            "Failed to transfer " + amount + " from " + fromId + " to " + toId, e);
    }
}

public void closeResources(AutoCloseable... resources) throws Exception {
    Exception primary = null;
    for (AutoCloseable r : resources) {
        try {
            r.close();
        } catch (Exception e) {
            if (primary == null) primary = e;
            else primary.addSuppressed(e);
        }
    }
    if (primary != null) throw primary;
}
```

> [!IMPORTANT]
> **Multi-Catch Subtlety**
> In `catch (IOException | SQLException e)`, `e` is **implicitly `final`** (cannot be reassigned) and the types in the union must be **disjoint** (neither may be a subclass of the other).

---

## Performance Impact

Entering a `try` block is nearly free in the JVM (handled via bytecode exception tables), **creating and throwing** an exception is ~1000x slower than normal control flow because `Throwable()` calls native `fillInStackTrace()`.

```mermaid
flowchart LR
    P1["Path A: Normal Exception"] --> F1["Calls Native fillInStackTrace()"] --> W1["Walks Entire Call Stack + Allocates Frames"] --> C1["1 to 10 us per Throw (~100-1000ms per 100k)"]
    P2["Path B: Normal Control Flow"] --> F2["Returns boolean, index, or Optional"] --> W2["No Stack Walk or Native Call"] --> C2["Sub-nanosecond Overhead (Under 1ms per 100k)"]
    P3["Path C: Stackless or JVM Cached"] --> F3["OmitStackTraceInFastThrow or writableStackTrace=false"] --> W3["Reuses Pre-Allocated or Empty Trace"] --> C3["Near Normal Return Cost (Zero Stack Capture)"]

    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e

    class P1,F1,W1,C1 red
    class P2,F2,W2,C2 green
    class P3,F3,W3,C3 amber
```

### Performance Rules & JVM Optimizations

- **Stack trace capture cost**: 100,000 throws take ~100–1000 ms (1–10 µs each) vs `< 1 ms` for normal branching/assignment—roughly **1000x slower**.
- **Never use exceptions for control flow**: Don't throw an exception to exit a search loop (`findIndex`)—return the index or `-1`.
- **Don't throw on high-frequency expected validation**: On hot loops where half the calls fail validation (`setAge` in a loop of 2,000 items), return `boolean setAgeIfValid(int age)` or a lightweight validation result instead of throwing `IllegalArgumentException`.
- **JVM Cached / Pre-allocated Exceptions**:
  - `OutOfMemoryError` may be pre-allocated by the JVM with an empty stack trace because heap is exhausted.
  - HotSpot JIT (`-XX:+OmitStackTraceInFastThrow`, enabled by default) optimizes repeated built-in exceptions (`NullPointerException`, `ArithmeticException`, `ArrayIndexOutOfBoundsException`, `ClassCastException`) by reusing a cached **stackless** instance after threshold hits.
  - **Custom stackless exceptions** (for rare internal control-flow/reactive frameworks): override `fillInStackTrace() { return this; }` or pass `writableStackTrace = false` via `super(message, cause, enableSuppression, false)`.

```java
// FAST: normal control flow and hot-path boolean validation
public int findIndexFast(int[] arr, int value) {
    for (int i = 0; i < arr.length; i++) {
        if (arr[i] == value) return i;
    }
    return -1;
}

public boolean setAgeIfValid(int age) {
    if (age < 0) return false;
    this.age = age;
    return true;
}

// Stackless exception (only for ultra-hot internal control/circuit-breaker signals)
public class FastSignalException extends RuntimeException {
    public FastSignalException(String message) {
        super(message, null, false, false); // writableStackTrace = false
    }
}
```

> [!WARNING]
> **Production Debugging Gotcha — `-XX:+OmitStackTraceInFastThrow`**
> If a production service suddenly starts logging `NullPointerException: null` **with zero stack trace lines**, HotSpot's `OmitStackTraceInFastThrow` optimization kicked in after thousands of throws at the same site. Check earlier logs for the original full stack trace, or pass `-XX:-OmitStackTraceInFastThrow` during debugging.

---

## SOLID Principles

SOLID design prevents tangled exception handling, brittle catch-all logic, and leaky infrastructure dependencies.

```mermaid
flowchart TD
    S_BAD["S Bad: UserService mixes Validation, JDBC, Email, Logging"] --> S_GOOD["S Good: UserValidator, UserRepository, EmailService, Logger"]
    O_BAD["O Bad: PaymentProcessor if-else chain for Credit, PayPal, Bitcoin"] --> O_GOOD["O Good: PaymentMethod interface + CreditCardPayment, PayPalPayment"]
    L_BAD["L Bad: Subtype throws broader checked Exception than Parent"] --> L_GOOD["L Good: Subtype throws same, narrower, or no checked Exception"]
    I_BAD["I Bad: Fat interface forces UnsupportedOperationException stubs"] --> I_GOOD["I Good: Cohesive role interfaces with zero dead methods"]
    D_BAD["D Bad: OrderService instantiates concrete DatabaseOrderRepository"] --> D_GOOD["D Good: OrderService injects OrderRepository interface"]

    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    classDef green fill:#dcfce7,stroke:#166534,color:#166534

    class S_BAD,O_BAD,L_BAD,I_BAD,D_BAD red
    class S_GOOD,O_GOOD,L_GOOD,I_GOOD,D_GOOD green
```

### Principle-by-Principle Breakdown

| Principle | Violation Symptom | Clean Design & Exception Benefit |
| :--- | :--- | :--- |
| **S — Single Responsibility** | `UserService.createUser` does validation, raw `Connection`/`PreparedStatement` JDBC, email sending, and `System.out.println` while throwing `SQLException` | Separate `UserValidator`, `UserRepository`, `EmailService`, and `Logger`; each class owns one failure domain |
| **O — Open-Closed** | `PaymentProcessor` uses `if/else` on `"credit"`, `"paypal"`, `"bitcoin"` — every new method modifies core class | Extract `PaymentMethod` interface; new payment providers implement `process(amount)` without modifying `PaymentProcessor` |
| **L — Liskov Substitution** | Subclass overrides method and throws broader/new checked exception or breaks postconditions | **Java compiler enforces**: overriding method cannot throw broader checked exceptions than base method (may throw narrower, fewer, or unchecked) |
| **I — Interface Segregation** | Bloated interface forces implementers to throw `UnsupportedOperationException` on unused operations | Split into focused client-specific interfaces so implementations never fake unsupported behavior |
| **D — Dependency Inversion** | `OrderService` creates `new DatabaseOrderRepository()` directly | `OrderService` accepts `OrderRepository` via constructor injection (`DatabaseOrderRepository` in prod, `InMemoryOrderRepository` in tests) |

```java
// SRP + OCP + DIP in action
public interface OrderRepository { void save(Order order); }

public class OrderService {
    private final OrderRepository repository; // DIP: depends on abstraction

    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }

    public void placeOrder(Order order) { repository.save(order); }
}

public interface PaymentMethod { void process(double amount); }
public class CreditCardPayment implements PaymentMethod {
    @Override public void process(double amount) { /* Credit card logic */ }
}
public class PayPalPayment implements PaymentMethod {
    @Override public void process(double amount) { /* PayPal logic */ }
}
public class PaymentProcessor {
    public void process(PaymentMethod method, double amount) {
        method.process(amount); // OCP: open for extension, closed for modification
    }
}
```

> [!IMPORTANT]
> **LSP & Java Exception Overriding Rule**
> When overriding a superclass or interface method, you may throw **the same, narrower, or zero** checked exceptions—**never broader or unrelated new checked exceptions**. However, if the superclass method throws no checked exceptions, the subclass override cannot add any checked exceptions (only unchecked `RuntimeException`s).

---

## Clean Code

Clean error handling pairs **flat, readable control flow** with **diagnostics-rich, secret-safe messages** and **explicit `@throws` contracts**.

```mermaid
flowchart LR
    B1["Deeply Nested if-else + Inline Validation + Mixed try-catch"] --> G1["Extract Guard Clauses: Fail Fast on Invalid Inputs"]
    G1 --> M1["Small Single-Purpose Methods: Flat Happy Path"]
    M1 --> D1["Document Exceptions with Javadoc throws Tags"]
    D1 --> S1["Safe Contextual Messages without Secrets or Bare Error Codes"]

    classDef red fill:#fee2e2,stroke:#991b1b,color:#991b1b
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534

    class B1 red
    class G1 amber
    class M1,D1 blue
    class S1 green
```

### Message Hygiene & Javadoc Matrix

```mermaid
flowchart TD
    MSG["Crafting an Exception Message"] --> Q1{"Vague e.g. Error?"}
    Q1 -->|Yes| F1["Fix: Add Expected vs Provided Values"]
    MSG --> Q2{"Contains Password, Token, or Secret?"}
    Q2 -->|Yes| F2["Fix: Strip Secrets - Throw Safe AuthException"]
    MSG --> Q3{"Bare Code e.g. ERR_001 Only?"}
    Q3 -->|Yes| F3["Fix: Pair Code with Human-Readable Diagnostics"]

    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e
    classDef green fill:#dcfce7,stroke:#166534,color:#166534

    class MSG purple
    class Q1,Q2,Q3 amber
    class F1,F2,F3 green
```

- **Guard clauses over nesting**: Validate preconditions at the top of the method and fail fast with specific exceptions instead of nesting business logic inside multi-level `if` pyramids.
- **Specific, human-readable messages**:
  - Bad: `throw new RuntimeException("Error");` or `throw new BusinessException("ERR_001");`
  - Good: `throw new IllegalArgumentException("Email must be valid (provided: " + email + ")");`
  - Good: `throw new BusinessException("Insufficient funds: required " + required + ", available " + available);`
- **Never leak secrets in exceptions (or logs!)**: Never include raw passwords, API keys, or tokens inside `AuthException` messages (exception messages frequently surface in HTTP responses, crash reports, and APM dashboards). Use a safe message like `throw new AuthException("Authentication failed");` and log only non-sensitive identifiers (`username` / `requestId`).
- **Document all thrown exceptions in Javadoc**: Document both checked exceptions and important unchecked exceptions (`@throws`) plus caller guidance (e.g., `@throws DataAccessException if database error (caller should log and retry)`).

```java
/**
 * Transfers money from source to destination account.
 *
 * @param source source account ID
 * @param destination destination account ID
 * @param amount transfer amount (must be positive)
 * @throws InsufficientFundsException if source account doesn't have enough balance
 * @throws AccountNotFoundException if either account doesn't exist
 * @throws TransferException if database error occurs
 */
public void transfer(String source, String destination, double amount)
        throws InsufficientFundsException, AccountNotFoundException, TransferException {
    // Guard clauses: flat, fail-fast entry checks
    if (amount <= 0) throw new IllegalArgumentException("Amount must be positive: " + amount);
    if (source == null || destination == null) throw new IllegalArgumentException("Account IDs required");

    executeTransfer(source, destination, amount);
}
```

> [!WARNING]
> **Security Alert — Never Put Passwords or PII in Exceptions or Logs**
> Even logging raw passwords on failed login (`logger.error("... password: " + password)`) is a severe security vulnerability. Log only the `userId`/`username` and failure reason, and return a generic `AuthException("Authentication failed")`.

---

## Effective Java Items

Joshua Bloch's *Effective Java* connects clean object construction, defensive design, and exception discipline into one cohesive engineering model.

```mermaid
flowchart TD
    EJ["Effective Java High-Yield Taxonomy"]

    OB["Object Design and Safety"]
    EX["Exception Design"]

    I2["Item 2: Builder Pattern (Validate invariants in build)"]
    I17["Item 17: Minimize Mutability (Final fields, thread-safe, failure-atomic)"]
    I18["Item 18: Composition over Inheritance (Forwarding wrappers)"]
    I50["Item 50: Defensive Copies (Copy before validate against TOCTOU)"]

    I72["Item 72: Standard Exceptions (IAE, ISE, NPE, IOB, CME, UOE)"]
    I73["Item 73: Abstraction Translation (Wrap cause at layer boundary)"]
    I75["Item 75: Failure-Capture Info (Include bounds and values)"]

    EJ --> OB
    EJ --> EX
    OB --> I2
    OB --> I17
    OB --> I18
    OB --> I50
    EX --> I72
    EX --> I73
    EX --> I75

    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534
    classDef amber fill:#fef3c7,stroke:#92400e,color:#92400e

    class EJ purple
    class OB,EX blue
    class I2,I17,I18,I50 green
    class I72,I73,I75 amber
```

### Core Effective Java Reference Matrix

| Item | Principle | Concrete Rule & Example |
| :--- | :--- | :--- |
| **Item 2** | **Builder Pattern** | Use a Builder when constructors have many/optional parameters; validate parameter invariants inside `build()` and throw `IllegalStateException`/`IllegalArgumentException` |
| **Item 17** | **Minimize Mutability** | Prefer immutable classes (`final` class/fields, no setters, copy mutable components) for thread safety and free **failure atomicity** (Item 76) |
| **Item 18** | **Composition over Inheritance** | Prefer wrapping with forwarding classes over `extends` across packages; inheritance breaks encapsulation when superclass internals change |
| **Item 50** | **Defensive Copies** | Copy mutable constructor inputs (`new Date(start.getTime())`) **before** validating them (prevents TOCTOU race attacks), and return copies from getters |
| **Item 72** | **Standard Exceptions** | Reuse JDK exceptions instead of inventing `DivideByZeroException` (see list below) |
| **Item 73** | **Throw Exceptions Appropriate to Abstraction** | Catch low-level `SQLException` in DAO and translate to `DataAccessException("Failed to load user: " + id, e)` |
| **Item 75** | **Failure-Capture Information** | Include every relevant parameter and boundary in messages: `"Index " + index + " out of bounds for array length " + array.length`, `"Port must be between 1-65535, got: " + port`, `"Insufficient funds: required %.2f, available %.2f"` |

### Standard Exceptions Cheat Sheet (Item 72)

- `IllegalArgumentException`: Non-null parameter value is invalid (e.g., divisor `0`, negative age).
- `IllegalStateException`: Object is in the wrong state for the requested method (e.g., calling `query()` on a closed connection).
- `NullPointerException`: Required parameter is `null` (`Objects.requireNonNull(arg, "arg must not be null")`).
- `IndexOutOfBoundsException`: Index parameter is out of bounds (`index < 0 || index >= size`).
- `ConcurrentModificationException`: Concurrent structural mutation detected during fail-fast iteration.
- `UnsupportedOperationException`: Object does not support the requested operation (e.g., `List.of(...).add(...)`).

```java
// Item 73 + Item 75: Abstraction translation + rich failure-capture message
public User getUser(int id) {
    try {
        return queryDatabase(id);
    } catch (SQLException e) {
        throw new DataAccessException("Failed to load user id=" + id, e);
    }
}

public void setPort(int port) {
    if (port < 1 || port > 65535) {
        throw new InvalidConfigException("Port must be between 1-65535, got: " + port);
    }
}
```

> [!IMPORTANT]
> **TOCTOU Gotcha (Item 50)**
> Always make defensive copies of mutable arguments **before** validating invariants—never after. Otherwise a malicious or concurrent caller thread can mutate the input object in the microsecond window between validation and field assignment.

---

## Interview Questions

Use this quick-revision decision tree before walking through the high-yield interview matrix.

```mermaid
flowchart TD
    IQ["Interview Scenario"] --> R1{"Managing AutoCloseable Resource?"}
    R1 -->|Yes| A1["Use try-with-resources: reverse close + suppressed preserved"]
    R1 -->|No| R2{"Exception in Overridden Method?"}
    R2 -->|Yes| A2["Same, narrower, or zero checked exceptions only (LSP)"]
    R2 -->|No| R3{"Hot Loop or Control Flow?"}
    R3 -->|Yes| A3["Return boolean/Optional; avoid fillInStackTrace() cost"]
    R3 -->|No| R4{"Crossing Layer Boundary?"}
    R4 -->|Yes| A4["Translate to Domain Exception with cause; log once at top"]
    R4 -->|No| A5["Checked if caller recovers; Unchecked if bug/invariant"]

    classDef purple fill:#f3e8ff,stroke:#6b21a8,color:#6b21a8
    classDef blue fill:#dbeafe,stroke:#1e40af,color:#1e40af
    classDef green fill:#dcfce7,stroke:#166534,color:#166534

    class IQ purple
    class R1,R2,R3,R4 blue
    class A1,A2,A3,A4,A5 green
```

### High-Yield Q&A Summary Matrix

| # | Question | Core Interview Answer |
| :--- | :--- | :--- |
| **Q1** | **Checked vs Unchecked exceptions?** | Checked: compile-time enforced (`IOException`, `SQLException`); use when caller can recover. Unchecked: `RuntimeException` subclasses (`NPE`, `IAE`); indicate bugs or contract violations. |
| **Q2** | **When to use `try-with-resources`?** | Always for `AutoCloseable` resources (streams, connections, readers). Closes in reverse order even on exception and preserves close errors as suppressed exceptions. |
| **Q3** | **How to design domain exception hierarchies?** | Create an abstract `ApplicationException extends RuntimeException` with `(message)` and `(message, cause)` constructors, then extend per domain (`UserServiceException`, `PaymentException`). |
| **Q4** | **Why are exceptions slow & what is `OmitStackTraceInFastThrow`?** | `new Throwable()` invokes native `fillInStackTrace()` to walk stack frames (~1000x slower than normal code). HotSpot caches stackless instances of hot built-in exceptions after threshold hits. |
| **Q5** | **What happens if `try` and `finally` both throw?** | In `try-finally`, the `finally` exception **masks** the `try` exception. In `try-with-resources`, the `try` exception propagates and `close()` exceptions are attached via `getSuppressed()`. |
| **Q6** | **What are Java's exception overriding rules?** | An overriding method cannot throw broader or new checked exceptions than the superclass method (may throw narrower, fewer, or none; any unchecked exception is allowed by compiler). |
| **Q7** | **What is `return` inside a `finally` block trap?** | Returning from `finally` silently suppresses any exception thrown in `try` or `catch` and overrides their return value—never `return` inside `finally`. |
| **Q8** | **How should exceptions cross service/API boundaries?** | Translate low-level `SQLException` into domain exceptions (`OrderProcessingException`) preserving `cause`, log once at `@RestControllerAdvice`, and return sanitized `ProblemDetail`. |

### Detailed Core Answers (Q1–Q3)

#### Q1: What's the difference between checked and unchecked exceptions?
- **Checked (`Exception` subclasses excluding `RuntimeException`)**: Must be caught or declared in `throws`; compiler enforces handling. Examples: `IOException`, `SQLException`. Use only when caller can reasonably recover.
- **Unchecked (`RuntimeException` and `Error` subclasses)**: Not enforced at compile time. `RuntimeException` examples (`NullPointerException`, `IllegalArgumentException`) signal programming errors or failed validation.

#### Q2: When should you use `try-with-resources`?
- **Always** for any `AutoCloseable` resource (streams, JDBC connections, sockets, readers/writers). It guarantees reverse-order `close()`, eliminates verbose `try-finally` null checks, and preserves cleanup exceptions via `getSuppressed()`.

#### Q3: How should you design exception hierarchies?
```java
// Base domain exception allows catch (ApplicationException e) at boundaries
public abstract class ApplicationException extends RuntimeException {
    public ApplicationException(String message) {
        super(message);
    }

    public ApplicationException(String message, Throwable cause) {
        super(message, cause);
    }
}

// Specific domain subclasses preserve granular catch capability
public class UserServiceException extends ApplicationException {
    public UserServiceException(String message, Throwable cause) { super(message, cause); }
}

public class PaymentException extends ApplicationException {
    public PaymentException(String message, Throwable cause) { super(message, cause); }
}
```

> [!IMPORTANT]
> **30-Second Final Interview Checklist**
> Never swallow exceptions silently, never `return` inside `finally`, never log-and-rethrow at every layer, never use exceptions for hot-loop control flow, and always preserve the original `Throwable cause` when translating across architectural boundaries.

---

**Key Takeaway Summary:**

1. **Hierarchy:** `Error` (don't catch), Checked (must catch or declare), Unchecked (indicates bugs or invalid state).
2. **Design:** Throw specific exceptions. Catch specific exceptions. Translate to the caller's abstraction level.
3. **Try-With-Resources:** Always use for `AutoCloseable`—reverse-order closing and `getSuppressed()` preservation.
4. **Best Practices:** Fail fast. Include failure-capture context (without secrets). Preserve cause chains. Never hide errors behind `null`.
5. **Performance:** Exceptions are ~1000x slower due to `fillInStackTrace()`. Never use for normal control flow.
6. **Standards:** Reuse standard JDK exceptions (Item 72); build domain hierarchies only for domain semantics.
