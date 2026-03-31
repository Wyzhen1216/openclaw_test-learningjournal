# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

### Email

- **Skill location:** `skills/email/`
- **Send script:** `skills/email/send-email.js`
- **Config file:** `skills/email/email-config.json`

**Configured Account:**
- **邮箱:** 3315850933@qq.com
- **SMTP:** smtp.qq.com:587

**Usage:**
```bash
node skills/email/send-email.js <to> <subject> <body> [from]
```

**Configuration options:**
1. Edit `skills/email/email-config.json`
2. Or set environment variables:
   - `EMAIL_SMTP_HOST` - SMTP server hostname
   - `EMAIL_SMTP_PORT` - SMTP server port (default: 587)
   - `EMAIL_SMTP_USER` - SMTP username
   - `EMAIL_SMTP_PASS` - SMTP password
   - `EMAIL_FROM` - Default from address

**Note:** Currently uses system `sendmail`/`mail` commands. SMTP support can be added with `nodemailer` if needed.

### Learning Journal

- **Skill location:** `skills/learning-journal/`
- **Main script:** `skills/learning-journal/learning-journal.js`
- **Profile sync script:** `skills/learning-journal/sync-workspace-profile.js`

**Environment variables (learning-journal):**
- `EMAIL_USER` - QQ 邮箱地址
- `EMAIL_PASS` - QQ 邮箱 SMTP 授权码
- `TO_EMAIL` - 收件邮箱
- `FROM_EMAIL` - 显示发件邮箱（默认同 `EMAIL_USER`）
- `FROM_NAME` - 显示发件人名称（默认“学习日志助手”）
- `JOURNAL_PATH` - 学习日志存储目录

**One-command profile sync:**
```bash
cd skills/learning-journal && npm run sync:profile
```

该命令会把 `skills/learning-journal/workspace-profile/` 下的 `AGENTS.md`、`SOUL.md`、`IDENTITY.md`、`TOOLS.md`（存在则同步）覆盖到 workspace 根目录，避免逐个手改。

---

Add whatever helps you do your job. This is your cheat sheet.
