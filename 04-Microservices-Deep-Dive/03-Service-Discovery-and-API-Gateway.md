# Service Discovery and API Gateway

## Table of Contents
1. [Service Discovery](#service-discovery)
2. [API Gateway Pattern](#api-gateway-pattern)
3. [Backend for Frontend (BFF)](#backend-for-frontend)
4. [Load Balancing](#load-balancing)
5. [Service Mesh](#service-mesh)
6. [Configuration Management](#configuration-management)
7. [Deployment Strategies](#deployment-strategies)
8. [Interview Questions](#interview-questions)

---

## Service Discovery

In a microservices architecture, services are dynamic (instances come and go). Discovery finds available instances.

### Without Service Discovery (Manual Registration)

```
Hardcoded in code:
├── Order Service: http://payment-service-instance-1:8080
├── Order Service: http://payment-service-instance-2:8080
├── Order Service: http://payment-service-instance-3:8080

Problems:
1. If instance dies, code fails
2. No dynamic scaling
3. Manual update of service URLs
4. Load balancing manual
```

### Service Discovery Architecture

```
┌─────────────────────────────────────────────────────────┐
│        Service Registry (Eureka, Consul, etcd)          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ payment-service:                                │   │
│  │   - instance-1: http://10.0.0.5:8080            │   │
│  │   - instance-2: http://10.0.0.6:8080            │   │
│  │   - instance-3: http://10.0.0.7:8080            │   │
│  │ order-service:                                  │   │
│  │   - instance-1: http://10.0.0.1:8080            │   │
│  │   - instance-2: http://10.0.0.2:8080            │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

Services register on startup, deregister on shutdown
Clients query registry to find service instances
```

### Client-Side Service Discovery

Client finds instances and load balances.

```java
// Netflix Eureka (Spring Cloud Eureka)

// Payment Service registers itself
@SpringBootApplication
@EnableEurekaClient
public class PaymentServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(PaymentServiceApplication.class, args);
    }
}

// application.yml
spring:
  application:
    name: payment-service
  cloud:
    eureka:
      client:
        serviceUrl:
          defaultZone: http://eureka-server:8761/eureka/
      instance:
        preferIpAddress: true
        metadata-map:
          version: 1.0

server:
  port: 8080

# Order Service discovers and calls Payment Service
@Service
public class OrderService {

    @Autowired
    private RestTemplate restTemplate;

    @Autowired
    private DiscoveryClient discoveryClient;

    public Order createOrder(CreateOrderRequest request) {
        // Find payment service instances from Eureka
        List<ServiceInstance> instances = discoveryClient
            .getInstances("payment-service");

        if (instances.isEmpty()) {
            throw new ServiceUnavailableException("payment-service not available");
        }

        // Load balance (round-robin)
        ServiceInstance instance = instances.get(
            (int)(Math.random() * instances.size())
        );

        String url = String.format(
            "http://%s:%d/api/payments",
            instance.getHost(),
            instance.getPort()
        );

        // Make request
        Payment payment = restTemplate.postForObject(
            url,
            new PaymentRequest(request.getOrderId(), request.getTotal()),
            Payment.class
        );

        return new Order(request, payment);
    }
}

// Better: Use Ribbon (load balancer)
@Service
public class OrderServiceWithRibbon {

    @Bean
    @LoadBalanced
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    @Autowired
    private RestTemplate restTemplate;

    public Order createOrder(CreateOrderRequest request) {
        // Ribbon handles discovery and load balancing automatically
        Payment payment = restTemplate.postForObject(
            "http://payment-service/api/payments",  // Service name, not hostname
            new PaymentRequest(request.getOrderId(), request.getTotal()),
            Payment.class
        );

        return new Order(request, payment);
    }
}
```

### Server-Side Service Discovery

API Gateway discovers instances and routes requests.

```
┌─────────────┐
│  Client     │
└──────┬──────┘
       │ HTTP request
       ▼
┌──────────────────────────────────┐
│    API Gateway                   │
│  (discovers services, routes)    │
└──────────────────┬───────────────┘
       │
       ├─ query Service Registry
       │
       ├─ route to payment-service:8080
       ├─ route to order-service:8080
       └─ route to inventory-service:8080

Advantages:
- Client doesn't know about service instances
- Gateway handles load balancing
- Client sees single entry point
```

```java
// Spring Cloud Gateway with service discovery
@Configuration
public class GatewayConfiguration {

    @Bean
    public RouteLocator routes(RouteLocatorBuilder builder) {
        return builder.routes()
            // Route to payment service
            .route("payment-service", r -> r
                .path("/api/payments/**")
                .uri("lb://payment-service"))  // lb:// = load balanced URI

            // Route to order service
            .route("order-service", r -> r
                .path("/api/orders/**")
                .uri("lb://order-service"))

            // Route to inventory service
            .route("inventory-service", r -> r
                .path("/api/inventory/**")
                .uri("lb://inventory-service"))

            .build();
    }
}

// application.yml
spring:
  application:
    name: api-gateway
  cloud:
    gateway:
      discovery:
        locator:
          enabled: true  # Enable service discovery
          lowerCaseServiceId: true
      routes:
        - id: payment-service
          uri: lb://payment-service
          predicates:
            - Path=/api/payments/**
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/orders/**
```

### Eureka Server Setup

```java
@SpringBootApplication
@EnableEurekaServer
public class EurekaServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(EurekaServerApplication.class, args);
    }
}

// application.yml
spring:
  application:
    name: eureka-server

server:
  port: 8761

eureka:
  client:
    register-with-eureka: false  # Server doesn't register with itself
    fetch-registry: false
  server:
    enable-self-preservation: true  # Keep registrations even if heartbeat stops
    eviction-interval-timer-in-ms: 60000
```

### Health Checks and Heartbeat

```java
// Health indicator
@Component
public class PaymentServiceHealthIndicator extends AbstractHealthIndicator {

    @Autowired
    private PaymentService paymentService;

    @Override
    protected void doHealthCheck(Health.Builder builder) throws Exception {
        try {
            // Check if database is accessible
            paymentService.getHealth();

            builder.up()
                .withDetail("service", "payment-service")
                .withDetail("database", "connected")
                .withDetail("status", "healthy");
        } catch (Exception e) {
            builder.down()
                .withDetail("service", "payment-service")
                .withDetail("error", e.getMessage());
        }
    }
}

// Eureka periodically polls /actuator/health
// If service unhealthy, it's marked as DOWN
// If no heartbeat for 90 seconds, instance removed
```

### Service Discovery in Kubernetes

Kubernetes has built-in service discovery via DNS.

```yaml
# Kubernetes Service definition
apiVersion: v1
kind: Service
metadata:
  name: payment-service
  namespace: default
spec:
  selector:
    app: payment-service
  ports:
    - port: 8080
      targetPort: 8080
  type: ClusterIP

---
# Deployment for payment service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
    spec:
      containers:
      - name: payment-service
        image: payment-service:1.0
        ports:
        - containerPort: 8080
```

In Kubernetes, service discovery is automatic:

```java
// Spring Boot application in Kubernetes
@Service
public class OrderServiceK8s {

    @Autowired
    private RestTemplate restTemplate;

    public Order createOrder(CreateOrderRequest request) {
        // In Kubernetes, DNS resolves service name to cluster IP
        // payment-service.default.svc.cluster.local:8080
        Payment payment = restTemplate.postForObject(
            "http://payment-service:8080/api/payments",  // Kubernetes DNS
            new PaymentRequest(request.getOrderId(), request.getTotal()),
            Payment.class
        );

        return new Order(request, payment);
    }
}
```

---

## API Gateway Pattern

Single entry point for all clients. Handles cross-cutting concerns.

### API Gateway Responsibilities

```
                    Clients
                (Web, Mobile, etc)
                       │
                       ▼
        ┌──────────────────────────────────┐
        │      API Gateway                 │
        ├──────────────────────────────────┤
        │ 1. Request Routing               │
        │    - Route /api/orders → Order   │
        │    - Route /api/products → Prod  │
        │                                  │
        │ 2. Authentication/Authorization  │
        │    - Verify JWT token            │
        │    - Check permissions           │
        │    - Rate limiting per user      │
        │                                  │
        │ 3. Request/Response Transformation
        │    - API versioning              │
        │    - Protocol conversion (REST)  │
        │    - Compression                 │
        │                                  │
        │ 4. Load Balancing                │
        │    - Distribute load             │
        │    - Circuit breaker             │
        │                                  │
        │ 5. Monitoring & Logging          │
        │    - Log all requests            │
        │    - Metrics collection          │
        │    - Distributed tracing         │
        └──────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
    Order Svc    Product Svc    Payment Svc
```

### Spring Cloud Gateway Implementation

```java
@Configuration
public class GatewayConfig {

    @Bean
    public RouteLocator customRoutes(RouteLocatorBuilder builder) {
        return builder.routes()
            // Order Service routes
            .route("orders", r -> r
                .path("/api/v1/orders/**")
                .filters(f -> f
                    .circuitBreaker(config -> config
                        .setName("ordersCircuitBreaker")
                        .setFallbackUri("forward:/fallback/orders"))
                    .addRequestHeader("X-Service-Name", "api-gateway")
                    .stripPrefix(2))  // Remove /api/v1
                .uri("lb://order-service"))

            // Product Service routes
            .route("products", r -> r
                .path("/api/v1/products/**")
                .filters(f -> f
                    .circuitBreaker(config -> config
                        .setName("productsCircuitBreaker"))
                    .cache())  // Cache GET requests
                .uri("lb://product-service"))

            .build();
    }
}

// Global filters (apply to all routes)
@Configuration
public class GlobalGatewayConfig {

    @Bean
    public GlobalFilter authenticationFilter() {
        return new GlobalFilter() {
            @Override
            public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
                // Extract JWT token
                String authHeader = exchange.getRequest()
                    .getHeaders()
                    .getFirst("Authorization");

                if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                    return onError(exchange, "Unauthorized", HttpStatus.UNAUTHORIZED);
                }

                String token = authHeader.substring("Bearer ".length());

                // Validate JWT
                try {
                    Claims claims = validateToken(token);

                    // Add user info to request headers
                    exchange.getRequest()
                        .mutate()
                        .header("X-User-Id", claims.getSubject())
                        .header("X-User-Roles", String.join(",", (Collection<String>) claims.get("roles")))
                        .build();
                } catch (JwtException e) {
                    return onError(exchange, "Invalid token", HttpStatus.UNAUTHORIZED);
                }

                return chain.filter(exchange);
            }
        };
    }

    @Bean
    public GlobalFilter rateLimitingFilter() {
        return new GlobalFilter() {
            @Override
            public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
                String userId = exchange.getRequest()
                    .getHeaders()
                    .getFirst("X-User-Id");

                if (isRateLimited(userId)) {
                    return onError(exchange, "Rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
                }

                return chain.filter(exchange);
            }
        };
    }

    @Bean
    public GlobalFilter loggingFilter() {
        return new GlobalFilter() {
            @Override
            public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
                long startTime = System.currentTimeMillis();

                return chain.filter(exchange)
                    .doFinally(signalType -> {
                        long duration = System.currentTimeMillis() - startTime;
                        HttpStatus status = exchange.getResponse().getStatusCode();

                        logger.info("Gateway request: {} {} - {} ms",
                            exchange.getRequest().getMethod(),
                            exchange.getRequest().getPath(),
                            duration);
                    });
            }
        };
    }

    private Mono<Void> onError(ServerWebExchange exchange, String message, HttpStatus status) {
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(status);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);

        String errorJson = String.format("""
            {"error": "%s", "status": %d}
            """, message, status.value());

        return response.writeWith(Mono.just(
            response.bufferFactory().wrap(errorJson.getBytes())
        ));
    }
}

// application.yml
spring:
  cloud:
    gateway:
      routes:
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/v1/orders/**
          filters:
            - StripPrefix=2
            - name: CircuitBreaker
              args:
                name: ordersCircuitBreaker

logging:
  level:
    org.springframework.cloud.gateway: DEBUG
```

### Kong (API Gateway Alternative)

```yaml
# Kong configuration (declarative)
version: '3'
services:
  kong:
    image: kong:latest
    environment:
      KONG_DATABASE: postgres
      KONG_PG_HOST: kong-db
      KONG_PG_USER: kong
      KONG_PG_PASSWORD: kong

  kong-migrations:
    image: kong:latest
    environment:
      KONG_DATABASE: postgres
      KONG_PG_HOST: kong-db
      KONG_PG_USER: kong
      KONG_PG_PASSWORD: kong
    command: kong migrations bootstrap

# Kong admin API to register services
curl -X POST http://localhost:8001/services \
  -d name=order-service \
  -d host=order-service \
  -d port=8080

# Create route
curl -X POST http://localhost:8001/services/order-service/routes \
  -d "paths[]=/api/orders" \
  -d "methods[]=GET,POST,PUT,DELETE"

# Apply rate limiting plugin
curl -X POST http://localhost:8001/services/order-service/plugins \
  -d "name=rate-limiting" \
  -d "config.minute=1000"
```

---

## Backend for Frontend (BFF)

Separate API gateway for each client type (web, mobile, etc).

```
┌────────────────────────────────────────────────────────┐
│           Clients                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │Web Client│  │Mobile App│  │Third-Pty │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
└───────┼──────────────┼──────────────┼───────────────────┘
        │              │              │
        ▼              ▼              ▼
    ┌────────────┐ ┌──────────────┐ ┌──────────┐
    │ Web BFF    │ │ Mobile BFF   │ │ API BFF  │
    │ Gateway    │ │ Gateway      │ │ (public) │
    └──────┬─────┘ └──────┬───────┘ └────┬─────┘
           │              │              │
           └──────────────┼──────────────┘
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
        Order Svc    Product Svc    Payment Svc

Each BFF optimized for its client:
- Web BFF: Full data, server-side rendering support
- Mobile BFF: Minimal data, optimized for bandwidth
- API BFF: Full API, public access control
```

```java
// Web BFF - optimized for browser clients
@RestController
@RequestMapping("/api/web")
public class WebBFFController {

    @Autowired
    private OrderService orderService;

    @Autowired
    private ProductService productService;

    // Single endpoint that aggregates multiple services
    @GetMapping("/orders/{id}")
    public OrderPageDTO getOrderPage(@PathVariable Long id) {
        Order order = orderService.getOrder(id);
        List<Product> products = productService.getProductsByIds(
            order.getItems().stream()
                .map(OrderItem::getProductId)
                .collect(Collectors.toList())
        );

        return new OrderPageDTO(
            order,
            products,
            calculateRecommendations(products)
        );
    }
}

// Mobile BFF - optimized for mobile clients
@RestController
@RequestMapping("/api/mobile")
public class MobileBFFController {

    @Autowired
    private OrderService orderService;

    // Minimal data for mobile
    @GetMapping("/orders/{id}")
    public OrderMobileDTO getOrder(@PathVariable Long id) {
        Order order = orderService.getOrder(id);

        return new OrderMobileDTO(
            order.getId(),
            order.getStatus(),
            order.getTotal()
            // Minimal fields for mobile
        );
    }

    @GetMapping("/orders/{id}/details")
    public OrderDetailsMobileDTO getOrderDetails(@PathVariable Long id) {
        Order order = orderService.getOrder(id);

        return new OrderDetailsMobileDTO(
            order.getId(),
            order.getItems(),
            order.getShippingAddress()
        );
    }
}

// Public API BFF
@RestController
@RequestMapping("/api/public")
public class PublicAPIController {

    @Autowired
    private OrderService orderService;

    // Limited access to specific fields
    @GetMapping("/orders/{id}/status")
    public OrderStatusDTO getOrderStatus(@PathVariable Long id) {
        Order order = orderService.getOrder(id);

        return new OrderStatusDTO(
            order.getId(),
            order.getStatus(),
            order.getLastUpdated()
        );
    }
}
```

---

## Load Balancing

Distributes requests across multiple instances.

### Load Balancing Algorithms

```java
// Round Robin (most common)
// Request 1 → Server A
// Request 2 → Server B
// Request 3 → Server C
// Request 4 → Server A

@Component
public class RoundRobinLoadBalancer {
    private int currentIndex = 0;

    public ServiceInstance selectInstance(List<ServiceInstance> instances) {
        ServiceInstance selected = instances.get(currentIndex % instances.size());
        currentIndex++;
        return selected;
    }
}

// Least Connections
// Server A: 10 connections
// Server B: 3 connections  (selected)
// Server C: 7 connections

@Component
public class LeastConnectionsLoadBalancer {
    private Map<ServiceInstance, Integer> connectionCount = new ConcurrentHashMap<>();

    public ServiceInstance selectInstance(List<ServiceInstance> instances) {
        return instances.stream()
            .min(Comparator.comparing(si -> connectionCount.getOrDefault(si, 0)))
            .orElseThrow();
    }
}

// Weighted Load Balancing
// Server A (power: 3): 3/6 = 50%
// Server B (power: 2): 2/6 = 33%
// Server C (power: 1): 1/6 = 17%

@Component
public class WeightedLoadBalancer {
    private Map<ServiceInstance, Integer> weights = new ConcurrentHashMap<>();

    public ServiceInstance selectInstance(List<ServiceInstance> instances) {
        int total = instances.stream()
            .map(si -> weights.getOrDefault(si, 1))
            .reduce(0, Integer::sum);

        int selected = new Random().nextInt(total);
        int sum = 0;

        for (ServiceInstance instance : instances) {
            sum += weights.getOrDefault(instance, 1);
            if (selected < sum) {
                return instance;
            }
        }

        return instances.get(0);
    }
}

// Consistent Hashing
// For sticky sessions or cache locality
// Same user always routes to same server

@Component
public class ConsistentHashLoadBalancer {
    private TreeMap<Integer, ServiceInstance> ring = new TreeMap<>();

    public ServiceInstance selectInstance(List<ServiceInstance> instances, String key) {
        int hash = key.hashCode();

        SortedMap<Integer, ServiceInstance> tailMap = ring.tailMap(hash);
        if (!tailMap.isEmpty()) {
            return tailMap.get(tailMap.firstKey());
        }
        return ring.get(ring.firstKey());
    }
}
```

### Ribbon (Client-Side Load Balancer)

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-netflix-ribbon</artifactId>
</dependency>
```

```java
@Configuration
public class RibbonConfig {

    @Bean
    @LoadBalanced
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    // Custom load balancer rule
    @Bean
    public IRule ribbonRule() {
        // AvailabilityFilteringRule: skip servers that are down
        // WeightedResponseTimeRule: based on response time
        // RoundRobinRule: simple round robin
        return new WeightedResponseTimeRule();
    }
}

// application.yml
payment-service:
  ribbon:
    listOfServers: localhost:8080,localhost:8081,localhost:8082
    NFLoadBalancerClassName: com.netflix.loadbalancer.WeightedResponseTimeRule
    ServerListRefreshInterval: 1000
    MaxAutoRetries: 1
    MaxAutoRetriesNextServer: 1
    ReadTimeout: 5000
    ConnectTimeout: 3000
```

---

## Service Mesh

Infrastructure layer that handles service-to-service communication.

```
Without Service Mesh:
┌─────────────────┐
│ Order Service   │
├─────────────────┤
│ - Business logic│
│ - Resilience    │ (complicated - retries, timeouts, circuit breaker)
│ - Security      │ (SSL/TLS)
│ - Monitoring    │ (metrics, tracing)
└─────────────────┘

With Service Mesh (Istio):
┌─────────────────────────────────────┐
│ Order Service  │  Service Mesh      │
├────────────────┼───────────────────┤
│ - Business     │ - Resilience      │
│   logic        │ - Security        │
│                │ - Monitoring      │
│                │ - Rate limiting   │
│                │ - Load balancing  │
│                │ - Service routing │
└─────────────────────────────────────┘
```

### Istio Components

```yaml
# VirtualService defines how traffic is routed
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: payment-service
spec:
  hosts:
  - payment-service
  http:
  - match:
    - uri:
        prefix: /api/payments
    route:
    - destination:
        host: payment-service
        port:
          number: 8080
      weight: 80
    - destination:
        host: payment-service-canary
        port:
          number: 8080
      weight: 20

---
# DestinationRule defines load balancing policy
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: payment-service
spec:
  host: payment-service
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 50
        http2MaxRequests: 100
    loadBalancer:
      simple: LEAST_REQUEST
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s

---
# ServiceEntry for external services
apiVersion: networking.istio.io/v1beta1
kind: ServiceEntry
metadata:
  name: external-api
spec:
  hosts:
  - api.example.com
  ports:
  - number: 443
    name: https
    protocol: HTTPS
  location: MESH_EXTERNAL
  resolution: DNS

---
# PeerAuthentication for mutual TLS
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
spec:
  mtls:
    mode: STRICT  # All services must use mTLS
```

### Envoy Proxy Configuration

```yaml
# Envoy automatically deployed as sidecar
apiVersion: v1
kind: Pod
metadata:
  name: order-service-pod
spec:
  containers:
  - name: order-service
    image: order-service:1.0
    ports:
    - containerPort: 8080

  - name: istio-proxy  # Envoy sidecar (injected by Istio)
    image: proxyv2:1.x
    ports:
    - containerPort: 15000  # Admin port
    - containerPort: 15001  # Outbound traffic
    volumeMounts:
    - name: istio-envoy
      mountPath: /etc/istio/proxy
```

**Service Mesh Benefits**:
- Centralized traffic management
- Security (mTLS, authorization)
- Observability (metrics, tracing)
- Resilience (retries, circuit breaker)
- No code changes needed

**Service Mesh Drawbacks**:
- Operational complexity
- Performance overhead (sidecar proxies)
- Learning curve
- Resource overhead (one proxy per pod)

---

## Configuration Management

Managing configuration across multiple environments and services.

### Spring Cloud Config

Centralized configuration repository.

```yaml
# config-server/application.yml
spring:
  application:
    name: config-server
  cloud:
    config:
      server:
        git:
          uri: https://github.com/company/config-repo
          default-label: main
          search-paths: config/{application}

server:
  port: 8888
```

```yaml
# Configuration repository (Git)
configs/
├── application.yml
│   ├── spring.datasource.url: jdbc:mysql://localhost:3306/orders
│   ├── logging.level.root: INFO
│
├── production/
│   └── application.yml
│       ├── spring.datasource.url: jdbc:mysql://prod-db:3306/orders
│       ├── logging.level.root: WARN
│
├── order-service/
│   ├── application.yml
│   └── application-production.yml
```

```java
// Client configuration
@SpringBootApplication
public class OrderServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderServiceApplication.class, args);
    }
}

// bootstrap.yml
spring:
  application:
    name: order-service
  cloud:
    config:
      uri: http://config-server:8888
      profile: production

// Access configuration
@Component
public class PaymentConfig {

    @Value("${payment.timeout:5000}")
    private int paymentTimeout;

    @Value("${payment.max-retries:3}")
    private int maxRetries;

    @RefreshScope  // Refresh configuration without restart
    public void updateConfig() {
        // Called when configuration changes
    }
}

// Listen for configuration changes
@Component
public class ConfigChangeListener {

    @EventListener
    public void onConfigRefresh(RefreshScopeRefreshedEvent event) {
        logger.info("Configuration refreshed");
        // Re-initialize components if needed
    }
}
```

### Consul Key-Value Store

Dynamic configuration with service discovery.

```java
@Configuration
@EnableConsulConfig
public class ConsulConfig {
    // Configuration automatically loaded from Consul
}

// application.yml
spring:
  application:
    name: order-service
  cloud:
    consul:
      host: consul-server
      port: 8500
      config:
        enabled: true
        format: YAML
        prefix: config
        default-context: application
        profile-separator: ','
```

```bash
# Store configuration in Consul
curl -X PUT http://localhost:8500/v1/kv/config/order-service/payment.timeout -d "5000"
curl -X PUT http://localhost:8500/v1/kv/config/order-service/payment.max-retries -d "3"

# Update configuration (services refresh automatically)
curl -X PUT http://localhost:8500/v1/kv/config/order-service/payment.timeout -d "10000"
```

### Kubernetes ConfigMaps and Secrets

```yaml
# ConfigMap for non-sensitive configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-service-config
data:
  application.yml: |
    spring:
      datasource:
        url: jdbc:mysql://mysql-service:3306/orders
        username: orders_user
      jpa:
        hibernate:
          ddl-auto: validate
    payment:
      timeout: 5000
      max-retries: 3

---
# Secret for sensitive data
apiVersion: v1
kind: Secret
metadata:
  name: order-service-secret
type: Opaque
data:
  db-password: cGFzc3dvcmQxMjM=  # base64 encoded
  api-key: YXBpa2V5MzQ1Ng==

---
# Pod using ConfigMap and Secret
apiVersion: v1
kind: Pod
metadata:
  name: order-service-pod
spec:
  containers:
  - name: order-service
    image: order-service:1.0
    volumeMounts:
    - name: config
      mountPath: /etc/config
    - name: secret
      mountPath: /etc/secret
    env:
    - name: DB_PASSWORD
      valueFrom:
        secretKeyRef:
          name: order-service-secret
          key: db-password
  volumes:
  - name: config
    configMap:
      name: order-service-config
  - name: secret
    secret:
      secretName: order-service-secret
```

---

## Deployment Strategies

### Blue-Green Deployment

```
V1.0 (Blue):
Order Service V1.0 (running, receiving traffic)
  ├ 3 instances, all at v1.0

V2.0 (Green - being deployed):
Order Service V2.0 (staged, no traffic)
  ├ 3 instances, all at v2.0
  ├ Running tests, verified

Switch:
Load Balancer switches from Blue (v1.0) to Green (v2.0)
  └─ Instant cutover, all traffic to v2.0
  └─ If issue: switch back to v1.0

Cleanup:
Keep v1.0 running for quick rollback
  └─ After stability confirmed, shut down v1.0
```

```java
// Using Spring Cloud to manage blue-green deployment
@Configuration
public class BlueGreenDeploymentConfig {

    @Bean
    public ServiceVersionResolver serviceVersionResolver() {
        return new ServiceVersionResolver() {
            @Override
            public String resolveVersion(String serviceName) {
                // Read from configuration
                return environment.getProperty("service." + serviceName + ".version");
            }
        };
    }
}
```

### Canary Release

```
Current Version (90% traffic):
Order Service V1.0
  ├ 90 instances at v1.0
  └ Receiving 90% of traffic

Canary Version (10% traffic):
Order Service V2.0
  ├ 10 instances at v2.0
  └ Receiving 10% of traffic (metrics monitored)

If metrics good, gradually increase canary:
  ├ After 1 hour: 80/20 split
  ├ After 2 hours: 50/50 split
  ├ After 4 hours: 0/100 (fully switched)

If metrics bad, rollback:
  ├ Go back to 90/10, investigate
  ├ Fix and re-deploy
```

```yaml
# Istio VirtualService for canary
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: order-service-canary
spec:
  hosts:
  - order-service
  http:
  - match:
    - sourceLabels:
        user: canary-tester  # Route canary testers to v2.0
    route:
    - destination:
        host: order-service
        subset: v2-0
  - route:
    - destination:
        host: order-service
        subset: v1-0
      weight: 90
    - destination:
        host: order-service
        subset: v2-0
      weight: 10
```

### Rolling Update

```
Gradually replace old instances with new instances.

V1.0 (3 instances):
Instance 1: v1.0
Instance 2: v1.0
Instance 3: v1.0

Update Instance 1:
Instance 1: v2.0 (new)
Instance 2: v1.0 (old)
Instance 3: v1.0 (old)
→ 2/3 old instances still handling traffic

Update Instance 2:
Instance 1: v2.0 (new)
Instance 2: v2.0 (new)
Instance 3: v1.0 (old)
→ 1/3 old instances still handling traffic

Update Instance 3:
Instance 1: v2.0 (new)
Instance 2: v2.0 (new)
Instance 3: v2.0 (new)
→ All new version
```

```yaml
# Kubernetes rolling update
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # Can have 4 instances (3+1) during update
      maxUnavailable: 0  # Must always have 3 available
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
      - name: order-service
        image: order-service:2.0  # New version
```

---

## Interview Questions

### Q1: How would you design service discovery for a system with 100+ microservices?

**Answer**:

```
Architecture:
1. Use Kubernetes or dedicated service registry (Consul, Eureka)
2. Automated registration/deregistration
3. Health checks and heartbeat
4. Load balancing at multiple levels

Implementation:
├── Kubernetes Service Registry (DNS-based)
│   ├ service-name.namespace.svc.cluster.local
│   ├ Automatic updates when pods added/removed
│   └ Built-in load balancing via ClusterIP
│
├── API Gateway for external traffic
│   ├ Single entry point
│   ├ Rate limiting, auth at gateway
│   └ Hide service topology from clients
│
├── Service Mesh (Istio) for inter-service communication
│   ├ Resilience (circuit breaker, retries)
│   ├ Security (mTLS)
│   ├ Traffic management (canary, blue-green)
│   └ Observability (tracing, metrics)

Monitoring:
├── Health checks: every service must expose /health
├── Deregistration: services down > 3 heartbeats removed
├── Metrics: Prometheus scrapes service health
└── Alerts: PagerDuty if multiple instances down
```

### Q2: Design an API Gateway for a mobile and web application with different requirements.

**Answer**:

```
Gateway Architecture:

┌────────────────────────────────────┐
│ Clients (Web, Mobile, Third-Party) │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│    Main API Gateway                │
│ (Authentication, Rate Limiting)    │
└────────┬────────────────┬──────────┘
         │                │
         ▼                ▼
┌──────────────────┐ ┌──────────────────┐
│   Web BFF        │ │  Mobile BFF      │
│   Gateway        │ │  Gateway         │
├──────────────────┤ ├──────────────────┤
│ - Full data      │ │ - Minimal data   │
│ - Complex queries│ │ - Optimized      │
│ - Pagination     │ │ - Image paths    │
│ - Recommendations│ │ - No inline pics │
└──────┬───────────┘ └────┬─────────────┘
       │                  │
       └──────────┬───────┘
                  ▼
        ┌─────────────────────┐
        │  Core Services      │
        │ (Order, Product,    │
        │  Payment, Inventory)│
        └─────────────────────┘

Authentication at main gateway:
├── JWT validation
├── Per-user rate limiting
├── Request signing (for mobile)

BFF layer:
├── Web BFF: Full product data, reviews, recommendations
├── Mobile BFF: Lightweight responses, cached images

Response optimization:
├── Web: Full HTML-friendly format
├── Mobile: Minimal JSON, binary encoding
```

### Q3: How would you implement a canary deployment for order service?

**Answer**:

```
Setup:
├── Current: Order Service v1.0 (100% traffic, 30 instances)
├── Canary: Order Service v2.0 (0% traffic, 3 instances)

Phase 1: Deploy v2.0 (10% traffic)
├── Route 10% of traffic to v2.0
├── Monitor error rates, latency
├── If good: proceed, else: rollback

Phase 2: Increase to 25% traffic
├── After 30 min of stability
├── Monitor v2.0 metrics

Phase 3: Increase to 50% traffic
├── After 1 hour of stability
├── Monitor business metrics (order completion rate)

Phase 4: Increase to 100% traffic
├── After 2 hours of stability
├── Decommission v1.0

Metrics to monitor:
├── Error rates (HTTP 5xx)
├── Latency (p50, p95, p99)
├── Order success rate
├── Database performance
├── Payment failures

Automatic rollback if:
├── Error rate > 1%
├── Latency p99 > 5 seconds
├── Database CPU > 80%
```

### Q4: What's the difference between client-side and server-side service discovery?

**Answer**:

```
CLIENT-SIDE DISCOVERY:
┌─────────────────────────┐
│ Client                  │
├─────────────────────────┤
│ 1. Query service registry
│ 2. Select instance
│ 3. Make request
└──────┬──────────────────┘
       │
       ├─ to Instance A
       ├─ to Instance B
       └─ to Instance C

Advantages:
- Direct connection to service
- Load balancing logic in client

Disadvantages:
- Client must know service registry
- Client must implement load balancing
- Client language dependent

Example: Netflix Eureka + Ribbon

SERVER-SIDE DISCOVERY:
┌──────────────┐
│ Client       │
└──────┬───────┘
       │ request to api-gateway
       ▼
┌──────────────────────────┐
│ API Gateway              │
├──────────────────────────┤
│ 1. Query service registry
│ 2. Select instance
│ 3. Forward request
└──────┬────────────────────┘
       │
       ├─ to Instance A
       ├─ to Instance B
       └─ to Instance C

Advantages:
- Client doesn't know about services
- Service discovery details abstracted
- Easier for multiple client languages

Disadvantages:
- Extra network hop (gateway)
- Gateway is single point of failure
- Need dedicated ops for gateway

Example: Kubernetes DNS, Spring Cloud Gateway

Recommendation: Use server-side discovery for simplicity
Easier to change service topology without client updates
```

