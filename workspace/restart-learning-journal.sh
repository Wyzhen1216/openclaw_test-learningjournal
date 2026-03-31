#!/bin/bash
# 学习日志服务重启脚本

echo "🔄 正在重启学习日志服务..."

# 进入正确目录
cd /Users/test/openclaw_test/workspace/skills/learning-journal || {
    echo "❌ 目录不存在！"
    exit 1
}

# 查找并杀掉旧进程
OLD_PID=$(ps aux | grep "learning-journal.js" | grep -v grep | awk '{print $2}')
if [ -n "$OLD_PID" ]; then
    echo "🛑 停止旧进程 (PID: $OLD_PID)"
    kill $OLD_PID
    sleep 1
fi

# 后台启动新进程
nohup node learning-journal.js > learning-journal.log 2>&1 &
NEW_PID=$!

echo "✅ 服务已启动！新 PID: $NEW_PID"
echo "📧 配置邮箱: 2683647758@qq.com"
echo "📂 日志路径: /Users/test/openclaw_test/workspace/memory/learning-journal"
echo ""
echo "查看实时日志: tail -f /Users/test/openclaw_test/workspace/skills/learning-journal/learning-journal.log"