# Microservices Fundamentals: A Comprehensive Guide

## Table of Contents
1. [Monolith vs SOA vs Microservices](#monolith-vs-soa-vs-microservices)
2. [Domain-Driven Design](#domain-driven-design)
3. [Decomposition Strategies](#decomposition-strategies)
4. [Service Boundaries](#service-boundaries)
5. [The Twelve-Factor App](#twelve-factor-app)
6. [Conway's Law](#conways-law)
7. [Microservices Maturity Model](#microservices-maturity-model)
8. [Migration Strategies](#migration-strategies)
9. [Interview Questions](#interview-questions)

---

## Monolith vs SOA vs Microservices

### Architecture Comparison

```
MONOLITH ARCHITECTURE
┌─────────────────────────────────────┐
│          Single Codebase            │
│  ┌──────────────────────────────┐  │
│  │  User Service Logic          │  │
│  │  Product Service Logic       │  │
│  │  Order Service Logic         │  │
│  │  Payment Service Logic       │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │      Shared Database         │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘

SOA (SERVICE ORIENTED ARCHITECTURE)
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Service 1  │  │   Service 2  │  │   Service 3  │
│  (Coarse)    │  │  (Coarse)    │  │  (Coarse)    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                    ESB (Enterprise Service Bus)
                         │
                    ┌────────────┐
                    │ Shared DB  │
                    └────────────┘

MICROSERVICES ARCHITECTURE
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│User Service │  │Product Srvc │  │Order Service│  │Payment Srvc │
│  (Fine)     │  │   (Fine)    │  │  (Fine)    │  │   (Fine)    │
└─────┬───────┘  └─────┬───────┘  └─────┬───────┘  └─────┬───────┘
      │                │                │                │
      ▼                ▼                ▼                ▼
    DB-U            DB-P             DB-O             DB-Pay

    Lightweight communication protocols (REST, gRPC, Async)
```

### Detailed Comparison Table

| Aspect | Monolith | SOA | Microservices |
|--------|----------|-----|--------------|
| **Deployment** | Single unit, all-or-nothing | Services bundled together | Independent, service at a time |
| **Scaling** | Scale entire app | Scale service clusters | Scale individual services |
| **Team Size** | Large, coordinated teams | Large teams, slow coordination | Small autonomous teams (8-10 people) |
| **Database** | Single shared DB | Possibly shared, some isolated | Each service owns its DB |
| **Granularity** | Coarse (business features) | Coarse (business domains) | Fine (single responsibility) |
| **Communication** | In-process calls | Synchronous (often SOAP/XML) | Sync (REST/gRPC) + Async (Events) |
| **Failure Impact** | Total system down | Partial degradation | Isolated, graceful degradation |
| **Operational Complexity** | Low | Medium-High | Very High |
| **Network Latency** | None (in-process) | Significant | Significant, must optimize |
| **Development Speed** | Fast initially, slows down | Moderate | Fast long-term, slow initially |
| **Testing** | Simple (monolithic tests) | Complex (integration tests) | Very complex (distributed tests) |
| **When to Choose** | MVPs, small teams, simple domains | Enterprise, many business domains | Complex domains, high scale, independent teams |

### Trade-offs Analysis

**Monolith Advantages:**
- Simple deployment: one artifact to test and deploy
- Easier testing: can test full stack locally
- Better performance: in-process method calls, shared memory
- Simpler debugging: full stack traces across features
- Easier monitoring: single JVM to monitor

**Monolith Disadvantages:**
- Technology lock-in: entire codebase in one tech stack
- Scaling inefficiency: must scale entire app even if only one feature needs it
- Reduced agility: requires coordinating releases across teams
- Reliability: one bug can crash entire system
- Hard to maintain: codebase becomes increasingly complex

**Microservices Advantages:**
- Independent deployment: deploy features without full regression
- Technology diversity: each service can use different stacks
- Targeted scaling: scale only what needs it
- Team autonomy: teams own full stack (dev, deploy, monitor)
- Resilience: failures are isolated
- Organizational alignment: services match team structure (Conway's Law)

**Microservices Disadvantages:**
- Operational complexity: must manage many services
- Network latency: all communication goes over network
- Data consistency: distributed transactions are hard
- Testing complexity: integration and end-to-end testing is difficult
- Debugging difficulty: errors span multiple services
- Infrastructure overhead: need robust CI/CD, monitoring, tracing

---

## Domain-Driven Design

### Core Concepts

Domain-Driven Design provides a framework for decomposing microservices using business logic, not technical layers.

#### 1. Bounded Contexts

A bounded context is an explicit boundary around a domain model. It defines the scope of a service.

```
E-Commerce System with Bounded Contexts:

┌─────────────────────────────────────────────────────────────────┐
│                      E-Commerce Domain                          │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐            │
│  │  Order Bounded       │  │  Product Bounded     │            │
│  │  Context             │  │  Context             │            │
│  │                      │  │                      │            │
│  │ - Order Aggregate    │  │ - Product Aggregate  │            │
│  │ - OrderItem          │  │ - SKU                │            │
│  │ - OrderStatus        │  │ - Price              │            │
│  │ - ShippingAddress    │  │ - Inventory          │            │
│  └──────────────────────┘  └──────────────────────┘            │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐            │
│  │  Payment Bounded     │  │  Shipping Bounded    │            │
│  │  Context             │  │  Context             │            │
│  │                      │  │                      │            │
│  │ - Payment Aggregate  │  │ - Shipment Aggregate │            │
│  │ - PaymentMethod      │  │ - Tracking           │            │
│  │ - Transaction        │  │ - Destination        │            │
│  └──────────────────────┘  └──────────────────────┘            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Insight**: Order context and Product context have different meanings for "Product":
- In Order context: Product is just an ID + quantity + price (lightweight)
- In Product context: Product is a full entity with inventory, variants, reviews

This difference is intentional and correct. Services communicate via APIs, not shared models.

#### 2. Aggregates

An aggregate is a cluster of domain objects that act as a single unit.

```java
// ORDER AGGREGATE
public class Order {
    private OrderId id;
    private CustomerId customerId;
    private List<OrderItem> items;  // Part of aggregate
    private ShippingAddress address; // Part of aggregate
    private OrderStatus status;
    private LocalDateTime createdAt;

    public void addItem(OrderItem item) {
        // Business logic: enforce invariants
        if (items.size() >= 100) {
            throw new OrderException("Too many items");
        }
        items.add(item);
    }

    public void submit() {
        if (items.isEmpty()) {
            throw new OrderException("Cannot submit empty order");
        }
        // Invariant: all items must be available
        status = OrderStatus.SUBMITTED;
    }

    // IMPORTANT: Only expose aggregate root, never expose internal entities
    public List<OrderItem> getItems() {
        return Collections.unmodifiableList(items);
    }
}

// OrderItem is part of the aggregate, not accessed directly
public class OrderItem {
    private OrderItemId id;
    private ProductId productId;
    private int quantity;
    private BigDecimal price;

    OrderItem(ProductId productId, int quantity, BigDecimal price) {
        // Private constructor, only Order can create OrderItems
        this.productId = productId;
        this.quantity = quantity;
        this.price = price;
    }
}
```

**Aggregate Rules**:
- Only expose the aggregate root (Order, not OrderItem)
- All business logic lives inside the aggregate
- Aggregates enforce invariants
- Aggregates are unit of consistency (one database transaction)
- Keep aggregates small (easier to reason about, less contention)

#### 3. Entities vs Value Objects

```java
// ENTITY: Has identity, mutable, persisted separately
@Entity
public class Customer {
    @Id
    private CustomerId id;  // Identity doesn't change
    private String name;
    private String email;

    // Two customers with same data are different if IDs differ
    @Override
    public boolean equals(Object other) {
        if (!(other instanceof Customer)) return false;
        return id.equals(((Customer)other).id);
    }
}

// VALUE OBJECT: No identity, immutable, defined by attributes
public class Money {
    private final BigDecimal amount;
    private final String currency;

    public Money(BigDecimal amount, String currency) {
        this.amount = amount;
        this.currency = currency;
    }

    // Two Money objects with same amount/currency are equal
    @Override
    public boolean equals(Object other) {
        if (!(other instanceof Money)) return false;
        Money m = (Money) other;
        return amount.equals(m.amount) && currency.equals(m.currency);
    }

    // Immutable: return new instance
    public Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Different currencies");
        }
        return new Money(amount.add(other.amount), currency);
    }
}

// In Order aggregate:
public class Order {
    private OrderId id;  // Entity, has identity
    private Money total; // Value object, immutable
    private ShippingAddress address; // Value object

    public void setTotal(Money total) {
        this.total = total; // Replace entire object
    }
}
```

#### 4. Domain Events

Domain events capture something important that happened in the business domain.

```java
// Domain event
public class OrderSubmittedEvent {
    private final OrderId orderId;
    private final CustomerId customerId;
    private final LocalDateTime submittedAt;
    private final Money orderTotal;

    public OrderSubmittedEvent(OrderId orderId, CustomerId customerId, Money orderTotal) {
        this.orderId = orderId;
        this.customerId = customerId;
        this.orderTotal = orderTotal;
        this.submittedAt = LocalDateTime.now();
    }

    // Getters, no setters (immutable)
}

// Aggregate that publishes events
public class Order {
    private List<DomainEvent> domainEvents = new ArrayList<>();

    public void submit() {
        if (items.isEmpty()) {
            throw new OrderException("Cannot submit empty order");
        }
        status = OrderStatus.SUBMITTED;

        // Domain event captured
        domainEvents.add(new OrderSubmittedEvent(id, customerId, calculateTotal()));
    }

    // Called by persistence layer
    public List<DomainEvent> getDomainEvents() {
        return domainEvents;
    }

    public void clearDomainEvents() {
        domainEvents.clear();
    }
}

// Service that publishes events
@Service
public class SubmitOrderService {
    @Autowired
    private OrderRepository orderRepo;

    @Autowired
    private ApplicationEventPublisher eventPublisher;

    @Transactional
    public void submitOrder(OrderId orderId) {
        Order order = orderRepo.findById(orderId);
        order.submit();
        orderRepo.save(order);

        // Publish domain events
        order.getDomainEvents().forEach(eventPublisher::publishEvent);
        order.clearDomainEvents();
    }
}
```

**Why Domain Events Matter**:
- Enable loose coupling between services
- Create audit trail of what happened
- Enable event sourcing and CQRS
- Support saga pattern for distributed transactions

#### 5. Ubiquitous Language

A shared vocabulary between business stakeholders and developers.

```java
// BAD: Technical jargon
public class PaymentProcessor {
    public void processPaymentTx(Customer cust, double amnt, String curr) {
        // Implementation
    }
}

// GOOD: Business language (Ubiquitous Language)
public class PaymentService {
    public void processPayment(Customer customer, Money amount) {
        // Implementation - domain expert understands this
    }
}

// Domain model reflects business concepts
public enum OrderStatus {
    CREATED,           // Just created
    SUBMITTED,         // Customer clicked submit
    PAYMENT_APPROVED,  // Payment went through
    READY_FOR_PICKUP,  // In warehouse, waiting
    CANCELLED,         // Order was cancelled
    COMPLETED         // Customer received it
}

// NOT: PENDING, PROCESSING, etc. - too technical
```

---

## Decomposition Strategies

### Strategy 1: Decompose by Business Capability

Identify high-level business capabilities and create services around them.

```
Business Capabilities for E-Commerce:

┌──────────────────────────────────────────────────────┐
│         Product Catalog Management                  │
│  (Browse products, manage inventory, pricing)       │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│         Order Management                             │
│  (Create orders, track status, manage returns)      │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│         Payment Processing                           │
│  (Process payments, refunds, payment history)       │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│         Customer Management                          │
│  (Profiles, addresses, preferences, loyalty)        │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│         Shipping & Fulfillment                       │
│  (Picking, packing, shipping, tracking)             │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│         Notification                                 │
│  (Email, SMS, push notifications)                   │
└──────────────────────────────────────────────────────┘
```

**Advantages**:
- Aligned with how business thinks about domain
- Relatively stable (capabilities don't change often)
- Clear responsibility ownership

**Disadvantages**:
- May still result in large services
- Doesn't directly follow DDD principles

### Strategy 2: Decompose by Subdomain (DDD Approach)

Identify subdomains within a bounded context and create fine-grained services.

```
Product Management Subdomain (decomposed):

┌─────────────────────────────────────────┐
│         Core Domain: Products            │
│  (Product definition, attributes)       │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         Core Domain: Inventory           │
│  (Stock levels, reservations)           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         Supporting: Pricing              │
│  (Price calculations, promotions)       │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         Supporting: Reviews & Ratings    │
│  (Customer feedback)                    │
└─────────────────────────────────────────┘
```

**Advantages**:
- More fine-grained, easier to understand
- Better aligned with DDD
- Clearer boundaries

**Disadvantages**:
- More services to manage
- Higher coordination overhead
- Risk of over-decomposition

---

## Service Boundaries

### How to Define Service Boundaries

#### 1. Single Responsibility Principle

Each service should have one reason to change.

```java
// BAD: Multiple reasons to change
@RestController
@RequestMapping("/api")
public class UserProductPaymentController {

    // Changes if user management requirements change
    @PostMapping("/users")
    public void createUser(CreateUserRequest request) { }

    // Changes if product catalog requirements change
    @GetMapping("/products")
    public List<Product> getProducts() { }

    // Changes if payment requirements change
    @PostMapping("/payments")
    public void processPayment(PaymentRequest request) { }
}

// GOOD: Separate services by responsibility
@RestController
@RequestMapping("/api/users")
public class UserController {
    @PostMapping
    public void createUser(CreateUserRequest request) { }
}

@RestController
@RequestMapping("/api/products")
public class ProductController {
    @GetMapping
    public List<Product> getProducts() { }
}

@RestController
@RequestMapping("/api/payments")
public class PaymentController {
    @PostMapping
    public void processPayment(PaymentRequest request) { }
}
```

#### 2. Minimize Inter-Service Dependencies

Create services with minimal coupling.

```
BAD: High coupling with many sync calls

Order Service
    ├─ calls → Product Service
    ├─ calls → Payment Service
    ├─ calls → Customer Service
    ├─ calls → Inventory Service
    └─ calls → Shipping Service

If any service is down, Order Service fails.
```

```
GOOD: Async events, reduced coupling

Order Service (core logic)
    ├─ publishes → OrderSubmitted event
    ├─ publishes → OrderShipped event
    └─ subscribes ← PaymentApproved event

Product Service
    └─ subscribes ← OrderSubmitted event (updates inventory)

Payment Service
    ├─ subscribes ← OrderSubmitted event (processes payment)
    └─ publishes → PaymentApproved event

Shipping Service
    └─ subscribes ← PaymentApproved event (initiates shipment)

If Payment Service is down, Order is created but payment is eventually processed.
```

#### 3. Avoid Chatty Interfaces

If two services must talk frequently, they might belong together.

```java
// BAD: Chatty interface (Order Service calling Product Service multiple times)
@Service
public class OrderService {

    @Autowired
    private ProductClient productClient;

    @Transactional
    public void createOrder(CreateOrderRequest request) {
        Order order = new Order();

        for (OrderItemRequest item : request.getItems()) {
            // Call 1: Get product
            Product product = productClient.getProduct(item.getProductId());

            // Call 2: Check availability
            boolean available = productClient.checkAvailability(item.getProductId(), item.getQuantity());

            // Call 3: Get current price
            BigDecimal price = productClient.getPrice(item.getProductId());

            // Call 4: Reserve inventory
            productClient.reserveInventory(item.getProductId(), item.getQuantity());

            order.addItem(item.getProductId(), item.getQuantity(), price);
        }

        orderRepository.save(order);
    }
}

// GOOD: Bulk operation, fewer calls
@Service
public class OrderService {

    @Autowired
    private ProductClient productClient;

    @Transactional
    public void createOrder(CreateOrderRequest request) {
        Order order = new Order();

        // Single call: get all product info at once
        List<Long> productIds = request.getItems()
            .stream()
            .map(OrderItemRequest::getProductId)
            .collect(Collectors.toList());

        Map<Long, ProductInfo> products = productClient.getProductsInfo(productIds);

        for (OrderItemRequest item : request.getItems()) {
            ProductInfo productInfo = products.get(item.getProductId());

            if (!productInfo.isAvailable(item.getQuantity())) {
                throw new OutOfStockException(item.getProductId());
            }

            order.addItem(item.getProductId(), item.getQuantity(), productInfo.getPrice());
        }

        // Single call: reserve all inventory
        productClient.reserveInventory(request.getItems());

        orderRepository.save(order);
    }
}
```

### Common Mistakes in Defining Boundaries

1. **Shared Database** - Forces tight coupling
2. **One Entity = One Service** - Too fine-grained, chatty
3. **Following Technical Layers** - Service for persistence, one for logic
4. **Circular Dependencies** - Service A calls B, B calls A
5. **Ignoring Transactions** - Create services where one can't work without another
6. **Following Current Org Structure** - Rigid, can't evolve
7. **Business Anti-Patterns** - Services that don't respect business rules

---

## Twelve-Factor App Methodology

A methodology for building scalable, maintainable applications (including microservices).

### 1. Codebase

One codebase per service, tracked in version control.

```
ecommerce-system/
├── order-service/
│   ├── pom.xml
│   ├── .git
│   └── src/
├── payment-service/
│   ├── pom.xml
│   ├── .git
│   └── src/
└── product-service/
    ├── pom.xml
    ├── .git
    └── src/
```

### 2. Dependencies

Explicitly declare and isolate dependencies (Maven/Gradle).

```xml
<!-- pom.xml -->
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
        <version>3.2.0</version>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-jpa</artifactId>
        <version>3.2.0</version>
    </dependency>
</dependencies>
```

### 3. Config

Store configuration in environment variables, not code.

```java
// BAD: Config in code
public class DatabaseConfig {
    private static final String DB_URL = "jdbc:mysql://prod-db:3306/orders";
    private static final String DB_USER = "admin";
    private static final String DB_PASSWORD = "secretpassword123";
}

// GOOD: Config from environment
@Configuration
public class DatabaseConfig {

    @Bean
    public DataSource dataSource(
        @Value("${DB_HOST:localhost}") String host,
        @Value("${DB_PORT:3306}") int port,
        @Value("${DB_NAME:orders}") String dbName,
        @Value("${DB_USER}") String user,
        @Value("${DB_PASSWORD}") String password
    ) {
        return DataSourceBuilder.create()
            .driverClassName("com.mysql.cj.jdbc.Driver")
            .url(String.format("jdbc:mysql://%s:%d/%s", host, port, dbName))
            .username(user)
            .password(password)
            .build();
    }
}
```

application.yml:
```yaml
spring:
  datasource:
    url: ${DB_URL:jdbc:mysql://localhost:3306/orders}
    username: ${DB_USER:root}
    password: ${DB_PASSWORD:}
    driver-class-name: com.mysql.cj.jdbc.Driver
```

### 4. Backing Services

Treat backing services (DB, cache, messaging) as attached resources.

```java
@Configuration
public class ServiceConfiguration {

    // Treat as replaceable resource
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    @Bean
    public RedisConnectionFactory redisConnectionFactory(
        @Value("${REDIS_HOST:localhost}") String host,
        @Value("${REDIS_PORT:6379}") int port
    ) {
        return new LettuceConnectionFactory(new RedisStandaloneConfiguration(host, port));
    }

    @Bean
    public StringRedisTemplate stringRedisTemplate(RedisConnectionFactory connectionFactory) {
        return new StringRedisTemplate(connectionFactory);
    }
}
```

### 5. Build, Release, Run

Strict separation of build, release, and run stages.

```dockerfile
# Dockerfile - build stage
FROM maven:3.9-eclipse-temurin-17 AS builder
COPY . /app
WORKDIR /app
RUN mvn clean package -DskipTests

# Release stage
FROM eclipse-temurin:17-jre
COPY --from=builder /app/target/order-service.jar /app/order-service.jar
EXPOSE 8080
CMD ["java", "-jar", "/app/order-service.jar"]
```

Deployed via:
```bash
# Build
mvn clean package

# Release with config
docker build -t order-service:v1.2.3 .
docker push order-service:v1.2.3

# Run with environment
docker run \
  -e DB_HOST=prod-db \
  -e DB_USER=admin \
  -e DB_PASSWORD=secret \
  order-service:v1.2.3
```

### 6-12. Other Factors

- **Processes**: Stateless, share nothing
- **Port Binding**: Self-contained (embedded Tomcat)
- **Concurrency**: Scale horizontally, multiple instances
- **Disposability**: Fast startup, graceful shutdown
- **Dev/Prod Parity**: Same tools, services, OS across environments
- **Logs**: Write to stdout, aggregated by infrastructure
- **Admin Tasks**: One-off tasks run against live database with same config

---

## Conway's Law

"Any organization that designs a system will produce a design whose structure is a copy of the organization's communication structure." - Melvin Conway (1968)

### Implications for Microservices

```
Organization Structure:

Founder
├── CTO
├── Product Manager
├── Engineering Manager
│   ├── Backend Team (4 engineers)
│   │   ├── Order Domain Expert
│   │   ├── Inventory Domain Expert
│   │   └── 2 Developers
│   ├── Frontend Team (3 engineers)
│   └── DevOps (2 engineers)
└── Operations (1)

Will likely produce:

Services:
├── Order Service (owned by Order Domain Expert)
├── Inventory Service (owned by Inventory Domain Expert)
├── Frontend (owned by Frontend Team)
├── DevOps Shared (owned by DevOps)
└── Notification (shared, no owner)
```

### Reverse Conway Maneuver

Structure your organization to match desired architecture.

```
If you want:
- Order Service
- Payment Service
- Inventory Service
- Shipping Service
- Notification Service

Structure as:
- Squad 1: Order Service (5 engineers)
- Squad 2: Payment Service (3 engineers)
- Squad 3: Inventory + Shipping (6 engineers)
- Squad 4: Platform (DevOps, Monitoring, Shared Libraries)
- Squad 5: Notification (2 engineers)

Each squad:
- Owns their service completely
- Responsible for dev, test, deploy, monitor
- Has dedicated DevOps engineer or receives Platform support
- Can choose technology stack (with constraints)
- Autonomous decision-making
```

### Organizational Anti-Patterns

```
Problem: Silos (tight coupling in code, loose in organization)

Organization:
├── Backend Team → builds Order, Payment, Inventory services
└── Frontend Team → builds UI, talks to Backend Team

Result: Services heavily coupled, frequent coordination, slow delivery

Solution: Cross-functional squads

Organization:
├── Squad 1: Features A, B, C (backend + frontend + QA)
├── Squad 2: Features D, E, F (backend + frontend + QA)
├── Platform: Shared services, DevOps, Monitoring
```

---

## Microservices Maturity Model

### Level 0: Monolith

- Single codebase, single deployment unit
- All features in one process
- Shared database

### Level 1: Modular Monolith

- Multiple modules within one codebase
- Clear package structure
- Logical separation of concerns
- Still single deployment unit
- **Example**: Separate packages for user, order, payment but deployed together

```
package structure:
src/
├── com/ecommerce/user/
│   ├── UserController
│   ├── UserService
│   └── UserRepository
├── com/ecommerce/order/
│   ├── OrderController
│   ├── OrderService
│   └── OrderRepository
└── com/ecommerce/payment/
    ├── PaymentController
    ├── PaymentService
    └── PaymentRepository
```

### Level 2: Service Per Team

- One or two services per engineering team
- Services are coarse-grained (entire business domain)
- Possibly shared database between services (acceptable at this level)
- Independent deployment

```
Order Service (Team A owns everything about orders)
├── User/Customer logic
├── Order creation
├── Order fulfillment
├── Order analytics
└── Shared Order DB

Product Service (Team B owns everything about products)
├── Catalog
├── Inventory
├── Pricing
└── Shared Product DB
```

### Level 3: Domain-Driven Services

- Services aligned with business domains and DDD bounded contexts
- Multiple services per team possible
- Truly separate databases
- Async communication via events

```
Order Service (can be owned by Order Squad)
├── Order Aggregate
└── Order DB

Payment Service (can be owned by Order Squad or Payment Squad)
├── Payment Aggregate
└── Payment DB

Async integration via OrderSubmittedEvent → PaymentService processes payment
```

### Level 4: Platform & Ecosystem

- Dedicated Platform team providing infrastructure
- Teams focus on business features
- Standardized deployment (Kubernetes, Docker)
- Standardized monitoring (Prometheus, ELK)
- Standardized communication (REST, gRPC, event streams)
- Self-service DevOps capabilities

```
Platform provides:
├── Container orchestration (Kubernetes)
├── Service mesh (Istio)
├── Distributed tracing (Jaeger)
├── Centralized logging (ELK)
├── Metrics & monitoring (Prometheus, Grafana)
├── Secret management (Vault)
├── Configuration management (Consul/Spring Cloud Config)
└── API Gateway (Kong/Spring Cloud Gateway)

Each squad gets:
├── Deployment pipelines
├── Monitoring dashboards
├── Alerting
├── Log aggregation
└── Service discovery (automatic)
```

### Level 5: Autonomous & Resilient

- Services fail gracefully
- Chaotic engineering and fault tolerance
- Multiple data centers/regions
- Automatic scaling
- Self-healing capabilities

```
Netflix level operations:
- Simian Army (chaos engineering)
- Multi-region deployment with automatic failover
- Bulkhead isolation
- Circuit breaker everywhere
- Fallback strategies
- Graceful degradation
```

---

## Migration Strategies

### Strategy 1: Strangler Fig Pattern

Gradually replace the monolith by creating new microservices and routing old traffic to them.

```
Phase 1: New service alongside monolith

    ┌─────────────────┐
    │ API Gateway     │
    └────────┬────────┘
             │
       ┌─────┴─────┐
       │           │
    ┌──▼──┐   ┌────▼─────┐
    │New  │   │ Monolith  │
    │Order│   │ (original)│
    │Srvc │   └───────────┘
    └─────┘

Phase 2: Route more traffic to new services

    ┌─────────────────┐
    │ API Gateway     │
    └────────┬────────┘
             │
    ┌────────┴──────────┐
    │                   │
 ┌──▼──────┐  ┌────────┼──────┐
 │New Order│  │New Pay │Monolith
 │Service  │  │Service │
 │(100%)   │  │(70%)   │
 └─────────┘  └───┬────┴───┬──┘
               (30%)      (rest)

Phase 3: Decommission monolith

    ┌─────────────────┐
    │ API Gateway     │
    └────────┬────────┘
             │
    ┌────────┼───────────┐
    │        │           │
 ┌──▼──┐ ┌──▼──┐    ┌──▼──┐
 │Order│ │Pay  │ .. │User │
 │Srvc │ │Srvc │    │Srvc │
 └─────┘ └─────┘    └─────┘
```

**Implementation**:

```java
// API Gateway routes based on request type
@Configuration
public class GatewayConfiguration {

    @Bean
    public RouteLocator routes(RouteLocatorBuilder builder) {
        return builder.routes()
            // New Order Service
            .route("order-service", r -> r
                .path("/api/orders/**")
                .uri("http://order-service:8080"))

            // Still using monolith for other features
            .route("monolith-fallback", r -> r
                .path("/**")
                .uri("http://monolith:8080"))
            .build();
    }
}

// Monolith can call new services
@Service
public class OrderController {

    @Autowired
    private RestTemplate restTemplate;

    @PostMapping("/orders")
    public Order createOrder(CreateOrderRequest request) {
        // New service handles order creation
        return restTemplate.postForObject(
            "http://order-service:8080/api/orders",
            request,
            Order.class
        );
    }
}
```

### Strategy 2: Branch by Abstraction

Create an abstraction layer, gradually move functionality behind it.

```java
// Phase 1: Abstract behind interface
public interface PaymentProcessor {
    PaymentResult processPayment(PaymentRequest request);
}

// Monolith implementation
public class MonolithPaymentProcessor implements PaymentProcessor {
    public PaymentResult processPayment(PaymentRequest request) {
        // Original implementation
    }
}

// Wire up monolith version initially
@Configuration
public class PaymentConfiguration {
    @Bean
    public PaymentProcessor paymentProcessor() {
        return new MonolithPaymentProcessor();
    }
}

// Phase 2: Create new service implementation
public class PaymentServiceClient implements PaymentProcessor {

    @Autowired
    private RestTemplate restTemplate;

    public PaymentResult processPayment(PaymentRequest request) {
        return restTemplate.postForObject(
            "http://payment-service:8080/api/payments",
            request,
            PaymentResult.class
        );
    }
}

// Phase 3: Switch implementation gradually
@Configuration
public class PaymentConfiguration {

    @Bean
    public PaymentProcessor paymentProcessor(
        @Value("${payment.use-service:false}") boolean useService
    ) {
        if (useService) {
            return new PaymentServiceClient();  // New service
        } else {
            return new MonolithPaymentProcessor(); // Still monolith
        }
    }
}

// Even better: use decorator pattern to support both
@Component
public class SwitchingPaymentProcessor implements PaymentProcessor {

    private final PaymentProcessor monolith;
    private final PaymentProcessor service;
    private final double serviceTrafficPercentage;

    @Autowired
    public SwitchingPaymentProcessor(
        MonolithPaymentProcessor monolith,
        PaymentServiceClient service,
        @Value("${payment.service-traffic-percentage:0.0}") double percentage
    ) {
        this.monolith = monolith;
        this.service = service;
        this.serviceTrafficPercentage = percentage;
    }

    @Override
    public PaymentResult processPayment(PaymentRequest request) {
        boolean useService = Math.random() < serviceTrafficPercentage;

        if (useService) {
            try {
                return service.processPayment(request);
            } catch (Exception e) {
                // Fallback to monolith if service fails
                return monolith.processPayment(request);
            }
        } else {
            return monolith.processPayment(request);
        }
    }
}
```

---

## Common Interview Questions

### Q1: When should you NOT use microservices?

**Answer**: You should NOT use microservices when:

1. **Team is small** (< 5 engineers) - Overhead not justified, monolith is better
2. **Simple domain** - No complex scaling needs, monolith sufficient
3. **Early stage product** - Need to move fast, unknown requirements
4. **Tight data consistency required** - Distributed transactions are hard
5. **Performance critical** - In-process calls faster than network calls
6. **Low traffic/scale** - Operational overhead not justified
7. **Team not experienced with distributed systems** - High risk of failure

**Real world example**: A startup building a marketplace might use monolith for first year, split services when they hit specific scaling bottlenecks.

### Q2: How do you determine the right service boundaries?

**Answer**: Use combination of approaches:

1. **Business domains** (from DDD) - Start with bounded contexts
2. **Team structure** (Conway's Law) - Services align with team ownership
3. **Deployment cycles** - Services that change together stay together
4. **Scalability** - Separate services that need different scaling
5. **Technology** - Separate if different tech stacks needed
6. **Data** - Separate if different data models/schemas

```
Example: E-Commerce Service Boundaries

Too coarse (monolith masquerading as services):
- Product Catalog Service: 100,000 lines, 20 engineers
  Contains: products, reviews, recommendations, pricing, inventory

Correct granularity (DDD):
- Product Service: products, attributes
- Inventory Service: stock levels, reservations
- Pricing Service: price calculations, promotions
- Reviews Service: customer feedback, ratings
- Recommendation Service: ML-based recommendations
```

### Q3: Explain the difference between business capability and subdomain decomposition.

**Answer**:

**Business Capability Decomposition**:
- Identifies high-level business functions
- Coarser granularity
- What business does (browses products, makes payments, ships orders)
- More stable, changes less frequently

**Subdomain Decomposition** (DDD):
- Breaks down business capabilities into subdomains
- Finer granularity
- Separates core, supporting, and generic subdomains
- More aligned with how domain experts think

```
Business Capability → Subdomains

Product Catalog (capability)
├── Product Information (core subdomain)
├── Inventory Management (core subdomain)
├── Pricing Engine (supporting)
└── Reviews & Ratings (supporting)

Order Management (capability)
├── Order Processing (core)
├── Order Fulfillment (core)
├── Returns & Refunds (supporting)
└── Order Analytics (generic - could buy or build)
```

### Q4: What's a realistic migration plan from monolith to microservices?

**Answer**: Phased approach over 12-24 months:

```
Timeline:
Month 1-2: Assessment
- Identify bottlenecks and scaling issues
- Define domain boundaries
- Build infrastructure (Docker, K8s, CI/CD)

Month 3-6: Extract first service (Strangler Fig)
- Choose non-critical service (e.g., Notifications)
- Run alongside monolith
- Route traffic gradually
- Build operational maturity (monitoring, logging, deployment)

Month 7-12: Extract core services
- Extract Payment Service (critical)
- Extract Order Service (complex)
- Real distributed transaction challenges emerge
- Build saga pattern, event publishing

Month 13-18: Extract remaining services
- User Service, Product Service, Inventory Service
- Build resilience patterns
- Improve coordination across teams

Month 19-24: Monolith decommissioning
- Verify all functionality migrated
- Migrate data
- Decommission legacy system
- Optimize service-to-service communication
```

### Q5: How would you split a massive User Service?

**Answer**: Consider multiple axes:

```
User Service (50,000 lines, 10 engineers) - TOO BIG

Decompose by:

1. Business domain (DDD):
   - User Profile Service (personal info)
   - Authentication Service (login, security)
   - Authorization Service (permissions)
   - Notification Preferences Service

2. Scalability:
   - Session Management (high write rate, accessed frequently)
   - User Profile (read-heavy)
   - Authentication (CPU intensive, separate scaling)

3. Data affinity:
   - Real-time user data (profile, preferences)
   - Audit log (append-only)
   - Session data (ephemeral, Redis)

Result:
├── Authentication Service (6 engineers)
│   ├── Login/logout
│   ├── Password management
│   ├── Session management
│   └── DB: Users, Sessions, Audit
│
├── User Profile Service (3 engineers)
│   ├── Get/update user info
│   ├── Preferences
│   └── DB: User Profiles
│
└── Authorization Service (2 engineers)
    ├── Check permissions
    ├── Role management
    └── DB: Roles, Permissions
```

### Q6: What challenges did you face going from monolith to microservices in your experience?

**Answer** (if you have experience; otherwise speak hypothetically):

Common challenges:

1. **Operational complexity** - Now managing 10+ services instead of 1
   - Solution: Invest in automation, monitoring, CI/CD

2. **Data consistency** - Can't use ACID transactions across services
   - Solution: Embrace eventual consistency, implement sagas

3. **Debugging** - Errors span multiple services and networks
   - Solution: Implement distributed tracing (Sleuth/Zipkin)

4. **Testing** - Integration tests become complex
   - Solution: Contract testing, service isolation in tests

5. **Team coordination** - More teams, more potential conflicts
   - Solution: Clear API contracts, governance

6. **Network latency** - Suddenly dealing with network calls everywhere
   - Solution: Batch operations, cache aggressively, async where possible

7. **Deployment coordination** - Services with dependencies
   - Solution: Backward-compatible APIs, semantic versioning

---

## Key Takeaways for Interviews

1. **Microservices are not silver bullet** - Know when NOT to use them
2. **Start with organization** - Conway's Law is real
3. **Clear boundaries from start** - Using DDD principles
4. **Expect distributed system challenges** - Network, consistency, failure
5. **Plan migration carefully** - Strangler Fig pattern with gradual rollout
6. **Operational excellence required** - Monitoring, tracing, deployment automation
7. **Team structure matters** - 2 pizza teams, full ownership

