# Email Skill - 邮件助理版

这个 skill 现在不是单纯的“发信脚本”了，而是一个带本地状态的邮件助理：

- 读邮件仍由 `read-email.js` 负责
- 真正发邮件仍由 `send-email.js` / `send-email.sh` 负责
- 新增 `email-assistant.js` 作为上层编排入口，负责模板检测、模板自动套用、群组、草稿预览、确认发送

配合当前 workspace 使用时，外层默认会把它作为“中文邮件助理”来介绍：

- 新会话 / `/new` 默认中文开场
- 当用户问“你能做什么”时，优先介绍邮件相关能力
- 不主动暴露具体邮箱账号与 SMTP / IMAP 细节，除非用户明确追问配置

## 目录结构

```text
skills/email/
  email-assistant.js      # 新的主控入口
  send-email.js           # 底层发送执行器
  read-email.js           # 底层读信执行器
  send-email.sh           # Bash 兼容发送器
  template-store.js       # 模板存储
  group-store.js          # 群组存储
  state-store.js          # 待确认草稿状态存储
  utils.js                # 公共工具
  templates.json          # 模板数据
  groups.json             # 群组数据
  pending-actions.json    # 待确认任务
  email-config.json       # SMTP / IMAP 配置
```

## 快速开始

### 1. 通过主控入口使用邮件助理

```bash
node skills/email/email-assistant.js "给 张三<zhangsan@example.com> 发邮件，主题是“测试”，正文是“你好”"
```

第一次不会真的发送，而是生成草稿预览，并写入 `pending-actions.json`。之后继续：

```bash
node skills/email/email-assistant.js "确认发送"
```

你也可以说：

```bash
node skills/email/email-assistant.js "修改正文为“补充一下，今天 6 点前回复。”"
node skills/email/email-assistant.js "取消发送"
```

自然语言发信现在遵循固定规则：

- 所有自然语言发信请求都必须先生成草稿
- 发信前会先检查模板库
- 命中模板时直接按模板起草，不再额外询问
- 未命中模板时按普通方式起草
- 真正发送只允许出现在已有 active pending draft 且用户明确回复 `确认发送` 的路径上

### 2. 直接使用底层发送器

兼容保留，适合脚本调用：

```bash
node skills/email/send-email.js "recipient@example.com" "邮件主题" "邮件内容"
./skills/email/send-email.sh "recipient@example.com" "邮件主题" "邮件内容"
```

### 3. 直接读取邮件

```bash
node skills/email/read-email.js 10
node skills/email/read-email.js --uid 4
node skills/email/read-email.js --since "2026-03-18 16:50"
```

也可以通过主控入口走自然语言：

```bash
node skills/email/email-assistant.js "查看最近 5 封邮件"
node skills/email/email-assistant.js "查看 UID 4 邮件"
```

## 新能力 1：邮件模板库与自动套用

### 创建模板

```bash
node skills/email/email-assistant.js "帮我保存一个模板，名字叫“会议邀请”，主题是“关于{{topic}}的会议”，正文是“您好{{name}}，请于{{time}}参加{{topic}}。”"
```

### 查看模板

```bash
node skills/email/email-assistant.js "查看所有模板"
node skills/email/email-assistant.js "查看模板“会议邀请”"
```

### 删除模板

```bash
node skills/email/email-assistant.js "删除模板“会议邀请”"
```

### 用模板起草邮件

```bash
node skills/email/email-assistant.js "用“会议邀请”模板给张三<zhangsan@example.com>发邮件，topic 是 项目评审，name 是 张三，time 是 明天下午 3 点"
```

说明：

- 模板变量使用 `{{变量名}}`
- 当前实现用简单字符串替换，不依赖外部模板引擎
- 变量缺失时会阻止进入发送确认流程
- 普通自然语言发信时也会自动检查模板库；如果找到最匹配模板，会直接按模板起草
- 如果没有合理匹配模板，系统会回退为普通邮件起草

## 新能力 2：发送前二次确认

所有自然语言发信都会先变成“待确认草稿”，不会直接调用底层发送器。只有当前存在待确认草稿且用户明确回复 `确认发送` 时，才会真正调用发送能力。

### 草稿预览

返回示例：

```text
【草稿预览】
起草方式：模板
模板：会议邀请
收件人：张三 <zhangsan@example.com>
主题：关于项目评审的会议
正文：
您好张三，请于明天下午 3 点参加项目评审。
请回复“确认发送”继续，或回复“修改……”调整，或回复“取消发送”终止。
```

群组场景会额外显示群组信息，例如：

```text
【草稿预览】
起草方式：群组+模板
模板：组会召开通知
群组：项目A组
收件人：
1. 张三 <zhangsan@example.com>
2. 李四 <lisi@example.com>
主题：组会召开通知
正文：
请大家从今天开始每天下午参加组会。
请回复“确认发送”继续，或回复“修改……”调整，或回复“取消发送”终止。
```

### 可用操作

- `确认发送`
- `取消发送`
- `修改主题为……`
- `修改正文为……`
- `收件人改成……`
- `查看草稿`

状态会持久化到 `pending-actions.json`，即使主进程重启也不会立刻丢失。

## 新能力 3：群发组管理

### 创建群组

```bash
node skills/email/email-assistant.js "创建一个群组叫“项目A组”，成员有张三<zhangsan@example.com>、李四<lisi@example.com>"
```

### 查看群组

```bash
node skills/email/email-assistant.js "查看所有群组"
node skills/email/email-assistant.js "查看群组“项目A组”"
```

### 增删成员

```bash
node skills/email/email-assistant.js "给“项目A组”加一个成员王五<wuwu@example.com>"
node skills/email/email-assistant.js "把“项目A组”里的李四删掉"
```

### 删除群组

```bash
node skills/email/email-assistant.js "删除群组“项目A组”"
```

### 给群组发邮件

```bash
node skills/email/email-assistant.js "给“项目A组”发邮件，主题是“本周同步”，正文是“请大家今晚前反馈进度。”"
```

说明：

- 群组成员保存在 `groups.json`
- 实际发送时会拼成逗号分隔收件人传给底层发送器
- 群发同样会先检测模板，命中则直接按模板起草
- 群发同样必须先确认再发送

### 群组候选确认

当用户输入的群组名没有精确命中时，当前实现会按下面顺序处理：

1. 精确匹配
2. 轻量归一化匹配
3. 候选确认

归一化匹配会做这些轻量处理：

- 去首尾空格
- 去中英文引号
- 全角半角统一
- 去掉常见后缀：`群组` / `邮件组` / `小组` / `组`

例如，已存在群组 `邮件测试` 时，下面这些表达更容易命中：

- `邮件测试`
- `邮件测试组`
- `邮件测试群组`

如果仍然没有精确命中，但找到高相似候选，skill 会先停在候选确认，不会静默自动发送，例如：

```text
未找到名为“测试群组”的群组。
你是不是想发给“邮件测试”？
回复“确认群组 邮件测试”继续，或回复“查看所有群组”。
```

确认后继续：

```bash
node skills/email/email-assistant.js "确认群组 邮件测试"
```

这一步只会恢复原本的起草流程并生成草稿，后面仍然需要：

```bash
node skills/email/email-assistant.js "确认发送"
```

边界：

- 不会因为候选命中就直接发送
- 如果完全没有候选，会提示查看所有群组
- 群组查看、加成员、删成员、删群组等管理操作也会给出候选提示，但不会自动替换执行

## 数据文件

- `templates.json`：模板库
- `groups.json`：群组库
- `pending-actions.json`：待确认草稿和发送状态

另外，workspace 侧的每日刷新状态保存在：

- `.openclaw/workspace/runtime/session-maintenance.json`

这些文件在不存在时会自动初始化。

## 配置 SMTP / IMAP

编辑 `skills/email/email-config.json`：

```json
{
  "smtp": {
    "host": "smtp.example.com",
    "port": 587,
    "user": "your-email@example.com",
    "pass": "your-password"
  },
  "imap": {
    "host": "imap.example.com",
    "port": 993,
    "user": "your-email@example.com",
    "pass": "your-password"
  },
  "from": "your-email@example.com"
}
```

也支持环境变量：

```bash
export EMAIL_SMTP_HOST=smtp.example.com
export EMAIL_SMTP_PORT=587
export EMAIL_SMTP_USER=your-email@example.com
export EMAIL_SMTP_PASS=your-password
export EMAIL_IMAP_HOST=imap.example.com
export EMAIL_IMAP_PORT=993
export EMAIL_IMAP_USER=your-email@example.com
export EMAIL_IMAP_PASS=your-password
export EMAIL_FROM=your-email@example.com
```

## 健壮性说明

- JSON 文件不存在时会自动创建
- JSON 文件损坏时会给出明确提示，而不是直接静默崩溃
- 模板名和群组名重复会拦截
- 空收件人、空主题、空正文会拦截
- 空群组禁止发信
- 缺失模板变量时禁止进入最终发送
- 没有待确认任务时，`确认发送` 会给出友好提示
- 代码不会主动打印 SMTP 密码

## 当前版本限制

- 只管理一个“当前待确认草稿”，新草稿会替换旧草稿
- 只管理一个“当前待确认群组候选”，新的候选会覆盖旧的候选
- 暂未支持附件、抄送、密送、定时发送、联系人自动匹配
- 自然语言解析是规则匹配式 MVP，建议尽量按文档示例表达

## Workspace 每日刷新逻辑

workspace 层新增了一个轻量 daily refresh 机制，用来控制“每天最多刷新一次对话上下文”：

- 主机制：当天第一次用户消息触发检查
- 兜底机制：heartbeat 辅助检查
- 若用户近 3 小时内活跃过，不会在工作中途强制刷新
- 一天只成功刷新一次
- 刷新只针对对话上下文负担，不删除模板、群组、待确认草稿等本地 JSON 数据

当前仓库里没有独立的应用级 session manager，因此这部分通过 workspace 提示层加 `.openclaw/workspace/session-maintenance.js` 的轻量状态文件来承接；如果外层平台支持 `/new`，优先在安全时机用新会话完成刷新，否则就以本地持久化文件为准继续工作。
