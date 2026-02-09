# Creational Design Patterns: In-Depth Guide for FAANG Interviews

## Overview
Creational patterns focus on object creation mechanisms. They abstract the instantiation process to make systems more independent of how objects are created, composed, and represented. For FAANG companies, understanding creational patterns is crucial as they form the backbone of frameworks like Spring and design decisions in microservices.

---

## 1. Singleton Pattern

### Intent
Ensure a class has only one instance and provide a global point of access to it.

### Problem It Solves
- Multiple instances create resource waste (e.g., database connections)
- Inconsistent state across the application
- Coordinating access to shared resources
- Logging systems, configuration managers, thread pools

### Text-Based UML
```
┌──────────────────────┐
│     Singleton        │
├──────────────────────┤
│ - instance: static   │
│ - Singleton()        │
├──────────────────────┤
│ + getInstance()      │
└──────────────────────┘
```

### 1.1 Eager Initialization (Thread-Safe but Wasteful)

```java
public class EagerSingleton {
    // Instance created at class loading time
    private static final EagerSingleton instance = new EagerSingleton();

    private EagerSingleton() {
        // Prevent instantiation
        if (instance != null) {
            throw new IllegalStateException("Singleton already initialized");
        }
    }

    public static EagerSingleton getInstance() {
        return instance;
    }
}

// Usage
public class Main {
    public static void main(String[] args) {
        EagerSingleton singleton1 = EagerSingleton.getInstance();
        EagerSingleton singleton2 = EagerSingleton.getInstance();
        System.out.println(singleton1 == singleton2); // true
    }
}
```

**Pros:**
- Thread-safe by nature (class loader guarantees)
- Simple and straightforward

**Cons:**
- Instance created even if never used (wastes memory)
- Difficult to control initialization parameters
- Cannot delay initialization

---

### 1.2 Lazy Initialization with Synchronization (Simple but Slow)

```java
public class LazySingleton {
    private static LazySingleton instance;

    private LazySingleton() {
    }

    // Synchronized method - thread-safe but performance bottleneck
    public synchronized static LazySingleton getInstance() {
        if (instance == null) {
            instance = new LazySingleton();
        }
        return instance;
    }
}

// Performance Issue Demo
public class PerformanceTest {
    public static void main(String[] args) throws InterruptedException {
        long start = System.currentTimeMillis();

        // Simulating 1000 concurrent requests
        for (int i = 0; i < 1000; i++) {
            new Thread(() -> {
                LazySingleton.getInstance(); // Synchronized call - bottleneck
            }).start();
        }

        Thread.sleep(2000);
        long end = System.currentTimeMillis();
        System.out.println("Time: " + (end - start) + "ms");
    }
}
```

**Pros:**
- Thread-safe
- Lazy initialization (created only when needed)

**Cons:**
- Severe performance penalty due to synchronization
- Every getInstance() call is synchronized
- Not suitable for high-concurrency scenarios

---

### 1.3 Double-Checked Locking (Good Performance + Thread Safety)

```java
public class DoubleCheckedLockingSingleton {
    private static volatile DoubleCheckedLockingSingleton instance;

    private DoubleCheckedLockingSingleton() {
    }

    public static DoubleCheckedLockingSingleton getInstance() {
        // First check without synchronization
        if (instance == null) {
            synchronized (DoubleCheckedLockingSingleton.class) {
                // Second check inside synchronized block
                if (instance == null) {
                    instance = new DoubleCheckedLockingSingleton();
                }
            }
        }
        return instance;
    }
}

// Demonstrating why volatile is critical
public class VolatileDemo {
    public static void main(String[] args) throws InterruptedException {
        // Without volatile: other threads might see a partially constructed object
        // due to memory visibility issues and CPU caching

        // volatile ensures:
        // 1. Memory barrier - changes are visible to all threads
        // 2. Prevents instruction reordering
        // 3. Disables CPU cache optimization for this variable

        Thread t1 = new Thread(() -> {
            for (int i = 0; i < 10000; i++) {
                DoubleCheckedLockingSingleton.getInstance();
            }
        });

        t1.start();
        t1.join();
        System.out.println("Singleton accessed safely");
    }
}
```

**Key Points about `volatile`:**
- Guarantees memory visibility across threads
- Prevents compiler optimizations that could cause issues
- Ensures happens-before relationship

**Pros:**
- Lazy initialization
- Thread-safe
- Good performance after first initialization

**Cons:**
- Complex to understand and implement correctly
- Easy to make mistakes (forgetting volatile)
- Still has overhead for the first check

---

### 1.4 Bill Pugh Singleton (Class Loader Pattern - RECOMMENDED)

```java
public class BillPughSingleton {

    private BillPughSingleton() {
    }

    // Static inner helper class
    private static class SingletonHelper {
        // Class loader loads this class only when needed
        // Thread-safe and lazy without synchronization overhead
        private static final BillPughSingleton INSTANCE = new BillPughSingleton();
    }

    public static BillPughSingleton getInstance() {
        return SingletonHelper.INSTANCE;
    }
}

// Why this works:
// 1. Inner class is not loaded until getInstance() is called
// 2. Class loader synchronizes class loading (thread-safe by JVM)
// 3. No explicit synchronization needed
// 4. No performance penalty

public class BillPughDemo {
    public static void main(String[] args) throws InterruptedException {
        long start = System.currentTimeMillis();

        for (int i = 0; i < 1000; i++) {
            new Thread(() -> {
                BillPughSingleton.getInstance(); // Class loader handles synchronization
            }).start();
        }

        Thread.sleep(2000);
        long end = System.currentTimeMillis();
        System.out.println("Time: " + (end - start) + "ms"); // Much faster than synchronized
    }
}
```

**Why This is Superior:**
- Thread-safe without explicit synchronization
- Lazy initialization without performance penalty
- Simple and elegant
- Preferred by Java experts (used in Spring, Hibernate, etc.)

---

### 1.5 Enum-Based Singleton (Most Bulletproof)

```java
public enum EnumSingleton {
    INSTANCE;

    private String data;

    EnumSingleton() {
        this.data = "Enum Singleton";
    }

    public String getData() {
        return data;
    }

    public void setData(String data) {
        this.data = data;
    }
}

// Usage
public class EnumSingletonDemo {
    public static void main(String[] args) throws IOException, ClassNotFoundException {
        EnumSingleton singleton1 = EnumSingleton.INSTANCE;
        EnumSingleton singleton2 = EnumSingleton.INSTANCE;

        System.out.println(singleton1 == singleton2); // true
        System.out.println(singleton1.getData()); // "Enum Singleton"

        // Even serialization/deserialization preserves singleton property
        testSerializationAttack();
    }

    // Serialization Attack (PREVENTED by Enum)
    private static void testSerializationAttack() throws IOException, ClassNotFoundException {
        EnumSingleton singleton1 = EnumSingleton.INSTANCE;

        // Serialize
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ObjectOutputStream oos = new ObjectOutputStream(baos);
        oos.writeObject(singleton1);

        // Deserialize
        ByteArrayInputStream bais = new ByteArrayInputStream(baos.toByteArray());
        ObjectInputStream ois = new ObjectInputStream(bais);
        EnumSingleton singleton2 = (EnumSingleton) ois.readObject();

        System.out.println(singleton1 == singleton2); // true - still same instance!
    }
}
```

**Why Enums are the Best Choice:**
1. **Serialization-safe**: Enum provides readResolve() automatically
2. **Reflection-proof**: Reflection cannot create enum instances
3. **Thread-safe**: Guaranteed by JVM
4. **Lazy loading**: Enums are loaded when first accessed
5. **Immutable**: Field values cannot be modified

---

### 1.6 Breaking Singleton - Common Attacks and Prevention

#### Attack 1: Reflection

```java
public class ReflectionAttack {
    public static void main(String[] args) throws Exception {
        BillPughSingleton singleton1 = BillPughSingleton.getInstance();

        // Attack: Use reflection to invoke private constructor
        Constructor<BillPughSingleton> constructor = BillPughSingleton.class.getDeclaredConstructor();
        constructor.setAccessible(true);
        BillPughSingleton singleton2 = constructor.newInstance();

        System.out.println(singleton1 == singleton2); // false - Broken!
    }
}

// Prevention: Add check in constructor
public class SafeBillPughSingleton {
    private static boolean instanceCreated = false;

    private SafeBillPughSingleton() {
        if (instanceCreated) {
            throw new IllegalStateException("Singleton already created");
        }
        instanceCreated = true;
    }

    private static class SingletonHelper {
        private static final SafeBillPughSingleton INSTANCE = new SafeBillPughSingleton();
    }

    public static SafeBillPughSingleton getInstance() {
        return SingletonHelper.INSTANCE;
    }
}
```

#### Attack 2: Serialization

```java
public class SerializationAttack {
    public static void main(String[] args) throws Exception {
        BillPughSingleton singleton1 = BillPughSingleton.getInstance();

        // Serialize
        FileOutputStream fos = new FileOutputStream("singleton.ser");
        ObjectOutputStream oos = new ObjectOutputStream(fos);
        oos.writeObject(singleton1);
        oos.close();

        // Deserialize
        FileInputStream fis = new FileInputStream("singleton.ser");
        ObjectInputStream ois = new ObjectInputStream(fis);
        BillPughSingleton singleton2 = (BillPughSingleton) ois.readObject();
        ois.close();

        System.out.println(singleton1 == singleton2); // false - Broken!
    }
}

// Prevention: Override readResolve method
public class SerializableSafeSingleton implements Serializable {
    private static final long serialVersionUID = 1L;

    private SerializableSafeSingleton() {
    }

    private static class SingletonHelper {
        private static final SerializableSafeSingleton INSTANCE = new SerializableSafeSingleton();
    }

    public static SerializableSafeSingleton getInstance() {
        return SingletonHelper.INSTANCE;
    }

    // This method is called during deserialization
    protected Object readResolve() {
        return getInstance(); // Return the singleton instance
    }
}
```

#### Attack 3: Cloning

```java
public class CloningAttack {
    public static void main(String[] args) throws CloneNotSupportedException {
        CloneableSingleton singleton1 = CloneableSingleton.getInstance();
        CloneableSingleton singleton2 = (CloneableSingleton) singleton1.clone();

        System.out.println(singleton1 == singleton2); // false - Broken!
    }
}

// Prevention: Prevent cloning
public class CloneableSingleton implements Cloneable {
    private CloneableSingleton() {
    }

    private static class SingletonHelper {
        private static final CloneableSingleton INSTANCE = new CloneableSingleton();
    }

    public static CloneableSingleton getInstance() {
        return SingletonHelper.INSTANCE;
    }

    @Override
    public Object clone() throws CloneNotSupportedException {
        throw new CloneNotSupportedException("Singleton cloning not allowed");
    }
}
```

---

### Real-World Examples

#### Logger (Spring Framework)
```java
// Spring's LoggerFactory uses singleton pattern
public class ApplicationLogger {
    private static final Logger logger = LoggerFactory.getLogger(ApplicationLogger.class);

    private ApplicationLogger() {
    }

    public static Logger getLogger() {
        return logger;
    }
}
```

#### Connection Pool
```java
public class DatabaseConnectionPool {
    private static final int POOL_SIZE = 10;
    private Queue<Connection> availableConnections;
    private Set<Connection> allConnections;

    private DatabaseConnectionPool() {
        availableConnections = new LinkedList<>();
        allConnections = new HashSet<>();
        initializePool();
    }

    private static class PoolHelper {
        private static final DatabaseConnectionPool INSTANCE = new DatabaseConnectionPool();
    }

    public static DatabaseConnectionPool getInstance() {
        return PoolHelper.INSTANCE;
    }

    private void initializePool() {
        for (int i = 0; i < POOL_SIZE; i++) {
            try {
                Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/db");
                availableConnections.add(conn);
                allConnections.add(conn);
            } catch (SQLException e) {
                e.printStackTrace();
            }
        }
    }

    public synchronized Connection getConnection() throws InterruptedException {
        while (availableConnections.isEmpty()) {
            wait();
        }
        Connection conn = availableConnections.poll();
        return conn;
    }

    public synchronized void releaseConnection(Connection conn) {
        availableConnections.add(conn);
        notifyAll();
    }
}
```

### When to Use
- Database connection pools
- Logging systems
- Cache managers
- Configuration managers
- Thread pools
- Event bus/message broker

### When NOT to Use
- Testability issues (hard to mock)
- Tight coupling (increases dependencies)
- When multiple instances are needed
- In multi-module applications with complex initialization
- When scalability requires distributed instances

### Interview Questions

**Q1: Why is `volatile` necessary in Double-Checked Locking?**
A: Without volatile, due to CPU caching and instruction reordering, one thread might see a partially initialized instance while another thread is initializing it. The volatile keyword ensures memory visibility and prevents reordering.

**Q2: What are the advantages of enum-based Singleton over Bill Pugh?**
A: Enums are automatically serialization-safe, reflection-proof, and immutable. They handle all edge cases without additional code. Bill Pugh requires additional preventive measures.

**Q3: Can you break a Singleton using reflection, and how do you prevent it?**
A: Yes, by accessing the private constructor and invoking it. Prevention: Add a flag check in the constructor to throw an exception if already instantiated.

**Q4: How does Spring handle Singleton scope?**
A: Spring uses a Singleton registry pattern where beans are created once and cached in a container. Each request retrieves the same instance from the registry.

**Q5: Explain the difference between Eager and Lazy initialization with trade-offs.**
A: Eager loads the instance at startup (simple, thread-safe, but wastes memory), while Lazy loads only when needed (saves memory, but adds initialization overhead).

---

## 2. Factory Method Pattern

### Intent
Define an interface for creating an object, but let subclasses decide which class to instantiate.

### Problem It Solves
- Decouples object creation from usage
- Centralized object creation logic
- Easy to add new types without modifying existing code
- Reduces tight coupling

### Text-Based UML
```
┌──────────────────┐
│    Creator       │
├──────────────────┤
│ + factoryMethod()│
│ + operation()    │
└────────┬─────────┘
         │
    ┌────┴─────┬─────────┐
    │           │         │
┌───▼──┐   ┌───▼──┐  ┌──▼───┐
│ConcreteA│ │ConcreteB│ │ConcreteC│
└────────┘ └────────┘ └───────┘
```

### Implementation with Interface

```java
// Product interface
public interface DatabaseConnection {
    void connect();
    void executeQuery(String query);
    void disconnect();
}

// Concrete Products
public class MySQLConnection implements DatabaseConnection {
    @Override
    public void connect() {
        System.out.println("Connecting to MySQL database...");
    }

    @Override
    public void executeQuery(String query) {
        System.out.println("Executing MySQL query: " + query);
    }

    @Override
    public void disconnect() {
        System.out.println("Disconnecting from MySQL");
    }
}

public class PostgreSQLConnection implements DatabaseConnection {
    @Override
    public void connect() {
        System.out.println("Connecting to PostgreSQL database...");
    }

    @Override
    public void executeQuery(String query) {
        System.out.println("Executing PostgreSQL query: " + query);
    }

    @Override
    public void disconnect() {
        System.out.println("Disconnecting from PostgreSQL");
    }
}

public class MongoDBConnection implements DatabaseConnection {
    @Override
    public void connect() {
        System.out.println("Connecting to MongoDB...");
    }

    @Override
    public void executeQuery(String query) {
        System.out.println("Executing MongoDB query: " + query);
    }

    @Override
    public void disconnect() {
        System.out.println("Disconnecting from MongoDB");
    }
}

// Creator/Factory interface
public abstract class ConnectionFactory {
    public abstract DatabaseConnection createConnection();

    // Template method
    public void performDatabaseOperation(String query) {
        DatabaseConnection connection = createConnection();
        connection.connect();
        connection.executeQuery(query);
        connection.disconnect();
    }
}

// Concrete Factories
public class MySQLConnectionFactory extends ConnectionFactory {
    @Override
    public DatabaseConnection createConnection() {
        return new MySQLConnection();
    }
}

public class PostgreSQLConnectionFactory extends ConnectionFactory {
    @Override
    public DatabaseConnection createConnection() {
        return new PostgreSQLConnection();
    }
}

public class MongoDBConnectionFactory extends ConnectionFactory {
    @Override
    public DatabaseConnection createConnection() {
        return new MongoDBConnection();
    }
}

// Usage
public class FactoryMethodDemo {
    public static void main(String[] args) {
        // Without knowing concrete classes
        ConnectionFactory factory = getConnectionFactory("mysql");
        factory.performDatabaseOperation("SELECT * FROM users");

        factory = getConnectionFactory("postgresql");
        factory.performDatabaseOperation("SELECT * FROM products");

        factory = getConnectionFactory("mongodb");
        factory.performDatabaseOperation("db.users.find()");
    }

    private static ConnectionFactory getConnectionFactory(String type) {
        return switch (type.toLowerCase()) {
            case "mysql" -> new MySQLConnectionFactory();
            case "postgresql" -> new PostgreSQLConnectionFactory();
            case "mongodb" -> new MongoDBConnectionFactory();
            default -> throw new IllegalArgumentException("Unknown database type: " + type);
        };
    }
}
```

### Spring's BeanFactory Analogy

```java
// Spring uses Factory Method pattern extensively
public class SpringFactoryMethodDemo {

    @Configuration
    public static class AppConfig {

        // Bean factory method
        @Bean
        public DatabaseConnection mysqlConnection() {
            return new MySQLConnection();
        }

        @Bean
        public DatabaseConnection postgresConnection() {
            return new PostgreSQLConnection();
        }

        @Bean
        @Primary // Default factory method
        public ConnectionFactory connectionFactory() {
            return new MySQLConnectionFactory();
        }
    }

    public static void main(String[] args) {
        ApplicationContext context = new AnnotationConfigApplicationContext(AppConfig.class);

        // Spring's ApplicationContext acts as a factory
        DatabaseConnection connection = context.getBean("mysqlConnection", DatabaseConnection.class);
        connection.connect();
    }
}
```

### Real-World Example: Payment Processing

```java
public interface PaymentProcessor {
    void processPayment(double amount);
    boolean validatePayment();
}

public class CreditCardProcessor implements PaymentProcessor {
    private String cardNumber;

    public CreditCardProcessor(String cardNumber) {
        this.cardNumber = cardNumber;
    }

    @Override
    public void processPayment(double amount) {
        System.out.println("Processing credit card payment: $" + amount);
    }

    @Override
    public boolean validatePayment() {
        return cardNumber.length() == 16;
    }
}

public class PayPalProcessor implements PaymentProcessor {
    private String email;

    public PayPalProcessor(String email) {
        this.email = email;
    }

    @Override
    public void processPayment(double amount) {
        System.out.println("Processing PayPal payment: $" + amount + " from " + email);
    }

    @Override
    public boolean validatePayment() {
        return email.contains("@");
    }
}

// Factory
public abstract class PaymentProcessorFactory {
    public abstract PaymentProcessor createProcessor(String... args);

    public final boolean processPaymentSafely(double amount, String... args) {
        PaymentProcessor processor = createProcessor(args);
        if (processor.validatePayment()) {
            processor.processPayment(amount);
            return true;
        }
        System.out.println("Payment validation failed");
        return false;
    }
}

public class CreditCardProcessorFactory extends PaymentProcessorFactory {
    @Override
    public PaymentProcessor createProcessor(String... args) {
        return new CreditCardProcessor(args[0]);
    }
}

public class PayPalProcessorFactory extends PaymentProcessorFactory {
    @Override
    public PaymentProcessor createProcessor(String... args) {
        return new PayPalProcessor(args[0]);
    }
}
```

### When to Use
- Creating objects whose exact types are determined at runtime
- Decoupling client code from specific classes
- Adding new product types without modifying existing code
- Centralizing object creation logic

### When NOT to Use
- Simple objects that don't require complex creation logic
- When there's only one implementation
- When using dependency injection containers (Spring, Guice)

### Interview Question

**Q: Explain the difference between Factory Method and Abstract Factory.**
A: Factory Method creates a single product, while Abstract Factory creates families of related products. Factory Method is about how to create an object, Abstract Factory is about families of related objects.

---

## 3. Abstract Factory Pattern

### Intent
Provide an interface for creating families of related or dependent objects without specifying their concrete classes.

### Text-Based UML
```
┌─────────────────┐
│AbstractFactory  │
├─────────────────┤
│+createProductA()│
│+createProductB()│
└────────┬────────┘
         │
    ┌────┴─────┬──────────┐
    │           │          │
  ConcreteFactory1    ConcreteFactory2
```

### Complete Example: UI Theme System

```java
// Abstract Products
public interface Button {
    void render();
}

public interface Checkbox {
    void render();
}

public interface TextBox {
    void render();
}

// Concrete Products - Light Theme
public class LightButton implements Button {
    @Override
    public void render() {
        System.out.println("Rendering Light Button (white background)");
    }
}

public class LightCheckbox implements Checkbox {
    @Override
    public void render() {
        System.out.println("Rendering Light Checkbox (light colors)");
    }
}

public class LightTextBox implements TextBox {
    @Override
    public void render() {
        System.out.println("Rendering Light TextBox (black text on white)");
    }
}

// Concrete Products - Dark Theme
public class DarkButton implements Button {
    @Override
    public void render() {
        System.out.println("Rendering Dark Button (dark background)");
    }
}

public class DarkCheckbox implements Checkbox {
    @Override
    public void render() {
        System.out.println("Rendering Dark Checkbox (dark colors)");
    }
}

public class DarkTextBox implements TextBox {
    @Override
    public void render() {
        System.out.println("Rendering Dark TextBox (white text on dark)");
    }
}

// Abstract Factory
public interface UIFactory {
    Button createButton();
    Checkbox createCheckbox();
    TextBox createTextBox();
}

// Concrete Factories
public class LightThemeFactory implements UIFactory {
    @Override
    public Button createButton() {
        return new LightButton();
    }

    @Override
    public Checkbox createCheckbox() {
        return new LightCheckbox();
    }

    @Override
    public TextBox createTextBox() {
        return new LightTextBox();
    }
}

public class DarkThemeFactory implements UIFactory {
    @Override
    public Button createButton() {
        return new DarkButton();
    }

    @Override
    public Checkbox createCheckbox() {
        return new DarkCheckbox();
    }

    @Override
    public TextBox createTextBox() {
        return new DarkTextBox();
    }
}

// Client Code
public class UIApplication {
    private Button button;
    private Checkbox checkbox;
    private TextBox textBox;

    public UIApplication(UIFactory factory) {
        this.button = factory.createButton();
        this.checkbox = factory.createCheckbox();
        this.textBox = factory.createTextBox();
    }

    public void render() {
        button.render();
        checkbox.render();
        textBox.render();
    }
}

// Usage
public class AbstractFactoryDemo {
    public static void main(String[] args) {
        // Light Theme
        UIFactory lightFactory = new LightThemeFactory();
        UIApplication lightApp = new UIApplication(lightFactory);
        lightApp.render();

        System.out.println("---");

        // Dark Theme
        UIFactory darkFactory = new DarkThemeFactory();
        UIApplication darkApp = new UIApplication(darkFactory);
        darkApp.render();
    }
}
```

### Real-World Example: Cross-Platform UI

```java
// Abstract products for different OS
public interface Dialog {
    void show();
}

public interface FileChooser {
    void browse();
}

// Windows implementations
public class WindowsDialog implements Dialog {
    @Override
    public void show() {
        System.out.println("Showing Windows-style dialog");
    }
}

public class WindowsFileChooser implements FileChooser {
    @Override
    public void browse() {
        System.out.println("Opening Windows file explorer");
    }
}

// Mac implementations
public class MacDialog implements Dialog {
    @Override
    public void show() {
        System.out.println("Showing Mac-style dialog");
    }
}

public class MacFileChooser implements FileChooser {
    @Override
    public void browse() {
        System.out.println("Opening Mac file browser");
    }
}

// Abstract factory
public interface OSFactory {
    Dialog createDialog();
    FileChooser createFileChooser();
}

// Factories
public class WindowsFactory implements OSFactory {
    @Override
    public Dialog createDialog() {
        return new WindowsDialog();
    }

    @Override
    public FileChooser createFileChooser() {
        return new WindowsFileChooser();
    }
}

public class MacFactory implements OSFactory {
    @Override
    public Dialog createDialog() {
        return new MacDialog();
    }

    @Override
    public FileChooser createFileChooser() {
        return new MacFileChooser();
    }
}

// Usage
public class CrossPlatformApp {
    public static void main(String[] args) {
        String os = System.getProperty("os.name").toLowerCase();
        OSFactory factory = os.contains("win") ? new WindowsFactory() : new MacFactory();

        Dialog dialog = factory.createDialog();
        FileChooser fileChooser = factory.createFileChooser();

        dialog.show();
        fileChooser.browse();
    }
}
```

### When to Use
- Systems supporting multiple families of related products
- Preventing creation of incompatible product families
- Cross-platform UI rendering
- Database abstraction layers

### When NOT to Use
- When there's only one product family
- When new families are added frequently
- When product creation is simple

---

## 4. Builder Pattern

### Intent
Separate the construction of a complex object from its representation, allowing the same construction process to create different representations.

### Problem: Telescoping Constructor Problem

```java
// Anti-pattern: Telescoping Constructor
public class PersonBad {
    private String firstName;
    private String lastName;
    private int age;
    private String email;
    private String phone;
    private String address;
    private String city;
    private String state;
    private String zipCode;

    // Nightmare of constructors!
    public PersonBad(String firstName, String lastName) {
        this.firstName = firstName;
        this.lastName = lastName;
    }

    public PersonBad(String firstName, String lastName, int age) {
        this(firstName, lastName);
        this.age = age;
    }

    public PersonBad(String firstName, String lastName, int age, String email) {
        this(firstName, lastName, age);
        this.email = email;
    }

    public PersonBad(String firstName, String lastName, int age, String email, String phone) {
        this(firstName, lastName, age, email);
        this.phone = phone;
    }

    // And more constructors...

    public PersonBad(String firstName, String lastName, int age, String email, String phone,
                     String address, String city, String state, String zipCode) {
        this.firstName = firstName;
        this.lastName = lastName;
        this.age = age;
        this.email = email;
        this.phone = phone;
        this.address = address;
        this.city = city;
        this.state = state;
        this.zipCode = zipCode;
    }
}

// Confusing usage
PersonBad person = new PersonBad("John", "Doe", 30, "john@example.com", "123-456-7890", "123 Main St", "NYC", "NY", "10001");
```

### Builder Pattern Solution

```java
public class Person {
    private String firstName;
    private String lastName;
    private int age;
    private String email;
    private String phone;
    private String address;
    private String city;
    private String state;
    private String zipCode;

    // Immutable object - constructor is private
    private Person(PersonBuilder builder) {
        this.firstName = builder.firstName;
        this.lastName = builder.lastName;
        this.age = builder.age;
        this.email = builder.email;
        this.phone = builder.phone;
        this.address = builder.address;
        this.city = builder.city;
        this.state = builder.state;
        this.zipCode = builder.zipCode;
    }

    // Builder inner class
    public static class PersonBuilder {
        private String firstName;
        private String lastName;
        private int age;
        private String email;
        private String phone;
        private String address;
        private String city;
        private String state;
        private String zipCode;

        public PersonBuilder(String firstName, String lastName) {
            this.firstName = firstName;
            this.lastName = lastName;
        }

        public PersonBuilder age(int age) {
            this.age = age;
            return this; // Fluent API
        }

        public PersonBuilder email(String email) {
            this.email = email;
            return this;
        }

        public PersonBuilder phone(String phone) {
            this.phone = phone;
            return this;
        }

        public PersonBuilder address(String address) {
            this.address = address;
            return this;
        }

        public PersonBuilder city(String city) {
            this.city = city;
            return this;
        }

        public PersonBuilder state(String state) {
            this.state = state;
            return this;
        }

        public PersonBuilder zipCode(String zipCode) {
            this.zipCode = zipCode;
            return this;
        }

        // Build method returns the final object
        public Person build() {
            return new Person(this);
        }
    }

    @Override
    public String toString() {
        return "Person{" +
                "firstName='" + firstName + '\'' +
                ", lastName='" + lastName + '\'' +
                ", age=" + age +
                ", email='" + email + '\'' +
                ", phone='" + phone + '\'' +
                ", address='" + address + '\'' +
                ", city='" + city + '\'' +
                ", state='" + state + '\'' +
                ", zipCode='" + zipCode + '\'' +
                '}';
    }
}

// Beautiful, readable usage
public class BuilderPatternDemo {
    public static void main(String[] args) {
        Person person = new Person.PersonBuilder("John", "Doe")
                .age(30)
                .email("john@example.com")
                .phone("123-456-7890")
                .address("123 Main St")
                .city("NYC")
                .state("NY")
                .zipCode("10001")
                .build();

        System.out.println(person);
    }
}
```

### Lombok's @Builder Annotation

```java
@Data
@Builder
public class PersonLombok {
    private String firstName;
    private String lastName;
    private int age;
    private String email;
    private String phone;
    private String address;
    private String city;
    private String state;
    private String zipCode;
}

// Usage - Lombok generates builder automatically
public class LombokBuilderDemo {
    public static void main(String[] args) {
        PersonLombok person = PersonLombok.builder()
                .firstName("John")
                .lastName("Doe")
                .age(30)
                .email("john@example.com")
                .phone("123-456-7890")
                .address("123 Main St")
                .city("NYC")
                .state("NY")
                .zipCode("10001")
                .build();

        System.out.println(person);
    }
}
```

### Real-World Example: SQL Query Builder

```java
public class SQLQueryBuilder {
    private String selectClause = "";
    private String fromClause = "";
    private String whereClause = "";
    private String orderByClause = "";
    private int limitValue = -1;

    public SQLQueryBuilder select(String... columns) {
        this.selectClause = "SELECT " + String.join(", ", columns);
        return this;
    }

    public SQLQueryBuilder from(String table) {
        this.fromClause = " FROM " + table;
        return this;
    }

    public SQLQueryBuilder where(String condition) {
        this.whereClause = " WHERE " + condition;
        return this;
    }

    public SQLQueryBuilder orderBy(String column, String direction) {
        this.orderByClause = " ORDER BY " + column + " " + direction;
        return this;
    }

    public SQLQueryBuilder limit(int limit) {
        this.limitValue = limit;
        return this;
    }

    public String build() {
        StringBuilder query = new StringBuilder();
        query.append(selectClause);
        query.append(fromClause);
        query.append(whereClause);
        query.append(orderByClause);
        if (limitValue > 0) {
            query.append(" LIMIT ").append(limitValue);
        }
        return query.toString();
    }
}

// Usage
public class SQLQueryBuilderDemo {
    public static void main(String[] args) {
        String query = new SQLQueryBuilder()
                .select("id", "name", "email")
                .from("users")
                .where("age > 18")
                .orderBy("name", "ASC")
                .limit(10)
                .build();

        System.out.println(query);
        // Output: SELECT id, name, email FROM users WHERE age > 18 ORDER BY name ASC LIMIT 10
    }
}
```

### When to Use vs Constructor
| Aspect | Builder | Constructor |
|--------|---------|------------|
| Parameters | 5+ optional parameters | Few, mostly required |
| Readability | Excellent (fluent) | Harder to read |
| Immutability | Easy to implement | Possible but verbose |
| Default values | Natural support | Requires multiple constructors |
| Thread safety | Easier | Same |
| Performance | Slight overhead | Minimal |

### When to Use
- Objects with many optional parameters
- Creating immutable objects
- Complex construction logic
- Builder's fluent API improves readability
- Default values needed

### When NOT to Use
- Simple objects with few parameters
- When performance is critical (micro-optimizations)
- Objects with only required parameters

---

## 5. Prototype Pattern

### Intent
Create new objects by copying a prototype rather than instantiating from scratch.

### Problem: Shallow vs Deep Copy

```java
public class PrototypeDemonstration {

    // Shallow copy problem
    public static class Address {
        public String street;
        public String city;

        public Address(String street, String city) {
            this.street = street;
            this.city = city;
        }

        @Override
        public String toString() {
            return city + " - " + street;
        }
    }

    public static class PersonShallow implements Cloneable {
        public String name;
        public Address address;

        public PersonShallow(String name, Address address) {
            this.name = name;
            this.address = address;
        }

        @Override
        public PersonShallow clone() throws CloneNotSupportedException {
            return (PersonShallow) super.clone(); // Shallow copy!
        }

        @Override
        public String toString() {
            return name + " @ " + address;
        }
    }

    public static void testShallowCopy() throws CloneNotSupportedException {
        Address address = new Address("123 Main St", "NYC");
        PersonShallow person1 = new PersonShallow("John", address);
        PersonShallow person2 = person1.clone(); // Shallow copy

        System.out.println("Before modification:");
        System.out.println("person1: " + person1);
        System.out.println("person2: " + person2);

        // Modifying address affects both!
        person2.address.city = "Boston";

        System.out.println("\nAfter modification:");
        System.out.println("person1: " + person1); // Also changed!
        System.out.println("person2: " + person2);
        System.out.println("Same address object: " + (person1.address == person2.address)); // true
    }

    // Deep copy solution
    public static class PersonDeep implements Cloneable {
        public String name;
        public Address address;

        public PersonDeep(String name, Address address) {
            this.name = name;
            this.address = address;
        }

        @Override
        public PersonDeep clone() throws CloneNotSupportedException {
            PersonDeep cloned = (PersonDeep) super.clone();
            // Deep copy - manually clone mutable objects
            cloned.address = new Address(this.address.street, this.address.city);
            return cloned;
        }

        @Override
        public String toString() {
            return name + " @ " + address;
        }
    }

    public static void testDeepCopy() throws CloneNotSupportedException {
        Address address = new Address("123 Main St", "NYC");
        PersonDeep person1 = new PersonDeep("John", address);
        PersonDeep person2 = person1.clone(); // Deep copy

        System.out.println("\nBefore modification:");
        System.out.println("person1: " + person1);
        System.out.println("person2: " + person2);

        // Modifying address in person2 doesn't affect person1
        person2.address.city = "Boston";

        System.out.println("\nAfter modification:");
        System.out.println("person1: " + person1); // Unchanged
        System.out.println("person2: " + person2);
        System.out.println("Different address objects: " + (person1.address != person2.address)); // true
    }

    public static void main(String[] args) throws CloneNotSupportedException {
        testShallowCopy();
        testDeepCopy();
    }
}
```

### Copy Constructor Alternative (Preferred)

```java
public class PersonCopyConstructor {
    private String name;
    private Address address;

    // Regular constructor
    public PersonCopyConstructor(String name, Address address) {
        this.name = name;
        this.address = address;
    }

    // Copy constructor - explicit deep copy
    public PersonCopyConstructor(PersonCopyConstructor other) {
        this.name = other.name;
        // Deep copy of mutable objects
        this.address = new Address(other.address.street, other.address.city);
    }

    public static class Address {
        public String street;
        public String city;

        public Address(String street, String city) {
            this.street = street;
            this.city = city;
        }
    }

    @Override
    public String toString() {
        return name + " @ " + address.city;
    }
}

public class CopyConstructorDemo {
    public static void main(String[] args) {
        PersonCopyConstructor.Address address = new PersonCopyConstructor.Address("123 Main St", "NYC");
        PersonCopyConstructor person1 = new PersonCopyConstructor("John", address);
        PersonCopyConstructor person2 = new PersonCopyConstructor(person1); // Clear intent!

        System.out.println("person1: " + person1);
        System.out.println("person2: " + person2);
    }
}
```

### Real-World Example: Document Cloning

```java
public class Document implements Cloneable {
    private String title;
    private List<String> content;
    private List<String> permissions;

    public Document(String title) {
        this.title = title;
        this.content = new ArrayList<>();
        this.permissions = new ArrayList<>();
    }

    public void addContent(String text) {
        this.content.add(text);
    }

    public void addPermission(String permission) {
        this.permissions.add(permission);
    }

    @Override
    public Document clone() throws CloneNotSupportedException {
        Document cloned = (Document) super.clone();
        // Deep copy collections
        cloned.content = new ArrayList<>(this.content);
        cloned.permissions = new ArrayList<>(this.permissions);
        return cloned;
    }

    @Override
    public String toString() {
        return "Document{" +
                "title='" + title + '\'' +
                ", content=" + content +
                ", permissions=" + permissions +
                '}';
    }
}

// Prototype Registry for efficient object creation
public class DocumentPrototypeRegistry {
    private Map<String, Document> prototypes = new HashMap<>();

    public void registerPrototype(String key, Document document) {
        prototypes.put(key, document);
    }

    public Document createDocument(String key) throws CloneNotSupportedException {
        Document prototype = prototypes.get(key);
        if (prototype == null) {
            throw new IllegalArgumentException("Prototype not found: " + key);
        }
        return prototype.clone();
    }
}

public class DocumentPrototypeDemo {
    public static void main(String[] args) throws CloneNotSupportedException {
        DocumentPrototypeRegistry registry = new DocumentPrototypeRegistry();

        // Create and register prototypes
        Document reportTemplate = new Document("Monthly Report");
        reportTemplate.addContent("Report header");
        reportTemplate.addPermission("read");
        registry.registerPrototype("report", reportTemplate);

        // Create new documents from prototypes
        Document report1 = registry.createDocument("report");
        Document report2 = registry.createDocument("report");

        report1.addContent("January data");
        report2.addContent("February data");

        System.out.println(report1);
        System.out.println(report2);
    }
}
```

### Issues with Cloneable and Solutions

```java
public class CloneableIssues {

    // Problem 1: Cloneable doesn't override clone()
    public static class BadImplementation implements Cloneable {
        private int value;

        public BadImplementation(int value) {
            this.value = value;
        }

        // clone() from Object is protected, hard to use
    }

    // Solution: Provide public clone() method
    public static class GoodImplementation implements Cloneable {
        private int value;

        public GoodImplementation(int value) {
            this.value = value;
        }

        @Override
        public GoodImplementation clone() {
            try {
                return (GoodImplementation) super.clone();
            } catch (CloneNotSupportedException e) {
                // Should never happen if properly implementing Cloneable
                throw new AssertionError(e);
            }
        }
    }

    // Problem 2: No deep copy by default
    // Solution: See deep copy examples above

    // Better alternative: Avoid Cloneable, use copy constructor
    public static class BestImplementation {
        private int value;

        public BestImplementation(int value) {
            this.value = value;
        }

        // Copy constructor - explicit and clear
        public BestImplementation(BestImplementation other) {
            this.value = other.value;
        }
    }
}
```

### When to Use
- Expensive object creation (database queries, file I/O)
- Creating variations of complex objects
- Needing independent copies of mutable objects
- Prototype registries for managing object templates

### When NOT to Use
- Simple objects (use constructors)
- When deep copy is difficult to implement correctly
- Performance is not a concern

---

## 6. Object Pool Pattern

### Intent
Reuse objects instead of creating and destroying them repeatedly.

### Real-World Example: Connection Pooling

```java
public class Connection implements Serializable {
    private String id;
    private boolean available;
    private long createdAt;
    private long lastUsedAt;

    public Connection(String id) {
        this.id = id;
        this.available = true;
        this.createdAt = System.currentTimeMillis();
        this.lastUsedAt = System.currentTimeMillis();
    }

    public String getId() {
        return id;
    }

    public boolean isAvailable() {
        return available;
    }

    public void setAvailable(boolean available) {
        this.available = available;
        this.lastUsedAt = System.currentTimeMillis();
    }

    public void execute(String query) {
        System.out.println("Executing query on connection " + id + ": " + query);
        this.lastUsedAt = System.currentTimeMillis();
    }

    public boolean isExpired(long timeoutMs) {
        return System.currentTimeMillis() - lastUsedAt > timeoutMs;
    }
}

public class ConnectionPool {
    private final Queue<Connection> availableConnections;
    private final Set<Connection> allConnections;
    private final int maxPoolSize;
    private final long connectionTimeout;
    private int connectionCounter = 0;

    public ConnectionPool(int maxPoolSize, long connectionTimeout) {
        this.maxPoolSize = maxPoolSize;
        this.connectionTimeout = connectionTimeout;
        this.availableConnections = new LinkedList<>();
        this.allConnections = Collections.synchronizedSet(new HashSet<>());
        initializePool();
    }

    private void initializePool() {
        for (int i = 0; i < maxPoolSize; i++) {
            Connection conn = new Connection("Conn_" + (++connectionCounter));
            availableConnections.add(conn);
            allConnections.add(conn);
        }
        System.out.println("Initialized connection pool with " + maxPoolSize + " connections");
    }

    public synchronized Connection getConnection() throws InterruptedException {
        while (availableConnections.isEmpty()) {
            System.out.println("Waiting for available connection...");
            wait();
        }
        Connection conn = availableConnections.poll();
        conn.setAvailable(false);
        return conn;
    }

    public synchronized void releaseConnection(Connection conn) {
        if (conn != null && allConnections.contains(conn)) {
            conn.setAvailable(true);
            availableConnections.add(conn);
            notifyAll(); // Notify waiting threads
            System.out.println("Connection " + conn.getId() + " released back to pool");
        }
    }

    // Maintenance: Remove expired connections
    public synchronized void removeExpiredConnections() {
        allConnections.removeIf(conn -> conn.isExpired(connectionTimeout));
        System.out.println("Removed expired connections. Pool size: " + allConnections.size());
    }

    public synchronized int getAvailableConnectionCount() {
        return availableConnections.size();
    }

    public synchronized int getTotalConnectionCount() {
        return allConnections.size();
    }
}

// Usage
public class ConnectionPoolDemo {
    public static void main(String[] args) throws InterruptedException {
        ConnectionPool pool = new ConnectionPool(3, 60000); // 3 connections, 60s timeout

        // Simulate multiple threads accessing the pool
        ExecutorService executor = Executors.newFixedThreadPool(5);

        for (int i = 0; i < 5; i++) {
            final int threadId = i;
            executor.submit(() -> {
                try {
                    Connection conn = pool.getConnection();
                    System.out.println("Thread " + threadId + " got connection: " + conn.getId());

                    conn.execute("SELECT * FROM users");
                    Thread.sleep(1000); // Simulate query execution

                    pool.releaseConnection(conn);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            });
        }

        executor.shutdown();
        executor.awaitTermination(10, TimeUnit.SECONDS);

        System.out.println("Final pool state:");
        System.out.println("Available: " + pool.getAvailableConnectionCount());
        System.out.println("Total: " + pool.getTotalConnectionCount());
    }
}
```

### Thread Pool as Object Pool

```java
public class ThreadPoolDemo {
    public static void main(String[] args) {
        // Java's ExecutorService is an object pool pattern
        ExecutorService executor = Executors.newFixedThreadPool(4); // Pool of 4 threads

        // Tasks are executed using threads from the pool
        for (int i = 0; i < 10; i++) {
            final int taskId = i;
            executor.submit(() -> {
                System.out.println("Task " + taskId + " executed by " + Thread.currentThread().getName());
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            });
        }

        executor.shutdown();
    }
}
```

### When to Use
- Database connection management
- Thread pool management
- Buffer/memory pool management
- Expensive object creation
- High-frequency object creation and destruction

### When NOT to Use
- Objects with limited lifespan
- Simple, lightweight objects
- Stateful objects that cannot be reused safely
- Memory is not a constraint

---

## Summary Table: When to Use Each Creational Pattern

| Pattern | Use Case | Key Benefit |
|---------|----------|------------|
| **Singleton** | Logging, configuration, caching | Single instance guarantee |
| **Factory Method** | Creating objects whose type varies | Decouples client from concrete classes |
| **Abstract Factory** | Families of related products | Ensures consistency across families |
| **Builder** | Complex objects with many options | Clear, readable object construction |
| **Prototype** | Expensive object copying | Efficient object replication |
| **Object Pool** | Frequently created/destroyed objects | Reduces allocation overhead |

