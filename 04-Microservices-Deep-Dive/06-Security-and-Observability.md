# Security and Observability in Microservices

## Table of Contents
1. [Authentication and Authorization](#authentication-and-authorization)
2. [Token-Based Authentication](#token-based-auth)
3. [Service-to-Service Authentication](#service-to-service)
4. [API Security](#api-security)
5. [Distributed Logging](#distributed-logging)
6. [Metrics and Monitoring](#metrics-and-monitoring)
7. [Alerting](#alerting)
8. [Interview Questions](#interview-questions)

---

## Authentication and Authorization

### OAuth 2.0 Flow

```
User logs in through application:

1. User clicks "Login"
   └─ Application redirects to OAuth provider
      (e.g., Google, GitHub, Okta)

2. User authenticates with provider
   └─ User enters credentials on provider's site

3. Provider redirects back to application
   └─ With authorization code

4. Application exchanges code for token (backend)
   └─ Application secret + code → Access token

5. Application uses token to fetch user info
   └─ Access token → User details

6. Application creates session
   └─ User logged in
```

### JWT (JSON Web Token)

```
Header.Payload.Signature

Header:
{
  "alg": "HS256",
  "typ": "JWT"
}

Payload:
{
  "sub": "user123",
  "name": "John Doe",
  "roles": ["admin", "user"],
  "iat": 1675000000,
  "exp": 1675003600
}

Signature:
HMACSHA256(base64(header) + "." + base64(payload), secret)

Full JWT:
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.
eyJzdWIiOiJ1c2VyMTIzIiwibmFtZSI6IkpvaG4gRG9lIiwicm9sZXMiOlsiYWRtaW4iLCJ1c2VyIl0sImlhdCI6MTY3NTAwMDAwMCwiZXhwIjoxNjc1MDAzNjAwfQ.
TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ
```

---

## Token-Based Authentication

### JWT Implementation with Spring Security

```java
// JWT Token Provider
@Component
public class JwtTokenProvider {

    @Value("${jwt.secret:mySecretKeyThatIsAtLeast32CharactersLong}")
    private String jwtSecret;

    @Value("${jwt.expiration:3600000}")  // 1 hour in milliseconds
    private long jwtExpirationMs;

    // Generate JWT token
    public String generateToken(String username, Collection<GrantedAuthority> authorities) {
        long now = System.currentTimeMillis();
        long expiryTime = now + jwtExpirationMs;

        List<String> roles = authorities.stream()
            .map(GrantedAuthority::getAuthority)
            .collect(Collectors.toList());

        return Jwts.builder()
            .setSubject(username)
            .claim("roles", roles)
            .setIssuedAt(new Date(now))
            .setExpiration(new Date(expiryTime))
            .signWith(SignatureAlgorithm.HS512, jwtSecret)
            .compact();
    }

    // Validate and extract claims
    public String getUsernameFromJWT(String token) {
        return Jwts.parser()
            .setSigningKey(jwtSecret)
            .parseClaimsJws(token)
            .getBody()
            .getSubject();
    }

    public Claims getClaimsFromJWT(String token) {
        return Jwts.parser()
            .setSigningKey(jwtSecret)
            .parseClaimsJws(token)
            .getBody();
    }

    public boolean validateJWT(String token) {
        try {
            Jwts.parser().setSigningKey(jwtSecret).parseClaimsJws(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            logger.error("JWT validation failed: {}", e.getMessage());
            return false;
        }
    }
}

// Authentication Controller
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private AuthenticationManager authenticationManager;

    @Autowired
    private UserService userService;

    @Autowired
    private JwtTokenProvider tokenProvider;

    @PostMapping("/login")
    public ResponseEntity<?> authenticateUser(@RequestBody LoginRequest loginRequest) {
        Authentication authentication = authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(
                loginRequest.getUsername(),
                loginRequest.getPassword()
            )
        );

        SecurityContextHolder.getContext().setAuthentication(authentication);

        UserDetails userDetails = (UserDetails) authentication.getPrincipal();
        String jwt = tokenProvider.generateToken(userDetails.getUsername(), userDetails.getAuthorities());

        return ResponseEntity.ok(new JwtAuthenticationResponse(jwt));
    }

    @PostMapping("/refresh")
    public ResponseEntity<?> refreshToken(HttpServletRequest request) {
        String jwt = getJwtFromRequest(request);

        if (tokenProvider.validateJWT(jwt)) {
            Claims claims = tokenProvider.getClaimsFromJWT(jwt);
            String username = claims.getSubject();

            UserDetails userDetails = userService.loadUserByUsername(username);
            String newToken = tokenProvider.generateToken(username, userDetails.getAuthorities());

            return ResponseEntity.ok(new JwtAuthenticationResponse(newToken));
        }

        throw new UnauthorizedException("Invalid token");
    }

    private String getJwtFromRequest(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");

        if (StringUtils.hasText(bearerToken) && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }

        return null;
    }
}

// JWT Authentication Filter
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    @Autowired
    private JwtTokenProvider tokenProvider;

    @Autowired
    private UserService userService;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
        FilterChain filterChain) throws ServletException, IOException {

        try {
            String jwt = getJwtFromRequest(request);

            if (StringUtils.hasText(jwt) && tokenProvider.validateJWT(jwt)) {
                String username = tokenProvider.getUsernameFromJWT(jwt);
                Claims claims = tokenProvider.getClaimsFromJWT(jwt);

                UserDetails userDetails = userService.loadUserByUsername(username);

                List<GrantedAuthority> authorities = ((List<?>) claims.get("roles"))
                    .stream()
                    .map(role -> new SimpleGrantedAuthority((String) role))
                    .collect(Collectors.toList());

                UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                        userDetails,
                        null,
                        authorities
                    );

                authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        } catch (Exception e) {
            logger.error("Could not set user authentication in security context", e);
        }

        filterChain.doFilter(request, response);
    }

    private String getJwtFromRequest(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");

        if (StringUtils.hasText(bearerToken) && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }

        return null;
    }
}

// Security Configuration
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf().disable()
            .exceptionHandling()
                .authenticationEntryPoint((request, response, authException) -> {
                    response.setStatus(HttpStatus.UNAUTHORIZED.value());
                    response.setContentType("application/json");
                    response.getWriter().write("{\"error\": \"Unauthorized\"}");
                })
            .and()
            .sessionManagement().sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            .and()
            .authorizeRequests()
                .antMatchers("/api/auth/**").permitAll()
                .antMatchers("/api/orders/**").hasRole("USER")
                .antMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            .and()
            .addFilterBefore(new JwtAuthenticationFilter(), UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public AuthenticationManager authenticationManager(UserDetailsService userDetailsService) {
        return new ProviderManager(new DaoAuthenticationProvider() {{
            setUserDetailsService(userDetailsService);
            setPasswordEncoder(passwordEncoder());
        }});
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}

// application.yml
jwt:
  secret: mySecretKeyThatIsAtLeast32CharactersLongForJwtSigning
  expiration: 3600000  # 1 hour
```

---

## Service-to-Service Authentication

### Mutual TLS (mTLS)

```java
// Service A: Client configuration
@Configuration
public class MtlsClientConfig {

    @Bean
    public RestTemplate restTemplate(
        @Value("${service.keystore.path}") String keystorePath,
        @Value("${service.keystore.password}") String keystorePassword,
        @Value("${service.truststore.path}") String truststorePath,
        @Value("${service.truststore.password}") String truststorePassword
    ) throws Exception {
        // Load client certificate
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        FileInputStream keyStoreFile = new FileInputStream(keystorePath);
        keyStore.load(keyStoreFile, keystorePassword.toCharArray());

        // Load trusted CA certificates
        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        FileInputStream trustStoreFile = new FileInputStream(truststorePath);
        trustStore.load(trustStoreFile, truststorePassword.toCharArray());

        // Create SSL context
        SSLContext sslContext = SSLContext.getInstance("TLS");

        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(keyStore, keystorePassword.toCharArray());

        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(trustStore);

        sslContext.init(kmf.getKeyManagers(), tmf.getTrustManagers(), new SecureRandom());

        // Create HTTP client with SSL context
        HttpClientBuilder httpClientBuilder = HttpClients.custom()
            .setSSLContext(sslContext);

        HttpComponentsClientHttpRequestFactory factory =
            new HttpComponentsClientHttpRequestFactory(httpClientBuilder.build());

        return new RestTemplate(factory);
    }
}

// Configuration
spring:
  service:
    keystore:
      path: /etc/ssl/certs/client-keystore.p12
      password: ${KEYSTORE_PASSWORD}
    truststore:
      path: /etc/ssl/certs/truststore.p12
      password: ${TRUSTSTORE_PASSWORD}
```

### Service-to-Service with API Key

```java
// Service A calling Service B
@Service
public class PaymentClient {

    @Autowired
    private RestTemplate restTemplate;

    @Value("${payment-service.url}")
    private String paymentServiceUrl;

    @Value("${payment-service.api-key}")
    private String apiKey;

    public Payment processPayment(Long orderId, BigDecimal amount) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-API-Key", apiKey);
        headers.set("X-Service-Name", "order-service");  // Service identification
        headers.setContentType(MediaType.APPLICATION_JSON);

        ProcessPaymentRequest request = new ProcessPaymentRequest(orderId, amount);
        HttpEntity<ProcessPaymentRequest> entity = new HttpEntity<>(request, headers);

        return restTemplate.postForObject(
            paymentServiceUrl + "/api/payments",
            entity,
            Payment.class
        );
    }
}

// Service B validating API key
@Component
public class ApiKeyValidator implements HandlerInterceptor {

    @Value("${api-keys.order-service:secret-key-123}")
    private String orderServiceApiKey;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
        Object handler) throws Exception {

        String apiKey = request.getHeader("X-API-Key");
        String serviceName = request.getHeader("X-Service-Name");

        if (apiKey == null || !apiKey.equals(getApiKeyForService(serviceName))) {
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            response.setContentType("application/json");
            response.getWriter().write("{\"error\": \"Invalid API key\"}");
            return false;
        }

        return true;
    }

    private String getApiKeyForService(String serviceName) {
        // Load from secure store
        return switch(serviceName) {
            case "order-service" -> orderServiceApiKey;
            case "inventory-service" -> getApiKeyFromSecureStore("inventory-service");
            default -> null;
        };
    }
}

// application.yml
api-keys:
  order-service: ${ORDER_SERVICE_API_KEY}
  inventory-service: ${INVENTORY_SERVICE_API_KEY}
  shipping-service: ${SHIPPING_SERVICE_API_KEY}
```

---

## API Security

### Input Validation

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @PostMapping
    public ResponseEntity<Order> createOrder(
        @Valid @RequestBody CreateOrderRequest request
    ) {
        // Spring validates request based on annotations
        return ResponseEntity.ok(orderService.createOrder(request));
    }
}

// Request DTO with validation
public class CreateOrderRequest {

    @NotNull(message = "Customer ID required")
    @Positive(message = "Customer ID must be positive")
    private Long customerId;

    @NotEmpty(message = "Order items cannot be empty")
    @Size(max = 100, message = "Cannot have more than 100 items")
    private List<OrderItem> items;

    @NotNull
    @DecimalMin(value = "0.01", message = "Total must be positive")
    private BigDecimal total;

    @Email(message = "Valid email required")
    private String customerEmail;

    @Pattern(regexp = "\\d{5}-\\d{4}", message = "Valid ZIP code required")
    private String zipCode;

    // Getters and setters
}

// Custom validation
@Component
public class CustomOrderValidator {

    public void validate(CreateOrderRequest request) {
        // Business logic validation
        if (request.getItems().isEmpty()) {
            throw new ValidationException("Order must have items");
        }

        BigDecimal calculatedTotal = request.getItems().stream()
            .map(item -> item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add);

        if (!calculatedTotal.equals(request.getTotal())) {
            throw new ValidationException("Total amount mismatch");
        }
    }
}
```

### Rate Limiting

```java
// Per-user rate limiting
@Component
public class RateLimitingFilter implements Filter {

    @Autowired
    private RateLimiterRegistry rateLimiterRegistry;

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
        FilterChain chain) throws IOException, ServletException {

        HttpServletRequest httpRequest = (HttpServletRequest) request;
        String userId = extractUserId(httpRequest);

        RateLimiter limiter = getRateLimiterForUser(userId);

        if (!limiter.acquirePermission()) {
            HttpServletResponse httpResponse = (HttpServletResponse) response;
            httpResponse.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            httpResponse.addHeader("Retry-After", "60");
            return;
        }

        chain.doFilter(request, response);
    }

    private RateLimiter getRateLimiterForUser(String userId) {
        String limiterName = "user-" + userId;
        // Get or create per-user rate limiter
        return rateLimiterRegistry.rateLimiter(limiterName, RateLimiterConfig.custom()
            .limitRefreshPeriod(Duration.ofMinutes(1))
            .limitForPeriod(100)  // 100 requests per minute
            .timeoutDuration(Duration.ZERO)
            .build());
    }

    private String extractUserId(HttpServletRequest request) {
        String authHeader = request.getHeader("Authorization");
        // Extract userId from JWT token
        return null;
    }
}
```

### CORS Configuration

```java
@Configuration
public class CorsConfig {

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**")
                    .allowedOrigins("https://app.example.com", "https://mobile.example.com")
                    .allowedMethods("GET", "POST", "PUT", "DELETE")
                    .allowedHeaders("*")
                    .exposedHeaders("X-Total-Count", "X-Page-Number")
                    .allowCredentials(true)
                    .maxAge(3600);
            }
        };
    }
}
```

---

## Distributed Logging

### ELK Stack (Elasticsearch, Logstash, Kibana)

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-sleuth</artifactId>
</dependency>
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>7.2</version>
</dependency>
```

```xml
<!-- logback-spring.xml -->
<configuration>
    <!-- Console appender with color -->
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>
                %d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{36} [%X{traceId}] - %msg%n
            </pattern>
        </encoder>
    </appender>

    <!-- JSON structured logging for Logstash -->
    <appender name="LOGSTASH" class="net.logstash.logback.appender.LogstashTcpSocketAppender">
        <destination>logstash:5000</destination>
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <customFields>{"service": "order-service", "environment": "production"}</customFields>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
        <appender-ref ref="LOGSTASH"/>
    </root>
</configuration>

# logback config in YAML
logging:
  level:
    root: INFO
    com.ecommerce: DEBUG
    org.springframework.web: WARN
  pattern:
    console: "%d{yyyy-MM-dd HH:mm:ss} - %msg%n"
    file: "%d{yyyy-MM-dd HH:mm:ss} [%thread] %-5level %logger{36} [%X{traceId}] - %msg%n"
  file:
    name: logs/application.log
    max-size: 10MB
    max-history: 10
```

### Structured Logging

```java
// Use structured logging for better querying
@Service
public class OrderService {

    private static final Logger logger = LoggerFactory.getLogger(OrderService.class);

    public void createOrder(CreateOrderRequest request) {
        // Structured logging with context
        logger.info("Creating order",
            kv("customerId", request.getCustomerId()),
            kv("itemCount", request.getItems().size()),
            kv("totalAmount", request.getTotal())
        );

        try {
            Order order = new Order(request);
            orderRepository.save(order);

            logger.info("Order created successfully",
                kv("orderId", order.getId()),
                kv("status", order.getStatus()),
                kv("duration_ms", System.currentTimeMillis() - startTime)
            );
        } catch (Exception e) {
            logger.error("Failed to create order",
                kv("customerId", request.getCustomerId()),
                kv("errorMessage", e.getMessage()),
                kv("exceptionType", e.getClass().getName()),
                e
            );
            throw e;
        }
    }

    // Helper method
    private static StructuredArgument kv(String key, Object value) {
        return keyValue(key, value);
    }
}
```

### Log Aggregation Query

```
Query in Kibana:
service: "order-service" AND level: "ERROR" AND timestamp: [now-1h TO now]

Returns: All error logs from order service in last hour

Fields in Elasticsearch:
├─ @timestamp: 2024-02-09T10:30:45.123Z
├─ service: order-service
├─ level: ERROR
├─ message: "Failed to create order"
├─ customerId: 123
├─ totalAmount: 99.99
├─ errorMessage: "Payment service unavailable"
├─ exceptionType: "PaymentServiceException"
├─ traceId: abc123def456
└─ spanId: xyz789
```

---

## Metrics and Monitoring

### Prometheus Metrics

```xml
<!-- pom.xml -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

```java
// Custom metrics
@Service
public class OrderService {

    @Autowired
    private MeterRegistry meterRegistry;

    @Autowired
    private OrderRepository orderRepository;

    private final Counter ordersCreated;
    private final Timer orderCreationTime;
    private final AtomicInteger pendingOrders;

    public OrderService(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;

        // Counter: monotonically increasing
        this.ordersCreated = Counter.builder("orders_created_total")
            .description("Total number of orders created")
            .tag("service", "order-service")
            .register(meterRegistry);

        // Timer: duration tracking
        this.orderCreationTime = Timer.builder("order_creation_time")
            .description("Time taken to create an order")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(meterRegistry);

        // Gauge: current value
        this.pendingOrders = new AtomicInteger(0);
        meterRegistry.gauge("orders_pending", pendingOrders);
    }

    @Transactional
    public Order createOrder(CreateOrderRequest request) {
        long startTime = System.currentTimeMillis();

        try {
            Order order = new Order(request);
            order = orderRepository.save(order);

            ordersCreated.increment();
            pendingOrders.incrementAndGet();

            return order;
        } finally {
            long duration = System.currentTimeMillis() - startTime;
            orderCreationTime.record(Duration.ofMillis(duration));
        }
    }

    public void completeOrder(Long orderId) {
        pendingOrders.decrementAndGet();
        meterRegistry.counter("orders_completed_total").increment();
    }
}

// Expose metrics endpoint
spring:
  application:
    name: order-service

management:
  endpoints:
    web:
      exposure:
        include: health,metrics,prometheus
  metrics:
    enable:
      logback: true
      jvm: true
      process: true
      system: true
    export:
      prometheus:
        enabled: true
```

### Key Metrics (RED Method)

```
RED Method for microservices:

R - REQUEST RATE
├─ Requests per second
├─ Alert: Rate > X requests/sec

E - ERROR RATE
├─ Percentage of failed requests
├─ Alert: Error rate > 1%

D - DURATION (Latency)
├─ Response time distribution
├─ Alert: p99 latency > 5 seconds
```

```java
// Implement RED metrics
@Component
public class MetricsCollector {

    @Autowired
    private MeterRegistry meterRegistry;

    @Before("execution(public * com.ecommerce..*.*(..))")
    public void recordMetrics(JoinPoint joinPoint) {
        String methodName = joinPoint.getSignature().getName();
        String className = joinPoint.getTarget().getClass().getSimpleName();

        // REQUEST RATE
        Counter.builder("http_requests_total")
            .tag("method", methodName)
            .tag("service", className)
            .register(meterRegistry)
            .increment();

        // DURATION
        long startTime = System.currentTimeMillis();

        try {
            joinPoint.proceed();

            // SUCCESS: no error
            long duration = System.currentTimeMillis() - startTime;
            Timer.builder("http_request_duration_ms")
                .tag("method", methodName)
                .tag("status", "success")
                .register(meterRegistry)
                .record(Duration.ofMillis(duration));

        } catch (Throwable e) {
            // ERROR RATE
            Counter.builder("http_requests_errors_total")
                .tag("method", methodName)
                .tag("exception", e.getClass().getSimpleName())
                .register(meterRegistry)
                .increment();

            long duration = System.currentTimeMillis() - startTime;
            Timer.builder("http_request_duration_ms")
                .tag("method", methodName)
                .tag("status", "error")
                .register(meterRegistry)
                .record(Duration.ofMillis(duration));

            throw e;
        }
    }
}

// Prometheus scrape config
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'order-service'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/actuator/prometheus'

  - job_name: 'payment-service'
    static_configs:
      - targets: ['localhost:8081']
    metrics_path: '/actuator/prometheus'
```

### Grafana Dashboards

```
Dashboard: Order Service Health

Panels:
1. Request Rate (per second)
   └─ Query: rate(http_requests_total[1m])

2. Error Rate (percentage)
   └─ Query: (rate(http_requests_errors_total[1m]) / rate(http_requests_total[1m])) * 100

3. Latency Percentiles
   └─ Query: histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))
   └─ Shows p50, p95, p99

4. Circuit Breaker State
   └─ Query: circuitbreaker_state{name="payment-service"}
   └─ 0=CLOSED, 1=OPEN, 2=HALF_OPEN

5. Pending Orders
   └─ Query: orders_pending

Alerts:
- Error rate > 1% for 5 minutes
- Latency p99 > 5 seconds
- Circuit breaker open > 2 minutes
- Memory usage > 80%
```

---

## Alerting

### Alert Rules

```yaml
# prometheus-rules.yml
groups:
  - name: order-service
    interval: 30s
    rules:
      - alert: HighErrorRate
        expr: (rate(http_requests_errors_total[5m]) / rate(http_requests_total[5m])) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate in order service"
          description: "Error rate is {{ $value | humanizePercentage }}"

      - alert: SlowResponse
        expr: histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m])) > 5000
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High latency in order service"
          description: "p95 latency is {{ $value | humanizeDuration }}"

      - alert: CircuitBreakerOpen
        expr: circuitbreaker_state{name="payment-service"} == 1
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Payment service circuit breaker open"
          description: "Payment service is failing, orders cannot be processed"

      - alert: ServiceDown
        expr: up{job="order-service"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Order service is down"
          description: "Order service is unreachable"
```

### Alert Routing (AlertManager)

```yaml
# alertmanager.yml
global:
  resolve_timeout: 5m

route:
  receiver: 'default'
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h

  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
      continue: true

    - match:
        severity: warning
      receiver: 'slack'

receivers:
  - name: 'default'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#alerts'

  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_KEY'
        description: '{{ .GroupLabels.alertname }}'

  - name: 'slack'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#warnings'
        title: 'Warning Alert'
```

---

## Interview Questions

### Q1: Design authentication for microservices where services need to talk to each other

**Answer**:

```
Architecture:

1. Client → API Gateway: JWT token
   ├─ Authorization header: "Bearer <JWT>"
   └─ Gateway validates token

2. API Gateway → Microservices: Service-to-service calls

   Option 1: mTLS (Mutual TLS)
   ├─ Each service has certificate
   ├─ Encrypted channel between services
   ├─ Most secure, requires cert management
   ├─ Suitable for: Istio/Service Mesh environments

   Option 2: API Key
   ├─ Service A sends API key in header
   ├─ Service B validates key
   ├─ Simpler than mTLS, less overhead
   ├─ Suitable for: Direct service calls

   Option 3: JWT with Service Account
   ├─ Service A uses service account credentials
   ├─ Gets JWT token from auth service
   ├─ Sends JWT to Service B
   ├─ Reuses same token validation as client auth

Implementation:
├─ Client auth: OAuth 2.0 + JWT
├─ Service-to-service: mTLS in Kubernetes, or API key/JWT
├─ Central auth server (Keycloak, Okta)
├─ Token validation caching to reduce latency
└─ Token refresh mechanism
```

### Q2: Your application is generating too many logs. How would you manage them?

**Answer**:

```
Log Management Strategy:

1. Log Levels
   ├─ DEBUG: development only
   ├─ INFO: important business events
   ├─ WARN: recoverable issues
   ├─ ERROR: service failures
   ├─ Environment-specific levels

2. Sampling
   ├─ Log 100% of errors
   ├─ Log 10% of info (random sampling)
   ├─ Log 1% of debug
   ├─ Reduces storage while maintaining visibility

3. Log Retention
   ├─ Errors: 30 days
   ├─ Warnings: 14 days
   ├─ Info: 7 days
   ├─ Archive old logs to S3

4. Structured Logging
   ├─ Include context fields (userId, orderId, traceId)
   ├─ Enables efficient searching
   ├─ Easier parsing and analysis

5. Aggregation
   ├─ Centralize logs (ELK, Datadog)
   ├─ Index by timestamp, service, level
   ├─ Efficient querying

Example query:
service: order-service AND level: ERROR AND timestamp: [now-24h TO now]
Returns: All errors in last 24 hours
```

