# Spring Security - Deep Dive

## Table of Contents
1. [Spring Security Architecture](#spring-security-architecture)
2. [Authentication](#authentication)
3. [Password Encoding](#password-encoding)
4. [Authorization](#authorization)
5. [JWT Implementation](#jwt-implementation)
6. [OAuth 2.0](#oauth-20)
7. [CORS and CSRF](#cors-and-csrf)
8. [Security Headers](#security-headers)
9. [Role vs Permission-Based Access](#role-vs-permission-based-access)
10. [Common Vulnerabilities](#common-vulnerabilities)
11. [Testing Security](#testing-security)
12. [Interview Questions](#interview-questions)

---

## Spring Security Architecture

### SecurityFilterChain and Filter Order

```
┌─────────────────────────────────────────────┐
│         HTTP Request                        │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│   DelegatingFilterProxy                     │
│   (Bridge between servlet and Spring)       │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│   FilterChainProxy                          │
│   (Orchestrates SecurityFilterChain)        │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│   SecurityFilter 1: SecurityContextPersistenceFilter
│   (Load/save SecurityContext from session)  │
├─────────────────────────────────────────────┤
│   SecurityFilter 2: HeaderWriterFilter      │
│   (Add security headers)                    │
├─────────────────────────────────────────────┤
│   SecurityFilter 3: CsrfFilter              │
│   (CSRF protection)                         │
├─────────────────────────────────────────────┤
│   SecurityFilter 4: LogoutFilter            │
│   (Handle logout requests)                  │
├─────────────────────────────────────────────┤
│   SecurityFilter 5: UsernamePasswordAuthenticationFilter
│   (Form login authentication)               │
├─────────────────────────────────────────────┤
│   SecurityFilter 6: BasicAuthenticationFilter
│   (HTTP Basic authentication)               │
├─────────────────────────────────────────────┤
│   SecurityFilter 7: ExceptionTranslationFilter
│   (Handle AuthenticationException)          │
├─────────────────────────────────────────────┤
│   SecurityFilter 8: FilterSecurityInterceptor
│   (Authorization - @PreAuthorize, etc.)    │
└─────────────────────────────────────────────┘
               │
               ▼
        DispatcherServlet
```

### SecurityFilterChain Configuration

```java
@Configuration
@EnableWebSecurity
public class SecurityConfiguration {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // CSRF protection
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .ignoringRequestMatchers("/api/**")
            )

            // Authorization
            .authorizeHttpRequests(authz -> authz
                .requestMatchers("/public/**").permitAll()
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/**").authenticated()
                .anyRequest().authenticated()
            )

            // Authentication
            .formLogin(form -> form
                .loginPage("/login")
                .loginProcessingUrl("/login")
                .defaultSuccessUrl("/dashboard", true)
                .permitAll()
            )

            // HTTP Basic for API
            .httpBasic(Customizer.withDefaults())

            // Session management
            .sessionManagement(session -> session
                .sessionFixationProtection(SessionFixationProtectionStrategy.MIGRATE_SESSION)
                .sessionConcurrency(concurrency -> concurrency
                    .maximumSessions(1)
                    .expiredUrl("/login?expired")
                )
            )

            // Headers
            .headers(headers -> headers
                .contentSecurityPolicy(csp -> csp
                    .policyDirectives("default-src 'self'")
                )
                .frameOptions(frameOptions -> frameOptions.sameOrigin())
            )

            // Logout
            .logout(logout -> logout
                .logoutUrl("/logout")
                .logoutSuccessUrl("/login?logout")
                .invalidateHttpSession(true)
                .clearAuthentication(true)
                .deleteCookies("JSESSIONID")
            );

        return http.build();
    }
}
```

---

## Authentication

### UserDetailsService

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {
    private final UserRepository userRepository;

    public CustomUserDetailsService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user = userRepository.findByEmail(username)
            .orElseThrow(() -> new UsernameNotFoundException("User not found: " + username));

        return new CustomUserPrincipal(user);
    }
}

public class CustomUserPrincipal implements UserDetails {
    private final User user;

    public CustomUserPrincipal(User user) {
        this.user = user;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return user.getRoles().stream()
            .map(role -> new SimpleGrantedAuthority("ROLE_" + role.getName()))
            .collect(Collectors.toList());
    }

    @Override
    public String getPassword() {
        return user.getPassword();
    }

    @Override
    public String getUsername() {
        return user.getEmail();
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return !user.isLocked();
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return user.isEnabled();
    }

    public User getUser() {
        return user;
    }
}
```

### AuthenticationManager

```java
@Configuration
public class AuthenticationConfiguration {

    @Bean
    public AuthenticationManager authenticationManager(
        UserDetailsService userDetailsService,
        PasswordEncoder passwordEncoder) {

        DaoAuthenticationProvider authProvider = new DaoAuthenticationProvider();
        authProvider.setUserDetailsService(userDetailsService);
        authProvider.setPasswordEncoder(passwordEncoder);

        return new ProviderManager(authProvider);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);  // strength = 12
    }
}

// Usage: programmatic authentication
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthenticationManager authenticationManager;

    public AuthController(AuthenticationManager authenticationManager) {
        this.authenticationManager = authenticationManager;
    }

    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@RequestBody LoginRequest request) {
        try {
            // Create authentication token with credentials
            UsernamePasswordAuthenticationToken token =
                new UsernamePasswordAuthenticationToken(
                    request.getEmail(),
                    request.getPassword()
                );

            // Authenticate using manager
            Authentication authenticated = authenticationManager.authenticate(token);

            // Store in SecurityContext
            SecurityContextHolder.getContext().setAuthentication(authenticated);

            return ResponseEntity.ok(new LoginResponse("Login successful"));

        } catch (BadCredentialsException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(new LoginResponse("Invalid credentials"));
        }
    }
}
```

---

## Password Encoding

### BCryptPasswordEncoder

```java
@Configuration
public class PasswordEncoderConfiguration {

    @Bean
    public PasswordEncoder passwordEncoder() {
        // Strength between 4 and 31 (default 10)
        // Higher = more secure but slower
        return new BCryptPasswordEncoder(12);
    }
}

@Service
public class UserService {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public void registerUser(String email, String plainPassword) {
        // Encode password
        String encodedPassword = passwordEncoder.encode(plainPassword);

        User user = new User();
        user.setEmail(email);
        user.setPassword(encodedPassword);  // Store encoded password
        userRepository.save(user);
    }

    public boolean verifyPassword(String plainPassword, String encodedPassword) {
        // Check if plain password matches encoded password
        return passwordEncoder.matches(plainPassword, encodedPassword);
    }
}
```

### Argon2PasswordEncoder

```xml
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-crypto</artifactId>
</dependency>
```

```java
@Configuration
public class PasswordEncoderConfiguration {

    @Bean
    public PasswordEncoder passwordEncoder() {
        // Argon2: More secure than BCrypt, resistant to GPU attacks
        return new Argon2PasswordEncoder(
            16,      // salt length
            32,      // hash length
            1,       // parallelism
            60000,   // memory in KB
            2        // iterations
        );
    }
}
```

---

## Authorization

### @PreAuthorize and @PostAuthorize

```java
@Configuration
@EnableMethodSecurity(
    prePostEnabled = true,  // Enable @PreAuthorize/@PostAuthorize
    securedEnabled = true,  // Enable @Secured
    jsr250Enabled = true    // Enable @RolesAllowed
)
public class MethodSecurityConfiguration {
}

@Service
public class OrderService {
    private final OrderRepository orderRepository;

    public OrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    // Check role before method execution
    @PreAuthorize("hasRole('ADMIN')")
    public void deleteOrder(Long orderId) {
        orderRepository.deleteById(orderId);
    }

    // Check permission using custom expression
    @PreAuthorize("hasAuthority('ORDER_DELETE')")
    public void cancelOrder(Long orderId) {
        Order order = orderRepository.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException());
        order.setStatus(OrderStatus.CANCELLED);
        orderRepository.save(order);
    }

    // Check if user owns the order (using authentication principal)
    @PreAuthorize("@authorizationService.isOrderOwner(#orderId, authentication)")
    public Order getOrder(@PathVariable Long orderId) {
        return orderRepository.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException());
    }

    // Check return value before returning
    @PostAuthorize("returnObject.userId == authentication.principal.userId")
    public Order getOrderForCurrentUser(Long orderId) {
        return orderRepository.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException());
    }

    // Complex expression
    @PreAuthorize("""
        hasRole('ADMIN') or
        (hasRole('USER') and @authorizationService.isOrderOwner(#orderId, authentication))
        """)
    public void updateOrder(Long orderId, OrderRequest request) {
        Order order = orderRepository.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException());
        order.setTotal(request.getTotal());
        orderRepository.save(order);
    }
}

@Component
public class AuthorizationService {
    private final OrderRepository orderRepository;

    public AuthorizationService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    public boolean isOrderOwner(Long orderId, Authentication authentication) {
        Order order = orderRepository.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException());

        CustomUserPrincipal principal = (CustomUserPrincipal) authentication.getPrincipal();
        return order.getUserId().equals(principal.getUser().getId());
    }
}
```

### @Secured and @RolesAllowed

```java
@Service
public class AdminService {

    @Secured("ROLE_ADMIN")  // SpEL not supported
    public void deleteUser(Long userId) {
        // Only ADMIN role can call
    }

    @Secured({"ROLE_ADMIN", "ROLE_SUPER_ADMIN"})  // Multiple roles
    public void viewAuditLogs() {
        // ADMIN or SUPER_ADMIN can call
    }

    @RolesAllowed("ROLE_ADMIN")  // JSR-250 annotation
    public void disableUser(Long userId) {
        // Only ADMIN role can call
    }
}
```

---

## JWT Implementation

### JWT Token Generation and Validation

```xml
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-api</artifactId>
    <version>0.12.5</version>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-impl</artifactId>
    <version>0.12.5</version>
    <scope>runtime</scope>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-jackson</artifactId>
    <version>0.12.5</version>
    <scope>runtime</scope>
</dependency>
```

```java
@Component
public class JwtTokenProvider {
    private static final Logger logger = LoggerFactory.getLogger(JwtTokenProvider.class);

    @Value("${app.jwt.secret:your-secret-key-min-256-bits-long}")
    private String jwtSecret;

    @Value("${app.jwt.expiration:3600000}")  // 1 hour in milliseconds
    private long jwtExpirationMs;

    public String generateToken(CustomUserPrincipal principal) {
        Instant now = Instant.now();
        Instant expiresAt = now.plusMillis(jwtExpirationMs);

        return Jwts.builder()
            .subject(principal.getUsername())
            .issuedAt(Date.from(now))
            .expiration(Date.from(expiresAt))
            .claim("userId", principal.getUser().getId())
            .claim("email", principal.getUser().getEmail())
            .claim("roles", principal.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.toList()))
            .signWith(getSigningKey(), SignatureAlgorithm.HS512)
            .compact();
    }

    public String extractUsername(String token) {
        try {
            return getAllClaims(token).getSubject();
        } catch (ExpiredJwtException | UnsupportedJwtException | MalformedJwtException | IllegalArgumentException e) {
            logger.error("Error extracting username from token", e);
            return null;
        }
    }

    public Long extractUserId(String token) {
        try {
            return getAllClaims(token).get("userId", Long.class);
        } catch (ExpiredJwtException | UnsupportedJwtException | MalformedJwtException e) {
            logger.error("Error extracting userId from token", e);
            return null;
        }
    }

    public boolean validateToken(String token) {
        try {
            Jwts.parserBuilder()
                .setSigningKey(getSigningKey())
                .build()
                .parseClaimsJws(token);
            return true;
        } catch (ExpiredJwtException e) {
            logger.error("Expired JWT token", e);
        } catch (UnsupportedJwtException e) {
            logger.error("Unsupported JWT token", e);
        } catch (MalformedJwtException e) {
            logger.error("Invalid JWT token", e);
        } catch (IllegalArgumentException e) {
            logger.error("JWT claims string is empty", e);
        }
        return false;
    }

    private Claims getAllClaims(String token) {
        return Jwts.parserBuilder()
            .setSigningKey(getSigningKey())
            .build()
            .parseClaimsJws(token)
            .getBody();
    }

    private Key getSigningKey() {
        byte[] keyBytes = Decoders.BASE64.decode(jwtSecret);
        return Keys.hmacShaKeyFor(keyBytes);
    }
}
```

### JWT Filter

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private static final Logger logger = LoggerFactory.getLogger(JwtAuthenticationFilter.class);
    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtTokenProvider jwtTokenProvider;
    private final UserDetailsService userDetailsService;

    public JwtAuthenticationFilter(JwtTokenProvider jwtTokenProvider,
                                  UserDetailsService userDetailsService) {
        this.jwtTokenProvider = jwtTokenProvider;
        this.userDetailsService = userDetailsService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                   HttpServletResponse response,
                                   FilterChain filterChain) throws ServletException, IOException {

        try {
            // Extract JWT from Authorization header
            String token = extractTokenFromRequest(request);

            if (token != null && jwtTokenProvider.validateToken(token)) {
                // Extract username and load user details
                String username = jwtTokenProvider.extractUsername(token);
                UserDetails userDetails = userDetailsService.loadUserByUsername(username);

                // Create authentication token
                UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                        userDetails,
                        null,
                        userDetails.getAuthorities()
                    );

                // Set authentication in SecurityContext
                SecurityContextHolder.getContext().setAuthentication(authentication);

                logger.debug("User authenticated: {}", username);
            }

        } catch (Exception e) {
            logger.error("Could not set user authentication", e);
        }

        // Continue filter chain
        filterChain.doFilter(request, response);
    }

    private String extractTokenFromRequest(HttpServletRequest request) {
        String authHeader = request.getHeader("Authorization");

        if (authHeader != null && authHeader.startsWith(BEARER_PREFIX)) {
            return authHeader.substring(BEARER_PREFIX.length());
        }

        return null;
    }
}
```

### JWT Configuration

```java
@Configuration
@EnableWebSecurity
public class JwtSecurityConfiguration {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    public JwtSecurityConfiguration(JwtAuthenticationFilter jwtAuthenticationFilter) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())  // Disable CSRF for API
            .authorizeHttpRequests(authz -> authz
                .requestMatchers("/api/auth/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/**").authenticated()
                .anyRequest().authenticated()
            )
            .httpBasic(basic -> basic.disable())  // Disable HTTP Basic
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)  // No session
            )
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    public AuthenticationManager authenticationManager(
        UserDetailsService userDetailsService,
        PasswordEncoder passwordEncoder) {

        DaoAuthenticationProvider authProvider = new DaoAuthenticationProvider();
        authProvider.setUserDetailsService(userDetailsService);
        authProvider.setPasswordEncoder(passwordEncoder);

        return new ProviderManager(authProvider);
    }
}
```

### JWT Login Controller

```java
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthenticationManager authenticationManager;
    private final JwtTokenProvider jwtTokenProvider;
    private final UserRepository userRepository;

    public AuthController(AuthenticationManager authenticationManager,
                        JwtTokenProvider jwtTokenProvider,
                        UserRepository userRepository) {
        this.authenticationManager = authenticationManager;
        this.jwtTokenProvider = jwtTokenProvider;
        this.userRepository = userRepository;
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@RequestBody LoginRequest request) {
        try {
            // Authenticate user
            Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(
                    request.getEmail(),
                    request.getPassword()
                )
            );

            // Get authenticated user
            CustomUserPrincipal principal = (CustomUserPrincipal) authentication.getPrincipal();

            // Generate JWT token
            String jwtToken = jwtTokenProvider.generateToken(principal);

            return ResponseEntity.ok(new AuthResponse(jwtToken));

        } catch (BadCredentialsException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(new AuthResponse("Invalid email or password"));
        }
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@RequestBody RegisterRequest request) {
        if (userRepository.existsByEmail(request.getEmail())) {
            return ResponseEntity.badRequest()
                .body(new AuthResponse("Email already registered"));
        }

        User user = new User();
        user.setEmail(request.getEmail());
        user.setPassword(new BCryptPasswordEncoder(12).encode(request.getPassword()));
        user.setFirstName(request.getFirstName());
        user.setLastName(request.getLastName());
        user.setEnabled(true);
        user.setLocked(false);

        User savedUser = userRepository.save(user);

        // Auto-login after registration
        CustomUserPrincipal principal = new CustomUserPrincipal(savedUser);
        String jwtToken = jwtTokenProvider.generateToken(principal);

        return ResponseEntity.status(HttpStatus.CREATED)
            .body(new AuthResponse(jwtToken));
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(HttpServletRequest request) {
        String token = extractTokenFromRequest(request);

        if (token == null || !jwtTokenProvider.validateToken(token)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        String username = jwtTokenProvider.extractUsername(token);
        UserDetails userDetails = loadUserByUsername(username);

        String newToken = jwtTokenProvider.generateToken((CustomUserPrincipal) userDetails);

        return ResponseEntity.ok(new AuthResponse(newToken));
    }

    private String extractTokenFromRequest(HttpServletRequest request) {
        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }
        return null;
    }
}
```

---

## OAuth 2.0

### OAuth 2.0 Resource Server

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-oauth2-resource-server</artifactId>
</dependency>
```

```yaml
# application.yml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://auth.example.com
          jwk-set-uri: https://auth.example.com/.well-known/jwks.json
```

```java
@Configuration
@EnableWebSecurity
public class OAuth2ResourceServerConfiguration {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(authz -> authz
                .requestMatchers("/public/**").permitAll()
                .requestMatchers("/api/**").authenticated()
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            );

        return http.build();
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authoritiesConverter = new JwtGrantedAuthoritiesConverter();
        authoritiesConverter.setAuthoritiesClaimName("roles");
        authoritiesConverter.setAuthorityPrefix("ROLE_");

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authoritiesConverter);

        return converter;
    }
}
```

### OAuth 2.0 Authorization Server Client

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-oauth2-client</artifactId>
</dependency>
```

```yaml
# application.yml
spring:
  security:
    oauth2:
      client:
        registration:
          google:
            client-id: your-client-id
            client-secret: your-client-secret
            scope: openid,profile,email
          github:
            client-id: your-client-id
            client-secret: your-client-secret
            scope: read:user
        provider:
          google:
            issuer-uri: https://accounts.google.com
          github:
            issuer-uri: https://github.com
```

---

## CORS and CSRF

### CORS Configuration

```java
@Configuration
public class CorsConfiguration {

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**")
                    .allowedOrigins("https://example.com")
                    .allowedMethods("GET", "POST", "PUT", "DELETE")
                    .allowedHeaders("*")
                    .allowCredentials(true)
                    .maxAge(3600);
            }
        };
    }
}

// OR via SecurityFilterChain
@Configuration
@EnableWebSecurity
public class SecurityConfiguration {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(csrf -> csrf.disable());

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(List.of("https://example.com"));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        return source;
    }
}
```

### CSRF Protection

```java
@Configuration
@EnableWebSecurity
public class SecurityConfiguration {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .ignoringRequestMatchers("/api/**", "/h2-console/**")
            );

        return http.build();
    }
}

// Client-side: Include CSRF token in POST/PUT/DELETE requests
@RestController
public class FormController {
    @GetMapping("/form")
    public String getForm(Model model, CsrfToken csrfToken) {
        model.addAttribute("_csrf", csrfToken);
        return "form";
    }
}
```

---

## Security Headers

```java
@Configuration
@EnableWebSecurity
public class SecurityConfiguration {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .headers(headers -> headers
                // Content Security Policy
                .contentSecurityPolicy(csp -> csp
                    .policyDirectives("default-src 'self'; script-src 'self' 'unsafe-inline'")
                )
                // X-Frame-Options
                .frameOptions(frameOptions -> frameOptions.sameOrigin())
                // X-Content-Type-Options
                .xssProtection(xss -> xss.headerValue(XXssProtectionHeaderWriter.HeaderValue.ENABLED))
                // Strict-Transport-Security
                .httpStrictTransportSecurity(hsts -> hsts
                    .includeSubDomains(true)
                    .maxAgeInSeconds(31536000)
                )
                // Referrer-Policy
                .referrerPolicy(referrer -> referrer
                    .policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN)
                )
            );

        return http.build();
    }
}
```

---

## Role vs Permission-Based Access

### Role-Based Access Control (RBAC)

```java
// User has roles: ADMIN, USER
// Check if user has role

@PreAuthorize("hasRole('ADMIN')")
public void deleteUser(Long userId) { }

// Problem: Brittle, can't change permissions without code change
```

### Permission-Based Access Control (PBAC)

```java
// User has permissions: USER_DELETE, USER_CREATE, ORDER_VIEW
// More granular and flexible

@PreAuthorize("hasAuthority('USER_DELETE')")
public void deleteUser(Long userId) { }

@PreAuthorize("hasAuthority('ORDER_VIEW')")
public void viewOrder(Long orderId) { }

// User granted permissions dynamically from database
// Can change permissions without code change
```

### Implementation

```java
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String email;

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(
        name = "user_permission",
        joinColumns = @JoinColumn(name = "user_id"),
        inverseJoinColumns = @JoinColumn(name = "permission_id")
    )
    private Set<Permission> permissions = new HashSet<>();
}

@Entity
public class Permission {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;  // e.g., "USER_DELETE", "ORDER_CREATE"

    private String description;
}

@Service
public class CustomUserDetailsService implements UserDetailsService {
    private final UserRepository userRepository;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user = userRepository.findByEmail(username)
            .orElseThrow(() -> new UsernameNotFoundException("User not found"));

        // Convert permissions to authorities
        List<GrantedAuthority> authorities = user.getPermissions().stream()
            .map(permission -> new SimpleGrantedAuthority(permission.getName()))
            .collect(Collectors.toList());

        return new org.springframework.security.core.userdetails.User(
            user.getEmail(),
            user.getPassword(),
            authorities
        );
    }
}

// Usage
@PreAuthorize("hasAuthority('USER_DELETE')")  // Check specific permission
public void deleteUser(Long userId) { }
```

---

## Common Vulnerabilities

### SQL Injection Prevention

```java
// VULNERABLE: String concatenation
String sql = "SELECT * FROM users WHERE email = '" + email + "'";

// SAFE: Parameterized queries (Spring Data does this automatically)
@Query("SELECT u FROM User u WHERE u.email = :email")
Optional<User> findByEmail(@Param("email") String email);

// Spring uses parameterized queries automatically
// Never concatenate user input into SQL
```

### Cross-Site Scripting (XSS) Prevention

```java
// Server-side: Always encode output
// Spring templates (Thymeleaf) encode by default
<h1 th:text="${user.name}"></h1>  <!-- Safe -->
<h1 th:utext="${user.name}"></h1> <!-- Dangerous, unescaped -->

// JavaScript: Use textContent instead of innerHTML
document.getElementById("name").textContent = userData.name;  // Safe
document.getElementById("name").innerHTML = userData.name;    // Dangerous

// Content-Security-Policy header prevents inline scripts
.contentSecurityPolicy(csp -> csp
    .policyDirectives("default-src 'self'; script-src 'self'")
)
```

### CSRF Prevention

```java
// Spring Security handles CSRF automatically
// Requires CSRF token in POST/PUT/DELETE requests

@Configuration
@EnableWebSecurity
public class SecurityConfiguration {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()));
        return http.build();
    }
}

// Client includes token in forms
<form method="POST">
    <input type="hidden" name="_csrf" value="${_csrf.token}">
    <!-- Form fields -->
</form>
```

---

## Testing Security

### @WithMockUser

```java
@SpringBootTest
public class OrderControllerSecurityTest {
    @Autowired
    private MockMvc mockMvc;

    // Unauthenticated request
    @Test
    public void testGetOrderUnauthenticated() throws Exception {
        mockMvc.perform(get("/api/orders/1"))
            .andExpect(status().isUnauthorized());
    }

    // Authenticated as user
    @Test
    @WithMockUser(username = "user@example.com", roles = "USER")
    public void testGetOrderAuthenticated() throws Exception {
        mockMvc.perform(get("/api/orders/1"))
            .andExpect(status().isOk());
    }

    // Authenticated as admin
    @Test
    @WithMockUser(roles = "ADMIN")
    public void testDeleteOrderAsAdmin() throws Exception {
        mockMvc.perform(delete("/api/orders/1"))
            .andExpect(status().isNoContent());
    }

    // User without permission
    @Test
    @WithMockUser(roles = "USER")
    public void testDeleteOrderAsUser() throws Exception {
        mockMvc.perform(delete("/api/orders/1"))
            .andExpect(status().isForbidden());
    }
}
```

### Using SecurityMockMvcRequestPostProcessors

```java
@SpringBootTest
public class AuthControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @Test
    public void testLoginWithValidCredentials() throws Exception {
        mockMvc.perform(
            post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"user@example.com\",\"password\":\"password\"}")
        )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.token").exists());
    }

    @Test
    public void testCsrfProtection() throws Exception {
        mockMvc.perform(
            post("/api/data")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}")
        )
            .andExpect(status().isForbidden());  // CSRF token missing
    }

    @Test
    public void testWithCsrfToken() throws Exception {
        mockMvc.perform(
            post("/api/data")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}")
                .with(csrf())  // SecurityMockMvcRequestPostProcessors.csrf()
        )
            .andExpect(status().isOk());
    }
}
```

---

## Interview Questions

### Q1: Explain the Spring Security filter chain.

**Answer:**
Spring Security uses a FilterChainProxy that orchestrates multiple security filters. Key filters include:
1. SecurityContextPersistenceFilter: Loads/saves SecurityContext
2. UsernamePasswordAuthenticationFilter: Handles form login
3. BasicAuthenticationFilter: Handles HTTP Basic auth
4. ExceptionTranslationFilter: Handles authentication exceptions
5. FilterSecurityInterceptor: Performs authorization checks

Filters execute in order, allowing request to pass through if all succeed.

### Q2: What's the difference between authentication and authorization?

**Answer:**
- **Authentication**: Verifying who you are (login with credentials)
- **Authorization**: Verifying what you're allowed to do (access control)

Spring Security handles both via UserDetailsService (authentication) and @PreAuthorize/@PostAuthorize (authorization).

### Q3: How do you implement JWT authentication in Spring?

**Answer:**
1. Create JwtTokenProvider to generate/validate JWT tokens
2. Create JwtAuthenticationFilter to extract token from request and set SecurityContext
3. Register filter in SecurityFilterChain before UsernamePasswordAuthenticationFilter
4. Disable session management (SessionCreationPolicy.STATELESS)
5. Provide login endpoint that returns JWT token

Token contains user info and roles, verified on each request.

### Q4: Explain @PreAuthorize vs @Secured.

**Answer:**
- **@PreAuthorize**: Supports Spring EL expressions, more powerful
- **@Secured**: Simple role checking, no EL support

@PreAuthorize is preferred because it's more flexible and can use custom expressions like @PreAuthorize("@authService.canAccess(#id)").

### Q5: How does Spring prevent CSRF attacks?

**Answer:**
Spring uses synchronizer token pattern: generates unique CSRF token per request, includes in hidden form field, validates on POST/PUT/DELETE. Token stored in session/cookie, random per request, invalidates if doesn't match. Automatically handled by CsrfFilter if enabled in SecurityFilterChain.

