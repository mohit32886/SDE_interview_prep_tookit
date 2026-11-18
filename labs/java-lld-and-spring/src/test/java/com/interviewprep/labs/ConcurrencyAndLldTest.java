package com.interviewprep.labs;

import com.interviewprep.labs.lld.ThreadSafeLRUCache;
import com.interviewprep.labs.lld.TokenBucketRateLimiter;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConcurrencyAndLldTest {

    @Test
    void lruCacheEvictsLeastRecentlyUsedAndIsThreadSafe() throws InterruptedException {
        ThreadSafeLRUCache<Integer, String> cache = new ThreadSafeLRUCache<>(3, 0);
        cache.put(1, "A");
        cache.put(2, "B");
        cache.put(3, "C");
        // Touch key 1 so key 2 becomes LRU
        assertEquals("A", cache.get(1).orElseThrow());
        cache.put(4, "D");

        assertTrue(cache.get(2).isEmpty(), "Key 2 should be evicted");
        assertEquals(3, cache.size());

        int threads = 16;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch latch = new CountDownLatch(threads);
        for (int t = 0; t < threads; t++) {
            final int id = t;
            pool.submit(() -> {
                try {
                    for (int i = 0; i < 200; i++) {
                        cache.put((id + i) % 5, "v-" + i);
                        cache.get((id + i) % 5);
                    }
                } finally {
                    latch.countDown();
                }
            });
        }
        latch.await();
        pool.shutdown();
        assertTrue(cache.size() <= 3);
    }

    @Test
    void tokenBucketEnforcesBurstCapUnderContention() throws InterruptedException {
        TokenBucketRateLimiter limiter = new TokenBucketRateLimiter(10, 1);
        int threads = 20;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);
        AtomicInteger allowed = new AtomicInteger();

        for (int i = 0; i < threads; i++) {
            pool.submit(() -> {
                try {
                    start.await();
                    if (limiter.allowRequest("user-42")) {
                        allowed.incrementAndGet();
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    done.countDown();
                }
            });
        }
        start.countDown();
        done.await();
        pool.shutdown();

        assertEquals(10, allowed.get(), "Exactly burst capacity (10) requests should pass");
    }
}
