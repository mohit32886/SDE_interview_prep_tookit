# Kafka in Microservices - Deep Dive

## Table of Contents
1. [Event-Driven Microservices](#event-driven-microservices)
2. [Event Sourcing](#event-sourcing)
3. [CQRS (Command Query Responsibility Segregation)](#cqrs)
4. [Saga Pattern](#saga-pattern)
5. [Outbox Pattern](#outbox-pattern)
6. [Dead Letter Queue Pattern](#dead-letter-queue-pattern)
7. [Retry and Error Handling](#retry-and-error-handling)
8. [Schema Evolution in Microservices](#schema-evolution-in-microservices)
9. [Ordering Guarantees](#ordering-guarantees)
10. [Handling Duplicates](#handling-duplicates)
11. [Monitoring and Operations](#monitoring-and-operations)
12. [Security](#security)
13. [Interview Questions](#interview-questions)

---

## Event-Driven Microservices

### Traditional vs Event-Driven Architecture

Traditional (Synchronous):
```
┌─────────────────┐
│  Order Service  │
└────────┬────────┘
         │ REST/gRPC
         ↓
┌─────────────────┐      ┌──────────────────┐
│ Payment Service │─────→│ Inventory Service│
└─────────────────┘      └──────────────────┘

Coupling:
├─ Order → Payment (direct call)
├─ Order → Inventory (direct call)
├─ Tight coupling (circular dependencies)
├─ Cascading failures
├─ Temporal coupling (all must be up)
└─ Difficult to scale independently
```

Event-Driven (Asynchronous):
```
Order Service         Order Created      Consumer Service
     │                  Event               (Payment)
     │                    │
     ├──────────────────────────────────────┐
     │                    ↓                   ↓
     │            ┌──────────────┐   ┌──────────────┐
     │            │ Order Topic  │   │ Event Handler│
     │            └──────────────┘   └──────────────┘
     │                    ↓
     │            ┌──────────────┐   ┌──────────────┐
     │            │ Order Topic  │   │ Event Handler│
     │            └──────────────┘   └──────────────┘
     │
     └──→ Order created
          Publish "OrderCreated"

Benefits:
├─ Loose coupling (services don't know each other)
├─ Asynchronous (services can process at own pace)
├─ Better scalability (independent scaling)
├─ Fault tolerant (service failures isolated)
├─ Audit trail (all events preserved)
└─ Easy to add new consumers
```

### Event-Driven Flow

```java
// Order Service: Publishes OrderCreated event
@Service
public class OrderService {
    @Autowired
    private KafkaTemplate<String, OrderCreatedEvent> kafkaTemplate;

    public void createOrder(Order order) {
        // Save order to database
        Order savedOrder = orderRepository.save(order);

        // Publish event
        OrderCreatedEvent event = new OrderCreatedEvent(
            savedOrder.getId(),
            savedOrder.getCustomerId(),
            savedOrder.getAmount(),
            System.currentTimeMillis()
        );

        kafkaTemplate.send("order-created-events", savedOrder.getId(), event);
    }
}

// Payment Service: Consumes OrderCreated event
@Service
public class PaymentService {
    @KafkaListener(topics = "order-created-events", groupId = "payment-group")
    public void handleOrderCreated(OrderCreatedEvent event) {
        // Process payment
        Payment payment = new Payment(
            event.getOrderId(),
            event.getAmount(),
            PaymentStatus.PENDING
        );

        paymentRepository.save(payment);
        processPayment(event.getOrderId(), event.getAmount());
    }
}

// Inventory Service: Consumes OrderCreated event (independently)
@Service
public class InventoryService {
    @KafkaListener(topics = "order-created-events", groupId = "inventory-group")
    public void handleOrderCreated(OrderCreatedEvent event) {
        // Update inventory
        inventoryRepository.decrementStock(event.getOrderId());
    }
}
```

---

## Event Sourcing

### Concept

Event Sourcing stores all state changes as immutable events:

```
Traditional approach:
Database: {Order: OrderId=123, Status=Shipped, Amount=500}
           └─ Only current state, history lost

Event Sourcing:
Kafka Topic (order-events):
Offset 0: OrderCreated {id: 123, amount: 500}
Offset 1: PaymentProcessed {id: 123, amount: 500}
Offset 2: OrderShipped {id: 123}
Offset 3: OrderDelivered {id: 123}

Current state derived from:
├─ OrderCreated → Pending
├─ PaymentProcessed → Paid
├─ OrderShipped → Shipped
└─ OrderDelivered → Delivered

Advantages:
├─ Complete audit trail
├─ Replay history anytime
├─ Temporal queries (state at any point in time)
└─ Debugging (see exactly what happened)
```

### Implementation with Kafka

```java
// Event base classes
public abstract class Event {
    public final String aggregateId;
    public final long timestamp;
    public final String eventType;

    public Event(String aggregateId, String eventType) {
        this.aggregateId = aggregateId;
        this.timestamp = System.currentTimeMillis();
        this.eventType = eventType;
    }
}

public class OrderCreatedEvent extends Event {
    public final String customerId;
    public final double amount;
    public final String address;

    public OrderCreatedEvent(String orderId, String customerId, double amount, String address) {
        super(orderId, "OrderCreated");
        this.customerId = customerId;
        this.amount = amount;
        this.address = address;
    }
}

public class PaymentProcessedEvent extends Event {
    public final String transactionId;

    public PaymentProcessedEvent(String orderId, String transactionId) {
        super(orderId, "PaymentProcessed");
        this.transactionId = transactionId;
    }
}

// Aggregate (Order) reconstructed from events
public class Order {
    private String id;
    private String customerId;
    private double amount;
    private OrderStatus status;

    public static Order fromEvents(String orderId, List<Event> events) {
        Order order = new Order();
        order.id = orderId;

        for (Event event : events) {
            if (event instanceof OrderCreatedEvent) {
                OrderCreatedEvent e = (OrderCreatedEvent) event;
                order.customerId = e.customerId;
                order.amount = e.amount;
                order.status = OrderStatus.CREATED;
            } else if (event instanceof PaymentProcessedEvent) {
                order.status = OrderStatus.PAID;
            } else if (event instanceof OrderShippedEvent) {
                order.status = OrderStatus.SHIPPED;
            }
        }

        return order;
    }
}

// Event store (Kafka topic)
@Service
public class OrderEventStore {
    @Autowired
    private KafkaTemplate<String, Event> kafkaTemplate;

    public void appendEvent(Event event) {
        kafkaTemplate.send("order-events", event.aggregateId, event);
    }

    public Order getOrder(String orderId) {
        // Consume all events for this order
        List<Event> events = consumeEvents(orderId);
        return Order.fromEvents(orderId, events);
    }

    public List<Order> getAllOrders() {
        // Replay all events from beginning
        List<Event> allEvents = consumeAllEvents();
        Map<String, List<Event>> eventsByOrder = allEvents.stream()
            .collect(Collectors.groupingBy(e -> e.aggregateId));

        return eventsByOrder.entrySet().stream()
            .map(entry -> Order.fromEvents(entry.getKey(), entry.getValue()))
            .collect(Collectors.toList());
    }
}
```

---

## CQRS (Command Query Responsibility Segregation)

### Concept

CQRS separates reads and writes:

```
Traditional Model:
Request → Business Logic → Database → Response
           (Read & Write)

CQRS Model:
Write Path:
Command → Order Service → Event Store (Kafka)

Read Path:
Query → Read Database (Denormalized view)

Separation of concerns:
├─ Write: Complex domain logic
├─ Read: Optimized for queries
└─ Independent scaling
```

### Implementation

```java
// Write Model (Order Service)
@Service
public class OrderCommandService {
    @Autowired
    private KafkaTemplate<String, Event> eventStore;

    // Commands (write operations)
    public void createOrder(CreateOrderCommand command) {
        Order order = new Order(command);
        List<Event> events = order.getUncommittedEvents();

        // Store events
        for (Event event : events) {
            eventStore.send("order-events", order.getId(), event);
        }
    }

    public void shipOrder(ShipOrderCommand command) {
        Order order = loadOrder(command.getOrderId());
        order.ship();

        List<Event> events = order.getUncommittedEvents();
        for (Event event : events) {
            eventStore.send("order-events", order.getId(), event);
        }
    }
}

// Read Model (Materialized Views)
@Service
public class OrderQueryService {
    @Autowired
    private OrderReadRepository readRepository;  // MySQL, Elasticsearch, etc.

    // Queries (read operations)
    public Order getOrder(String orderId) {
        return readRepository.findById(orderId);
    }

    public List<Order> getOrdersByCustomer(String customerId) {
        return readRepository.findByCustomerId(customerId);
    }

    public List<Order> searchOrders(String query) {
        // Elasticsearch query
        return elasticsearchRepository.search(query);
    }
}

// Projector (Updates read model)
@Service
public class OrderProjector {
    @Autowired
    private OrderReadRepository readRepository;

    @KafkaListener(topics = "order-events", groupId = "read-model-group")
    public void project(Event event) {
        if (event instanceof OrderCreatedEvent) {
            OrderCreatedEvent e = (OrderCreatedEvent) event;
            Order readModel = new Order();
            readModel.setId(e.aggregateId);
            readModel.setCustomerId(e.customerId);
            readModel.setAmount(e.amount);
            readRepository.save(readModel);

        } else if (event instanceof OrderShippedEvent) {
            Order order = readRepository.findById(event.aggregateId);
            order.setStatus(OrderStatus.SHIPPED);
            readRepository.save(order);
        }
    }
}

// Controller
@RestController
@RequestMapping("/orders")
public class OrderController {
    @Autowired
    private OrderCommandService commandService;

    @Autowired
    private OrderQueryService queryService;

    @PostMapping
    public ResponseEntity<Void> createOrder(@RequestBody CreateOrderCommand command) {
        commandService.createOrder(command);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Order> getOrder(@PathVariable String id) {
        return ResponseEntity.ok(queryService.getOrder(id));
    }

    @GetMapping("/customer/{customerId}")
    public ResponseEntity<List<Order>> getOrdersByCustomer(@PathVariable String customerId) {
        return ResponseEntity.ok(queryService.getOrdersByCustomer(customerId));
    }
}
```

Advantages:
```
├─ Scalable: Read and write paths scale independently
├─ Optimized: Each can use best database (write: transactional, read: denormalized)
├─ Complex reads: Elasticsearch, analytics database
├─ Eventually consistent: Read model eventually consistent with write model
├─ Audit trail: Event store provides complete history
```

---

## Saga Pattern

### Distributed Transactions

Sagas coordinate transactions across services:

```
Traditional transaction (single database):
BEGIN TRANSACTION
├─ Insert order
├─ Update inventory
├─ Process payment
└─ COMMIT / ROLLBACK (all or nothing)

Distributed saga (multiple services):
No 2-phase commit (slow, blocking)
Instead: Coordinated events with compensations

Order Service: CreateOrder
    ↓ publishes OrderCreated
Payment Service: ProcessPayment
    ↓ publishes PaymentProcessed
Inventory Service: ReserveInventory
    ↓ publishes InventoryReserved
Shipping Service: CreateShipment
    ↓ publishes ShipmentCreated

If any step fails:
Payment fails → Trigger compensations
├─ Reverse inventory reservation
├─ Cancel order
└─ Notify customer
```

### Choreography-Based Saga

Services react to events (decoupled):

```java
// Order Service (initiator)
@Service
public class OrderService {
    @Autowired
    private KafkaTemplate<String, Event> kafka;

    public void createOrder(Order order) {
        orderRepository.save(order);

        // Trigger saga: publish OrderCreatedEvent
        kafka.send("order-events", order.getId(),
            new OrderCreatedEvent(order.getId(), order.getTotal()));
    }
}

// Payment Service (participant)
@Service
public class PaymentService {
    @Autowired
    private KafkaTemplate<String, Event> kafka;

    @KafkaListener(topics = "order-events")
    public void handleOrderCreated(OrderCreatedEvent event) {
        try {
            // Attempt payment
            processPayment(event.getOrderId(), event.getTotal());

            // Publish success
            kafka.send("payment-events",
                new PaymentSucceededEvent(event.getOrderId()));

        } catch (PaymentException e) {
            // Publish failure
            kafka.send("payment-events",
                new PaymentFailedEvent(event.getOrderId(), e.getMessage()));
        }
    }

    // Compensation: Handle order cancellation
    @KafkaListener(topics = "order-events")
    public void handleOrderCancelled(OrderCancelledEvent event) {
        // Refund payment
        refund(event.getOrderId());
    }
}

// Inventory Service (participant)
@Service
public class InventoryService {
    @Autowired
    private KafkaTemplate<String, Event> kafka;

    @KafkaListener(topics = "payment-events")
    public void handlePaymentSucceeded(PaymentSucceededEvent event) {
        try {
            // Reserve inventory
            reserveInventory(event.getOrderId());

            // Publish success
            kafka.send("inventory-events",
                new InventoryReservedEvent(event.getOrderId()));

        } catch (InventoryException e) {
            // Publish failure: this triggers compensation
            kafka.send("inventory-events",
                new InventoryReservationFailedEvent(event.getOrderId()));
        }
    }

    // Compensation: Handle payment failure
    @KafkaListener(topics = "payment-events")
    public void handlePaymentFailed(PaymentFailedEvent event) {
        // No action needed (inventory not reserved yet)
    }
}

// Shipping Service (participant)
@Service
public class ShippingService {
    @KafkaListener(topics = "inventory-events")
    public void handleInventoryReserved(InventoryReservedEvent event) {
        // Create shipment
        createShipment(event.getOrderId());
    }

    // Compensation: Handle inventory failure
    @KafkaListener(topics = "inventory-events")
    public void handleInventoryReservationFailed(InventoryReservationFailedEvent event) {
        // Trigger order cancellation saga
        // Refund payment, reverse inventory
    }
}
```

### Orchestration-Based Saga

Central orchestrator coordinates (decoupled but centralized):

```java
// Saga Orchestrator
@Service
public class OrderSagaOrchestrator {
    @Autowired
    private KafkaTemplate<String, SagaCommand> kafka;

    @KafkaListener(topics = "order-events")
    public void handleOrderCreated(OrderCreatedEvent event) {
        // Start saga
        SagaState state = new SagaState(event.getOrderId());

        // Step 1: Process payment
        kafka.send("payment-commands",
            new ProcessPaymentCommand(event.getOrderId(), event.getTotal()));

        // Listen for response
        listenForPaymentResponse(event.getOrderId(), state);
    }

    @KafkaListener(topics = "payment-responses")
    public void handlePaymentResponse(PaymentResponse response) {
        SagaState state = loadState(response.getOrderId());

        if (response.isSuccess()) {
            // Step 2: Reserve inventory
            kafka.send("inventory-commands",
                new ReserveInventoryCommand(response.getOrderId()));

        } else {
            // Compensation: Cancel order
            state.setStatus(SagaStatus.FAILED);
            saveState(state);
        }
    }

    @KafkaListener(topics = "inventory-responses")
    public void handleInventoryResponse(InventoryResponse response) {
        SagaState state = loadState(response.getOrderId());

        if (response.isSuccess()) {
            // Step 3: Create shipment
            kafka.send("shipping-commands",
                new CreateShipmentCommand(response.getOrderId()));

        } else {
            // Compensation: Refund payment
            compensate(state);
        }
    }
}
```

Choreography vs Orchestration:
```
Choreography:
├─ Services react to events
├─ Loose coupling
├─ Distributed logic (harder to understand)
├─ No single point of failure
└─ Good: Simple sagas

Orchestration:
├─ Central coordinator
├─ Tighter coupling (to orchestrator)
├─ Centralized logic (easier to understand)
├─ Single point of failure
└─ Good: Complex sagas
```

---

## Outbox Pattern

### Problem

Updating database and publishing event is not atomic:

```
Without outbox pattern:
1. INSERT INTO orders VALUES (...)  ✓
2. Publish event to Kafka          ✗ (service crashes)
3. No notification about order creation!

Result:
├─ Order created in DB
├─ Event never published
├─ Payment service never notified
└─ Inconsistent state
```

### Solution: Outbox Table

Store event in same transaction as business data:

```
Database:
├─ orders table
└─ outbox table (event log)

Transaction:
BEGIN
├─ INSERT INTO orders VALUES (...)
├─ INSERT INTO outbox (event_id, event_type, payload, created_at)
└─ COMMIT

Separate process:
├─ Polls outbox table
├─ Publishes to Kafka
├─ Marks as published
└─ Cleans up old records
```

### Implementation with Spring Data JPA

```java
// Order entity
@Entity
@Table(name = "orders")
public class Order {
    @Id
    private String id;
    private String customerId;
    private double amount;
    private OrderStatus status;
}

// Outbox entity
@Entity
@Table(name = "outbox")
public class OutboxEvent {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false)
    private String aggregateId;  // Order ID

    @Column(nullable = false)
    private String eventType;    // OrderCreated, etc.

    @Column(columnDefinition = "TEXT")
    private String payload;      // JSON

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private boolean published = false;

    @Column(nullable = false)
    private LocalDateTime publishedAt;
}

// Repository
@Repository
public interface OutboxRepository extends JpaRepository<OutboxEvent, String> {
    List<OutboxEvent> findByPublishedFalseOrderByCreatedAtAsc(Pageable pageable);
}

// Service: Create order with outbox
@Service
public class OrderService {
    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private OutboxRepository outboxRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Transactional
    public void createOrder(CreateOrderRequest request) {
        // Create order
        Order order = new Order(request);
        orderRepository.save(order);

        // Create outbox event in same transaction
        OrderCreatedEvent event = new OrderCreatedEvent(
            order.getId(), order.getCustomerId(), order.getAmount());

        OutboxEvent outboxEvent = new OutboxEvent();
        outboxEvent.setAggregateId(order.getId());
        outboxEvent.setEventType("OrderCreated");
        outboxEvent.setPayload(objectMapper.writeValueAsString(event));
        outboxEvent.setCreatedAt(LocalDateTime.now());

        outboxRepository.save(outboxEvent);

        // Transaction commits: Both order and outbox record persisted
    }
}

// Outbox Poller (separate service)
@Service
public class OutboxPoller {
    @Autowired
    private OutboxRepository outboxRepository;

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    @Scheduled(fixedDelay = 1000)  // Poll every 1 second
    public void pollAndPublish() {
        Pageable pageable = PageRequest.of(0, 100);
        List<OutboxEvent> unpublished = outboxRepository
            .findByPublishedFalseOrderByCreatedAtAsc(pageable);

        for (OutboxEvent event : unpublished) {
            try {
                // Publish to Kafka
                kafkaTemplate.send(
                    event.getEventType().toLowerCase() + "-events",
                    event.getAggregateId(),
                    event.getPayload()
                );

                // Mark as published
                event.setPublished(true);
                event.setPublishedAt(LocalDateTime.now());
                outboxRepository.save(event);

            } catch (Exception e) {
                logger.error("Failed to publish event: " + event.getId(), e);
                // Retry on next poll
            }
        }
    }
}
```

With Debezium CDC:
```
Outbox table → Debezium → Kafka topic

Advantages:
├─ No custom polling needed
├─ Lower latency (CDC-driven)
├─ No duplicate publishes
├─ Database-agnostic
```

---

## Dead Letter Queue Pattern

### Handling Failed Messages

Failed messages need separate handling:

```
Normal flow:
Message → Process → Success → Commit offset

Failed flow:
Message → Process → Exception → Handle gracefully

Options:
1. Retry in same topic
2. Send to DLQ topic
3. Manual intervention
```

### DLQ Implementation with Spring Kafka

```java
// Configuration
@Configuration
public class KafkaConfig {
    @Bean
    public NewTopic mainTopic() {
        return TopicBuilder.name("orders").partitions(3).replicas(1).build();
    }

    @Bean
    public NewTopic dlqTopic() {
        return TopicBuilder.name("orders-dlq").partitions(1).replicas(1).build();
    }

    @Bean
    public KafkaListenerContainerFactory<?> kafkaListenerContainerFactory() {
        ConcurrentKafkaListenerContainerFactory<?, ?> factory =
            new ConcurrentKafkaListenerContainerFactory<>();

        factory.setCommonErrorHandler(
            new DefaultErrorHandler(
                (record, exception) -> handleDlq(record, exception),
                new FixedBackOff(1000, 3)  // Retry 3 times, 1s delay
            )
        );

        return factory;
    }
}

// Consumer with DLQ
@Service
public class OrderConsumer {
    @Autowired
    private KafkaTemplate<String, Order> kafkaTemplate;

    @KafkaListener(topics = "orders", groupId = "order-group")
    public void handleOrder(Order order) throws Exception {
        try {
            // Process order
            validateOrder(order);
            saveOrder(order);

        } catch (ValidationException e) {
            logger.error("Validation failed for order: " + order.getId(), e);
            throw e;  // Will trigger retries, then DLQ
        }
    }

    private void handleDlq(ConsumerRecord<?, ?> record, Exception exception) {
        logger.error("Message sent to DLQ: " + record.value(), exception);

        // Send to DLQ topic
        kafkaTemplate.send("orders-dlq",
            record.key().toString(),
            ((Order) record.value()).toString());

        // Alert operations team
        alertOperations("Order DLQ: " + record.value());
    }
}

// DLQ consumer for manual intervention
@Service
public class DlqConsumer {
    @KafkaListener(topics = "orders-dlq", groupId = "dlq-handler")
    public void handleDlq(Order order) {
        logger.warn("DLQ message: " + order.getId());

        // Log to monitoring system
        // Create ticket for operations team
        // Send Slack notification
        // Send email
    }
}
```

---

## Retry and Error Handling

### Retry Strategies

```java
// Exponential backoff
@Service
public class OrderService {
    @Autowired
    private KafkaTemplate<String, Order> kafkaTemplate;

    @Retryable(
        value = {TemporaryException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1000, multiplier = 2.0)
    )
    public void processOrder(Order order) {
        // Delay: 1s, 2s, 4s
        apiClient.callExternalService(order);
    }

    @Recover
    public void handleRetryFailure(TemporaryException e, Order order) {
        // After all retries fail
        sendToDlq(order);
    }
}

// Retry topic (Spring Kafka pattern)
@Service
public class OrderConsumer {
    @KafkaListener(
        topics = "orders",
        groupId = "order-group",
        containerFactory = "kafkaListenerContainerFactory"
    )
    public void handleOrder(Order order) throws Exception {
        try {
            processOrder(order);
        } catch (Exception e) {
            throw new KafkaException("Processing failed", e);
        }
    }
}

@Configuration
public class RetryTopicConfig {
    @Bean
    public ListenerContainerFactoryConfigurer configurer() {
        return (container, endpoint) -> {
            container.getContainerProperties().setDeliveryAttemptHeader(true);
            container.setCommonErrorHandler(new DefaultErrorHandler(
                new FixedBackOff(1000, 3)
            ));
        };
    }
}
```

### Error Classification

```
Transient errors (retry):
├─ Network timeout
├─ Temporary service unavailable
├─ Database connection pool exhausted
└─ Lock timeout

Permanent errors (DLQ):
├─ Invalid JSON
├─ Missing required fields
├─ Validation failure
├─ Unsupported operation
└─ Authorization failure
```

Implementation:
```java
@KafkaListener(topics = "orders")
public void handleOrder(Order order) throws Exception {
    try {
        processOrder(order);
    } catch (NetworkException e) {
        // Transient: Throw to trigger retry
        throw e;
    } catch (ValidationException e) {
        // Permanent: Send to DLQ directly
        sendToDlq(order, e);
    }
}
```

---

## Schema Evolution in Microservices

### Backward Compatibility

Consumers can read old messages with new code:

```
Evolution: Add new optional field

Old event:
{
  "orderId": "order-123",
  "amount": 100.00
}

New schema:
{
  "orderId": "order-123",
  "amount": 100.00,
  "currency": "USD"      ← New optional field
}

New consumer reading old event:
├─ Reads: orderId, amount
├─ Uses default for: currency (USD)
└─ Works ✓
```

### Incompatible Changes (Breaking)

```
Removing field (incompatible):

Old event:
{
  "orderId": "order-123",
  "amount": 100.00,
  "status": "PENDING"
}

New schema (removed "status"):
{
  "orderId": "order-123",
  "amount": 100.00
}

Old consumer expecting "status":
└─ Missing field → Error ✗

Solution:
├─ Mark field as deprecated (first)
├─ Wait for all consumers to handle missing field
├─ Then remove field
└─ Or use versioning
```

### Version Handling

**Explicit versioning**:
```java
@Data
public class OrderCreatedEvent {
    public static final int VERSION = 2;

    private String orderId;
    private double amount;
    private String currency;  // Added in V2

    public OrderCreatedEvent(String orderId, double amount) {
        this(orderId, amount, "USD");
    }

    public OrderCreatedEvent(String orderId, double amount, String currency) {
        this.orderId = orderId;
        this.amount = amount;
        this.currency = currency;
    }
}

// Consumer handles multiple versions
@KafkaListener(topics = "order-created")
public void handleOrderCreated(OrderCreatedEvent event) {
    double amount = event.getAmount();
    String currency = event.getCurrency() != null ? event.getCurrency() : "USD";

    // Process using currency-aware amount
}
```

**Schema Registry with versioning**:
```
Schema Registry manages compatibility

Config:
├─ BACKWARD: Consumers can read new/old events
├─ FORWARD: Old consumers can read new events
├─ FULL: Both directions (most restrictive)
└─ NONE: No compatibility check
```

---

## Ordering Guarantees

### Single Partition Ordering

```
Messages must have same key to guarantee order

Topic: orders (3 partitions)

Partition 0: order-123
Partition 1: order-456
Partition 2: order-789

Timeline:
T=1: CreateOrder(order-123) → Partition 0 [offset=0]
T=2: PayOrder(order-123)    → Partition 0 [offset=1]
T=3: ShipOrder(order-123)   → Partition 0 [offset=2]

Consumer reads partition 0:
├─ Offset 0: CreateOrder
├─ Offset 1: PayOrder
├─ Offset 2: ShipOrder
└─ Ordered ✓

Consumer with multiple partitions:
├─ Partition 0: order-123 events (ordered)
├─ Partition 1: order-456 events (ordered)
└─ But relative order between partitions: undefined
```

### Ordering with Consumer Deserialization

```java
// Configuration
properties.put(ProducerConfig.KEY_SERIALIZER_CONFIG,
    StringSerializer.class);

// Produce with key
kafkaTemplate.send("orders", orderId, event);  // Key = orderId
// All events for same orderId go to same partition (hash(orderId) % partitions)

// Consume with ordering guarantee
@KafkaListener(topics = "orders", groupId = "order-group")
public void handleOrder(OrderEvent event, @Header(KafkaHeaders.RECEIVED_PARTITION_ID) int partition) {
    // Single-threaded consumption from partition
    // Events processed in order
    processEvent(event);
}
```

### Key Considerations

```
Ordering guarantee requirements:
├─ Same key → same partition (automatic with key-based partitioning)
├─ Sequential processing (single consumer thread per partition)
├─ No parallel processing (violates order)
└─ Handle rebalancing (may lose in-flight events)

Tradeoff:
├─ Order: Reduced parallelism
├─ No order: Better throughput, parallel processing
└─ Design choice based on requirements
```

---

## Handling Duplicates

### Idempotent Consumers

```java
// Store processed IDs in database
@Service
public class IdempotentOrderProcessor {
    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private ProcessedEventRepository processedEventRepository;

    @KafkaListener(topics = "orders")
    public void handleOrder(Order order) throws Exception {
        // Check if already processed
        if (processedEventRepository.exists(order.getId())) {
            logger.warn("Duplicate order: " + order.getId());
            return;
        }

        try {
            // Process order
            processOrder(order);

            // Mark as processed (atomic with business logic)
            processedEventRepository.save(new ProcessedEvent(order.getId()));

        } catch (Exception e) {
            logger.error("Processing failed", e);
            throw e;
        }
    }
}

// Processed event entity
@Entity
@Table(name = "processed_events")
public class ProcessedEvent {
    @Id
    private String eventId;
    private LocalDateTime processedAt;
}
```

### Deduplication with Cache

```java
// Fast in-memory deduplication
@Service
public class CachedIdempotentProcessor {
    private final Set<String> processedIds = Collections.newSetFromMap(
        new ConcurrentHashMap<>()
    );

    @Scheduled(fixedDelay = 60000)  // Cleanup every minute
    public void cleanupCache() {
        // Remove old entries (older than 1 hour)
        processedIds.removeIf(id -> isOlderThan(id, Duration.ofHours(1)));
    }

    @KafkaListener(topics = "orders")
    public void handleOrder(Order order) {
        if (processedIds.contains(order.getId())) {
            logger.warn("Duplicate: " + order.getId());
            return;
        }

        try {
            processOrder(order);
            processedIds.add(order.getId());
        } catch (Exception e) {
            logger.error("Processing failed", e);
            throw e;
        }
    }
}
```

---

## Monitoring and Operations

### Consumer Lag Monitoring

```java
// Metrics
@Component
public class LagMonitor {
    @Autowired
    private KafkaAdmin kafkaAdmin;

    @Autowired
    private AdminClient adminClient;

    @Scheduled(fixedRate = 10000)  // Every 10 seconds
    public void monitorLag() {
        // Get all consumer groups
        ListConsumerGroupsResult groups = adminClient.listConsumerGroups();

        groups.all().whenComplete((result, exception) -> {
            result.forEach(group -> {
                describeLagForGroup(group.groupId());
            });
        });
    }

    private void describeLagForGroup(String groupId) {
        // Get lag for each partition
        Map<TopicPartition, OffsetAndMetadata> offsets =
            adminClient.listConsumerGroupOffsets(groupId).partitionsToOffsetAndMetadata().join();

        offsets.forEach((partition, offset) -> {
            long lag = getLag(partition, offset.offset());

            // Alert if lag is high
            if (lag > 1000000) {
                alertOps("High lag for " + groupId + ": " + lag + " messages");
            }
        });
    }
}
```

### JMX Metrics

```
Kafka broker JMX metrics:
├─ kafka.server:type=BrokerTopicMetrics → Message count, bytes
├─ kafka.server:type=ReplicaManager → Replicas, ISR
└─ kafka.controller:type=KafkaController → Leader elections

Consumer JMX metrics:
├─ kafka.consumer:type=consumer-fetch-manager → Records fetched
├─ kafka.consumer:type=consumer-coordinator-metrics → Rebalance latency
└─ kafka.consumer:type=consumer-metrics → Lag per topic/partition
```

---

## Security

### SASL/SCRAM Authentication

```properties
# Broker configuration
security.protocol=SASL_SSL
sasl.mechanism=SCRAM-SHA-256
sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required \
    username="user" \
    password="password";

# Client configuration
bootstrap.servers=broker1:9092
security.protocol=SASL_SSL
sasl.mechanism=SCRAM-SHA-256
sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required \
    username="user" \
    password="password";
```

### TLS/SSL Encryption

```properties
# Broker
listeners=PLAINTEXT://:9092,SSL://:9093
advertised.listeners=PLAINTEXT://broker:9092,SSL://broker:9093
ssl.keystore.location=/path/to/keystore.jks
ssl.keystore.password=keystore-password
ssl.key.password=key-password
ssl.truststore.location=/path/to/truststore.jks
ssl.truststore.password=truststore-password

# Client
bootstrap.servers=broker:9093
security.protocol=SSL
ssl.truststore.location=/path/to/truststore.jks
ssl.truststore.password=truststore-password
```

### ACLs (Access Control Lists)

```
Restrict who can do what:

# Allow user to produce to topic
kafka-acls --bootstrap-server broker:9092 \
    --add \
    --allow-principal User:app-user \
    --operation Write \
    --topic orders

# Allow user to consume from group
kafka-acls --bootstrap-server broker:9092 \
    --add \
    --allow-principal User:app-user \
    --operation Read \
    --topic orders \
    --group order-processor
```

---

## Interview Questions

### Question 1: Event-Driven vs Synchronous Microservices

**Answer**:

Event-driven advantages:
```
1. Loose coupling: Services don't know each other
2. Better failure isolation: One service failure doesn't cascade
3. Independent scaling: Each service scales based on its load
4. Flexibility: Add new consumers without modifying producers
5. Audit trail: All events captured for compliance
```

Trade-offs:
```
Consistency: Eventually consistent (not immediately consistent)
Complexity: Harder to debug (distributed logic)
Latency: Higher (asynchronous) vs synchronous
Testing: More complex (async behavior)
```

When to use:
```
Event-driven: High throughput, fault tolerance needed
Synchronous: Simple request-response, immediate feedback needed
```

### Question 2: Outbox Pattern and Debezium

**Answer**:

Problem without outbox:
```
1. INSERT order → Success
2. Publish event → Failure

Result: Order created but event never published
(Payment service never notified)
```

Outbox solution:
```
1. INSERT order → Success
2. INSERT outbox → Success
   (Both in same transaction)

3. Separate process:
   Read outbox → Publish to Kafka → Mark as published

Benefit: Guarantees publication
(no message loss between DB and Kafka)
```

Debezium (CDC):
```
Outbox table → Debezium → Kafka

Advantages:
├─ No custom polling code
├─ Lower latency (CDC-driven)
├─ Better performance
├─ Proven pattern
```

### Question 3: Saga Pattern Choreography vs Orchestration

**Answer**:

Choreography (distributed):
```
Services emit events, others react

Pros:
├─ Loose coupling
├─ No central point of failure
├─ Each service independent

Cons:
├─ Logic distributed (hard to understand)
├─ Circular dependencies possible
├─ Testing difficult
```

Orchestration (centralized):
```
Central service coordinates

Pros:
├─ Clear flow (one place to understand)
├─ Easier testing
├─ Complex sagas easier

Cons:
├─ Central service is bottleneck
├─ Tighter coupling (to orchestrator)
└─ Single point of failure
```

Example comparison:
```
Order → Payment → Inventory → Shipping

Choreography:
Order: Publish OrderCreated
Payment: Listen to OrderCreated → Process → Publish PaymentDone
Inventory: Listen to PaymentDone → Reserve → Publish InventoryDone
Shipping: Listen to InventoryDone → Ship

Orchestration:
Orchestrator:
  1. Call PaymentService
  2. Wait for response
  3. Call InventoryService
  4. Wait for response
  5. Call ShippingService
  6. If any fails → Compensate
```

### Question 4: Idempotent Consumers

**Answer**:

Idempotent processing prevents duplicates:

```
Scenario:
1. Process order 123 → Save to DB ✓
2. Commit offset → Fails ✗
3. Consumer restarts
4. Process order 123 again → Duplicate order!

Solution: Idempotent processing
├─ Check if already processed
├─ Use unique constraint (DB)
├─ Deduplication cache
└─ No duplicate output
```

Implementation:
```java
// Database-backed
if (processedEventRepository.exists(orderId)) {
    return;  // Skip duplicate
}
processOrder(order);
processedEventRepository.save(orderId);

// Cache-backed
if (processedCache.contains(orderId)) {
    return;
}
processOrder(order);
processedCache.add(orderId);
```

---

## Summary

Event-driven microservices patterns:
- Event Sourcing: Store all state changes
- CQRS: Separate read and write models
- Saga: Distribute transactions across services
- Outbox: Guarantee event publication
- DLQ: Handle failed messages

Key principles:
- Loose coupling through events
- Eventually consistent state
- Idempotent processing (handle duplicates)
- Proper error handling (retries, DLQ)
- Schema evolution awareness
