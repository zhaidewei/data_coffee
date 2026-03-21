#!/usr/bin/env bash
#
# Data Coffee — E2E Test Script
#
# Usage:
#   1. Start dev server:  npm run dev
#   2. Run tests:         bash test-e2e.sh
#
# Prerequisites: curl, python3, sqlite3
# Tests against: http://localhost:3000

set -uo pipefail

BASE="http://localhost:3000"
PASS=0
FAIL=0

# ── Helpers ──────────────────────────────────────────────────

call_tool() {
  local token="$1" name="$2" args="$3" id="$4"
  local auth_header=""
  [[ -n "$token" ]] && auth_header="-H \"Authorization: Bearer $token\""

  eval curl -s "$BASE/mcp" \
    -H "'Content-Type: application/json'" \
    -H "'Accept: application/json, text/event-stream'" \
    $auth_header \
    -d "'$(printf '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"%s","arguments":%s},"id":%s}' "$name" "$args" "$id")'"
}

parse_text() {
  python3 -c "
import sys, json
for line in sys.stdin:
  if 'data:' in line:
    d = json.loads(line.split('data: ', 1)[1])
    print(d['result']['content'][0]['text'])
    break
"
}

parse_json() {
  python3 -c "
import sys, json
for line in sys.stdin:
  if 'data:' in line:
    d = json.loads(line.split('data: ', 1)[1])
    print(json.dumps(json.loads(d['result']['content'][0]['text']), indent=2))
    break
"
}

extract() {
  python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
keys = '$1'.split('.')
for k in keys:
  if isinstance(data, list): data = data[int(k)]
  else: data = data[k]
print(data)
"
}

assert_eq() {
  local desc="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ $desc"
    ((PASS++))
  else
    echo "  ✗ $desc — expected \"$expected\", got \"$actual\""
    ((FAIL++))
  fi
}

assert_contains() {
  local desc="$1" actual="$2" expected="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    echo "  ✓ $desc"
    ((PASS++))
  else
    echo "  ✗ $desc — expected to contain \"$expected\", got \"$actual\""
    ((FAIL++))
  fi
}

assert_gt() {
  local desc="$1" actual="$2" threshold="$3"
  if (( actual > threshold )); then
    echo "  ✓ $desc"
    ((PASS++))
  else
    echo "  ✗ $desc — expected > $threshold, got $actual"
    ((FAIL++))
  fi
}

# ── Pre-flight ───────────────────────────────────────────────

echo "=== Data Coffee E2E Tests ==="
echo ""

# Check server is running
if ! curl -s "$BASE/" > /dev/null 2>&1; then
  echo "ERROR: Dev server not running at $BASE. Start it with: npm run dev"
  exit 1
fi
echo "Server is running at $BASE"
echo ""

# ── 1. Landing Page ──────────────────────────────────────────

echo "[1] Landing Page"

HTML_ZH=$(curl -s "$BASE/")
assert_contains "Chinese landing page loads" "$HTML_ZH" "Data Coffee"
assert_contains "Chinese subtitle" "$HTML_ZH" "荷兰数据群"
assert_contains "Language switcher" "$HTML_ZH" "?lang=en"

HTML_EN=$(curl -s "$BASE/?lang=en")
assert_contains "English landing page loads" "$HTML_EN" "Dutch Data Community"
assert_contains "English stats" "$HTML_EN" "Members"
echo ""

# ── 2. MCP Initialize ───────────────────────────────────────

echo "[2] MCP Initialize"

INIT=$(curl -s "$BASE/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}')
assert_contains "Initialize returns server info" "$INIT" "data-coffee"
echo ""

# ── 3. Tools List ────────────────────────────────────────────

echo "[3] Tools List"

TOOLS=$(curl -s "$BASE/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}')

for tool in profile_register profile_get profile_update coffee_create coffee_list coffee_join coffee_detail coffee_leave coffee_update coffee_complete message_send message_inbox message_read; do
  assert_contains "Tool: $tool" "$TOOLS" "\"$tool\""
done
echo ""

# ── 4. Profile Registration ─────────────────────────────────

echo "[4] Profile Registration"

RESP_A=$(call_tool "" "profile_register" '{"nickname":"TestAlice","bio":"Data engineer in Amsterdam"}' 10 | parse_text)
TOKEN_A=$(echo "$RESP_A" | extract "token")
USER_A=$(echo "$RESP_A" | extract "user_id")
assert_contains "Alice registered" "$RESP_A" "Registration successful"
echo "  → Alice: $USER_A"

RESP_B=$(call_tool "" "profile_register" '{"nickname":"TestBob","bio":"ML engineer in Rotterdam"}' 11 | parse_text)
TOKEN_B=$(echo "$RESP_B" | extract "token")
USER_B=$(echo "$RESP_B" | extract "user_id")
assert_contains "Bob registered" "$RESP_B" "Registration successful"
echo "  → Bob: $USER_B"
echo ""

# ── 5. Profile Get & Update ─────────────────────────────────

echo "[5] Profile Get & Update"

PROFILE=$(call_tool "$TOKEN_A" "profile_get" '{"query":"TestAlice"}' 12 | parse_text)
assert_contains "Alice can get own profile" "$PROFILE" "TestAlice"

call_tool "$TOKEN_A" "profile_update" '{"city":"Amsterdam","role":"Data Engineer","skills":["Python","Spark"]}' 13 > /dev/null
UPDATED=$(call_tool "$TOKEN_A" "profile_get" '{"query":"TestAlice"}' 14 | parse_text)
assert_contains "Profile updated with city" "$UPDATED" "Amsterdam"
assert_contains "Profile updated with role" "$UPDATED" "Data Engineer"
echo ""

# ── 6. Coffee Create ────────────────────────────────────────

echo "[6] Coffee Create"

COFFEE_RESP=$(call_tool "$TOKEN_A" "coffee_create" '{"topic":"E2E Test Coffee","description":"Testing the full flow","city":"Amsterdam","max_size":5}' 20 | parse_text)
COFFEE_ID=$(echo "$COFFEE_RESP" | extract "coffee_id")
assert_contains "Coffee created" "$COFFEE_RESP" "Coffee created"
assert_eq "Coffee status is open" "$(echo "$COFFEE_RESP" | extract 'status')" "open"
echo "  → Coffee: $COFFEE_ID"
echo ""

# ── 7. Coffee List ───────────────────────────────────────────

echo "[7] Coffee List"

LIST=$(call_tool "" "coffee_list" '{}' 21 | parse_text)
assert_contains "Coffee appears in list" "$LIST" "E2E Test Coffee"

LIST_CITY=$(call_tool "" "coffee_list" '{"city":"Amsterdam"}' 22 | parse_text)
assert_contains "City filter works" "$LIST_CITY" "E2E Test Coffee"

LIST_OTHER=$(call_tool "" "coffee_list" '{"city":"Nowhere"}' 23 | parse_text)
TOTAL_OTHER=$(echo "$LIST_OTHER" | extract "total")
assert_eq "City filter excludes non-matching" "$TOTAL_OTHER" "0"
echo ""

# ── 8. Coffee Join ───────────────────────────────────────────

echo "[8] Coffee Join"

JOIN=$(call_tool "$TOKEN_B" "coffee_join" "{\"coffee_id\":\"$COFFEE_ID\"}" 30 | parse_text)
assert_contains "Bob joined coffee" "$JOIN" "You joined"

# Try joining again
JOIN_DUP=$(call_tool "$TOKEN_B" "coffee_join" "{\"coffee_id\":\"$COFFEE_ID\"}" 31 | parse_text)
assert_contains "Duplicate join rejected" "$JOIN_DUP" "already joined"

# No auth
JOIN_NOAUTH=$(call_tool "" "coffee_join" "{\"coffee_id\":\"$COFFEE_ID\"}" 32 | parse_text)
assert_contains "Join without auth rejected" "$JOIN_NOAUTH" "Authentication required"
echo ""

# ── 9. Coffee Detail ────────────────────────────────────────

echo "[9] Coffee Detail"

DETAIL=$(call_tool "" "coffee_detail" "{\"coffee_id\":\"$COFFEE_ID\"}" 40 | parse_text)
assert_contains "Detail shows topic" "$DETAIL" "E2E Test Coffee"
assert_contains "Detail shows Alice" "$DETAIL" "TestAlice"
assert_contains "Detail shows Bob" "$DETAIL" "TestBob"
echo ""

# ── 10. Coffee Update (creator only) ────────────────────────

echo "[10] Coffee Update"

UPDATE=$(call_tool "$TOKEN_A" "coffee_update" "{\"coffee_id\":\"$COFFEE_ID\",\"description\":\"Updated description\"}" 41 | parse_text)
assert_contains "Creator can update" "$UPDATE" "Coffee updated"

UPDATE_FAIL=$(call_tool "$TOKEN_B" "coffee_update" "{\"coffee_id\":\"$COFFEE_ID\",\"topic\":\"Hijack\"}" 42 | parse_text)
assert_contains "Non-creator cannot update" "$UPDATE_FAIL" "not the creator"
echo ""

# ── 11. Message Send (Direct) ───────────────────────────────

echo "[11] Message Send (Direct)"

SEND_DM=$(call_tool "$TOKEN_A" "message_send" '{"to":"TestBob","content":"Hey Bob, see you at the coffee!"}' 50 | parse_text)
assert_contains "Direct message sent" "$SEND_DM" "Message sent to TestBob"
assert_contains "Message type is direct" "$SEND_DM" '"direct"'

# Self-message
SEND_SELF=$(call_tool "$TOKEN_A" "message_send" '{"to":"TestAlice","content":"Hello self"}' 51 | parse_text)
assert_contains "Self-message rejected" "$SEND_SELF" "Cannot send message to yourself"

# Unknown recipient
SEND_UNKNOWN=$(call_tool "$TOKEN_A" "message_send" '{"to":"NonExistent","content":"Hello"}' 52 | parse_text)
assert_contains "Unknown recipient rejected" "$SEND_UNKNOWN" "not found"

# No target
SEND_EMPTY=$(call_tool "$TOKEN_A" "message_send" '{"content":"Hello nobody"}' 53 | parse_text)
assert_contains "No target rejected" "$SEND_EMPTY" "required"
echo ""

# ── 12. Message Send (Coffee Group) ─────────────────────────

echo "[12] Message Send (Coffee Group)"

SEND_GROUP=$(call_tool "$TOKEN_B" "message_send" "{\"coffee_id\":\"$COFFEE_ID\",\"content\":\"Looking forward to it!\"}" 60 | parse_text)
assert_contains "Coffee group message sent" "$SEND_GROUP" "Message sent to coffee group"
assert_contains "Shows participant count" "$SEND_GROUP" "participants"

# Non-participant tries to send
RESP_C=$(call_tool "" "profile_register" '{"nickname":"TestCharlie","bio":"Outsider"}' 61 | parse_text)
TOKEN_C=$(echo "$RESP_C" | extract "token")
SEND_OUTSIDER=$(call_tool "$TOKEN_C" "message_send" "{\"coffee_id\":\"$COFFEE_ID\",\"content\":\"Can I join?\"}" 62 | parse_text)
assert_contains "Non-participant cannot send to coffee" "$SEND_OUTSIDER" "not a participant"
echo ""

# ── 13. Message Inbox ───────────────────────────────────────

echo "[13] Message Inbox"

INBOX_B=$(call_tool "$TOKEN_B" "message_inbox" '{}' 70 | parse_text)
assert_contains "Bob sees DM from Alice" "$INBOX_B" "Hey Bob"
assert_contains "Bob sees system notification" "$INBOX_B" "私信"
UNREAD_B=$(echo "$INBOX_B" | extract "unread_count")
assert_gt "Bob has unread messages" "$UNREAD_B" 0

# Filter by type
INBOX_DIRECT=$(call_tool "$TOKEN_B" "message_inbox" '{"type":"direct"}' 71 | parse_text)
assert_contains "Direct filter shows DM" "$INBOX_DIRECT" "Hey Bob"

INBOX_SYSTEM=$(call_tool "$TOKEN_B" "message_inbox" '{"type":"system"}' 72 | parse_text)
assert_contains "System filter shows notifications" "$INBOX_SYSTEM" "system"

# Alice sees coffee group message (not her own system notifications for join)
INBOX_A=$(call_tool "$TOKEN_A" "message_inbox" '{"type":"coffee"}' 73 | parse_text)
assert_contains "Alice sees Bob's coffee message" "$INBOX_A" "Looking forward"

# Unread filter
INBOX_UNREAD=$(call_tool "$TOKEN_B" "message_inbox" '{"unread":true}' 74 | parse_text)
UNREAD_COUNT=$(echo "$INBOX_UNREAD" | extract "unread_count")
assert_gt "Unread filter returns unread messages" "$UNREAD_COUNT" 0
echo ""

# ── 14. Message Read ────────────────────────────────────────

echo "[14] Message Read"

# Get a message ID from Bob's inbox
MSG_ID=$(echo "$INBOX_B" | extract "messages.0.id")

READ_ONE=$(call_tool "$TOKEN_B" "message_read" "{\"message_id\":\"$MSG_ID\"}" 80 | parse_text)
assert_contains "Single message marked read" "$READ_ONE" '"success"'

READ_ALL=$(call_tool "$TOKEN_B" "message_read" '{"all":true}' 81 | parse_text)
assert_contains "All messages marked read" "$READ_ALL" '"success"'

# Verify no unread
INBOX_AFTER=$(call_tool "$TOKEN_B" "message_inbox" '{"unread":true}' 82 | parse_text)
UNREAD_AFTER=$(echo "$INBOX_AFTER" | extract "unread_count")
assert_eq "No unread messages after mark all" "$UNREAD_AFTER" "0"
echo ""

# ── 15. System Notifications ────────────────────────────────

echo "[15] System Notifications (coffee_join / coffee_leave / coffee_complete)"

# Alice should have a join notification from Bob
ALICE_NOTIF=$(call_tool "$TOKEN_A" "message_inbox" '{"type":"system"}' 90 | parse_text)
assert_contains "Alice got join notification" "$ALICE_NOTIF" "加入了你的 coffee"

# Bob leaves
call_tool "$TOKEN_B" "coffee_leave" "{\"coffee_id\":\"$COFFEE_ID\"}" 91 > /dev/null
ALICE_NOTIF2=$(call_tool "$TOKEN_A" "message_inbox" '{"type":"system","unread":true}' 92 | parse_text)
assert_contains "Alice got leave notification" "$ALICE_NOTIF2" "退出了你的 coffee"

# Bob re-joins for complete test
call_tool "$TOKEN_B" "coffee_join" "{\"coffee_id\":\"$COFFEE_ID\"}" 93 > /dev/null

# Alice completes coffee
call_tool "$TOKEN_A" "coffee_complete" "{\"coffee_id\":\"$COFFEE_ID\"}" 94 > /dev/null
BOB_COMPLETE=$(call_tool "$TOKEN_B" "message_inbox" '{"type":"system","unread":true}' 95 | parse_text)
assert_contains "Bob got complete notification" "$BOB_COMPLETE" "已完成"
echo ""

# ── 16. Coffee Leave ────────────────────────────────────────

echo "[16] Coffee Leave"

# Create a new coffee for leave test
COFFEE2_RESP=$(call_tool "$TOKEN_A" "coffee_create" '{"topic":"Leave Test Coffee"}' 100 | parse_text)
COFFEE2_ID=$(echo "$COFFEE2_RESP" | extract "coffee_id")
call_tool "$TOKEN_B" "coffee_join" "{\"coffee_id\":\"$COFFEE2_ID\"}" 101 > /dev/null

LEAVE=$(call_tool "$TOKEN_B" "coffee_leave" "{\"coffee_id\":\"$COFFEE2_ID\"}" 102 | parse_text)
assert_contains "Bob left coffee" "$LEAVE" "You left"

# Creator cannot leave
LEAVE_CREATOR=$(call_tool "$TOKEN_A" "coffee_leave" "{\"coffee_id\":\"$COFFEE2_ID\"}" 103 | parse_text)
assert_contains "Creator cannot leave" "$LEAVE_CREATOR" "Creator cannot leave"
echo ""

# ── Summary ──────────────────────────────────────────────────

echo "==============================="
echo "  Results: $PASS passed, $FAIL failed"
echo "==============================="

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
