# Resilience Patterns in Microservices

## Table of Contents
1. [Circuit Breaker](#circuit-breaker)
2. [Retry Pattern](#retry-pattern)
3. [Bulkhead Pattern](#bulkhead-pattern)
4. [Rate Limiter](#rate-limiter)
5. [Timeout Pattern](#timeout-pattern)
6. [Fallback Strategies](#fallback-strategies)
7. [Health Checks](#health-checks)
8. [Chaos Engineering](#chaos-engineering)
9. [Distributed Tracing](#distributed-tracing)
10. [Interview Questions](#interview-questions)

---

## Circuit Breaker

Prevents cascading failures by stopping requests to failing services.

### States

```
CLOSED (normal operation):
├─ Service is healthy
├─ Requests pass through
└─ Success counter increments

OPEN (service failing):
├─ Failure threshold exceeded
├─ Fast-fail all requests
└─ Return cached response or error

HALF-OPEN (testing recovery):
├─ Allow limited requests
├─ If successful: transition to CLOSED
└─ If failed: transition back to OPEN
```

### Circuit Breaker Flow

```
Request arrives
    │
    ▼
Is circuit CLOSED?
    ├─ YES: Pass request through
    │   ├─ Success: increment success counter
    │   └─ Failure: increment failure counter
    │       └─ Failure threshold exceeded?
    │           └─ YES: Open circuit
    │
    └─ NO (OPEN/HALF-OPEN):
        Is circuit OPEN?
        ├─ YES: Fast fail, return fallback
        │
        └─ HALF-OPEN: Allow probe request
            ├─ Success: Close circuit
            └─ Failure: Keep open
```

### Resilience4j Implementation

```xml
<!-- pom.xml -->
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot3</artifactId>
    <version>2.1.0</version>
</dependency>
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-circuitbreaker</artifactId>
    <version>2.1.0</version>
</dependency>
```

```java
// Configuration
@Configuration
public class Resilience4jConfig {

    @Bean
    public CircuitBreakerRegistry circuitBreakerRegistry() {
        return CircuitBreakerRegistry.ofDefaults();
    }

    @Bean
    public CircuitBreaker paymentCircuitBreaker(CircuitBreakerRegistry registry) {
        return registry.circuitBreaker("payment-service", CircuitBreakerConfig.custom()
            .failureRateThreshold(50.0f)           // Open if 50% fail
            .slowCallRateThreshold(50.0f)          // Open if 50% slow
            .slowCallDurationThreshold(Duration.ofSeconds(2))
            .waitDurationInOpenState(Duration.ofSeconds(30))  // Wait 30s before half-open
            .permittedNumberOfCallsInHalfOpenState(3)  // Allow 3 calls in half-open
            .slidingWindowSize(100)                // Track last 100 calls
            .slidingWindowType(SlidingWindowType.COUNT_BASED)
            .recordExceptions(PaymentException.class, TimeoutException.class)
            .ignoreExceptions(ValidationException.class)  // Don't count these
            .automaticTransitionFromOpenToHalfOpenEnabled(true)
            .build());
    }
}

// Using circuit breaker with annotations
@Service
public class OrderService {

    @Autowired
    private PaymentClient paymentClient;

    @CircuitBreaker(
        name = "payment-service",
        fallbackMethod = "fallbackProcessPayment"
    )
    @Retry(name = "payment-service")  // Combine with retry
    public Payment processPayment(Long orderId, BigDecimal amount) {
        return paymentClient.processPayment(orderId, amount);
    }

    // Fallback called when circuit opens
    public Payment fallbackProcessPayment(Long orderId, BigDecimal amount, Exception ex) {
        logger.warn("Payment service unavailable, returning pending payment", ex);
        return new Payment(
            orderId,
            amount,
            PaymentStatus.PENDING,
            "Payment service temporarily unavailable"
        );
    }
}

// Using circuit breaker programmatically
@Service
public class OrderServiceProgrammatic {

    private final CircuitBreaker circuitBreaker;

    @Autowired
    public OrderServiceProgrammatic(CircuitBreakerRegistry registry) {
        this.circuitBreaker = registry.circuitBreaker("payment-service");
    }

    public Payment processPayment(Long orderId, BigDecimal amount) {
        try {
            return circuitBreaker.executeSupplier(() ->
                paymentClient.processPayment(orderId, amount)
            );
        } catch (CallNotPermittedException ex) {
            // Circuit is open
            logger.error("Circuit breaker is open for payment-service");
            return createPendingPayment(orderId, amount);
        }
    }
}

// Monitoring circuit breaker state
@Component
public class CircuitBreakerHealthIndicator implements HealthIndicator {

    @Autowired
    private CircuitBreakerRegistry circuitBreakerRegistry;

    @Override
    public Health health() {
        Health.Builder builder = new Health.Builder();

        circuitBreakerRegistry.getAllCircuitBreakers()
            .forEach(cb -> {
                CircuitBreaker.State state = cb.getState();
                builder.withDetail(cb.getName(), state.name());

                if (state == CircuitBreaker.State.OPEN) {
                    builder.outOfService();
                } else {
                    builder.up();
                }
            });

        return builder.build();
    }
}

// application.yml
resilience4j:
  circuitbreaker:
    instances:
      payment-service:
        failureRateThreshold: 50
        slowCallRateThreshold: 50
        slowCallDurationThreshold: 2s
        waitDurationInOpenState: 30s
        permittedNumberOfCallsInHalfOpenState: 3
        slidingWindowSize: 100
        recordExceptions:
          - com.example.PaymentException
          - java.util.concurrent.TimeoutException

  metrics:
    enabled: true

management:
  endpoints:
    web:
      exposure:
        include: health,circuitbreakers
  health:
    circuitbreakers:
      enabled: true
```

### Circuit Breaker Metrics

```java
// Monitoring circuit breaker with metrics
@Component
public class CircuitBreakerMetrics {

    @Autowired
    private CircuitBreakerRegistry registry;

    @Scheduled(fixedDelay = 10000)
    public void publishMetrics() {
        registry.getAllCircuitBreakers()
            .forEach(cb -> {
                CircuitBreakerMetrics metrics = cb.getMetrics();

                logger.info("CircuitBreaker {} - State: {}, Failure Rate: {}%, Slow Call Rate: {}%",
                    cb.getName(),
                    cb.getState(),
                    String.format("%.2f", metrics.getFailureRate()),
                    String.format("%.2f", metrics.getSlowCallRate())
                );

                logger.info("  Total calls: {}, Successful: {}, Failed: {}, Slow: {}",
                    metrics.getNumberOfTotalCalls(),
                    metrics.getNumberOfSuccessfulCalls(),
                    metrics.getNumberOfFailedCalls(),
                    metrics.getNumberOfSlowCalls()
                );
            });
    }
}
```

---

## Retry Pattern

Automatically retry failed requests with exponential backoff.

### Retry Configuration

```java
// Simple retry
@Service
public class OrderService {

    @Retry(name = "payment-service")
    public Payment processPayment(Long orderId, BigDecimal amount) {
        return paymentClient.processPayment(orderId, amount);
    }
}

// Advanced retry configuration
@Configuration
public class RetryConfig {

    @Bean
    public RetryRegistry retryRegistry() {
        return RetryRegistry.ofDefaults();
    }

    @Bean
    public Retry paymentRetry(RetryRegistry registry) {
        return registry.retry("payment-service", RetryConfig.custom()
            .maxAttempts(3)                    // Total of 3 attempts (1 original + 2 retries)
            .waitDuration(Duration.ofMillis(1000))  // 1 second between retries
            .intervalFunction(
                IntervalFunction.ofExponentialBackoff(
                    1000,      // Initial interval: 1 second
                    2,         // Multiplier: each retry waits 2x longer
                    1000       // Maximum interval: 1 second (capped at 1s)
                )
            )
            .retryExceptions(PaymentException.class, TimeoutException.class)
            .ignoreExceptions(ValidationException.class)  // Don't retry these
            .failAfterMaxAttempts(true)
            .build());
    }
}

// Exponential backoff with jitter
@Service
public class PaymentClientWithJitter {

    @Autowired
    private RestTemplate restTemplate;

    private Random random = new Random();

    public Payment processPayment(Long orderId, BigDecimal amount) {
        int maxAttempts = 3;
        int attempt = 0;
        PaymentException lastException = null;

        while (attempt < maxAttempts) {
            try {
                return restTemplate.postForObject(
                    "http://payment-service:8080/api/payments",
                    new PaymentRequest(orderId, amount),
                    Payment.class
                );
            } catch (PaymentException e) {
                lastException = e;
                attempt++;

                if (attempt < maxAttempts) {
                    // Exponential backoff with jitter
                    long baseDelay = 1000 * (long) Math.pow(2, attempt - 1);  // 1s, 2s, 4s
                    long jitter = random.nextLong(baseDelay / 2);  // Random 0 to delay/2
                    long totalDelay = baseDelay + jitter;

                    logger.info("Payment attempt {} failed, retrying after {}ms",
                        attempt, totalDelay);

                    try {
                        Thread.sleep(totalDelay);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new RuntimeException(ie);
                    }
                }
            }
        }

        throw lastException;
    }
}

// application.yml
resilience4j:
  retry:
    instances:
      payment-service:
        maxAttempts: 3
        waitDuration: 1000
        intervalFunction: exponentialBackoff
        exponentialBackoffMultiplier: 2
        retryExceptions:
          - com.example.PaymentException
          - java.util.concurrent.TimeoutException
```

### When NOT to Retry

```java
// BAD: Retrying idempotent operations can cause issues
@Retry(name = "payment-service", maxAttempts = 3)
public Payment processPayment(Long orderId, BigDecimal amount) {
    // If network timeout after payment is processed:
    // Retry will charge customer AGAIN
    return paymentClient.processPayment(orderId, amount);
}

// GOOD: Use idempotency key for retries
@Retry(name = "payment-service", maxAttempts = 3)
public Payment processPayment(Long orderId, BigDecimal amount) {
    String idempotencyKey = "order-" + orderId + "-payment";
    // Same key ensures duplicate processing is prevented
    return paymentClient.processPayment(orderId, amount, idempotencyKey);
}

// Don't retry certain exceptions
@Retry(
    name = "payment-service",
    maxAttempts = 3,
    ignoreExceptions = {ValidationException.class, UnauthorizedException.class}
)
public Payment processPayment(Long orderId, BigDecimal amount) {
    // ValidationException: client error, retrying won't help
    // UnauthorizedException: auth issue, retrying won't help
    return paymentClient.processPayment(orderId, amount);
}
```

---

## Bulkhead Pattern

Isolates resources to prevent cascading failures.

### Thread Pool Isolation

```
Without bulkhead:
┌───────────────────────────────────┐
│   Order Service (20 threads)      │
├─────────────┬─────────────────────┤
│ DB calls    │ Payment Service     │
│ (10 threads)│ (10 threads)        │
└─────────────┴─────────────────────┘

If Payment Service hangs:
└─ All 10 threads blocked
└─ Order service can still handle other requests
└─ But 50% of threads consumed

With bulkhead:
┌──────────────────────────────────────┐
│   Order Service (20 threads total)   │
├───────────────┬──────────────────────┤
│ Pool 1        │ Pool 2               │
│ DB calls      │ Payment Service      │
│ (10 threads)  │ (5 threads)          │
│ Isolated      │ Isolated             │
└───────────────┴──────────────────────┘

If Payment Service hangs:
└─ Only 5 threads blocked (25%)
└─ Order service can still use Pool 1
└─ Failure isolated to Pool 2
```

### Bulkhead Implementation

```java
@Configuration
public class BulkheadConfig {

    @Bean
    public BulkheadRegistry bulkheadRegistry() {
        return BulkheadRegistry.ofDefaults();
    }

    @Bean
    public Bulkhead paymentBulkhead(BulkheadRegistry registry) {
        return registry.bulkhead("payment-service", BulkheadConfig.custom()
            .maxConcurrentCalls(5)              // Max 5 concurrent calls
            .maxWaitDuration(Duration.ofSeconds(3))  // Wait max 3 seconds if at capacity
            .build());
    }

    @Bean
    public Bulkhead dbBulkhead(BulkheadRegistry registry) {
        return registry.bulkhead("database", BulkheadConfig.custom()
            .maxConcurrentCalls(20)
            .maxWaitDuration(Duration.ofSeconds(2))
            .build());
    }
}

// Using bulkhead with annotations
@Service
public class OrderService {

    @Bulkhead(name = "payment-service")
    public Payment processPayment(Long orderId, BigDecimal amount) {
        return paymentClient.processPayment(orderId, amount);
    }

    @Bulkhead(name = "database")
    public Order getOrder(Long orderId) {
        return orderRepository.findById(orderId).orElseThrow();
    }
}

// Programmatic usage
@Service
public class OrderServiceProgrammatic {

    private final Bulkhead paymentBulkhead;

    @Autowired
    public OrderServiceProgrammatic(BulkheadRegistry registry) {
        this.paymentBulkhead = registry.bulkhead("payment-service");
    }

    public Payment processPayment(Long orderId, BigDecimal amount) {
        try {
            return paymentBulkhead.executeSupplier(() ->
                paymentClient.processPayment(orderId, amount)
            );
        } catch (BulkheadFullException e) {
            logger.error("Payment service bulkhead at capacity");
            return createPendingPayment(orderId, amount);
        }
    }
}

// application.yml
resilience4j:
  bulkhead:
    instances:
      payment-service:
        maxConcurrentCalls: 5
        maxWaitDuration: 3s
      database:
        maxConcurrentCalls: 20
        maxWaitDuration: 2s

    metrics:
      enabled: true
```

### Semaphore Isolation

```java
// Lighter weight than thread pool isolation
@Bean
public Bulkhead paymentSemaphoreBulkhead(BulkheadRegistry registry) {
    return registry.bulkhead("payment-service", BulkheadConfig.custom()
        .maxConcurrentCalls(5)
        .maxWaitDuration(Duration.ofSeconds(3))
        .bulkheadType(BulkheadConfig.Type.SEMAPHORE)  // Semaphore instead of thread pool
        .build());
}

// Semaphore: shares existing thread, just limits concurrency
// vs
// ThreadPool: separate thread pool with separate thread creation
```

---

## Rate Limiter

Controls the rate of requests to prevent overload.

### Token Bucket Algorithm

```
Bucket: 100 tokens
Refill rate: 10 tokens/second

Second 0: 100 tokens, request arrives → 99 tokens left
Second 0: 100 tokens, request arrives → 98 tokens left
Second 0: 100 tokens, request arrives → 97 tokens left
...
Second 0.1: Refill 1 token → 98 tokens
...
Second 1.0: Refill 10 tokens → 100 tokens
```

```java
@Configuration
public class RateLimiterConfig {

    @Bean
    public RateLimiterRegistry rateLimiterRegistry() {
        return RateLimiterRegistry.ofDefaults();
    }

    @Bean
    public RateLimiter apiRateLimiter(RateLimiterRegistry registry) {
        return registry.rateLimiter("api", RateLimiterConfig.custom()
            .limitRefreshPeriod(Duration.ofMinutes(1))  // 60-second window
            .limitForPeriod(1000)                       // 1000 requests per minute
            .timeoutDuration(Duration.ofSeconds(5))     // Wait max 5 seconds for token
            .build());
    }

    @Bean
    public RateLimiter premiumUserRateLimiter(RateLimiterRegistry registry) {
        return registry.rateLimiter("premium-user", RateLimiterConfig.custom()
            .limitRefreshPeriod(Duration.ofMinutes(1))
            .limitForPeriod(10000)                      // 10x more requests for premium
            .timeoutDuration(Duration.ofSeconds(1))
            .build());
    }
}

// Using rate limiter
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @GetMapping
    @RateLimiter(name = "api")
    public List<Order> getOrders() {
        return orderService.getAllOrders();
    }

    @PostMapping
    @RateLimiter(name = "api")
    public Order createOrder(@RequestBody CreateOrderRequest request) {
        return orderService.createOrder(request);
    }
}

// Per-user rate limiting
@RestController
@RequestMapping("/api/orders")
public class PerUserRateLimitingController {

    @Autowired
    private RateLimiterRegistry rateLimiterRegistry;

    @GetMapping
    public List<Order> getOrders(@RequestHeader String authorization) {
        String userId = extractUserId(authorization);
        RateLimiter rateLimiter = getRateLimiterForUser(userId);

        try {
            boolean allowed = rateLimiter.acquirePermission();
            if (!allowed) {
                throw new RateLimitExceededException("Rate limit exceeded");
            }
            return orderService.getAllOrders();
        } finally {
            // Do something
        }
    }

    private RateLimiter getRateLimiterForUser(String userId) {
        // Get or create per-user rate limiter
        String rateLimiterName = "user-" + userId;

        return rateLimiterRegistry.rateLimiter(rateLimiterName, RateLimiterConfig.custom()
            .limitRefreshPeriod(Duration.ofMinutes(1))
            .limitForPeriod(100)  // 100 requests per minute per user
            .timeoutDuration(Duration.ofSeconds(1))
            .build());
    }
}

// Application-level global rate limiter
@Component
public class GlobalRateLimitingFilter implements Filter {

    @Autowired
    private RateLimiterRegistry rateLimiterRegistry;

    private final RateLimiter globalRateLimiter;

    public GlobalRateLimitingFilter(RateLimiterRegistry registry) {
        this.globalRateLimiter = registry.rateLimiter("global-api", RateLimiterConfig.custom()
            .limitRefreshPeriod(Duration.ofSeconds(1))
            .limitForPeriod(10000)              // 10K requests per second global
            .timeoutDuration(Duration.ZERO)     // No wait, reject immediately
            .build());
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
        throws IOException, ServletException {

        if (!globalRateLimiter.acquirePermission()) {
            ((HttpServletResponse) response).setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.getWriter().write("Service limit exceeded");
            return;
        }

        chain.doFilter(request, response);
    }
}

// application.yml
resilience4j:
  ratelimiter:
    instances:
      api:
        limitRefreshPeriod: 1m
        limitForPeriod: 1000
        timeoutDuration: 5s
      premium-user:
        limitRefreshPeriod: 1m
        limitForPeriod: 10000
        timeoutDuration: 1s
```

### Sliding Window Algorithm

```
Alternative to token bucket, tracks request timestamps.

Minute 1:00-1:59: 150 requests
Minute 2:00-2:59: 200 requests (exceeds 1000 limit)
At 2:30: Current window has 500 requests so far
         Previous window has 150 requests (30 seconds old)
         Total: 500 + (150 * 0.5) = 575 requests
         Still under 1000, allow request
```

---

## Timeout Pattern

Prevents requests from hanging indefinitely.

### Types of Timeouts

```java
// Connection timeout: time to establish TCP connection
int connectTimeout = 3000;  // 3 seconds

// Read timeout: time to read response data
int readTimeout = 5000;     // 5 seconds

// Request timeout: total time from request to response
int requestTimeout = 10000; // 10 seconds
```

### Timeout Implementation

```java
@Configuration
public class TimeoutConfig {

    @Bean
    public RestTemplate restTemplate() {
        HttpComponentsClientHttpRequestFactory factory =
            new HttpComponentsClientHttpRequestFactory();

        factory.setConnectTimeout(3000);  // 3 seconds
        factory.setReadTimeout(5000);     // 5 seconds

        return new RestTemplate(factory);
    }

    @Bean
    public Timer paymentTimer(TimerRegistry registry) {
        return registry.timer("payment-service");
    }

    @Bean
    public TimeLimiter paymentTimeLimiter(TimeLimiterRegistry registry) {
        return registry.timeLimiter("payment-service", TimeLimiterConfig.custom()
            .timeoutDuration(Duration.ofSeconds(3))
            .cancelRunningFuture(true)
            .build());
    }
}

// Using TimeLimiter with async
@Service
public class PaymentServiceWithTimeout {

    @Autowired
    private PaymentClient paymentClient;

    @Autowired
    private TimeLimiter timeLimiter;

    public CompletableFuture<Payment> processPaymentAsync(Long orderId, BigDecimal amount) {
        return timeLimiter.executeSupplierAsCompletableFuture(() ->
            paymentClient.processPayment(orderId, amount)
        );
    }

    @Async
    public void processPaymentAsyncWithTimeout(Long orderId, BigDecimal amount) {
        try {
            Payment payment = Failsafe.with(
                Timeout.of(Duration.ofSeconds(3))
            ).get(() -> paymentClient.processPayment(orderId, amount));

            publishPaymentSucceeded(payment);
        } catch (TimeoutException e) {
            publishPaymentTimeout(orderId);
        }
    }
}

// Application level timeout
@Component
public class TimeoutFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
        FilterChain chain) throws IOException, ServletException {

        long startTime = System.currentTimeMillis();
        chain.doFilter(request, response);
        long duration = System.currentTimeMillis() - startTime;

        if (duration > 30000) {  // 30 second timeout
            logger.warn("Request took {}ms, exceeds timeout", duration);
        }
    }
}

// application.yml
resilience4j:
  timelimiter:
    instances:
      payment-service:
        timeoutDuration: 3s
        cancelRunningFuture: true

spring:
  cloud:
    openfeign:
      client:
        config:
          default:
            connectTimeout: 3000
            readTimeout: 5000
```

---

## Fallback Strategies

Handle failures gracefully when services are unavailable.

### Cache Fallback

```java
@Service
public class ProductServiceWithFallback {

    @Autowired
    private ProductClient productClient;

    @Autowired
    private RedisTemplate<String, Product> redisTemplate;

    @CircuitBreaker(
        name = "product-service",
        fallbackMethod = "getProductFromCache"
    )
    public Product getProduct(Long productId) {
        return productClient.getProduct(productId);
    }

    // Fallback: serve stale data from cache
    public Product getProductFromCache(Long productId, Exception ex) {
        logger.warn("Product service unavailable, serving from cache", ex);

        Product cached = redisTemplate.opsForValue()
            .get("product:" + productId);

        if (cached != null) {
            cached.setFromCache(true);
            return cached;
        }

        throw new ServiceUnavailableException("Product service unavailable and no cached data");
    }
}
```

### Default Value Fallback

```java
@Service
public class DiscountServiceWithFallback {

    @CircuitBreaker(
        name = "discount-service",
        fallbackMethod = "getDefaultDiscount"
    )
    public BigDecimal getDiscount(Long customerId) {
        return discountClient.calculateDiscount(customerId);
    }

    // Fallback: return conservative default
    public BigDecimal getDefaultDiscount(Long customerId, Exception ex) {
        logger.warn("Discount service unavailable, using default 0%", ex);
        return BigDecimal.ZERO;  // No discount if service down
    }
}
```

### Degraded Service Fallback

```java
@Service
public class RecommendationServiceWithFallback {

    @CircuitBreaker(
        name = "recommendation-service",
        fallbackMethod = "getDegradedRecommendations"
    )
    public List<Product> getRecommendations(Long customerId, int count) {
        return recommendationClient.getRecommendations(customerId, count);
    }

    // Fallback: return simple fallback recommendations
    public List<Product> getDegradedRecommendations(Long customerId, int count, Exception ex) {
        logger.warn("Recommendation service unavailable, returning trending products", ex);

        // Return trending products instead of personalized
        return productService.getTrendingProducts(count);
    }
}
```

### Async Processing Fallback

```java
@Service
public class NotificationServiceWithFallback {

    @CircuitBreaker(
        name = "email-service",
        fallbackMethod = "queueNotificationForRetry"
    )
    public void sendOrderConfirmation(Order order) {
        emailService.sendOrderConfirmation(order);
    }

    // Fallback: queue for later retry
    public void queueNotificationForRetry(Order order, Exception ex) {
        logger.warn("Email service unavailable, queuing for retry", ex);

        NotificationQueue notification = new NotificationQueue(
            order.getCustomerId(),
            NotificationType.ORDER_CONFIRMATION,
            order.getId(),
            LocalDateTime.now().plusHours(1)  // Retry after 1 hour
        );

        notificationQueueRepository.save(notification);
    }
}
```

---

## Health Checks

Determine if service is healthy and should receive traffic.

### Liveness vs Readiness

```
LIVENESS: Is the service running?
├─ If false: Kill the pod, start new instance
├─ Check: Can database connection be established?
├─ Check: Is main event loop running?
└─ Should be true for running services even if degraded

READINESS: Is the service ready to handle traffic?
├─ If false: Remove from load balancer (don't kill)
├─ Check: Can all dependencies be reached?
├─ Check: Is cache warmed up?
├─ Check: Are there available database connections?
└─ Can be false if warming up or temporarily degraded
```

### Health Check Implementation

```java
@Component
public class ApplicationHealthIndicator extends AbstractHealthIndicator {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private RestTemplate restTemplate;

    @Override
    protected void doHealthCheck(Health.Builder builder) throws Exception {
        try {
            // Check database connectivity
            orderRepository.count();

            // Check payment service availability
            restTemplate.getForObject("http://payment-service:8080/health", String.class);

            builder.up()
                .withDetail("service", "order-service")
                .withDetail("status", "healthy")
                .withDetail("database", "connected")
                .withDetail("payment-service", "reachable");
        } catch (Exception e) {
            builder.down()
                .withDetail("service", "order-service")
                .withDetail("error", e.getMessage());
        }
    }
}

// Kubernetes liveness probe
@RestController
public class HealthController {

    @GetMapping("/actuator/health/live")  // Liveness
    public ResponseEntity<String> isAlive() {
        return ResponseEntity.ok("OK");
    }

    @GetMapping("/actuator/health/ready")  // Readiness
    public ResponseEntity<String> isReady() {
        // Check if dependencies available
        try {
            orderRepository.count();
            return ResponseEntity.ok("READY");
        } catch (Exception e) {
            return ResponseEntity.status(503).body("NOT_READY");
        }
    }

    @GetMapping("/actuator/health")  // Overall
    public Health getHealth() {
        // Aggregate all indicators
        return new Health.Builder().up().build();
    }
}

// Kubernetes manifest
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  template:
    spec:
      containers:
      - name: order-service
        image: order-service:1.0

        livenessProbe:
          httpGet:
            path: /actuator/health/live
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 3
          failureThreshold: 3

        readinessProbe:
          httpGet:
            path: /actuator/health/ready
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
```

---

## Chaos Engineering

Intentionally inject failures to test resilience.

### Netflix Simian Army

```java
// Simulating chaos in tests
@SpringBootTest
public class ChaosEngineeringTests {

    @Autowired
    private OrderService orderService;

    @Autowired
    private PaymentClient paymentClient;

    // Chaos test: Payment service always fails
    @Test
    public void testOrderCreationWhenPaymentServiceDown() {
        // Mock payment service to always fail
        when(paymentClient.processPayment(any(), any()))
            .thenThrow(new PaymentServiceException("Service unavailable"));

        // Order should still be created (payment retried later)
        Order order = orderService.createOrder(createOrderRequest());

        assertThat(order.getStatus()).isEqualTo(OrderStatus.PENDING);
        assertThat(order.getPaymentStatus()).isEqualTo(PaymentStatus.PENDING);
    }

    // Chaos test: Inventory service times out
    @Test
    public void testOrderCreationWhenInventoryTimesOut() {
        // Mock inventory to timeout
        when(inventoryClient.reserveItems(any()))
            .thenThrow(new TimeoutException("Request timed out"));

        // Should fallback gracefully
        Order order = orderService.createOrder(createOrderRequest());

        assertThat(order).isNotNull();
        // Either order created with pending inventory
        // Or order failed with clear error message
    }

    // Chaos test: Cascade failure
    @Test
    public void testOrderServiceWhenMultipleDependenciesDown() {
        when(paymentClient.processPayment(any(), any()))
            .thenThrow(new ServiceException());
        when(inventoryClient.reserveItems(any()))
            .thenThrow(new ServiceException());
        when(shippingClient.createShipment(any()))
            .thenThrow(new ServiceException());

        // Circuit breaker should open for all services
        // Requests should fail fast
        OrderException exception = assertThrows(
            OrderException.class,
            () -> orderService.createOrder(createOrderRequest())
        );

        assertThat(exception.getMessage()).contains("unavailable");
    }

    // Chaos test: Latency injection
    @Test
    public void testOrderServiceWithHighLatency() {
        // Mock with slow response
        doAnswer(invocation -> {
            Thread.sleep(5000);  // 5 second delay
            return createPayment();
        }).when(paymentClient).processPayment(any(), any());

        // Should timeout and fallback
        long startTime = System.currentTimeMillis();
        Order order = orderService.createOrder(createOrderRequest());
        long duration = System.currentTimeMillis() - startTime;

        assertThat(duration).isLessThan(10000);  // Should use timeout
        assertThat(order.getPaymentStatus()).isEqualTo(PaymentStatus.PENDING);
    }
}

// Production chaos engineering with Chaos Toolkit
@Configuration
public class ChaosConfiguration {

    // In production environment, occasionally inject failures
    @Bean
    public ChaosMonkeyRunner chaosMonkeyRunner() {
        return new ChaosMonkeyRunner()
            .withFailureRate(0.01)  // 1% of requests fail
            .withLatency(100);      // Add 100ms latency
    }
}
```

---

## Distributed Tracing

Track requests across multiple services.

### Spring Cloud Sleuth + Zipkin

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-sleuth</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-sleuth-zipkin</artifactId>
</dependency>
```

```yaml
# application.yml
spring:
  sleuth:
    sampler:
      probability: 1.0  # Sample 100% of requests (0.1 = 10%)
  zipkin:
    baseUrl: http://zipkin-server:9411/

management:
  tracing:
    sampling:
      probability: 1.0
```

```java
// Services automatically instrumented by Sleuth
@Service
public class OrderService {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private PaymentClient paymentClient;

    @Autowired
    private RestTemplate restTemplate;

    public Order createOrder(CreateOrderRequest request) {
        // Sleuth automatically creates span for method
        Order order = new Order(request);
        orderRepository.save(order);

        // Sleuth automatically creates child span for HTTP call
        Payment payment = paymentClient.processPayment(order.getId(), order.getTotal());

        return order;
    }
}

// Trace appears in Zipkin:
// POST /api/orders (trace: abc123def456)
//   ├── save order (span: 1)
//   ├── POST payment-service/api/payments (span: 2)
//   │   ├── processing payment (span: 3)
//   │   └── update ledger (span: 4)
//   └── update order status (span: 5)

// Manual span creation
@Service
public class ComplexOrderService {

    @Autowired
    private Tracer tracer;

    public void processOrder(Long orderId) {
        // Parent span
        Tracer.SpanInScope span = tracer.withSpan(
            tracer.nextSpan().name("process-order")
        );

        try {
            // Child span for inventory
            Tracer.SpanInScope inventorySpan = tracer.withSpan(
                tracer.nextSpan().name("reserve-inventory")
            );
            try {
                inventoryService.reserveItems(orderId);
            } finally {
                inventorySpan.close();
            }

            // Child span for payment
            Tracer.SpanInScope paymentSpan = tracer.withSpan(
                tracer.nextSpan().name("process-payment")
            );
            try {
                paymentService.processPayment(orderId);
            } finally {
                paymentSpan.close();
            }
        } finally {
            span.close();
        }
    }
}
```

### Correlation IDs

```java
// Manually pass correlation ID
@Component
public class CorrelationIdFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
        FilterChain chain) throws IOException, ServletException {

        HttpServletRequest httpRequest = (HttpServletRequest) request;
        String correlationId = httpRequest.getHeader("X-Correlation-ID");

        if (correlationId == null) {
            correlationId = UUID.randomUUID().toString();
        }

        // Add to MDC (Mapped Diagnostic Context) for logging
        MDC.put("correlationId", correlationId);

        // Add to response
        ((HttpServletResponse) response).addHeader("X-Correlation-ID", correlationId);

        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove("correlationId");
        }
    }
}

// Logging includes correlation ID
// logback.xml
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>
                %d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} [%X{correlationId}] - %msg%n
            </pattern>
        </encoder>
    </appender>
</configuration>

// Logs appear as:
// 2024-02-09 10:30:45.123 [http-nio-8080-exec-1] INFO OrderService [abc123] - Processing order
// 2024-02-09 10:30:45.456 [http-nio-8080-exec-2] INFO PaymentService [abc123] - Processing payment
// All with same correlationId for easy tracing
```

---

## Interview Questions

### Q1: Design a resilient payment service handling 10K requests/second

**Answer**:

```
Resilience layers:

┌─────────────────────────────────────────┐
│ API Gateway (Public Interface)          │
├─────────────────────────────────────────┤
│ - Rate limiting (10K/sec)               │
│ - Authentication, validation            │
│ - Idempotency key tracking              │
└──────────────┬──────────────────────────┘
               ▼
┌─────────────────────────────────────────┐
│ Payment Service                         │
├─────────────────────────────────────────┤
│ 1. Circuit Breaker (Resilience4j)       │
│    - Fail fast if payment provider down │
│    - Fallback: queue for async retry    │
│                                         │
│ 2. Retry Pattern                        │
│    - Exponential backoff with jitter    │
│    - Max 3 attempts (1 orig + 2 retry)  │
│    - Don't retry on validation errors   │
│                                         │
│ 3. Bulkhead Pattern                     │
│    - Separate thread pools:             │
│      ├── Credit card (5 threads)        │
│      ├── PayPal (5 threads)             │
│      ├── Bank transfer (3 threads)      │
│    - Isolated failures                  │
│                                         │
│ 4. Timeout Pattern                      │
│    - Connect: 3 seconds                 │
│    - Read: 5 seconds                    │
│    - Total: 10 seconds max              │
│                                         │
│ 5. Fallback Strategy                    │
│    - Payment provider down:             │
│      └── Mark as PENDING, retry queue   │
│    - Timeout: queue for async          │
│    - Rate limited: return 429 + queue   │
│                                         │
│ 6. Idempotency                          │
│    - Client provides idempotency key    │
│    - Prevents double charging on retry  │
└──────────────┬──────────────────────────┘
               ▼
        Payment Providers
        (Stripe, PayPal, etc)

Monitoring:
├── Circuit breaker state (Prometheus)
├── Retry counts (metrics)
├── Bulkhead capacity (alerts)
├── Latency distributions (p50, p95, p99)
└── Distributed tracing (Zipkin)
```

### Q2: Your payment service is timing out. How would you troubleshoot?

**Answer**:

```
Timeout Troubleshooting:

1. Identify where timeout occurs:
   └── Use distributed tracing (Sleuth/Zipkin)
       ├── Check which service calls are slow
       ├── See if timeout on client side or server side
       └── Example: Payment Service → Stripe API timeout

2. Server-side issues:
   ├── Database slow queries
   │   └── Check slow query log
   │   └── Add query indexes
   │
   ├── Resource constraints
   │   ├── CPU usage > 90%?
   │   ├── Memory usage > 80%?
   │   ├── Thread pool exhausted?
   │   └── Scale service or tune resources
   │
   ├── Dependency latency
   │   ├── Database too slow
   │   ├── External API slow
   │   └── Network latency high

3. Client-side issues:
   ├── Timeout value too low?
   ├── Retry storm (many clients retrying)
   ├── Circuit breaker thrashing
   ├── Bulkhead at capacity (queuing)

4. Network issues:
   ├── Network latency high
   ├── Packet loss
   ├── DNS lookup slow
   └── Load balancer having issues

5. Quick fixes:
   ├── Increase timeout value (temporary)
   ├── Scale payment service (add instances)
   ├── Cache responses where possible
   ├── Batch requests
   ├── Check circuit breaker state
   └── Check dependency health

6. Long-term fixes:
   ├── Database optimization (indexes, caching)
   ├── Async processing where possible
   ├── Improve payment provider integration
   ├── Add caching layer (Redis)
   └── Load test to find bottlenecks
```

