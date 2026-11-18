# Hands-On Runnable Labs

Practice the core backend interview concepts locally with real infrastructure (**PostgreSQL 16**, **Redis 7**, **Kafka 3.8 KRaft**, **MongoDB 7**) and a runnable **Java 21 + Spring Boot 3.4 + JUnit 5** lab suite.

---

## 1. Start the Infrastructure Stack

```bash
cd labs
docker compose up -d
docker compose ps
```

| Service | Container | Port | Credentials / Notes |
| :--- | :--- | :---: | :--- |
| **PostgreSQL 16** | `prep-postgres` | `5432` | `prep` / `prep`, DB `interview_prep` (50k seeded orders) |
| **Redis 7** | `prep-redis` | `6379` | AOF enabled (`--appendonly yes`) |
| **Apache Kafka 3.8** | `prep-kafka` | `9092` | Single-node KRaft (no ZooKeeper) |
| **MongoDB 7** | `prep-mongo` | `27017` | Single-node `mongosh` ready |

---

## 2. Lab A — Java Concurrency & JPA N+1 Verification (No Docker Required)

Run the JUnit 5 suite to verify:
- **`ConcurrencyAndLldTest`**: 16-thread `ThreadSafeLRUCache` stress test + 20-thread `TokenBucketRateLimiter` burst-cap test.
- **`JpaNPlusOneTest`**: Hibernate `Statistics` proving `findAll()` executes `6` SQL queries (`N+1`), while `JOIN FETCH` and `@EntityGraph` drop it to `1` SQL query.

```bash
cd labs/java-lld-and-spring
mvn test
```

---

## 3. Lab B — PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` & `SKIP LOCKED`

Run [sql/01-explain-analyze-and-locks.sql](./sql/01-explain-analyze-and-locks.sql) against the 50,000-row `orders` table to observe `Seq Scan` vs ESR Composite `Index Scan` buffer hits and `FOR UPDATE SKIP LOCKED`:

```bash
docker exec -i prep-postgres psql -U prep -d interview_prep < labs/sql/01-explain-analyze-and-locks.sql
```

---

## 4. Lab C — Redis Atomic Lua Rate Limiter & ZSET Leaderboard

Make the script executable and run [redis/01-lua-rate-limiter.sh](./redis/01-lua-rate-limiter.sh):

```bash
chmod +x labs/redis/01-lua-rate-limiter.sh
./labs/redis/01-lua-rate-limiter.sh
```

---

## 5. Lab D — Kafka Consumer Group Rebalancing

Create a 3-partition topic and observe partition assignment / rebalancing across two consumers in the same group:

```bash
# 1. Create a 3-partition topic
docker exec prep-kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --create --topic orders.events --partitions 3 --replication-factor 1

# 2. Start Consumer 1 (Terminal 1) and Consumer 2 (Terminal 2)
docker exec -it prep-kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic orders.events --group order-workers

# 3. Inspect live partition ownership & lag
docker exec prep-kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 --describe --group order-workers
```
