#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOW_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"

echo "=== 1. Loading & Running Atomic Token Bucket Lua Script (capacity=5, rate=1/s) ==="
SHA=$(docker exec -i prep-redis redis-cli -x SCRIPT LOAD < "$SCRIPT_DIR/token_bucket.lua")
echo "Loaded SHA: $SHA"

for i in {1..7}; do
  RES=$(docker exec prep-redis redis-cli EVALSHA "$SHA" 1 "rl:demo:user1" 5 1 "$NOW_MS" 1 | tr '\n' ' ')
  echo "Request #$i -> [allowed, remaining]: $RES"
done

echo ""
echo "=== 2. Redis ZSET Leaderboard Demo ==="
docker exec prep-redis redis-cli DEL lb:global >/dev/null
docker exec prep-redis redis-cli ZADD lb:global 1200 alice 1850 bob 1540 charlie 2100 diana >/dev/null
echo "Top 3:"
docker exec prep-redis redis-cli ZREVRANGE lb:global 0 2 WITHSCORES
echo "Charlie 0-based rank:"
docker exec prep-redis redis-cli ZREVRANK lb:global charlie
