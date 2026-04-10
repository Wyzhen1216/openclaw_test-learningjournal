# 57. Daily Learning Journal

## Introduction

# 每日学习日志（QQ邮箱版）
## 介绍
这是一个基于 OpenClaw 的每日学习日志技能，通过 QQ 邮箱发送每日学习提醒，自动保存学习记录，并生成周/月总结发送到邮箱。

## 依赖技能
- 无（独立运行）

## 配置要求
在 OpenClaw 「设置→API 密钥」中添加以下环境变量：
- EMAIL_USER: 你的 QQ 邮箱地址（如 123456@qq.com）
- EMAIL_PASS: QQ 邮箱授权码（不是登录密码）
- TO_EMAIL: 接收提醒的邮箱（可与 EMAIL_USER 相同）
- FROM_EMAIL: 邮件显示的发件邮箱（默认等于 EMAIL_USER）
- FROM_NAME: 邮件显示的发件人名称（默认“学习日志助手”）
- JOURNAL_PATH: 日志保存根目录（不填时默认 `workspace/memory/learning-journal`）
- OPENCLAW_SUMMARY_MODEL: 周/月总结生成使用的模型名（如已在网关配置的模型 ID）
- OPENCLAW_SUMMARY_ENDPOINT: 可选，模型网关地址（默认 `http://127.0.0.1:18789/v1/chat/completions`）
- OPENCLAW_GATEWAY_TOKEN: 可选，网关鉴权 token
- OPENCLAW_SUMMARY_COMMAND: 可选，CLI 调用命令（当网关不可用时备用）

## 功能说明
1. 每日 09:00 自动发送今日学习计划邮件（基于近几天日志）
2. 每日 20:00 自动发送学习提醒邮件
3. 支持“草稿-编辑-确认”两阶段日志保存流程
4. 每周日 19:00 自动生成周总结草稿并发提醒邮件（不直接覆盖正式总结）
5. 每月最后一天 20:00 自动生成月总结草稿并发提醒邮件（不直接覆盖正式总结）
6. 周/月总结支持标签、关键词、关键句自动提取，优先 AI 生成，失败自动降级为规则汇总

## 交互保存流程（推荐）

1. 调用 `createLearningJournalDraft(content)` 创建草稿
2. 用户修改后调用 `editLearningJournalDraft(content)` 更新草稿
3. 可调用 `previewLearningJournalDraft()` 查看当前草稿
4. 用户明确同意后调用 `confirmAndSaveLearningJournal()` 才会落盘并发送邮件
5. 放弃时调用 `discardLearningJournalDraft()`

## 周/月总结草稿流程（推荐）

1. 调用 `createWeeklySummaryDraft()` 或 `createMonthlySummaryDraft()` 生成草稿
2. 调用 `previewSummaryDraft()` 预览
3. 按需调用 `editSummaryDraft(content)` 修改
4. 用户明确同意后调用 `confirmAndSaveSummaryDraft()` 才会写入正式总结并发送邮件
5. 放弃时调用 `discardSummaryDraft()`

## 自动提取与生成原理

1. 从 `daily/*.md` 中提取标签（如 `#问题`）、关键词频次、关键句（困难/收获/计划）
2. 聚合为周/月结构化统计，再构造提示词给大模型生成总结
3. 若模型不可用，自动降级为规则化总结模板，保证可用性
4. 始终先生成草稿，用户确认前不会覆盖正式总结文件

## 日志存储路径
默认：`workspace/memory/learning-journal/daily/YYYY-MM-DD.md`  
可通过 `JOURNAL_PATH` 自定义为任意可写目录

## 总结存储路径

- 草稿：`workspace/memory/learning-journal/summaries/draft/`
  - 周草稿：`weekly-YYYY-[W]WW.draft.md`
  - 月草稿：`monthly-YYYY-MM.draft.md`
- 正式：`workspace/memory/learning-journal/summaries/final/`
  - 周总结：`weekly-YYYY-[W]WW.md`
  - 月总结：`monthly-YYYY-MM.md`

## OpenClaw 调用约束（重要）

为避免在聊天中卡住（常见为 edit/read 参数不完整），处理“学习日志更新”时请严格遵循：

1. 优先调用本技能函数，不要直接走通用文件编辑工具：
   - 创建草稿：`createLearningJournalDraft(content)`
   - 编辑草稿：`editLearningJournalDraft(content)`
   - 预览草稿：`previewLearningJournalDraft()`
   - 确认保存：`confirmAndSaveLearningJournal()`
   - 放弃草稿：`discardLearningJournalDraft()`

2. 用户仅表达“新增/修改日志”时：
   - 先调用 `createLearningJournalDraft(content)` 或 `editLearningJournalDraft(content)`，
   - 然后明确询问“是否同意保存”，
   - 用户同意后再调用 `confirmAndSaveLearningJournal()`。

3. 禁止在本场景直接调用通用 `edit` 工具去改 markdown 文件，
   除非用户明确要求“手工编辑某个指定文件路径”。

4. 若工具失败，优先返回可执行的下一步（重试/确认内容），
   不要在失败后进入无穷重试。