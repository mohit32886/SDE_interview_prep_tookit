package com.interviewprep.labs.lld;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Thread-safe O(1) LRU Cache with optional TTL support.
 * Uses ReentrantReadWriteLock so reads/writes maintain DLL order safely.
 */
public class ThreadSafeLRUCache<K, V> {

    private static final class Node<K, V> {
        final K key;
        V value;
        long expiresAtNanos;
        Node<K, V> prev;
        Node<K, V> next;

        Node(K key, V value, long expiresAtNanos) {
            this.key = key;
            this.value = value;
            this.expiresAtNanos = expiresAtNanos;
        }
    }

    private final int capacity;
    private final long defaultTtlNanos;
    private final Map<K, Node<K, V>> map = new HashMap<>();
    private final Node<K, V> head = new Node<>(null, null, Long.MAX_VALUE);
    private final Node<K, V> tail = new Node<>(null, null, Long.MAX_VALUE);
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();

    public ThreadSafeLRUCache(int capacity, long defaultTtlMillis) {
        if (capacity <= 0) throw new IllegalArgumentException("Capacity must be > 0");
        this.capacity = capacity;
        this.defaultTtlNanos = defaultTtlMillis > 0 ? defaultTtlMillis * 1_000_000L : Long.MAX_VALUE;
        head.next = tail;
        tail.prev = head;
    }

    public Optional<V> get(K key) {
        lock.writeLock().lock();
        try {
            Node<K, V> node = map.get(key);
            if (node == null) return Optional.empty();
            if (isExpired(node)) {
                removeNode(node);
                map.remove(key);
                return Optional.empty();
            }
            moveToFront(node);
            return Optional.of(node.value);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void put(K key, V value) {
        lock.writeLock().lock();
        try {
            long exp = defaultTtlNanos == Long.MAX_VALUE
                    ? Long.MAX_VALUE
                    : System.nanoTime() + defaultTtlNanos;
            Node<K, V> existing = map.get(key);
            if (existing != null) {
                existing.value = value;
                existing.expiresAtNanos = exp;
                moveToFront(existing);
                return;
            }
            if (map.size() >= capacity) {
                Node<K, V> lru = tail.prev;
                if (lru != head) {
                    removeNode(lru);
                    map.remove(lru.key);
                }
            }
            Node<K, V> fresh = new Node<>(key, value, exp);
            map.put(key, fresh);
            insertAfterHead(fresh);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public int size() {
        lock.readLock().lock();
        try {
            return map.size();
        } finally {
            lock.readLock().unlock();
        }
    }

    private boolean isExpired(Node<K, V> node) {
        return node.expiresAtNanos != Long.MAX_VALUE && System.nanoTime() > node.expiresAtNanos;
    }

    private void moveToFront(Node<K, V> node) {
        removeNode(node);
        insertAfterHead(node);
    }

    private void insertAfterHead(Node<K, V> node) {
        node.next = head.next;
        node.prev = head;
        head.next.prev = node;
        head.next = node;
    }

    private void removeNode(Node<K, V> node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }
}
