# Spring Core and IoC Container - Deep Dive

## Table of Contents
1. [BeanFactory vs ApplicationContext](#beanfactory-vs-applicationcontext)
2. [Dependency Injection Strategies](#dependency-injection-strategies)
3. [Bean Lifecycle](#bean-lifecycle)
4. [Bean Scopes](#bean-scopes)
5. [Stereotype Annotations](#stereotype-annotations)
6. [@Configuration and @Bean](#configuration-and-bean)
7. [Profiles and Conditional Beans](#profiles-and-conditional-beans)
8. [Spring AOP Deep Dive](#spring-aop-deep-dive)
9. [SpEL Basics](#spel-basics)
10. [Interview Questions](#interview-questions)

---

## BeanFactory vs ApplicationContext

### BeanFactory: The Basic Container

BeanFactory is the lowest-level interface for accessing Spring beans. It's responsible for instantiating, configuring, and managing beans.

**Key Characteristics:**
- Lazy initialization (beans created on demand)
- Minimal overhead
- Used in resource-constrained environments

```java
// Basic BeanFactory usage
BeanFactory factory = new XmlBeanFactory(new ClassPathResource("beans.xml"));
MyBean bean = factory.getBean("myBean", MyBean.class);
```

### ApplicationContext: The Advanced Container

ApplicationContext extends BeanFactory and provides additional enterprise-level features.

**Key Characteristics:**
- Eager initialization (beans created on startup)
- Message resource handling (i18n)
- Event publishing
- Hierarchical context
- ResourceLoader capabilities

**Core Implementations:**
```java
// ClassPathXmlApplicationContext: loads XML from classpath
ApplicationContext context = new ClassPathXmlApplicationContext("beans.xml");

// FileSystemXmlApplicationContext: loads XML from filesystem
ApplicationContext context = new FileSystemXmlApplicationContext("/etc/config/beans.xml");

// AnnotationConfigApplicationContext: loads from @Configuration classes
ApplicationContext context = new AnnotationConfigApplicationContext(MyConfiguration.class);

// ServletWebServerApplicationContext: web-specific context (Spring Boot)
// Automatically used in Spring Boot applications
```

### Comparison Table

| Feature | BeanFactory | ApplicationContext |
|---------|-------------|-------------------|
| Bean Initialization | Lazy | Eager |
| Memory Usage | Lower | Higher |
| Startup Speed | Faster | Slower |
| i18n Support | No | Yes |
| Event Publishing | No | Yes |
| ResourceLoader | No | Yes |
| Hierarchical Contexts | No | Yes |
| AOP | Manual Setup | Automatic |

### Practical Implications

```java
// Spring Boot always uses ApplicationContext
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        ApplicationContext context = SpringApplication.run(Application.class, args);

        // ApplicationContext features available immediately
        String message = context.getMessage("welcome.message", null, Locale.getDefault());
        context.publishEvent(new MyEvent("data"));
    }
}
```

---

## Dependency Injection Strategies

### 1. Constructor Injection (PREFERRED)

**Advantages:**
- Immutability: dependencies are final
- Null-safety: detects missing dependencies at construction time
- Testability: easy to provide mocks
- Explicit dependencies: all dependencies visible in constructor signature
- Thread-safety: no need for synchronization

```java
@Component
public class UserService {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final EmailService emailService;

    // Spring automatically resolves dependencies
    public UserService(UserRepository userRepository,
                       PasswordEncoder passwordEncoder,
                       EmailService emailService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.emailService = emailService;
    }

    public void registerUser(String email, String password) {
        User user = new User();
        user.setEmail(email);
        user.setPassword(passwordEncoder.encode(password));
        userRepository.save(user);
        emailService.sendConfirmation(email);
    }
}

// Testing is straightforward
@Test
public void testRegisterUser() {
    UserRepository mockRepo = mock(UserRepository.class);
    PasswordEncoder mockEncoder = mock(PasswordEncoder.class);
    EmailService mockEmail = mock(EmailService.class);

    UserService service = new UserService(mockRepo, mockEncoder, mockEmail);
    // Test without Spring context
}
```

**When Spring Doesn't Find a Constructor with @Autowired:**

If no constructor is explicitly marked with @Autowired and there's only one constructor, Spring automatically uses it (implicit constructor injection).

```java
@Component
public class PaymentService {
    private final PaymentGateway gateway;

    // No @Autowired needed - Spring auto-detects the single constructor
    public PaymentService(PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

### 2. Setter Injection

**Advantages:**
- Optional dependencies (use DefaultValue pattern)
- Can change dependencies at runtime
- Backward compatible with existing code

**Disadvantages:**
- Mutable state (thread-unsafe without proper synchronization)
- Doesn't enforce all dependencies are set
- Harder to test

```java
@Component
public class ReportService {
    private ReportGenerator generator;
    private ReportStorage storage;
    private NotificationService notifier; // Optional

    @Autowired
    public void setGenerator(ReportGenerator generator) {
        this.generator = generator;
    }

    @Autowired
    public void setStorage(ReportStorage storage) {
        this.storage = storage;
    }

    @Autowired(required = false)
    public void setNotifier(NotificationService notifier) {
        this.notifier = notifier;
    }

    public void generateReport() {
        // Null check needed for optional dependencies
        if (notifier != null) {
            notifier.notify("Report generation started");
        }
    }
}
```

### 3. Field Injection (NOT RECOMMENDED)

**Disadvantages:**
- Hidden dependencies
- Mutable state
- Cannot be injected in constructor, complicating testing
- NullPointerException risk if field not injected
- Circular dependency issues

```java
@Component
public class OrderService {
    @Autowired
    private OrderRepository orderRepository; // Mutable field injection

    @Autowired
    private InventoryService inventoryService;

    // Hard to test without Spring context
    public void createOrder(Order order) {
        // Risk: fields could be null if injection failed
        orderRepository.save(order);
    }
}

// Testing requires Spring context setup
@SpringBootTest
public class OrderServiceTest {
    @Autowired
    private OrderService orderService; // Need full Spring context

    @Test
    public void testCreateOrder() {
        // Harder to isolate and mock
    }
}
```

### 4. Optional Dependency Pattern

For truly optional dependencies, use Optional or @Autowired(required = false):

```java
@Component
public class NotificationService {
    private final EmailSender emailSender;
    private final Optional<SmsSender> smsSender;
    private final Optional<PushNotificationSender> pushSender;

    public NotificationService(EmailSender emailSender,
                              Optional<SmsSender> smsSender,
                              Optional<PushNotificationSender> pushSender) {
        this.emailSender = emailSender;
        this.smsSender = smsSender;
        this.pushSender = pushSender;
    }

    public void notifyUser(String userId, String message) {
        emailSender.sendEmail(userId, message);
        smsSender.ifPresent(sender -> sender.sendSms(userId, message));
        pushSender.ifPresent(sender -> sender.sendPush(userId, message));
    }
}

@Configuration
public class NotificationConfig {
    @Bean
    public EmailSender emailSender() {
        return new SimpleEmailSender();
    }

    // SmsSender is optional - bean might not exist
    @Bean
    @ConditionalOnProperty(name = "notifications.sms.enabled")
    public SmsSender smsSender() {
        return new AwsSmsSender();
    }
}
```

### 5. Lookup Method Injection (Rare, but Useful)

When you need a new instance every time:

```java
@Component
public class TaskProcessor {

    // Spring will override this method to return a new TaskWorker each time
    @Lookup
    protected TaskWorker createWorker() {
        return null; // Implementation replaced by Spring
    }

    public void processTasks(List<Task> tasks) {
        for (Task task : tasks) {
            TaskWorker worker = createWorker(); // New instance each time
            worker.process(task);
        }
    }
}

@Component
@Scope("prototype") // New instance each time
public class TaskWorker {
    public void process(Task task) {
        // Task processing logic
    }
}
```

### Dependency Injection Best Practices

```java
// GOOD: Constructor injection with final fields
@Component
public class PaymentProcessor {
    private final PaymentGateway gateway;
    private final TransactionLog transactionLog;
    private final AuditService auditService;

    public PaymentProcessor(PaymentGateway gateway,
                           TransactionLog transactionLog,
                           AuditService auditService) {
        this.gateway = gateway;
        this.transactionLog = transactionLog;
        this.auditService = auditService;
    }

    public void processPayment(Payment payment) throws PaymentException {
        // All dependencies available, immutable, thread-safe
    }
}

// BAD: Field injection with mutable state
@Component
public class PaymentProcessor {
    @Autowired
    private PaymentGateway gateway;

    @Autowired
    private TransactionLog transactionLog;

    public void processPayment(Payment payment) throws PaymentException {
        // Fields could be null, hard to test, not thread-safe
    }
}
```

---

## Bean Lifecycle

Understanding the bean lifecycle is crucial for production applications. Here's the complete sequence:

### Visual Flow

```
1. Bean Definition Loading
   └─> Parsing XML/Annotations → BeanDefinition created

2. BeanFactoryPostProcessor.postProcessBeanFactory()
   └─> Modifying bean definitions

3. Instantiation (Constructor called)
   └─> New instance created via reflection/CGLIB

4. Property Population & Autowiring
   └─> Setter methods called, @Autowired resolved

5. BeanNameAware.setBeanName()
   └─> Bean learns its name

6. BeanFactoryAware.setBeanFactory()
   └─> Bean gets reference to factory

7. ApplicationContextAware.setApplicationContext()
   └─> Bean gets reference to context

8. BeanPostProcessor.postProcessBeforeInitialization()
   └─> Before init lifecycle callbacks

9. @PostConstruct method (if exists)
   └─> Annotated with @PostConstruct

10. InitializingBean.afterPropertiesSet()
    └─> If implements InitializingBean interface

11. Custom init-method (if configured)
    └─> init-method in @Bean or XML

12. BeanPostProcessor.postProcessAfterInitialization()
    └─> After init lifecycle callbacks

13. Bean Ready for Use
    └─> Singleton added to cache, prototype returned

14. @PreDestroy method (if exists)
    └─> On shutdown, annotated with @PreDestroy

15. DisposableBean.destroy()
    └─> If implements DisposableBean interface

16. Custom destroy-method (if configured)
    └─> destroy-method in @Bean or XML
```

### Practical Lifecycle Implementation

```java
@Component
public class DatabaseConnection implements
    InitializingBean, DisposableBean, BeanNameAware, ApplicationContextAware {

    private String beanName;
    private ApplicationContext applicationContext;
    private Connection connection;
    private static final Logger logger = LoggerFactory.getLogger(DatabaseConnection.class);

    // Constructor
    public DatabaseConnection() {
        logger.info("1. DatabaseConnection constructor called");
    }

    // BeanNameAware - Spring calls this automatically
    @Override
    public void setBeanName(String name) {
        logger.info("2. setBeanName called with: {}", name);
        this.beanName = name;
    }

    // ApplicationContextAware - Spring calls this automatically
    @Override
    public void setApplicationContext(ApplicationContext applicationContext) {
        logger.info("3. setApplicationContext called");
        this.applicationContext = applicationContext;
    }

    // BeanPostProcessor.postProcessBeforeInitialization is called here
    // (handled by Spring infrastructure)

    // @PostConstruct - Spring calls this after properties set
    @PostConstruct
    public void init() {
        logger.info("4. @PostConstruct init() called");
        try {
            this.connection = DriverManager.getConnection(
                "jdbc:mysql://localhost/testdb",
                "root",
                "password"
            );
            logger.info("4. Database connection established");
        } catch (SQLException e) {
            throw new RuntimeException("Failed to establish connection", e);
        }
    }

    // InitializingBean.afterPropertiesSet() - called if @PostConstruct not present
    @Override
    public void afterPropertiesSet() throws Exception {
        logger.info("5. InitializingBean.afterPropertiesSet() called");
        // Additional initialization if needed
    }

    // Custom init method (if specified in @Bean)
    // public void customInit() { }

    // BeanPostProcessor.postProcessAfterInitialization is called here

    // Now the bean is ready for use...

    public void executeQuery(String sql) {
        if (connection == null) {
            throw new IllegalStateException("Connection not initialized");
        }
        // Execute query
    }

    // Destruction phase

    @PreDestroy
    public void cleanup() {
        logger.info("6. @PreDestroy cleanup() called");
        closeConnection();
    }

    @Override
    public void destroy() throws Exception {
        logger.info("7. DisposableBean.destroy() called");
        closeConnection();
    }

    private void closeConnection() {
        if (connection != null) {
            try {
                connection.close();
                logger.info("Database connection closed");
            } catch (SQLException e) {
                logger.error("Error closing connection", e);
            }
        }
    }
}
```

### BeanPostProcessor: Advanced Lifecycle Hook

BeanPostProcessors allow you to customize bean creation:

```java
@Component
public class LoggingBeanPostProcessor implements BeanPostProcessor {
    private static final Logger logger = LoggerFactory.getLogger(LoggingBeanPostProcessor.class);

    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        logger.debug("Before initialization: {}", beanName);

        // Can return a different object (e.g., a proxy)
        if (bean instanceof Service) {
            return new ServiceProxy((Service) bean);
        }
        return bean;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        logger.debug("After initialization: {}", beanName);
        return bean;
    }
}

// Practical example: Auto-registering repositories
@Component
public class RepositoryRegistrationPostProcessor implements BeanPostProcessor {

    private static final Logger logger = LoggerFactory.getLogger(RepositoryRegistrationPostProcessor.class);

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        // Register all repositories in a registry
        if (bean instanceof BaseRepository) {
            RepositoryRegistry.register(beanName, (BaseRepository<?>) bean);
            logger.info("Registered repository: {}", beanName);
        }
        return bean;
    }
}

public class RepositoryRegistry {
    private static final Map<String, BaseRepository<?>> repositories = new ConcurrentHashMap<>();

    public static void register(String name, BaseRepository<?> repository) {
        repositories.put(name, repository);
    }

    public static BaseRepository<?> getRepository(String name) {
        return repositories.get(name);
    }
}
```

### Configuration-based Lifecycle

```java
@Configuration
public class LifecycleConfiguration {

    @Bean(initMethod = "customInit", destroyMethod = "customDestroy")
    public DataSourceManager dataSourceManager() {
        return new DataSourceManager();
    }
}

public class DataSourceManager {
    private DataSource dataSource;

    public void customInit() {
        // Initialize data source
        this.dataSource = createDataSource();
    }

    public void customDestroy() {
        // Close data source
        if (dataSource != null) {
            try {
                dataSource.getConnection().close();
            } catch (SQLException e) {
                // Handle error
            }
        }
    }

    private DataSource createDataSource() {
        // Create datasource
        return null;
    }
}
```

---

## Bean Scopes

Bean scope determines the lifecycle and visibility of a bean instance.

### 1. Singleton Scope (Default)

One instance per Spring container. Thread-safe but stateless.

```java
@Component
// @Scope("singleton") // Default, explicit
public class UserRepository {
    private final JdbcTemplate jdbcTemplate;

    public UserRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public User findById(Long id) {
        return jdbcTemplate.queryForObject(
            "SELECT * FROM users WHERE id = ?",
            (rs, rowNum) -> new User(rs.getLong("id"), rs.getString("name")),
            id
        );
    }
}

@SpringBootTest
public class SingletonScopeTest {
    @Autowired
    private UserRepository repo1;

    @Autowired
    private UserRepository repo2;

    @Test
    public void singletonScope() {
        assertSame(repo1, repo2); // Same instance
    }
}
```

**Best For:**
- Stateless services
- Repository/DAO objects
- Utility services
- Configuration beans

### 2. Prototype Scope

New instance created each time the bean is requested. No cleanup lifecycle calls.

```java
@Component
@Scope("prototype")
public class RequestContext {
    private String requestId;
    private long createdAt;

    public RequestContext() {
        this.requestId = UUID.randomUUID().toString();
        this.createdAt = System.currentTimeMillis();
    }

    public String getRequestId() {
        return requestId;
    }

    public long getCreatedAt() {
        return createdAt;
    }
}

@Component
public class RequestProcessor {
    private final ObjectProvider<RequestContext> contextProvider;

    public RequestProcessor(ObjectProvider<RequestContext> contextProvider) {
        this.contextProvider = contextProvider;
    }

    public void processRequest() {
        RequestContext context = contextProvider.getObject(); // New instance
        String requestId = context.getRequestId();
        // Process with unique context
    }
}

@SpringBootTest
public class PrototypeScopeTest {
    @Autowired
    private ObjectProvider<RequestContext> contextProvider;

    @Test
    public void prototypeScope() {
        RequestContext ctx1 = contextProvider.getObject();
        RequestContext ctx2 = contextProvider.getObject();

        assertNotSame(ctx1, ctx2); // Different instances
        assertNotEquals(ctx1.getRequestId(), ctx2.getRequestId());
    }
}
```

**Best For:**
- Request-scoped data
- Stateful objects
- Per-invocation instances
- Thread-local-like behavior

### 3. Web Scopes (Request, Session, Application)

Only available in web-aware ApplicationContext.

```java
// REQUEST SCOPE: New bean per HTTP request
@Component
@Scope("request")
public class HttpRequestData {
    private String correlationId;
    private long startTime;

    @PostConstruct
    public void init() {
        this.correlationId = UUID.randomUUID().toString();
        this.startTime = System.currentTimeMillis();
    }

    public String getCorrelationId() {
        return correlationId;
    }

    public long getElapsedTime() {
        return System.currentTimeMillis() - startTime;
    }
}

// SESSION SCOPE: One bean per HTTP session
@Component
@Scope("session")
public class UserSession {
    private String userId;
    private List<String> visitedPages = new ArrayList<>();

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public String getUserId() {
        return userId;
    }

    public void recordPageVisit(String page) {
        visitedPages.add(page);
    }

    public List<String> getVisitedPages() {
        return new ArrayList<>(visitedPages);
    }
}

// APPLICATION SCOPE: One bean per ServletContext
@Component
@Scope("application")
public class ApplicationStatistics {
    private AtomicLong totalRequests = new AtomicLong(0);
    private AtomicLong totalErrors = new AtomicLong(0);

    public void recordRequest() {
        totalRequests.incrementAndGet();
    }

    public void recordError() {
        totalErrors.incrementAndGet();
    }

    public long getTotalRequests() {
        return totalRequests.get();
    }

    public long getTotalErrors() {
        return totalErrors.get();
    }
}

@RestController
@RequestMapping("/api")
public class OrderController {
    private final HttpRequestData requestData;
    private final UserSession userSession;
    private final ApplicationStatistics stats;

    public OrderController(HttpRequestData requestData,
                          UserSession userSession,
                          ApplicationStatistics stats) {
        this.requestData = requestData;
        this.userSession = userSession;
        this.stats = stats;
    }

    @GetMapping("/orders")
    public ResponseEntity<?> getOrders() {
        stats.recordRequest();
        userSession.recordPageVisit("/orders");

        return ResponseEntity.ok(Map.of(
            "correlationId", requestData.getCorrelationId(),
            "elapsedTime", requestData.getElapsedTime(),
            "userId", userSession.getUserId()
        ));
    }
}
```

### 4. Custom Scope

Implement Scope interface for custom scope behavior:

```java
// Custom scope: Thread-scoped beans
@Component
public class ThreadScope implements Scope {
    private static final ThreadLocal<Map<String, Object>> THREAD_LOCAL_BEANS =
        ThreadLocal.withInitial(ConcurrentHashMap::new);

    @Override
    public Object get(String name, ObjectFactory<?> objectFactory) {
        Map<String, Object> map = THREAD_LOCAL_BEANS.get();
        Object object = map.get(name);
        if (object == null) {
            object = objectFactory.getObject();
            map.put(name, object);
        }
        return object;
    }

    @Override
    public void registerDestructionCallback(String name, Runnable callback) {
        // Register cleanup callbacks if needed
    }

    @Override
    public Object resolveContextualObject(String key) {
        return null;
    }

    @Override
    public String getConversationId() {
        return Thread.currentThread().getName();
    }
}

// Register custom scope
@Configuration
public class ScopeConfiguration {
    @Bean
    public static CustomScopeConfigurer customScopeConfigurer() {
        CustomScopeConfigurer configurer = new CustomScopeConfigurer();
        configurer.addScope("thread", new ThreadScope());
        return configurer;
    }
}

@Component
@Scope("thread")
public class ThreadLocalCache {
    private Map<String, Object> cache = new ConcurrentHashMap<>();

    public void put(String key, Object value) {
        cache.put(key, value);
    }

    public Object get(String key) {
        return cache.get(key);
    }
}
```

---

## Stereotype Annotations

### @Component

Generic stereotype for any managed component.

```java
@Component
public class UtilityService {
    public String formatDate(LocalDate date) {
        return date.format(DateTimeFormatter.ISO_DATE);
    }
}
```

### @Service

Semantic indication that the class provides business logic.

```java
@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final PaymentService paymentService;

    public OrderService(OrderRepository orderRepository,
                       PaymentService paymentService) {
        this.orderRepository = orderRepository;
        this.paymentService = paymentService;
    }

    @Transactional
    public Order createOrder(OrderRequest request) {
        Order order = new Order();
        order.setItems(request.getItems());
        order.setTotal(request.getTotal());

        paymentService.process(order);
        return orderRepository.save(order);
    }
}
```

### @Repository

Semantic indication that the class accesses data. Also provides exception translation (DataAccessException).

```java
@Repository
public class UserRepository extends JpaRepository<User, Long> {
    // Spring Data JPA handles queries
    List<User> findByEmail(String email);
}

// Without Spring Data JPA
@Repository
public class LegacyUserRepository {
    private final JdbcTemplate jdbcTemplate;

    public LegacyUserRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public User findById(Long id) {
        try {
            return jdbcTemplate.queryForObject(
                "SELECT * FROM users WHERE id = ?",
                (rs, rowNum) -> new User(rs.getLong("id"), rs.getString("email")),
                id
            );
        } catch (EmptyResultDataAccessException e) {
            // Exception translated from SQLException
            return null;
        }
    }
}
```

### @Controller

Indicates the class handles HTTP requests (returns views).

```java
@Controller
public class ProductController {
    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    @GetMapping("/products")
    public String listProducts(Model model) {
        model.addAttribute("products", productService.findAll());
        return "products/list"; // View name
    }
}
```

### @RestController

Combination of @Controller + @ResponseBody. Returns JSON/XML directly.

```java
@RestController
@RequestMapping("/api/products")
public class ProductRestController {
    private final ProductService productService;

    public ProductRestController(ProductService productService) {
        this.productService = productService;
    }

    @GetMapping("/{id}")
    public ResponseEntity<Product> getProduct(@PathVariable Long id) {
        return productService.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<Product> createProduct(@RequestBody ProductRequest request) {
        Product created = productService.create(request);
        return ResponseEntity.created(
            URI.create("/api/products/" + created.getId())
        ).body(created);
    }
}
```

### Key Differences

| Annotation | Purpose | Exception Translation | AOP |
|-----------|---------|---------------------|-----|
| @Component | Generic bean | No | Yes |
| @Service | Business logic | No | Yes |
| @Repository | Data access | Yes (DataAccessException) | Yes |
| @Controller | Web requests (view) | No | Yes |
| @RestController | Web requests (JSON) | No | Yes |

---

## @Configuration and @Bean

### How @Configuration Works with CGLIB Proxying

```java
@Configuration
public class AppConfiguration {

    @Bean
    public UserRepository userRepository() {
        return new UserRepository();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public UserService userService(UserRepository userRepository,
                                   PasswordEncoder passwordEncoder) {
        return new UserService(userRepository, passwordEncoder);
    }
}
```

When you call `userService()`, it doesn't just call the method. Here's what actually happens:

```
@Configuration is processed by:
1. ConfigurationClassPostProcessor (BeanFactoryPostProcessor)
2. CGLIB creates a subclass of AppConfiguration at runtime
3. This subclass intercepts @Bean method calls
4. Returns cached singleton instances instead of creating new ones

// Without CGLIB proxying (if @Configuration didn't use proxies):
UserRepository repo1 = appConfig.userRepository(); // new instance
UserRepository repo2 = appConfig.userRepository(); // another new instance
// repo1 != repo2 ❌ WRONG!

// With CGLIB proxying (actual behavior):
UserRepository repo1 = appConfig.userRepository(); // cached instance
UserRepository repo2 = appConfig.userRepository(); // same cached instance
// repo1 == repo2 ✓ CORRECT!
```

### Full CGLIB Proxy Example

```java
@Configuration
public class DataSourceConfiguration {

    @Bean
    public DataSource dataSource() {
        // This method gets intercepted by CGLIB proxy
        // First call: Creates and caches the DataSource
        // Subsequent calls: Returns cached instance
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:mysql://localhost/testdb");
        config.setUsername("root");
        config.setPassword("password");
        config.setMaximumPoolSize(20);
        return new HikariDataSource(config);
    }

    @Bean
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        // dataSource parameter is injected (same cached instance from above)
        return new JdbcTemplate(dataSource);
    }

    @Bean
    public TransactionManager transactionManager(DataSource dataSource) {
        // dataSource parameter is the SAME instance
        return new DataSourceTransactionManager(dataSource);
    }
}

// Usage
@Component
public class UserRepository {
    private final JdbcTemplate jdbcTemplate;
    private final DataSource dataSource;

    public UserRepository(JdbcTemplate jdbcTemplate, DataSource dataSource) {
        this.jdbcTemplate = jdbcTemplate; // From @Bean method
        this.dataSource = dataSource;     // Same instance from all @Bean methods
    }
}
```

### @Bean Method Parameters Are Auto-Injected

```java
@Configuration
public class ServiceConfiguration {

    // Spring automatically finds and injects beans
    @Bean
    public UserService userService(UserRepository userRepository,
                                   PasswordEncoder passwordEncoder,
                                   AuditService auditService) {
        return new UserService(userRepository, passwordEncoder, auditService);
    }

    // Named beans
    @Bean(name = "primaryUserRepository")
    public UserRepository userRepository() {
        return new UserRepository();
    }

    // Conditional bean creation
    @Bean
    @ConditionalOnMissingBean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

### @Bean Scope Configuration

```java
@Configuration
public class PrototypeConfiguration {

    @Bean
    @Scope("prototype")
    public RequestContext requestContext() {
        return new RequestContext();
    }

    @Bean
    @Scope(value = "session", proxyMode = ScopedProxyMode.TARGET_CLASS)
    public UserSession userSession() {
        return new UserSession();
    }
}
```

### Comparison: @Configuration vs @Component

```java
// @Configuration: Full-featured config class with CGLIB proxying
@Configuration
public class FullConfiguration {
    @Bean
    public Service service() {
        return new Service();
    }

    @Bean
    public Repository repository() {
        return new Repository(service()); // Calls service() only once (cached)
    }
}

// Lite @Bean mode: @Component with @Bean methods (no proxying)
@Component
public class LiteConfiguration {
    @Bean
    public Service service() {
        return new Service();
    }

    @Bean
    public Repository repository() {
        return new Repository(service()); // Calls service() multiple times
    }
}

// Difference:
// @Configuration ensures singleton behavior and inter-bean dependencies work correctly
// @Component with @Bean creates new instances each time (lite mode)
```

---

## Profiles and Conditional Beans

### @Profile: Environment-Specific Configuration

```java
// Development configuration
@Configuration
@Profile("dev")
public class DevConfiguration {

    @Bean
    public DataSource dataSource() {
        // H2 in-memory database for development
        return DataSourceBuilder.create()
            .driverClassName("org.h2.Driver")
            .url("jdbc:h2:mem:testdb")
            .username("sa")
            .password("")
            .build();
    }

    @Bean
    public Logger logger() {
        Logger logger = LoggerFactory.getLogger("dev");
        return logger;
    }
}

// Production configuration
@Configuration
@Profile("prod")
public class ProdConfiguration {

    @Bean
    public DataSource dataSource(
        @Value("${db.url}") String url,
        @Value("${db.username}") String username,
        @Value("${db.password}") String password) {

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(url);
        config.setUsername(username);
        config.setPassword(password);
        config.setMaximumPoolSize(30);
        config.setConnectionTimeout(10000);
        return new HikariDataSource(config);
    }
}

// Activation
// application.properties: spring.profiles.active=prod
// OR environment variable: SPRING_PROFILES_ACTIVE=prod
// OR application-prod.properties file
```

### @Conditional: Programmatic Bean Conditions

```java
// Custom condition
public class OnAwsCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        Environment env = context.getEnvironment();
        return "aws".equals(env.getProperty("cloud.provider"));
    }
}

// Custom condition for property existence
public class OnPropertyCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        Environment env = context.getEnvironment();
        String property = env.getProperty("feature.advanced.enabled");
        return "true".equalsIgnoreCase(property);
    }
}

@Configuration
public class ConditionalBeanConfiguration {

    @Bean
    @Conditional(OnAwsCondition.class)
    public StorageService awsStorageService() {
        return new S3StorageService();
    }

    @Bean
    @Conditional(OnPropertyCondition.class)
    public AdvancedFeature advancedFeature() {
        return new AdvancedFeatureImpl();
    }
}
```

### @ConditionalOnProperty: Property-Based Conditions

```java
@Configuration
public class FeatureToggleConfiguration {

    @Bean
    @ConditionalOnProperty(
        name = "feature.email-notifications.enabled",
        havingValue = "true"
    )
    public EmailNotificationService emailNotificationService() {
        return new EmailNotificationService();
    }

    @Bean
    @ConditionalOnProperty(
        name = "feature.sms-notifications.enabled",
        havingValue = "true",
        matchIfMissing = false
    )
    public SmsNotificationService smsNotificationService() {
        return new SmsNotificationService();
    }

    @Bean
    @ConditionalOnProperty(
        prefix = "cache",
        name = "type",
        havingValue = "redis"
    )
    public CacheManager redisCacheManager() {
        return new RedisCacheManager();
    }
}

// application.yml
/*
feature:
  email-notifications:
    enabled: true
  sms-notifications:
    enabled: false

cache:
  type: redis
*/
```

### Other Useful Conditional Annotations

```java
@Configuration
public class SmartConditionalConfiguration {

    // Bean exists only if class is on classpath
    @Bean
    @ConditionalOnClass(name = "com.amazonaws.services.s3.AmazonS3")
    public AwsS3Client awsS3Client() {
        return new AwsS3Client();
    }

    // Bean exists only if class is NOT on classpath
    @Bean
    @ConditionalOnMissingClass("com.amazonaws.services.s3.AmazonS3")
    public LocalStorageService localStorageService() {
        return new LocalStorageService();
    }

    // Bean created only if another bean is missing
    @Bean
    @ConditionalOnMissingBean
    public CacheManager cacheManager() {
        return new NoOpCacheManager();
    }

    // Bean created only if bean with specific name exists
    @Bean
    @ConditionalOnBean(name = "dataSource")
    public TransactionManager transactionManager(DataSource dataSource) {
        return new DataSourceTransactionManager(dataSource);
    }
}
```

---

## Spring AOP Deep Dive

### How AOP Proxies Work

Spring AOP uses either JDK dynamic proxies or CGLIB to create proxies:

```
// Original class structure
┌─ UserService (interface)
   └─ UserServiceImpl (concrete class)

// JDK Dynamic Proxy (for interfaces)
UserService userService = (UserService) Proxy.newProxyInstance(
    classLoader,
    new Class[] { UserService.class },
    new InvocationHandler() { ... }
);
// proxiedService.someMethod() → handler → UserServiceImpl.someMethod()

// CGLIB Proxy (for concrete classes without interfaces)
Enhancer enhancer = new Enhancer();
enhancer.setSuperclass(UserService.class);
enhancer.setCallback(...);
UserService userService = (UserService) enhancer.create();
// proxiedService.someMethod() → CGLIB → UserService.someMethod()
```

### @Aspect: Complete Example

```java
@Aspect
@Component
public class PerformanceAspect {
    private static final Logger logger = LoggerFactory.getLogger(PerformanceAspect.class);

    // Pointcut: applies to all methods in service classes
    @Pointcut("execution(* com.example.service.*.*(..)) && @annotation(PerformanceLogging)")
    public void serviceMethodsWithPerformanceLogging() {
    }

    // @Before: executes before method call
    @Before("serviceMethodsWithPerformanceLogging()")
    public void logBefore(JoinPoint joinPoint) {
        String methodName = joinPoint.getSignature().getName();
        logger.info("Starting method: {}", methodName);
    }

    // @After: executes after method returns (regardless of success/exception)
    @After("serviceMethodsWithPerformanceLogging()")
    public void logAfter(JoinPoint joinPoint) {
        String methodName = joinPoint.getSignature().getName();
        logger.info("Method finished: {}", methodName);
    }

    // @AfterReturning: executes after successful return
    @AfterReturning(
        pointcut = "serviceMethodsWithPerformanceLogging()",
        returning = "result"
    )
    public void logAfterReturning(JoinPoint joinPoint, Object result) {
        String methodName = joinPoint.getSignature().getName();
        logger.info("Method {} returned: {}", methodName, result);
    }

    // @AfterThrowing: executes after exception
    @AfterThrowing(
        pointcut = "serviceMethodsWithPerformanceLogging()",
        throwing = "exception"
    )
    public void logAfterThrowing(JoinPoint joinPoint, Throwable exception) {
        String methodName = joinPoint.getSignature().getName();
        logger.error("Method {} threw exception: {}", methodName, exception.getMessage());
    }

    // @Around: full control before and after
    @Around("serviceMethodsWithPerformanceLogging()")
    public Object measureExecutionTime(ProceedingJoinPoint joinPoint) throws Throwable {
        String methodName = joinPoint.getSignature().getName();
        long startTime = System.currentTimeMillis();

        try {
            logger.info(">>> Executing: {}", methodName);
            Object result = joinPoint.proceed(); // Call actual method
            return result;
        } finally {
            long duration = System.currentTimeMillis() - startTime;
            if (duration > 1000) {
                logger.warn("!!! Method {} took {}ms (SLOW)", methodName, duration);
            } else {
                logger.info("<<< Completed in {}ms", duration);
            }
        }
    }
}

// Marker annotation
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface PerformanceLogging {
}

// Usage
@Service
public class OrderService {

    @PerformanceLogging
    public Order createOrder(OrderRequest request) {
        // Method execution is intercepted by AOP
        return new Order(request.getItems());
    }
}
```

### Pointcut Expressions

```java
@Aspect
@Component
public class PointcutExamples {

    // 1. Method signature pointcut
    @Pointcut("execution(* com.example.service.UserService.save(..))")
    public void userServiceSaveMethod() {}

    // 2. Any method in service classes
    @Pointcut("execution(* com.example.service.*.*(..))")
    public void anyServiceMethod() {}

    // 3. Methods with specific parameter types
    @Pointcut("execution(* com.example.service.*.*(java.lang.String, int))")
    public void methodWithStringAndInt() {}

    // 4. Classes with specific annotation
    @Pointcut("@target(org.springframework.stereotype.Service)")
    public void classesAnnotatedWithService() {}

    // 5. Methods with specific annotation
    @Pointcut("@annotation(com.example.annotation.Cacheable)")
    public void methodsAnnotatedWithCacheable() {}

    // 6. Methods in classes in specific package
    @Pointcut("within(com.example.service.*)")
    public void classesInServicePackage() {}

    // 7. Complex pointcut with logical operators
    @Pointcut("(execution(* com.example.service.*.*(..)) || " +
              "execution(* com.example.repository.*.*(..))) && " +
              "!execution(* *.toString())")
    public void serviceOrRepositoryButNotToString() {}

    @Before("serviceOrRepositoryButNotToString()")
    public void logComplexPointcut(JoinPoint jp) {
        // Applies to service and repository methods, excluding toString
    }
}
```

### JDK Dynamic Proxy vs CGLIB

```java
// Interface-based: Uses JDK Dynamic Proxy
public interface OrderService {
    void createOrder(Order order);
}

@Service
public class OrderServiceImpl implements OrderService {
    @Override
    public void createOrder(Order order) {
        // Actual implementation
    }
}

// Proxy created automatically:
// OrderService proxy = Proxy.newProxyInstance(
//     OrderService.class.getClassLoader(),
//     new Class[]{OrderService.class},
//     invocationHandler
// );

// Concrete class without interface: Uses CGLIB (by default in Spring Boot)
@Service
public class PaymentService {
    public void processPayment(Payment payment) {
        // Actual implementation
    }
}

// CGLIB proxy created automatically
// Unless spring.aop.proxy-target-class=false

// Force specific proxy type in configuration
@Configuration
@EnableAspectJAutoProxy(proxyTargetClass = true) // Force CGLIB
public class AopConfiguration {
    // CGLIB will be used for all proxies
}
```

### Creating Custom Advice

```java
@Component
public class AuthenticationAdvice implements MethodInterceptor {
    private static final Logger logger = LoggerFactory.getLogger(AuthenticationAdvice.class);

    @Override
    public Object invoke(MethodInvocation invocation) throws Throwable {
        Method method = invocation.getMethod();

        // Check if method requires authentication
        if (method.isAnnotationPresent(RequiresAuthentication.class)) {
            if (!isUserAuthenticated()) {
                throw new UnauthorizedException("User not authenticated");
            }
            logger.info("User authenticated, proceeding with: {}", method.getName());
        }

        return invocation.proceed();
    }

    private boolean isUserAuthenticated() {
        SecurityContext context = SecurityContextHolder.getContext();
        return context.getAuthentication() != null &&
               context.getAuthentication().isAuthenticated();
    }
}

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresAuthentication {
}
```

---

## SpEL Basics

Spring Expression Language allows dynamic runtime expressions:

```java
@Component
public class SpElExamples {

    @Value("#{systemProperties['user.home']}")
    private String userHome;

    @Value("#{systemEnvironment['JAVA_HOME']}")
    private String javaHome;

    @Value("#{1 + 2}")
    private int arithmeticResult; // 3

    @Value("#{'Hello' + ' ' + 'World'}")
    private String concatenated; // "Hello World"

    @Value("#{T(java.lang.Math).PI}")
    private double mathPI; // 3.14159...

    @Value("#{systemProperties['os.name'].toLowerCase()}")
    private String osNameLowercase;

    // Conditional expression
    @Value("#{${app.debug-mode:false} ? 'DEBUG' : 'PRODUCTION'}")
    private String environment;
}

@Configuration
public class SpElConfiguration {

    @Bean
    public ExpressionParser expressionParser() {
        return new SpelExpressionParser();
    }

    @Bean
    public EvaluationContext evaluationContext() {
        return new StandardEvaluationContext();
    }
}

@Component
public class DynamicExpressionEvaluator {
    private final ExpressionParser expressionParser;
    private final EvaluationContext context;

    public DynamicExpressionEvaluator(ExpressionParser expressionParser,
                                     EvaluationContext context) {
        this.expressionParser = expressionParser;
        this.context = context;
    }

    public Object evaluateExpression(String expression) {
        Expression expr = expressionParser.parseExpression(expression);
        return expr.getValue(context);
    }

    public void setVariable(String name, Object value) {
        context.setVariable(name, value);
    }
}

// Usage
@Service
public class OrderService {
    private final DynamicExpressionEvaluator evaluator;

    public OrderService(DynamicExpressionEvaluator evaluator) {
        this.evaluator = evaluator;
    }

    public void processOrders(List<Order> orders) {
        evaluator.setVariable("orders", orders);

        // Dynamic evaluation
        Integer totalAmount = (Integer) evaluator.evaluateExpression(
            "#orders.![price].^[#this]"
        );

        Boolean hasExpensiveOrders = (Boolean) evaluator.evaluateExpression(
            "#orders.?[price > 1000].size() > 0"
        );
    }
}
```

---

## Interview Questions

### Q1: Explain the complete bean lifecycle with all hooks.

**Answer:**
The bean lifecycle has 13+ stages from creation to destruction. The sequence is:
1. **Bean definition loading** from XML/annotations
2. **BeanFactoryPostProcessor** modifies bean definitions
3. **Instantiation** via constructor reflection
4. **Property population** (setter injection, @Autowired)
5. **Aware interfaces**: BeanNameAware → BeanFactoryAware → ApplicationContextAware
6. **BeanPostProcessor.postProcessBeforeInitialization()** before initialization
7. **@PostConstruct** method (JSR-250)
8. **InitializingBean.afterPropertiesSet()** interface method
9. **Custom init-method** from @Bean(initMethod = "...")
10. **BeanPostProcessor.postProcessAfterInitialization()** after initialization
11. **Bean ready for use** (singleton cached or prototype returned)
12. On shutdown: **@PreDestroy** method
13. **DisposableBean.destroy()** interface method
14. **Custom destroy-method** from @Bean(destroyMethod = "...")

Constructor injection happens during instantiation; setter injection happens during property population. Use @PostConstruct for initialization logic that depends on all dependencies being set.

### Q2: Why is constructor injection preferred over field injection?

**Answer:**
1. **Immutability**: Fields can be final, preventing accidental modification
2. **Null-safety**: Missing dependencies detected at construction time, not at method call time
3. **Testability**: Can instantiate beans without Spring context for unit testing
4. **Explicit dependencies**: All dependencies visible in constructor signature
5. **Thread-safety**: No synchronization needed for immutable state
6. **Circular dependency detection**: Constructor injection fails fast if there are circular dependencies; field injection can hide them

Field injection hides dependencies, makes testing harder, and creates mutable state that's not thread-safe.

### Q3: What's the difference between @Component and @Service?

**Answer:**
Semantically, @Service indicates business logic while @Component is generic. Functionally:
- Both create singleton beans by default
- Both enable component scanning
- @Repository provides exception translation (SQLException → DataAccessException)
- @Service and @Controller don't provide special features beyond semantics
- Using correct annotations improves code readability and allows future enhancement (e.g., @Service could get @Transactional by default)

### Q4: How does @Configuration with @Bean achieve singleton behavior?

**Answer:**
@Configuration classes are enhanced with CGLIB proxies at runtime. When you call a @Bean method, the proxy intercepts the call:
- First call: Creates instance and caches it
- Subsequent calls: Returns cached instance

This is why `@Bean public DataSource dataSource()` and `@Bean public JdbcTemplate jdbcTemplate(DataSource dataSource)` always get the same DataSource instance, even though the method is called multiple times. Without proxying, each call would create a new instance.

### Q5: Explain AOP proxies: JDK Dynamic Proxy vs CGLIB.

**Answer:**
- **JDK Dynamic Proxy**: Used for interface-based implementations. Creates proxy implementing the same interface. Can only proxy interface methods.
- **CGLIB**: Used for concrete classes without interfaces. Creates subclass that overrides methods. Can proxy all public methods.

Spring Boot uses CGLIB by default (since Spring 5.1). JDK Dynamic Proxy is faster at creation but CGLIB is faster at runtime. CGLIB is better for concrete classes; JDK Dynamic Proxy is better for interfaces because proxies can be accessed as the interface type.

### Q6: What's the difference between @Bean scope configurations?

**Answer:**
- **Singleton** (default): One instance per ApplicationContext, shared across entire application
- **Prototype**: New instance every time requested, no cleanup hooks called
- **Request**: New instance per HTTP request (web-only)
- **Session**: One instance per HTTP session (web-only)
- **Application**: One instance per ServletContext (web-only)

Use singleton for stateless services; use prototype for stateful objects; use web scopes for request/session-specific data.

### Q7: How do you handle optional dependencies in Spring?

**Answer:**
```java
// Option 1: Optional<T>
public MyService(Optional<OptionalDependency> dependency) {
    this.dependency = dependency;
}

// Option 2: @Autowired(required = false)
@Autowired(required = false)
private OptionalDependency dependency;

// Option 3: ObjectProvider<T>
public MyService(ObjectProvider<OptionalDependency> provider) {
    this.dependency = provider.getIfAvailable();
}

// Option 4: @ConditionalOnMissingBean
@Bean
@ConditionalOnMissingBean
public OptionalDependency optionalDependency() {
    return new DefaultOptionalDependency();
}
```

ObjectProvider is preferred because it allows lazy initialization and clear intent.

### Q8: Explain @ConditionalOnProperty with example.

**Answer:**
```java
@Bean
@ConditionalOnProperty(
    name = "feature.caching.enabled",
    havingValue = "true",
    matchIfMissing = false
)
public CacheManager cacheManager() {
    return new RedisCacheManager();
}
```

Bean is created only if application.properties has `feature.caching.enabled=true`. If property is missing and `matchIfMissing = false`, bean won't be created. This is useful for feature flags and environment-specific configurations.

### Q9: How does Spring resolve constructor injection with multiple candidates?

**Answer:**
Spring uses this priority:
1. **@Primary**: Marks preferred bean when multiple exist
2. **@Qualifier**: Explicitly names which bean to inject
3. **Parameter name matching**: Matches constructor parameter name to bean name
4. **Type matching**: If only one bean of that type exists

```java
@Bean
@Primary
public DataSource primaryDataSource() { }

@Bean
public DataSource secondaryDataSource() { }

@Component
public class MyService {
    private final DataSource dataSource; // Gets primaryDataSource

    public MyService(DataSource dataSource) {
        this.dataSource = dataSource;
    }
}

@Component
public class OtherService {
    private final DataSource dataSource; // Needs @Qualifier

    public OtherService(@Qualifier("secondaryDataSource") DataSource dataSource) {
        this.dataSource = dataSource;
    }
}
```

