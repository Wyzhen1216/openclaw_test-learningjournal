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

## 功能说明
1. 每日 09:00 自动发送今日学习计划邮件（基于近几天日志）
2. 每日 20:00 自动发送学习提醒邮件
3. 支持“草稿-编辑-确认”两阶段日志保存流程
4. 每周日 19:00 发送周学习总结
5. 每月最后一天 20:00 发送月学习总结

## 交互保存流程（推荐）

1. 调用 `createLearningJournalDraft(content)` 创建草稿
2. 用户修改后调用 `editLearningJournalDraft(content)` 更新草稿
3. 可调用 `previewLearningJournalDraft()` 查看当前草稿
4. 用户明确同意后调用 `confirmAndSaveLearningJournal()` 才会落盘并发送邮件
5. 放弃时调用 `discardLearningJournalDraft()`

## 日志存储路径
默认：`workspace/memory/learning-journal/daily/YYYY-MM-DD.md`  
可通过 `JOURNAL_PATH` 自定义为任意可写目录