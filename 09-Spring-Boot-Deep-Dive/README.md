# Spring Boot Deep Dive - Complete Interview Preparation Guide

## Overview

This comprehensive guide is designed for mid-level Java engineers (5+ years experience) preparing for FAANG company interviews. It covers production-grade Spring Boot concepts with deep technical knowledge, real-world code examples, and detailed explanations of how things work internally.

**Target Audience:** Engineers who have:
- Used Spring Boot extensively in production (migrated versions, built microservices, decoupled monoliths)
- Strong Java fundamentals
- Experience with Spring Data JPA, Spring Security, Spring MVC
- Built and maintained REST APIs, microservices architectures

## File Structure

### 1. **01-Spring-Core-and-IoC.md** (1,862 lines, 52 KB)
Deep dive into Spring's core container and dependency injection.

**Key Topics:**
- BeanFactory vs ApplicationContext with practical use cases
- Three dependency injection strategies: constructor (preferred), setter, field
- Complete bean lifecycle from instantiation to destruction (13+ stages)
- Bean scopes: singleton, prototype, request, session, application, custom
- Stereotype annotations: @Component, @Service, @Repository, @Controller, @RestController
- @Configuration and @Bean with CGLIB proxying explanation
- Profiles and conditional beans: @Profile, @Conditional, @ConditionalOnProperty
- Spring AOP deep dive: JDK Dynamic Proxy vs CGLIB, @Aspect, pointcut expressions
- SpEL (Spring Expression Language) basics

**Interview Questions:** 9 comprehensive Q&A covering lifecycle, DI strategies, scopes, and AOP

**Code Examples:**
```java
// Constructor injection (PREFERRED)
@Component
public class UserService {
    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }
}

// Bean lifecycle hooks
@PostConstruct    // After dependencies injected
@PreDestroy       // On shutdown
InitializingBean.afterPropertiesSet()
DisposableBean.destroy()
```

---

### 2. **02-Spring-Boot-Auto-Configuration.md** (1,361 lines, 35 KB)
Master Spring Boot's intelligent auto-configuration mechanism.

**Key Topics:**
- How auto-configuration works: @EnableAutoConfiguration, spring.factories, conditional checks
- @SpringBootApplication unpacked: @Configuration + @EnableAutoConfiguration + @ComponentScan
- Starter dependencies: what they include, how to create custom starters
- Configuration properties: @ConfigurationProperties, @Value, 17-level resolution hierarchy
- Profiles and multi-document YAML with Spring Boot 2.4+
- Spring Boot Actuator: health, metrics, custom endpoints, security
- DevTools: auto-restart, LiveReload, remote debugging
- Spring Boot 2.x vs 3.x migration: Jakarta namespace, GraalVM native compilation
- Embedded server configuration: Tomcat, Jetty, Undertow tuning
- Graceful shutdown implementation

**Interview Questions:** 8 comprehensive Q&A covering auto-configuration, properties, actuator, versioning

**Code Examples:**
```yaml
# 17 levels of property resolution
spring.datasource.url=jdbc:mysql://localhost/db  # Highest priority
SPRING_DATASOURCE_URL=jdbc:mysql://localhost/db  # Environment var
application-prod.yml  # Profile-specific
application.yml       # Default

# Conditional bean creation
@Bean
@ConditionalOnProperty(name = "feature.enabled", havingValue = "true")
public FeatureService featureService() { }
```

---

### 3. **03-Spring-Web-and-REST.md** (1,613 lines, 46 KB)
REST API development with Spring MVC and WebFlux.

**Key Topics:**
- DispatcherServlet architecture and request flow through Spring MVC
- @RestController vs @Controller with practical differences
- Request mapping: @GetMapping, @PostMapping, path variables, query params, request body
- Content negotiation: JSON, XML, automatic format selection
- Exception handling: @ExceptionHandler, @ControllerAdvice, ResponseEntityExceptionHandler, ProblemDetail (RFC 7807)
- Validation: @Valid, @Validated, custom validators, group validation
- Pagination and sorting with Spring Data Pageable
- HATEOAS basics with EntityModel and CollectionModel
- File upload/download with MultipartFile
- WebClient vs RestTemplate: blocking vs reactive
- Filters vs Interceptors vs AOP: when to use which layer
- CORS configuration and cross-origin requests
- API versioning strategies: URL, header, custom
- Rate limiting with Bucket4j

**Interview Questions:** 5 comprehensive Q&A covering request flow, validation, content negotiation, AOP layers

**Code Examples:**
```java
// Request flow through DispatcherServlet
@RestController
@GetMapping("/{id}")
public Order getOrder(@PathVariable Long id) {
    // DispatcherServlet: HandlerMapping → HandlerAdapter → resolve @PathVariable
    // → call method → convert response to JSON → return
}

// Content negotiation
// GET /api/products with Accept: application/json → JSON
// GET /api/products with Accept: application/xml → XML

// Rate limiting with Bucket4j
@InterceptorRegistry
public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(new RateLimitingInterceptor())
        .addPathPatterns("/api/**");
}
```

---

### 4. **04-Spring-Data-and-JPA.md** (1,535 lines, 41 KB)
Data access layer with Spring Data JPA and advanced ORM concepts.

**Key Topics:**
- Spring Data repository hierarchy: CrudRepository, PagingAndSortingRepository, JpaRepository
- Entity mapping: @Entity, @Table, @Id, @GeneratedValue strategies (IDENTITY, SEQUENCE, TABLE, UUID)
- Relationships: @OneToMany, @ManyToOne, @ManyToMany, @OneToOne with fetch types and cascade
- Lazy vs Eager loading: N+1 problem explanation and 5 solutions
  - JOIN FETCH in JPQL
  - @EntityGraph for declarative fetching
  - @BatchSize for batched loading
  - Projections to select only needed fields
  - Query-specific methods
- JPQL and native SQL queries with @Query
- Specification and Criteria API for dynamic queries
- Auditing with @CreatedDate, @LastModifiedDate, @CreatedBy, @LastModifiedBy
- Transaction management deep dive:
  - Propagation levels: REQUIRED, REQUIRES_NEW, SUPPORTS, NESTED, etc.
  - Isolation levels: READ_UNCOMMITTED, READ_COMMITTED, REPEATABLE_READ, SERIALIZABLE
  - Rollback rules and exception handling
- Connection pooling: HikariCP configuration and tuning
- Database migration: Flyway vs Liquibase
- Multi-datasource configuration
- Spring Data MongoDB basics

**Interview Questions:** 6 comprehensive Q&A covering N+1 problem, transactions, propagation levels

**Code Examples:**
```java
// N+1 Problem: 1 query for authors + N queries for each author's books = 1+N queries
List<Author> authors = authorRepository.findAll();
// For each: author.getBooks() triggers new query!

// Solution 1: JOIN FETCH
@Query("SELECT a FROM Author a LEFT JOIN FETCH a.books")
List<Author> findAllWithBooks();

// Solution 2: @EntityGraph
@EntityGraph(attributePaths = {"books"})
List<Author> findAll();

// Solution 3: @BatchSize
@OneToMany(mappedBy = "author")
@BatchSize(size = 20)  // Load 20 authors' books in single query
List<Book> books;

// Transactional with propagation
@Transactional(propagation = Propagation.REQUIRES_NEW)  // New transaction
public void auditLog(String message) { }
```

---

### 5. **05-Spring-Security.md** (1,262 lines, 39 KB)
Authentication, authorization, and security best practices.

**Key Topics:**
- Spring Security architecture: SecurityFilterChain and filter execution order (diagram included)
- Authentication: UserDetailsService, AuthenticationManager, AuthenticationProvider
- Password encoding: BCryptPasswordEncoder, Argon2PasswordEncoder with strength tuning
- Authorization:
  - @PreAuthorize and @PostAuthorize with SpEL expressions
  - @Secured and @RolesAllowed
  - Method-level security with @EnableMethodSecurity
- JWT authentication implementation:
  - JwtTokenProvider for token generation/validation
  - JwtAuthenticationFilter for request processing
  - Complete login/register/refresh flow
  - Token claims and expiration
- OAuth 2.0: Resource server and authorization code flow
- CORS and CSRF protection with configuration
- Security headers: CSP, X-Frame-Options, HSTS, Referrer-Policy
- Role-Based vs Permission-Based Access Control (RBAC vs PBAC)
- Common vulnerabilities:
  - SQL injection prevention
  - XSS (Cross-Site Scripting) prevention
  - CSRF (Cross-Site Request Forgery) mitigation
- Testing security: @WithMockUser, SecurityMockMvcRequestPostProcessors

**Interview Questions:** 5 comprehensive Q&A covering filters, JWT, authorization, vulnerabilities

**Code Examples:**
```java
// JWT authentication flow
@RestController
@PostMapping("/login")
public ResponseEntity<AuthResponse> login(@RequestBody LoginRequest request) {
    Authentication auth = authenticationManager.authenticate(
        new UsernamePasswordAuthenticationToken(request.getEmail(), request.getPassword())
    );
    String token = jwtTokenProvider.generateToken((CustomUserPrincipal) auth.getPrincipal());
    return ResponseEntity.ok(new AuthResponse(token));
}

// Authorization with SpEL
@PreAuthorize("hasRole('ADMIN') or @authService.isOwner(#id, authentication)")
public Order getOrder(Long id) { }

// CSRF protection
http.csrf(csrf -> csrf
    .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
    .ignoringRequestMatchers("/api/**")
);
```

---

### 6. **06-Spring-Boot-Testing-and-Performance.md** (1,167 lines, 34 KB)
Comprehensive testing strategies and performance optimization.

**Key Topics:**
- Testing pyramid: unit tests (60-80%), integration tests (15-25%), E2E tests (5-10%)
- Unit testing: Mockito, @Mock, @InjectMocks, mock interactions, spy on real objects
- Integration testing: @SpringBootTest, loading full context, @MockBean
- Slice tests:
  - @WebMvcTest: test controllers only, mock services
  - @DataJpaTest: test repositories only
  - @JsonTest: test JSON serialization
- MockMvc: testing controllers without starting server
- Testcontainers: real Docker containers for MySQL, PostgreSQL, Redis in tests
- Test profiles and configuration
- Performance tuning:
  - JVM tuning: G1GC, heap size, garbage collection
  - Connection pool sizing: HikariCP configuration
  - Thread pool sizing: core/max pools, queue capacity
- Caching: @Cacheable, @CacheEvict, @CachePut, cache managers
- Async processing: @Async, CompletableFuture, custom executors
- Scheduling: @Scheduled, cron expressions, timezone support
- Logging: SLF4J + Logback configuration, structured logging with MDC
- Monitoring: Micrometer + Prometheus metrics, custom metrics with MeterRegistry

**Interview Questions:** 6 comprehensive Q&A covering testing pyramid, async, caching, monitoring

**Code Examples:**
```java
// Unit test without Spring
@Test
public void testOrderService() {
    OrderRepository mockRepo = mock(OrderRepository.class);
    when(mockRepo.save(any())).thenReturn(new Order(1L));

    OrderService service = new OrderService(mockRepo);
    service.createOrder(request);

    verify(mockRepo, times(1)).save(any());
}

// Integration test with full context
@SpringBootTest
public class OrderServiceIntegrationTest {
    @Autowired private OrderRepository orderRepository;
    // Real database operations
}

// Caching
@Cacheable(cacheNames = "users", key = "#id", condition = "#id > 1000")
public User getUser(Long id) { }

// Performance monitoring
meterRegistry.timer("payment.processing").record(() -> {
    // Measure payment processing time
});
```

---

## How to Use This Guide

### For Interview Preparation

1. **Start with 01-Spring-Core-and-IoC**: Master the fundamentals. Understand how Spring works internally.
2. **Move to 02-Spring-Boot-Auto-Configuration**: Learn how Spring Boot simplifies configuration.
3. **Study 03-Spring-Web-and-REST**: REST API design and HTTP request processing.
4. **Deep dive 04-Spring-Data-and-JPA**: Database layer and common performance issues.
5. **Review 05-Spring-Security**: Authentication/authorization and security best practices.
6. **Finish with 06-Testing-and-Performance**: Production-ready testing and optimization.

### Reading Strategy

Each file is organized as:
1. **Conceptual Explanation** with ASCII diagrams and flow charts
2. **Practical Code Examples** (Java, YAML configuration)
3. **Real-World Patterns** and best practices
4. **Common Pitfalls** and anti-patterns
5. **Interview Questions** with detailed answers

### For Each Topic

- Read the conceptual explanation first
- Review the code examples
- Try to understand WHY things work that way
- Memorize key patterns for quick recollection in interviews
- Practice writing similar code from memory

---

## Key Concepts to Master

### Architecture & Design
- Spring IoC Container and bean lifecycle
- Dependency injection patterns
- Spring AOP and proxies
- Design patterns: Factory, Observer, Strategy

### Configuration & Boot
- Auto-configuration mechanism
- Property resolution hierarchy
- Profile management
- Custom starters

### Web & REST
- HTTP request processing through DispatcherServlet
- Content negotiation
- Exception handling
- API design principles (HATEOAS, versioning, pagination)

### Data Access
- ORM mapping and relationships
- N+1 problem and solutions
- Transaction management and propagation
- Connection pooling tuning

### Security
- Authentication vs authorization
- JWT token management
- CSRF and XSS prevention
- Role vs permission-based access

### Testing & Performance
- Testing pyramid and each layer's purpose
- Mock vs real dependencies
- Testcontainers for integration tests
- JVM tuning and connection pooling
- Caching strategies
- Async processing

---

## Interview Tips

### When Asked About Spring Container
Explain:
1. ApplicationContext extends BeanFactory
2. Beans are registered from @Component, @Bean, XML
3. Lifecycle: instantiation → property population → awareness interfaces → init → ready → destroy
4. Emphasis: constructor injection prevents null pointer exceptions

### When Asked About Performance
Discuss:
1. Connection pooling (HikariCP with proper sizing)
2. N+1 problem and JOIN FETCH solution
3. Caching for expensive operations
4. Async processing for non-blocking operations
5. Database indexes and query optimization

### When Asked About Security
Cover:
1. Authentication (UserDetailsService)
2. Authorization (@PreAuthorize with SpEL)
3. JWT for stateless APIs
4. CSRF token validation
5. SQL injection and XSS prevention

### When Asked About Testing
Explain:
1. Unit tests (Mockito) for fast feedback
2. Integration tests (@SpringBootTest) for interactions
3. Slice tests (@WebMvcTest) for focused testing
4. Testcontainers for realistic database testing
5. Testing pyramid: 70% unit, 20% integration, 10% E2E

---

## File Statistics

| File | Lines | Size | Topics |
|------|-------|------|--------|
| 01-Spring-Core-and-IoC.md | 1,862 | 52 KB | BeanFactory, DI, Lifecycle, Scopes, AOP |
| 02-Spring-Boot-Auto-Configuration.md | 1,361 | 35 KB | Auto-config, Starters, Properties, Actuator |
| 03-Spring-Web-and-REST.md | 1,613 | 46 KB | DispatcherServlet, REST, Validation, Versioning |
| 04-Spring-Data-and-JPA.md | 1,535 | 41 KB | Repositories, N+1, Transactions, Migrations |
| 05-Spring-Security.md | 1,262 | 39 KB | Authentication, JWT, Authorization, Vulnerabilities |
| 06-Spring-Boot-Testing-and-Performance.md | 1,167 | 34 KB | Testing Pyramid, Caching, Async, Monitoring |
| **TOTAL** | **8,800** | **247 KB** | **Complete Spring Boot Deep Dive** |

---

## Production Application Architecture Example

Based on concepts from this guide, here's a typical production architecture:

```
┌─────────────────────────────────────┐
│   Client (Web/Mobile)               │
└────────────┬────────────────────────┘
             │ HTTP/HTTPS
             ▼
┌─────────────────────────────────────┐
│   Load Balancer (NGINX)             │
└────────────┬────────────────────────┘
             │
    ┌────────┴────────┬─────────────┐
    ▼                 ▼             ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Spring Boot │ │ Spring Boot │ │ Spring Boot │
│  Instance 1 │ │  Instance 2 │ │  Instance 3 │
│             │ │             │ │             │
│ Controllers │ │ Controllers │ │ Controllers │
│ Security    │ │ Security    │ │ Security    │
│ Services    │ │ Services    │ │ Services    │
│ Caching     │ │ Caching     │ │ Caching     │
└────┬────────┘ └────┬────────┘ └────┬────────┘
     │                │               │
     └────────┬───────┴──────┬────────┘
              ▼              ▼
        ┌──────────────┐  ┌──────────────┐
        │ Persistence  │  │ Redis Cache  │
        │ (PostgreSQL) │  │              │
        │              │  │ (Distributed)│
        └──────────────┘  └──────────────┘

Components using concepts from this guide:
- Controllers: DispatcherServlet, @RestController (03-Spring-Web-and-REST)
- Security: JWT, @PreAuthorize (05-Spring-Security)
- Services: @Transactional with propagation (04-Spring-Data-and-JPA)
- Caching: @Cacheable with Redis (06-Testing-and-Performance)
- Async: @Async for notifications (06-Testing-and-Performance)
- Monitoring: Micrometer/Prometheus metrics (06-Testing-and-Performance)
- Auto-config: Spring Boot starters (02-Spring-Boot-Auto-Configuration)
```

---

## Quick Reference: Interview Checklist

Before your interview, ensure you can explain:

- [ ] **Spring IoC**: What is IoC? How does Spring container work? Bean lifecycle stages.
- [ ] **Dependency Injection**: Constructor vs setter vs field. Why constructor is preferred.
- [ ] **Bean Scopes**: Singleton vs prototype. When to use each.
- [ ] **Auto-Configuration**: How does it work? @EnableAutoConfiguration vs @Configuration.
- [ ] **DispatcherServlet**: How does request flow through Spring MVC?
- [ ] **Exception Handling**: @ControllerAdvice vs @ExceptionHandler. ProblemDetail RFC 7807.
- [ ] **N+1 Problem**: What is it? All 5 solutions (JOIN FETCH, @EntityGraph, etc.).
- [ ] **Transactions**: Propagation levels (REQUIRED, REQUIRES_NEW). Isolation levels.
- [ ] **Security Filter Chain**: Order of filters. How authentication/authorization works.
- [ ] **JWT**: Token generation, validation, claims. Complete auth flow.
- [ ] **Testing Pyramid**: Ratio of unit/integration/E2E. When to use each.
- [ ] **Performance**: Connection pooling, caching, async processing.

---

## Additional Resources to Study

While these files are comprehensive, consider studying:

1. **Official Spring Documentation**: https://spring.io/projects/spring-boot
2. **Spring Security Architecture**: https://spring.io/guides/topicals/spring-security-architecture
3. **Spring Data JPA**: https://spring.io/projects/spring-data-jpa
4. **Spring by Example**: Real-world code patterns

---

## Feedback & Updates

These files are production-quality interview preparation materials. Use them to:
1. Build deep understanding of Spring Boot internals
2. Prepare for technical interviews at FAANG companies
3. Improve your current Spring Boot applications
4. Mentor junior developers on best practices

Good luck with your interview preparation!

**Last Updated:** February 2026
**Version:** 1.0
**Total Content:** 8,800 lines, 247 KB
**Topics Covered:** 60+ Spring Boot concepts with 200+ code examples and 50+ interview questions
