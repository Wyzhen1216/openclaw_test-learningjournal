# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics.

## Learning Journal

- **Skill location:** `skills/learning-journal/`
- **Main script:** `skills/learning-journal/learning-journal.js`
- **Profile sync script:** `skills/learning-journal/sync-workspace-profile.js`

### Environment variables

- `EMAIL_USER` - QQ 邮箱地址
- `EMAIL_PASS` - QQ 邮箱 SMTP 授权码
- `TO_EMAIL` - 收件邮箱
- `FROM_EMAIL` - 显示发件邮箱（默认同 `EMAIL_USER`）
- `FROM_NAME` - 显示发件人名称（默认“学习日志助手”）
- `JOURNAL_PATH` - 日志存储目录

### One-command sync

```bash
cd skills/learning-journal && npm run sync:profile
```

该命令会将 profile 中的 `AGENTS.md`、`SOUL.md`、`IDENTITY.md`、`TOOLS.md` 覆盖同步到 workspace 根目录。
