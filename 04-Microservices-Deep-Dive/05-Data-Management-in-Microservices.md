# Data Management in Microservices

## Table of Contents
1. [Database per Service Pattern](#database-per-service)
2. [Data Consistency](#data-consistency)
3. [Saga Pattern Deep Dive](#saga-pattern-deep-dive)
4. [Event Sourcing](#event-sourcing)
5. [CQRS Implementation](#cqrs-implementation)
6. [Distributed Caching](#distributed-caching)
7. [API Composition for Queries](#api-composition)
8. [Data Replication](#data-replication)
9. [Interview Questions](#interview-questions)

---

## Database per Service

Each service owns its database. No shared database between services.

### Why Database per Service?

```
Monolith (Shared Database):
┌──────────────────────────────────┐
│        Monolith App              │
├──────────────────────────────────┤
│ User Logic  │ Order Logic        │
│ Product     │ Payment Logic      │
│ Inventory   │ Notification       │
├──────────────────────────────────┤
│        Shared Database           │
│ Users | Orders | Products | ...  │
└──────────────────────────────────┘

Problems:
├─ If DB slow, entire app slow
├─ Schema changes affect all services
├─ Cannot optimize schema per service
├─ Tight coupling at database level
└─ Difficult to scale (only option: scale entire app)

Microservices (Database per Service):
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ Order Service  │ │Product Service │ │ Payment Service│
├────────────────┤ ├────────────────┤ ├────────────────┤
│  Order DB      │ │ Product DB     │ │ Payment DB     │
│ (normalized)   │ │ (denormalized) │ │ (optimized)    │
└────────────────┘ └────────────────┘ └────────────────┘

Benefits:
├─ Services scale independently
├─ Can use different DB tech (SQL vs NoSQL)
├─ Schema evolution independent
├─ Loose coupling
└─ Better performance per service

Tradeoffs:
├─ Distributed transactions complex
├─ Distributed queries harder
├─ Data consistency challenges
└─ More databases to operate
```

### Implementation

```java
// Order Service with its own database
@Configuration
@EnableJpaRepositories(
    basePackages = "com.ecommerce.order",
    entityManagerFactoryRef = "orderEntityManager",
    transactionManagerRef = "orderTransactionManager"
)
public class OrderDatabaseConfiguration {

    @Bean
    @ConfigurationProperties(prefix = "spring.datasource.order")
    public DataSource orderDataSource() {
        return DataSourceBuilder.create().build();
    }

    @Bean
    public LocalContainerEntityManagerFactoryBean orderEntityManager(
        @Qualifier("orderDataSource") DataSource dataSource,
        EntityManagerFactoryBuilder builder
    ) {
        return builder
            .dataSource(dataSource)
            .packages("com.ecommerce.order.entity")
            .persistenceUnit("order")
            .build();
    }

    @Bean
    public PlatformTransactionManager orderTransactionManager(
        @Qualifier("orderEntityManager") LocalContainerEntityManagerFactoryBean emf
    ) {
        return new JpaTransactionManager(emf.getObject());
    }
}

// Product Service with different database technology
@Configuration
@EnableMongoRepositories(basePackages = "com.ecommerce.product")
public class ProductDatabaseConfiguration {

    @Bean
    public MongoTemplate mongoTemplate(MongoClient mongoClient, MongoDatabaseFactory mongoDatabaseFactory) {
        return new MongoTemplate(mongoDatabaseFactory);
    }
}

// application.yml
spring:
  datasource:
    order:
      url: jdbc:mysql://order-db:3306/order_service
      username: ${DB_USER}
      password: ${DB_PASSWORD}
      driver-class-name: com.mysql.cj.jdbc.Driver

  data:
    mongodb:
      uri: mongodb://product-db:27017/product_service

# Order Service entities
@Entity
@Table(name = "orders")
public class Order {
    @Id
    private Long id;
    private Long customerId;
    private LocalDateTime createdAt;
    // Normalized schema, optimized for transactions
}

# Product Service entities (MongoDB)
@Document(collection = "products")
public class Product {
    @Id
    private String id;
    private String name;
    private List<Review> reviews;        // Embedded
    private Map<String, Object> metadata; // Flexible schema
    // Denormalized schema, optimized for querying
}
```

### Shared Database Anti-Pattern

```java
// BAD: Multiple services using same database
@Entity
@Table(name = "orders")
public class Order {
    @Id
    private Long id;
    private Long customerId;
    private String productId;           // Foreign key to product_service schema
    private String paymentStatus;       // Payment service updates this
    private String shippingStatus;      // Shipping service updates this
}

// Problems:
// 1. Order service depends on payment schema
// 2. If payment adds new column, order service broken
// 3. Services tightly coupled at database level
// 4. Difficult to migrate payment to different database
// 5. Cannot optimize schema per service

// GOOD: Each service has own database
// Order Service only has order-specific data
@Entity
@Table(name = "orders")
public class Order {
    @Id
    private Long id;
    private Long customerId;
    @Embedded
    private OrderItem[] items;
    private LocalDateTime createdAt;
}

// Payment Service has its own payment database
@Entity
@Table(name = "payments")
public class Payment {
    @Id
    private Long id;
    private Long orderId;               // Reference, not foreign key
    private BigDecimal amount;
    private PaymentStatus status;
    private String transactionId;
}

// Services communicate via events or APIs, not shared database
```

---

## Data Consistency

### Eventual vs Strong Consistency

```
STRONG CONSISTENCY:
Account A: $100      Account B: $50
Transfer $30 from A to B

Atomic transaction:
1. A: $100 → $70
2. B: $50 → $80
Both succeed or both fail

If you query at any point, you see consistent state

EVENTUAL CONSISTENCY:
Order Service submits order
Payment Service processes payment (asynchronously)

States:
1. Order created, payment pending
2. Payment processed
3. Order marked as paid

Between these states, system is inconsistent
Application must tolerate this

When to use STRONG:
├─ Financial transactions (money must not disappear)
├─ Inventory (cannot oversell)
└─ ACID critical operations

When to use EVENTUAL:
├─ Recommendations (slightly stale is OK)
├─ View counts (eventual accuracy sufficient)
├─ User notifications (can be delayed)
└─ Analytics (eventual consistency acceptable)
```

### Handling Eventual Consistency

```java
// Order is created but payment not yet processed
@Entity
public class Order {
    @Id
    private Long id;
    private Long customerId;

    @Enumerated(EnumType.STRING)
    private OrderStatus orderStatus;       // CREATED, PAYMENT_PENDING, PAYMENT_APPROVED

    @Enumerated(EnumType.STRING)
    private PaymentStatus paymentStatus;   // PENDING, APPROVED, FAILED

    private LocalDateTime paymentReceivedAt;
}

// Client must handle pending states
@RestController
public class OrderController {

    @GetMapping("/{id}")
    public Order getOrder(@PathVariable Long id) {
        Order order = orderService.findById(id);

        // Client sees order with PAYMENT_PENDING status
        // Knows to check back later or use event notification
        return order;
    }
}

// Polling for completion
@Component
public class OrderStatusPoller {

    @Autowired
    private OrderService orderService;

    @Scheduled(fixedDelay = 5000)  // Check every 5 seconds
    public void pollOrderStatus() {
        List<Order> pendingOrders = orderService.findByPaymentStatus(PaymentStatus.PENDING);

        pendingOrders.forEach(order -> {
            // Check if payment was processed
            Payment payment = paymentService.getPayment(order.getId());

            if (payment.isApproved()) {
                // Update order status
                order.markPaymentApproved();
                orderService.save(order);

                // Notify user
                notificationService.sendOrderConfirmation(order.getCustomerId());
            }
        });
    }
}

// Better: Event notification
@Component
public class PaymentEventListener {

    @KafkaListener(topics = "payments", groupId = "order-service")
    public void onPaymentProcessed(PaymentProcessedEvent event) {
        Order order = orderService.findById(event.getOrderId());
        order.markPaymentApproved();
        orderService.save(order);

        // User notified immediately when payment completes
        notificationService.sendOrderConfirmation(order.getCustomerId());
    }
}
```

---

## Saga Pattern Deep Dive

Managing distributed transactions across services without ACID.

### Choreography-Based Saga (Event-Driven)

```
Each service publishes events, others react independently

Order Creation Saga:

1. Client calls Order Service
   Order Service
   ├─ Create order (PENDING)
   └─ Publish: OrderCreated
        ├─ orderId, customerId, items, total
        └─ Event published to Kafka

2. Payment Service listens to OrderCreated
   Payment Service
   ├─ Try to process payment
   ├─ If success: Publish: PaymentApproved
   └─ If fail: Publish: PaymentFailed
         └─ Reason for failure

3. If PaymentFailed:
   Order Service listens to PaymentFailed
   ├─ Update order status to CANCELLED
   └─ Publish: OrderCancelled

4. If PaymentApproved:
   Inventory Service listens to PaymentApproved
   ├─ Try to reserve items
   ├─ If success: Publish: InventoryReserved
   └─ If fail: Publish: InventoryReservationFailed
         └─ Order Service listens and cancels order
         └─ Payment Service listens and refunds payment

5. If InventoryReserved:
   Shipping Service listens
   ├─ Create shipment
   └─ Publish: ShipmentCreated
         └─ Order Service listens and marks COMPLETED
```

```java
// Domain events
public class OrderCreatedEvent {
    private Long orderId;
    private Long customerId;
    private List<OrderItem> items;
    private BigDecimal total;
    // Immutable event
}

public class PaymentApprovedEvent {
    private Long orderId;
    private Long paymentId;
    private BigDecimal amount;
}

public class PaymentFailedEvent {
    private Long orderId;
    private String reason;
}

// Order Service
@Service
public class OrderService {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private KafkaTemplate<String, OrderCreatedEvent> kafkaTemplate;

    // Step 1: Create order
    @Transactional
    public void createOrder(CreateOrderRequest request) {
        Order order = new Order();
        order.setCustomerId(request.getCustomerId());
        order.setItems(request.getItems());
        order.setTotal(request.getTotal());
        order.setStatus(OrderStatus.PENDING);

        orderRepository.save(order);

        // Publish event
        OrderCreatedEvent event = new OrderCreatedEvent(
            order.getId(),
            order.getCustomerId(),
            order.getItems(),
            order.getTotal()
        );

        kafkaTemplate.send("orders", event);
    }

    // Step 3: Listen for payment result
    @KafkaListener(topics = "payments", groupId = "order-service")
    public void onPaymentResult(PaymentEvent event) {
        Order order = orderRepository.findById(event.getOrderId()).orElseThrow();

        if (event instanceof PaymentApprovedEvent) {
            order.setPaymentApprovedAt(LocalDateTime.now());
            // Wait for inventory, don't mark completed yet
        } else if (event instanceof PaymentFailedEvent) {
            order.setStatus(OrderStatus.CANCELLED);
            order.setCancellationReason(((PaymentFailedEvent) event).getReason());
        }

        orderRepository.save(order);
    }

    // Step 5: Listen for shipment created
    @KafkaListener(topics = "shipments", groupId = "order-service")
    public void onShipmentCreated(ShipmentCreatedEvent event) {
        Order order = orderRepository.findById(event.getOrderId()).orElseThrow();
        order.setStatus(OrderStatus.COMPLETED);
        order.setShipmentId(event.getShipmentId());

        orderRepository.save(order);
    }
}

// Payment Service
@Service
public class PaymentService {

    @Autowired
    private PaymentRepository paymentRepository;

    @Autowired
    private KafkaTemplate<String, PaymentEvent> kafkaTemplate;

    // Step 2: Listen for order creation
    @KafkaListener(topics = "orders", groupId = "payment-service")
    public void onOrderCreated(OrderCreatedEvent event) {
        try {
            Payment payment = processPaymentWithProvider(event.getOrderId(), event.getTotal());

            paymentRepository.save(payment);

            // Publish success
            PaymentApprovedEvent approvedEvent = new PaymentApprovedEvent(
                event.getOrderId(),
                payment.getId(),
                payment.getAmount()
            );

            kafkaTemplate.send("payments", approvedEvent);
        } catch (PaymentException e) {
            // Publish failure
            PaymentFailedEvent failedEvent = new PaymentFailedEvent(
                event.getOrderId(),
                e.getMessage()
            );

            kafkaTemplate.send("payments", failedEvent);
        }
    }

    private Payment processPaymentWithProvider(Long orderId, BigDecimal amount) {
        // Call Stripe/PayPal API
        return new Payment();
    }
}

// Inventory Service
@Service
public class InventoryService {

    @Autowired
    private InventoryRepository inventoryRepository;

    @Autowired
    private KafkaTemplate<String, InventoryEvent> kafkaTemplate;

    // Step 4: Listen for payment approval
    @KafkaListener(topics = "payments", groupId = "inventory-service")
    public void onPaymentApproved(PaymentApprovedEvent event) {
        try {
            // Fetch order details
            Order order = orderService.getOrder(event.getOrderId());

            // Reserve inventory
            for (OrderItem item : order.getItems()) {
                inventoryRepository.reserveItem(item.getProductId(), item.getQuantity());
            }

            // Publish success
            InventoryReservedEvent reservedEvent = new InventoryReservedEvent(
                event.getOrderId(),
                order.getItems()
            );

            kafkaTemplate.send("inventory", reservedEvent);
        } catch (OutOfStockException e) {
            // Publish failure - triggers compensation
            InventoryReservationFailedEvent failedEvent = new InventoryReservationFailedEvent(
                event.getOrderId(),
                e.getMessage()
            );

            kafkaTemplate.send("inventory", failedEvent);

            // Trigger refund
            kafkaTemplate.send("refunds", new RefundRequest(event.getOrderId()));
        }
    }
}
```

### Orchestration-Based Saga (Centralized Control)

```java
// Single orchestrator coordinates the workflow
@Service
public class OrderSagaOrchestrator {

    @Autowired
    private OrderServiceClient orderService;

    @Autowired
    private PaymentServiceClient paymentService;

    @Autowired
    private InventoryServiceClient inventoryService;

    @Autowired
    private ShippingServiceClient shippingService;

    public void processOrder(CreateOrderRequest request) {
        String orderId = null;
        String paymentId = null;
        String reservationId = null;

        try {
            // Step 1: Create order
            orderId = orderService.createOrder(request);
            logger.info("Order created: {}", orderId);

            // Step 2: Process payment
            paymentId = paymentService.processPayment(orderId, request.getTotal());
            logger.info("Payment processed: {}", paymentId);

            // Step 3: Reserve inventory
            reservationId = inventoryService.reserveInventory(orderId, request.getItems());
            logger.info("Inventory reserved: {}", reservationId);

            // Step 4: Create shipment
            String shipmentId = shippingService.createShipment(orderId);
            logger.info("Shipment created: {}", shipmentId);

            // Step 5: Mark order complete
            orderService.markCompleted(orderId);

        } catch (PaymentFailedException e) {
            // Compensation: only order was created, just mark cancelled
            logger.error("Payment failed for order: {}", orderId, e);
            if (orderId != null) {
                orderService.markCancelled(orderId, "Payment failed: " + e.getMessage());
            }
            throw e;

        } catch (InventoryException e) {
            // Compensation: order created, payment done, need to refund and release
            logger.error("Inventory unavailable for order: {}", orderId, e);

            if (paymentId != null) {
                paymentService.refund(paymentId);
            }

            if (orderId != null) {
                orderService.markCancelled(orderId, "Inventory unavailable: " + e.getMessage());
            }

            throw e;

        } catch (ShippingException e) {
            // Compensation: everything done, only shipment failed
            logger.error("Shipping failed for order: {}", orderId, e);

            if (reservationId != null) {
                inventoryService.releaseReservation(reservationId);
            }

            if (paymentId != null) {
                paymentService.refund(paymentId);
            }

            if (orderId != null) {
                orderService.markCancelled(orderId, "Shipping unavailable: " + e.getMessage());
            }

            throw e;
        }
    }
}
```

### Choreography vs Orchestration

| Aspect | Choreography | Orchestration |
|--------|--------------|---------------|
| **Control** | Distributed, implicit | Centralized, explicit |
| **Visibility** | Flow hidden in events | Clear step-by-step |
| **Debugging** | Hard (flow across multiple services) | Easy (single point to debug) |
| **Coupling** | Loose (via events) | Tight (via orchestrator) |
| **Scalability** | Scales well | Orchestrator can bottleneck |
| **New service** | Add listener, pick relevant events | Update orchestrator |
| **Failure handling** | Each service handles its failures | Orchestrator coordinates |

---

## Event Sourcing

Store complete history of state changes as immutable events.

```
Traditional approach:
Current State:
├─ Order ID: 123
├─ Status: COMPLETED
├─ Total: $99.99

Problem: No audit trail, can't know how we got here

Event Sourcing approach:
Event Log (immutable, append-only):
├─ OrderCreatedEvent (OrderId=123, CustomerId=456, Total=$99.99)
├─ OrderSubmittedEvent (OrderId=123)
├─ PaymentApprovedEvent (OrderId=123, Amount=$99.99)
├─ InventoryReservedEvent (OrderId=123, Items=[...])
└─ OrderShippedEvent (OrderId=123, ShipmentId=789)

Current state derived by replaying all events

Advantages:
├─ Complete audit trail
├─ Can replay any point in time
├─ Easy debugging (see exactly what happened)
├─ Natural event-driven architecture
└─ Temporal queries (what was state at time T?)

Disadvantages:
├─ Complex to implement correctly
├─ Event schema evolution challenging
├─ Eventually consistent (rebuilding state takes time)
└─ Storage grows indefinitely
```

### Event Sourcing Implementation

```java
// Event (immutable)
public abstract class DomainEvent {
    private String eventId;
    private String aggregateId;
    private LocalDateTime timestamp;
    private int version;

    // Getters, no setters
}

public class OrderCreatedEvent extends DomainEvent {
    private Long customerId;
    private List<OrderItem> items;
    private BigDecimal total;
}

public class PaymentApprovedEvent extends DomainEvent {
    private BigDecimal amount;
    private String transactionId;
}

// Event store (persistence)
@Entity
@Table(name = "event_store")
public class EventStoreEntry {
    @Id
    private String eventId;

    @Column(name = "aggregate_id")
    private String aggregateId;

    @Enumerated(EnumType.STRING)
    private String eventType;

    @Column(columnDefinition = "TEXT")
    private String eventData;  // JSON serialized event

    @Column(name = "event_version")
    private int version;

    @CreationTimestamp
    private LocalDateTime createdAt;
}

// Repository
public interface EventStoreRepository extends JpaRepository<EventStoreEntry, String> {
    List<EventStoreEntry> findByAggregateIdOrderByVersion(String aggregateId);
}

// Event store service
@Service
public class EventStore {

    @Autowired
    private EventStoreRepository eventStoreRepository;

    @Autowired
    private ObjectMapper objectMapper;

    // Append event
    @Transactional
    public void append(String aggregateId, DomainEvent event) {
        EventStoreEntry entry = new EventStoreEntry();
        entry.setEventId(UUID.randomUUID().toString());
        entry.setAggregateId(aggregateId);
        entry.setEventType(event.getClass().getSimpleName());
        entry.setEventData(objectMapper.writeValueAsString(event));
        entry.setVersion(getNextVersion(aggregateId));

        eventStoreRepository.save(entry);

        // Publish event for event handlers
        publishEvent(event);
    }

    // Reconstruct aggregate from events
    public Order reconstructOrder(String orderId) {
        List<EventStoreEntry> events = eventStoreRepository
            .findByAggregateIdOrderByVersion(orderId);

        Order order = new Order();

        for (EventStoreEntry entry : events) {
            DomainEvent event = deserializeEvent(entry);
            order.apply(event);  // Replay event
        }

        return order;
    }

    private int getNextVersion(String aggregateId) {
        Optional<EventStoreEntry> latest = eventStoreRepository
            .findByAggregateIdOrderByVersion(aggregateId)
            .stream()
            .reduce((first, second) -> second);

        return latest.map(e -> e.getVersion() + 1).orElse(1);
    }

    private DomainEvent deserializeEvent(EventStoreEntry entry) {
        Class<?> eventClass = ClassUtils.forName(
            "com.example.events." + entry.getEventType(),
            getClass().getClassLoader()
        );

        return objectMapper.readValue(entry.getEventData(), eventClass);
    }
}

// Aggregate that applies events
public class Order {
    private String orderId;
    private Long customerId;
    private List<OrderItem> items;
    private OrderStatus status;
    private int version;

    // Apply event to current aggregate
    public void apply(DomainEvent event) {
        if (event instanceof OrderCreatedEvent) {
            OrderCreatedEvent e = (OrderCreatedEvent) event;
            this.orderId = e.getAggregateId();
            this.customerId = e.getCustomerId();
            this.items = e.getItems();
            this.status = OrderStatus.CREATED;
            this.version++;

        } else if (event instanceof PaymentApprovedEvent) {
            this.status = OrderStatus.PAYMENT_APPROVED;
            this.version++;

        } else if (event instanceof OrderShippedEvent) {
            this.status = OrderStatus.SHIPPED;
            this.version++;
        }
    }

    // Generate events for actions
    public OrderCreatedEvent create(Long customerId, List<OrderItem> items, BigDecimal total) {
        return new OrderCreatedEvent(
            this.orderId,
            customerId,
            items,
            total
        );
    }

    public PaymentApprovedEvent approvePayment(BigDecimal amount, String transactionId) {
        return new PaymentApprovedEvent(
            this.orderId,
            amount,
            transactionId
        );
    }
}

// Using event sourcing
@Service
public class OrderServiceWithEventSourcing {

    @Autowired
    private EventStore eventStore;

    @Transactional
    public String createOrder(CreateOrderRequest request) {
        String orderId = UUID.randomUUID().toString();

        Order order = new Order(orderId);
        OrderCreatedEvent event = order.create(
            request.getCustomerId(),
            request.getItems(),
            request.getTotal()
        );

        eventStore.append(orderId, event);

        return orderId;
    }

    public Order getOrder(String orderId) {
        return eventStore.reconstructOrder(orderId);
    }

    // Get order state at specific time
    public Order getOrderAtTime(String orderId, LocalDateTime time) {
        List<EventStoreEntry> events = eventStoreRepository
            .findByAggregateIdOrderByVersion(orderId)
            .stream()
            .filter(e -> e.getCreatedAt().isBefore(time))
            .collect(Collectors.toList());

        Order order = new Order(orderId);
        events.forEach(e -> order.apply(deserializeEvent(e)));

        return order;
    }
}
```

### Event Store with Snapshots

```java
// Snapshot: cached state at specific version
@Entity
@Table(name = "snapshots")
public class Snapshot {
    @Id
    private String snapshotId;

    private String aggregateId;
    private int version;

    @Column(columnDefinition = "TEXT")
    private String aggregateData;  // Serialized Order

    private LocalDateTime createdAt;
}

// Using snapshots for performance
@Service
public class EventStoreWithSnapshots {

    private static final int SNAPSHOT_THRESHOLD = 10;  // Every 10 events

    @Autowired
    private EventStoreRepository eventStoreRepository;

    @Autowired
    private SnapshotRepository snapshotRepository;

    public Order reconstructOrder(String orderId) {
        // Try to find latest snapshot
        Optional<Snapshot> latestSnapshot = snapshotRepository
            .findByAggregateIdOrderByVersionDesc(orderId)
            .stream()
            .findFirst();

        Order order;
        int eventsFromVersion = 0;

        if (latestSnapshot.isPresent()) {
            // Start from snapshot
            order = deserializeOrder(latestSnapshot.get().getAggregateData());
            eventsFromVersion = latestSnapshot.get().getVersion();
        } else {
            // Start from beginning
            order = new Order(orderId);
        }

        // Replay events since snapshot
        List<EventStoreEntry> events = eventStoreRepository
            .findByAggregateIdAndVersionGreaterThanOrderByVersion(orderId, eventsFromVersion);

        for (EventStoreEntry entry : events) {
            order.apply(deserializeEvent(entry));
        }

        return order;
    }

    @Transactional
    public void append(String aggregateId, DomainEvent event) {
        int currentVersion = getNextVersion(aggregateId);

        EventStoreEntry entry = new EventStoreEntry(aggregateId, event, currentVersion);
        eventStoreRepository.save(entry);

        // Create snapshot every N events
        if (currentVersion % SNAPSHOT_THRESHOLD == 0) {
            Order order = reconstructOrder(aggregateId);

            Snapshot snapshot = new Snapshot();
            snapshot.setSnapshotId(UUID.randomUUID().toString());
            snapshot.setAggregateId(aggregateId);
            snapshot.setVersion(currentVersion);
            snapshot.setAggregateData(serializeOrder(order));

            snapshotRepository.save(snapshot);
        }
    }
}
```

---

## CQRS Implementation

```java
// CQRS: Command side (write) and Query side (read)

// Command side: Accept commands, produce events
@Service
public class OrderCommandService {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private EventPublisher eventPublisher;

    @Transactional
    public String submitOrder(SubmitOrderCommand command) {
        Order order = new Order();
        order.setCustomerId(command.getCustomerId());
        order.setItems(command.getItems());
        order.setTotal(command.getTotal());

        order = orderRepository.save(order);

        // Publish event for read side
        eventPublisher.publish(new OrderSubmittedEvent(
            order.getId(),
            order.getCustomerId(),
            order.getTotal()
        ));

        return order.getId();
    }

    @Transactional
    public void shipOrder(ShipOrderCommand command) {
        Order order = orderRepository.findById(command.getOrderId()).orElseThrow();
        order.setStatus(OrderStatus.SHIPPED);

        orderRepository.save(order);

        eventPublisher.publish(new OrderShippedEvent(
            order.getId(),
            command.getShipmentId()
        ));
    }
}

// Query side: Optimized for read, updated from events
@Service
public class OrderQueryService {

    @Autowired
    private OrderViewRepository orderViewRepository;

    public OrderSummary getOrderSummary(Long orderId) {
        OrderView view = orderViewRepository.findById(orderId).orElseThrow();

        return new OrderSummary(
            view.getOrderId(),
            view.getStatus(),
            view.getTotal(),
            view.getItemCount(),
            view.getEstimatedDelivery()
        );
    }

    public Page<OrderListItem> searchOrders(String query, Pageable pageable) {
        return orderViewRepository.searchByCustomerNameOrId(query, pageable)
            .map(view -> new OrderListItem(
                view.getOrderId(),
                view.getCustomerName(),
                view.getTotal(),
                view.getStatus()
            ));
    }

    public OrderAnalytics getAnalytics(LocalDate startDate, LocalDate endDate) {
        List<OrderView> orders = orderViewRepository
            .findByCreatedAtBetween(startDate.atStartOfDay(), endDate.atTime(23, 59, 59));

        return new OrderAnalytics(
            orders.size(),
            orders.stream().map(OrderView::getTotal).reduce(BigDecimal.ZERO, BigDecimal::add),
            calculateMetrics(orders)
        );
    }
}

// Read model: OrderView (denormalized)
@Entity
@Table(name = "order_view")
@Document(value = "orders")  // Could be MongoDB
public class OrderView {
    @Id
    private Long orderId;

    private Long customerId;
    private String customerName;        // Denormalized from customer
    private String customerEmail;

    private BigDecimal total;
    private int itemCount;
    private LocalDate estimatedDelivery;

    @Enumerated(EnumType.STRING)
    private OrderStatus status;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @ElementCollection
    private List<String> productNames;  // For text search

    @Index  // Fast text search
    private String searchText;          // Denormalized search index
}

// Event projector: updates read model from events
@Service
public class OrderViewProjector {

    @Autowired
    private OrderViewRepository orderViewRepository;

    @Autowired
    private CustomerClient customerClient;

    @EventListener(OrderSubmittedEvent.class)
    public void onOrderSubmitted(OrderSubmittedEvent event) {
        Customer customer = customerClient.getCustomer(event.getCustomerId());

        OrderView view = new OrderView();
        view.setOrderId(event.getOrderId());
        view.setCustomerId(event.getCustomerId());
        view.setCustomerName(customer.getName());
        view.setCustomerEmail(customer.getEmail());
        view.setTotal(event.getTotal());
        view.setStatus(OrderStatus.SUBMITTED);
        view.setCreatedAt(LocalDateTime.now());

        orderViewRepository.save(view);
    }

    @EventListener(OrderShippedEvent.class)
    public void onOrderShipped(OrderShippedEvent event) {
        OrderView view = orderViewRepository.findById(event.getOrderId()).orElseThrow();
        view.setStatus(OrderStatus.SHIPPED);
        view.setEstimatedDelivery(calculateEstimated());

        orderViewRepository.save(view);
    }

    // Handle read model consistency
    @EventListener
    public void onEvent(DomainEvent event) {
        // Ensure read model is consistent with write model
        // If event processing fails, retry logic, dead letter queue, etc.
    }
}
```

---

## Distributed Caching

### Redis Cache Strategies

```
CACHE-ASIDE (Lazy Loading):
Client
  │
  ├─ Check cache
  │   ├─ Hit: return data
  │   └─ Miss: fetch from DB
  │            ├─ Update cache
  │            └─ Return data

WRITE-THROUGH:
Client writes data
  ├─ Write to cache
  ├─ Write to DB
  └─ Return to client

Both always in sync
More consistent, slower writes

WRITE-BEHIND (Write-Back):
Client writes data
  ├─ Write to cache only
  ├─ Return to client immediately
  ├─ Async write to DB
  └─ Higher risk of data loss if cache fails
```

```java
@Configuration
public class CacheConfiguration {

    @Bean
    public StringRedisTemplate stringRedisTemplate(RedisConnectionFactory connectionFactory) {
        return new StringRedisTemplate(connectionFactory);
    }

    @Bean
    public RedisTemplate<String, Product> productRedisTemplate(RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, Product> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);

        Jackson2JsonRedisSerializer<Product> jackson2JsonRedisSerializer =
            new Jackson2JsonRedisSerializer<>(Product.class);

        ObjectMapper mapper = new ObjectMapper();
        mapper.activateDefaultTyping(mapper.getPolymorphicTypeValidator(), ObjectMapper.DefaultTyping.NON_FINAL);
        jackson2JsonRedisSerializer.setObjectMapper(mapper);

        StringRedisSerializer stringSerializer = new StringRedisSerializer();

        template.setKeySerializer(stringSerializer);
        template.setValueSerializer(jackson2JsonRedisSerializer);
        template.setHashKeySerializer(stringSerializer);
        template.setHashValueSerializer(jackson2JsonRedisSerializer);

        template.afterPropertiesSet();

        return template;
    }
}

// Cache-Aside Pattern
@Service
public class ProductServiceCacheAside {

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private RedisTemplate<String, Product> redisTemplate;

    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;

        // Try cache first
        Product cached = redisTemplate.opsForValue().get(cacheKey);

        if (cached != null) {
            logger.info("Cache hit for product: {}", productId);
            return cached;
        }

        logger.info("Cache miss for product: {}", productId);

        // Fetch from database
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));

        // Update cache (expire after 1 hour)
        redisTemplate.opsForValue().set(
            cacheKey,
            product,
            Duration.ofHours(1)
        );

        return product;
    }
}

// Write-Through Pattern
@Service
public class ProductServiceWriteThrough {

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private RedisTemplate<String, Product> redisTemplate;

    @Transactional
    public Product updateProduct(Long productId, UpdateProductRequest request) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));

        product.setName(request.getName());
        product.setPrice(request.getPrice());

        // Write to database
        productRepository.save(product);

        // Write to cache
        String cacheKey = "product:" + productId;
        redisTemplate.opsForValue().set(
            cacheKey,
            product,
            Duration.ofHours(1)
        );

        return product;
    }

    @Transactional
    public void deleteProduct(Long productId) {
        productRepository.deleteById(productId);

        // Invalidate cache
        String cacheKey = "product:" + productId;
        redisTemplate.delete(cacheKey);
    }
}

// Write-Behind Pattern
@Service
public class ProductServiceWriteBehind {

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private RedisTemplate<String, Product> redisTemplate;

    @Autowired
    private TaskExecutor taskExecutor;

    public void updateProduct(Long productId, UpdateProductRequest request) {
        Product product = new Product();
        product.setId(productId);
        product.setName(request.getName());
        product.setPrice(request.getPrice());

        String cacheKey = "product:" + productId;

        // Write to cache immediately
        redisTemplate.opsForValue().set(
            cacheKey,
            product,
            Duration.ofHours(1)
        );

        // Return to client immediately

        // Write to database asynchronously
        taskExecutor.execute(() -> {
            try {
                productRepository.save(product);
                logger.info("Product updated in database: {}", productId);
            } catch (Exception e) {
                logger.error("Failed to update product in database: {}", productId, e);
                // Could implement retry logic here
            }
        });
    }
}

// Cache Invalidation Patterns

// Pattern 1: TTL-based
redisTemplate.opsForValue().set(
    cacheKey,
    product,
    Duration.ofMinutes(30)  // Auto-expire after 30 minutes
);

// Pattern 2: Event-based invalidation
@EventListener(ProductUpdatedEvent.class)
public void onProductUpdated(ProductUpdatedEvent event) {
    String cacheKey = "product:" + event.getProductId();
    redisTemplate.delete(cacheKey);  // Invalidate cache
}

// Pattern 3: Wildcard invalidation
@EventListener(PriceChangedEvent.class)
public void onPriceChanged(PriceChangedEvent event) {
    // Invalidate all caches for product (including derived)
    Set<String> keys = redisTemplate.keys("product:" + event.getProductId() + "*");
    if (!keys.isEmpty()) {
        redisTemplate.delete(keys);
    }
}

// Pattern 4: Cache warming
@Component
public class CacheWarmer {

    @Autowired
    private RedisTemplate<String, Product> redisTemplate;

    @EventListener(ApplicationReadyEvent.class)
    public void warmCache() {
        List<Product> topProducts = productRepository.findTopProducts(100);

        topProducts.forEach(product -> {
            String cacheKey = "product:" + product.getId();
            redisTemplate.opsForValue().set(
                cacheKey,
                product,
                Duration.ofHours(1)
            );
        });

        logger.info("Cache warmed with {} products", topProducts.size());
    }
}
```

### Cache Invalidation Challenges

```
Cache Invalidation: One of the hardest problems in computer science

Problem:
┌─────────────────────────────────┐
│   Cache: Product #123           │
│   Price: $99.99                 │
│   Expires: 1 hour               │
└─────────────────────────────────┘

Price updated to $89.99

Options:
1. Invalidate immediately
   └─ Consistent but forces cache misses

2. Wait for TTL to expire
   └─ Stale data served for up to 1 hour

3. Use event-based invalidation
   └─ Fast and consistent but requires orchestration

4. Use versioning
   └─ Cache key includes version number
   └─ Update version when data changes
   └─ Old cache entries expire naturally

Recommendation:
└─ Short TTL (5-10 minutes) for consistency
└─ Event-based invalidation for critical data
└─ Cache warming for hot data
└─ Monitor cache hit rates
```

---

## API Composition for Queries

When query spans multiple services' data.

```java
// Problem: Need order with customer name and product names
// Order in Order Service, Customer in Customer Service, Products in Product Service

@Service
public class OrderCompositeQueryService {

    @Autowired
    private OrderClient orderClient;

    @Autowired
    private CustomerClient customerClient;

    @Autowired
    private ProductClient productClient;

    public OrderDetailDTO getOrderDetails(Long orderId) {
        // Parallel fetch to reduce latency
        CompletableFuture<Order> orderFuture = CompletableFuture.supplyAsync(
            () -> orderClient.getOrder(orderId)
        );

        // After we have order, fetch customer
        CompletableFuture<OrderDetailDTO> detailFuture = orderFuture.thenCompose(order ->
            CompletableFuture.supplyAsync(
                () -> customerClient.getCustomer(order.getCustomerId())
            ).thenCompose(customer ->
                // Then fetch all products in order
                CompletableFuture.allOf(
                    order.getItems().stream()
                        .map(item -> CompletableFuture.supplyAsync(
                            () -> productClient.getProduct(item.getProductId())
                        ))
                        .toArray(CompletableFuture[]::new)
                ).thenApply(v -> {
                    // Aggregate everything
                    List<ProductDTO> products = order.getItems().stream()
                        .map(item -> productClient.getProduct(item.getProductId()))
                        .collect(Collectors.toList());

                    return new OrderDetailDTO(
                        order,
                        customer,
                        products
                    );
                })
            )
        );

        return detailFuture.get();
    }

    // Better: Use CQRS instead of composition
    // Maintain denormalized view that has all needed data
}

// Query-side view combining data
@Entity
@Table(name = "order_details_view")
public class OrderDetailView {
    @Id
    private Long orderId;

    // From Order Service
    private LocalDateTime createdAt;
    private BigDecimal total;

    // From Customer Service
    private String customerName;
    private String customerEmail;

    // From Product Service (embedded)
    @ElementCollection
    private List<ProductDetail> productDetails;

    // Built from events/updates from all services
}

// Projector updates this view
@Service
public class OrderDetailProjector {

    @EventListener(OrderSubmittedEvent.class)
    public void onOrderSubmitted(OrderSubmittedEvent event) {
        // Fetch customer and product details
        // Build OrderDetailView
        // Save to database
    }
}
```

---

## Data Replication

Synchronizing data across services.

```java
// Service A: Source of truth
@Service
public class ProductService {

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private KafkaTemplate<String, ProductUpdatedEvent> kafkaTemplate;

    @Transactional
    public void updateProduct(Long productId, UpdateProductRequest request) {
        Product product = productRepository.findById(productId).orElseThrow();
        product.setName(request.getName());
        product.setPrice(request.getPrice());

        productRepository.save(product);

        // Publish event
        kafkaTemplate.send("products", new ProductUpdatedEvent(
            productId,
            product.getName(),
            product.getPrice()
        ));
    }
}

// Service B: Replicates data
@Service
public class OrderServiceReplicaListener {

    @Autowired
    private ProductReplicaRepository productReplicaRepository;

    @KafkaListener(topics = "products", groupId = "order-service")
    public void onProductUpdated(ProductUpdatedEvent event) {
        ProductReplica replica = productReplicaRepository
            .findById(event.getProductId())
            .orElse(new ProductReplica(event.getProductId()));

        replica.setName(event.getName());
        replica.setPrice(event.getPrice());
        replica.setLastSyncedAt(LocalDateTime.now());

        productReplicaRepository.save(replica);
    }
}

// Eventual consistency issues
// Solution 1: Version numbers
@Entity
public class ProductReplica {
    @Id
    private Long productId;
    private String name;
    private BigDecimal price;
    private long version;  // Track version
}

// Solution 2: Sync events with ordering
@KafkaListener(topics = "products", groupId = "order-service")
public void onProductUpdated(ProductUpdatedEvent event) {
    ProductReplica replica = productReplicaRepository.findById(event.getProductId()).orElseThrow();

    if (event.getVersion() > replica.getVersion()) {
        // Update only if newer
        replica.setName(event.getName());
        replica.setPrice(event.getPrice());
        replica.setVersion(event.getVersion());

        productReplicaRepository.save(replica);
    }
}

// Solution 3: Periodic sync for safety
@Component
public class DataReplicationSyncer {

    @Scheduled(fixedDelay = 300000)  // Every 5 minutes
    public void syncReplicas() {
        List<Product> sourceData = productRepository.findAll();
        List<ProductReplica> replicaData = productReplicaRepository.findAll();

        // Find differences and update replicas
        for (Product source : sourceData) {
            ProductReplica replica = replicaData.stream()
                .filter(r -> r.getProductId().equals(source.getId()))
                .findFirst()
                .orElse(new ProductReplica(source.getId()));

            if (!replica.getName().equals(source.getName()) ||
                !replica.getPrice().equals(source.getPrice())) {
                replica.setName(source.getName());
                replica.setPrice(source.getPrice());

                productReplicaRepository.save(replica);
                logger.info("Synced product replica: {}", source.getId());
            }
        }
    }
}
```

---

## Interview Questions

### Q1: How would you handle an order that spans multiple services with different consistency requirements?

**Answer**:

```
Order requirements:
1. Customer payment: STRONG consistency (money can't disappear)
2. Inventory: STRONG consistency (can't oversell)
3. Recommendation: EVENTUAL consistency (can be stale)

Design:

Command Side (Write):
├─ Accept order submission
├─ Use saga pattern for distributed transaction
│  ├─ Step 1: Reserve inventory (STRONG)
│  ├─ Step 2: Process payment (STRONG)
│  └─ Compensate if either fails
├─ Publish order events

Query Side (Read):
├─ Eventually consistent read model
├─ For critical operations (payment): read from source of truth
├─ For display (recommendations): read from cache
```

### Q2: When would you choose event sourcing over traditional persistence?

**Answer**:

**Choose Event Sourcing when:**
- Need complete audit trail (financial, compliance)
- Need temporal queries (state at time T)
- Debugging is critical (replay to point in time)
- Event-driven architecture natural fit
- Multiple read models needed (CQRS)

**Don't choose when:**
- Simple CRUD operations
- Large amounts of data (storage grows)
- Team inexperienced with patterns
- Performance critical (reconstruction overhead)

**Example use case:**
E-commerce order system - order history important
- Can replay entire order lifecycle
- Audit trail for disputes
- Multiple views (customer, admin, analytics)
