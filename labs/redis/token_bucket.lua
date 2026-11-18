-- Atomic Token Bucket Rate Limiter
-- KEYS[1] = bucket key (e.g. rl:user:42)
-- ARGV[1] = capacity (max burst)
-- ARGV[2] = refill_rate_per_sec
-- ARGV[3] = now_ms
-- ARGV[4] = requested_tokens
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last_ms')
local tokens = tonumber(data[1])
local last_ms = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last_ms = now_ms
else
  local elapsed = math.max(0, now_ms - last_ms) / 1000.0
  tokens = math.min(capacity, tokens + elapsed * rate)
  last_ms = now_ms
end

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'last_ms', last_ms)
redis.call('PEXPIRE', key, math.ceil((capacity / rate) * 1000) * 2)

return { allowed, math.floor(tokens) }
