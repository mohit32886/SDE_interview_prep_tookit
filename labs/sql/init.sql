-- Seed 50,000 orders for EXPLAIN ANALYZE & index tuning labs
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    email VARCHAR(120) NOT NULL UNIQUE,
    tier VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers(id),
    status VARCHAR(20) NOT NULL,
    amount_cents INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO customers (email, tier)
SELECT
    'user' || g || '@example.com',
    CASE WHEN g % 10 = 0 THEN 'ENTERPRISE' ELSE 'STANDARD' END
FROM generate_series(1, 5000) AS g
ON CONFLICT DO NOTHING;

INSERT INTO orders (customer_id, status, amount_cents, created_at)
SELECT
    1 + (random() * 4999)::int,
    (ARRAY['PENDING', 'PAID', 'SHIPPED', 'CANCELLED'])[1 + (random() * 3)::int],
    100 + (random() * 50000)::int,
    NOW() - (random() * INTERVAL '90 days')
FROM generate_series(1, 50000) AS g;

ANALYZE customers;
ANALYZE orders;
