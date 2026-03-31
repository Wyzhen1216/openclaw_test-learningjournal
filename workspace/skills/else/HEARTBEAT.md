# HEARTBEAT.md

# 每次 heartbeat 先做轻量 daily refresh 检查，不要粗暴打断当前工作流。

1. 读取 `.openclaw/workspace/runtime/session-maintenance.json`。
2. 如果今天已经成功刷新过，则当天不再触发刷新。
3. 如果今天还没刷新：
   - heartbeat 只负责兜底检查
   - 若距离 `lastUserActiveAt` 小于 3 小时，只标记待刷新，不要打断工作
   - 若距离 `lastUserActiveAt` 大于等于 3 小时，可把当前 heartbeat 作为安全刷新点
4. 刷新只清理对话上下文负担，不删除本地模板、群组、待确认草稿等数据文件。
5. 如果平台支持 `/new` 或新会话，优先在安全时机使用；否则就以本地持久化文件为准，丢弃旧的临时聊天假设。
6. 如果没有其他任务，就回复 `HEARTBEAT_OK`。
