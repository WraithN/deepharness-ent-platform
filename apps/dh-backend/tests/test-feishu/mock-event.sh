#!/usr/bin/env bash
# 飞书机器人 webhook 全链路 mock 测试脚本
#
# 用法:
#   bash apps/dh-backend/tests/test-feishu/mock-event.sh
#
# 前置条件:
#   1. dh-backend 已启动（默认 :8080）
#   2. config.yaml 中 feishu.mock_mode=true、feishu.webhook_token 已配置
#   3. gatewayd 已启动（:2346），否则 agent 分发会失败
#
# 本脚本发送 3 类测试请求：
#   A. URL 验证（飞书回调地址校验）
#   B. mock 一次性问答（普通提问 -> QuickComplete）
#   C. mock 持久化会话（斜杠命令 -> AGUIClient.Run）
#   D. 用户绑定（管理接口）
#   E. 绑定列表查询

set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8080}"
WEBHOOK_TOKEN="${FEISHU_WEBHOOK_TOKEN:-feishu-local-dev-token}"
AUTH_USER="${AUTH_USER:-admin}"

echo "========================================"
echo "飞书机器人 Webhook Mock 测试"
echo "Backend: $BACKEND_URL"
echo "========================================"

# A. URL 验证
echo ""
echo "[A] URL 验证 (challenge)..."
curl -s -X POST "$BACKEND_URL/api/v1/feishu/webhook" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"challenge":"test-challenge-12345","token":"verify","type":"url_verification"}' \
  | python3 -m json.tool 2>/dev/null || echo "(非 JSON 响应)"

# D. 用户绑定
echo ""
echo "[D] 绑定飞书用户 -> 平台用户..."
curl -s -X POST "$BACKEND_URL/api/v1/feishu/bindings" \
  -H "Authorization: Bearer $AUTH_USER" \
  -H "Content-Type: application/json" \
  -d '{
    "openId": "ou_test_user_001",
    "userId": "admin",
    "workspaceId": "default-workspace",
    "userName": "测试用户",
    "nickName": "Tester"
  }' \
  | python3 -m json.tool 2>/dev/null || echo "(非 JSON 响应)"

# E. 绑定列表
echo ""
echo "[E] 查询飞书用户绑定列表..."
curl -s -X GET "$BACKEND_URL/api/v1/feishu/bindings" \
  -H "Authorization: Bearer $AUTH_USER" \
  | python3 -m json.tool 2>/dev/null || echo "(非 JSON 响应)"

# B. 一次性问答
echo ""
echo "[B] Mock 一次性问答（普通提问）..."
echo "    内容: 你好，请用一句话介绍你自己"
curl -s -X POST "$BACKEND_URL/api/v1/feishu/webhook" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mock_event": true,
    "chat_id": "oc_test_chat_oneshot",
    "chat_type": "p2p",
    "open_id": "ou_test_user_001",
    "user_name": "测试用户",
    "message_type": "text",
    "content": "你好，请用一句话介绍你自己",
    "message_id": "om_test_oneshot_001"
  }' \
  | python3 -m json.tool 2>/dev/null || echo "(非 JSON 响应)"

echo ""
echo "    (回复将异步输出到 dh-backend 日志，搜索 [Feishu-MockReply])"

# C. 持久化会话（斜杠命令）
echo ""
echo "[C] Mock 持久化会话（斜杠命令）..."
echo "    内容: /help"
curl -s -X POST "$BACKEND_URL/api/v1/feishu/webhook" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mock_event": true,
    "chat_id": "oc_test_chat_persistent",
    "chat_type": "group",
    "open_id": "ou_test_user_001",
    "user_name": "测试用户",
    "message_type": "text",
    "content": "/help",
    "message_id": "om_test_persistent_001"
  }' \
  | python3 -m json.tool 2>/dev/null || echo "(非 JSON 响应)"

echo ""
echo "    (回复将异步输出到 dh-backend 日志，搜索 [Feishu-MockReply])"

# F. 会话映射列表
echo ""
echo "[F] 查询飞书会话映射列表..."
curl -s -X GET "$BACKEND_URL/api/v1/feishu/chat-sessions" \
  -H "Authorization: Bearer $AUTH_USER" \
  | python3 -m json.tool 2>/dev/null || echo "(非 JSON 响应)"

echo ""
echo "========================================"
echo "测试请求已全部发送。"
echo "请查看 dh-backend 日志确认 agent 回复："
echo "  grep -E '\\[Feishu' <dh-backend 日志输出>"
echo "========================================"
