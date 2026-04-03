const fs = require('fs-extra');
const moment = require('moment');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const MAX_CONTEXT_LOGS = 14;
const KEYWORD_STOP_WORDS = new Set([
  '今天', '今天的', '本周', '本月', '学习', '日志', '记录', '总结', '计划',
  '明日', '明天', '完成', '进行', '继续', '以及', '这个', '那个', '我们', '自己',
  '已经', '还是', '一个', '一些', '然后', '因为', '所以', '但是', '如果', '需要',
  '问题', '收获', '复盘', '时间', '工作', '任务', '内容', '相关', '通过'
]);
const SIGNAL_PATTERNS = {
  pain: /(卡住|困难|问题|挑战|阻塞|不会|报错|失败|中断|拖延|分心)/i,
  win: /(完成|搞定|突破|收获|进步|产出|实现|解决|通过|上线|掌握)/i,
  plan: /(明日计划|明天计划|下一步|计划|TODO|Top ?3|明日)/i
};

/**
 * 保存日志内容到指定文件
 * @param {string} filePath - 文件路径
 * @param {string} content - 日志内容
 */
async function saveJournal(filePath, content) {
  await fs.ensureFile(filePath); // 确保文件所在目录存在
  await fs.writeFile(filePath, content, 'utf8');
}

function countBy(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item, (map.get(item) || 0) + 1);
  }
  return map;
}

function topFromMap(map, limit = 8) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function uniqueLines(lines, limit = 8) {
  const seen = new Set();
  const result = [];
  for (const line of lines) {
    const key = line.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length >= limit) break;
  }
  return result;
}

function extractJournalSignals(logContent) {
  const content = (logContent || '').trim();
  const tags = [];
  const tagRegex = /#([\u4e00-\u9fa5A-Za-z0-9_-]{1,20})/g;
  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    tags.push(match[1].toLowerCase());
  }

  const keywordCandidates = (content.match(/[\u4e00-\u9fa5]{2,8}|[A-Za-z][A-Za-z0-9_-]{2,20}/g) || [])
    .map((w) => w.toLowerCase())
    .filter((w) => !KEYWORD_STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const keywordCounts = countBy(keywordCandidates);
  const keywords = topFromMap(keywordCounts, 12).map((k) => k.name);

  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('# ') && !line.startsWith('*记录时间'));

  const painPoints = lines.filter((line) => SIGNAL_PATTERNS.pain.test(line));
  const wins = lines.filter((line) => SIGNAL_PATTERNS.win.test(line));
  const plans = lines.filter((line) => SIGNAL_PATTERNS.plan.test(line));
  const keySentences = uniqueLines([...wins, ...painPoints, ...plans, ...lines], 10);

  return {
    tags: Array.from(new Set(tags)),
    keywords,
    painPoints: uniqueLines(painPoints, 6),
    wins: uniqueLines(wins, 6),
    plans: uniqueLines(plans, 6),
    keySentences
  };
}

function aggregatePeriodSignals(entries) {
  const tags = [];
  const keywords = [];
  const painPoints = [];
  const wins = [];
  const plans = [];
  const highlights = [];

  for (const entry of entries) {
    const signal = extractJournalSignals(entry.content);
    tags.push(...signal.tags);
    keywords.push(...signal.keywords);
    painPoints.push(...signal.painPoints.map((item) => `[${entry.date}] ${item}`));
    wins.push(...signal.wins.map((item) => `[${entry.date}] ${item}`));
    plans.push(...signal.plans.map((item) => `[${entry.date}] ${item}`));
    highlights.push(...signal.keySentences.map((item) => `[${entry.date}] ${item}`));
  }

  return {
    logCount: entries.length,
    sourceDates: entries.map((e) => e.date),
    topTags: topFromMap(countBy(tags), 8),
    topKeywords: topFromMap(countBy(keywords), 10),
    painPoints: uniqueLines(painPoints, 8),
    wins: uniqueLines(wins, 8),
    plans: uniqueLines(plans, 8),
    highlights: uniqueLines(highlights, 12)
  };
}

function buildSummaryPrompt(period, stats, periodRangeText) {
  const periodLabel = period === 'weekly' ? '周总结' : '月总结';
  return [
    '你是学习复盘助手。请严格基于给定统计与摘录写总结，不要编造未出现的事实。',
    `总结类型：${periodLabel}`,
    `时间范围：${periodRangeText}`,
    `覆盖日志日期：${stats.sourceDates.join(', ') || '无'}`,
    '',
    '【输入数据(JSON)】',
    JSON.stringify(stats, null, 2),
    '',
    '【输出目标】',
    `请用中文 markdown 写一份${periodLabel}，严格分为三大部分，顺序固定：`,
    '1. 「这一段时间我实际做了什么」—— 3~6 条可验证的具体事件；',
    '2. 「从这些事情里的收获与感悟」—— 3~5 条反思，每条都指向上面某一件事；',
    '3. 「接下来要做的具体计划」—— 3~5 条可执行的行动计划。',
    '',
    '【第一部分：这一段时间我实际做了什么】',
    '- 用小标题「这一段时间我实际做了什么」。',
    '- 输出 3~6 条 bullet，每条前面必须带日期标签，例如 `[2026-03-31]`，日期必须来自输入数据中的 `sourceDates`。',
    '- 每条描述一件具体的、可验证的事情（如完成的任务、调通的功能、关键尝试），不要写成「持续学习」「坚持记录」这种抽象口号。',
    '',
    '【第二部分：从这些事情里的收获与感悟】',
    '- 用小标题「从这些事情里的收获与感悟」。',
    '- 输出 3~5 条 bullet，每条都要明确说明「来自哪一天/哪件事」，可以用 `[来源：YYYY-MM-DD 某事件] —— 结论` 形式。',
    '- 内容侧重方法、认知、节奏、情绪等层面的变化，不要重复叙述事实本身。',
    '- 尽量避免空洞句式，如「让我意识到」「让我明白」后面仍要给出具体、可操作的认识。',
    '',
    '【第三部分：接下来要做的具体计划】',
    '- 用小标题「接下来要做的具体计划」。',
    '- 输出 3~5 条 bullet，每条写清楚：要做的动作 + 频率/时长 + 完成标准，例如「下周至少 2 次，每次 1 小时的……，完成标准是……」。',
    '- 至少有 1 条是「延续一个已经在做且值得保留的习惯」，至少有 1 条是「针对上面暴露的问题给出的具体改进方案」。',
    '- 禁止只写「继续保持」「持续优化」「不断精进」这类没有动作细节的口号。',
    '',
    '【写作风格要求】',
    '- 语气自然、偏口语、简洁，像给自己写复盘，不要像给别人写汇报。',
    '- 每条 bullet 控制在 1~2 句内，避免长段落堆砌形容词。',
    '- 尽量引用输入 JSON 中的日期、关键词或关键句，不要编造未出现的事实。',
    '- 不要输出任何 JSON 或代码块，只输出 markdown 标题与正文。',
  ].join('\\n');
}

async function tryGenerateByGateway(prompt) {
  const endpoint = process.env.OPENCLAW_SUMMARY_ENDPOINT || 'http://127.0.0.1:18789/v1/chat/completions';
  const backendModel = process.env.OPENCLAW_SUMMARY_MODEL;
  if (!backendModel) {
    throw new Error('OPENCLAW_SUMMARY_MODEL 未配置');
  }
  const agentModel = process.env.OPENCLAW_SUMMARY_GATEWAY_MODEL || 'openclaw/default';
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    headers.Authorization = `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN}`;
  }
  headers['x-openclaw-model'] = backendModel;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: agentModel,
      messages: [
        { role: 'system', content: '你是学习日志总结助手。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    })
  });
  const raw = await resp.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `gateway 返回非 JSON（HTTP ${resp.status}）：${raw.slice(0, 240)}`
    );
  }
  if (!resp.ok) {
    const errMsg =
      (typeof data?.error === 'string' ? data.error : data?.error?.message) ||
      data?.message ||
      raw.slice(0, 400);
    throw new Error(`gateway 调用失败: ${resp.status} — ${errMsg}`);
  }
  const text = (
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    ''
  ).trim();
  if (!text) {
    throw new Error(
      `gateway 返回为空（请检查模型与网关是否匹配）。响应键：${Object.keys(data).join(', ')}`
    );
  }
  return text;
}

async function tryGenerateByCli(prompt) {
  const command = process.env.OPENCLAW_SUMMARY_COMMAND;
  if (!command) {
    throw new Error('OPENCLAW_SUMMARY_COMMAND 未配置');
  }
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  if (parts.length === 0) {
    throw new Error('OPENCLAW_SUMMARY_COMMAND 无效');
  }
  const bin = parts[0].replace(/^"|"$/g, '');
  const args = parts.slice(1).map((p) => p.replace(/^"|"$/g, ''));
  const { stdout } = await execFileAsync(bin, [...args, prompt], { maxBuffer: 1024 * 1024 });
  const text = (stdout || '').trim();
  if (!text) {
    throw new Error('CLI 返回为空');
  }
  return text;
}

function buildRuleBasedSummary(periodTitle, periodRangeText, stats, aiError) {
  const topKeywordText = stats.topKeywords.length > 0
    ? stats.topKeywords.map((k) => `${k.name}(${k.count})`).join('、')
    : '暂无明显关键词';
  const topTagText = stats.topTags.length > 0
    ? stats.topTags.map((k) => `#${k.name}(${k.count})`).join('、')
    : '暂无标签';
  const winsText = stats.wins.length > 0 ? stats.wins.map((line) => `- ${line}`).join('\n') : '- 暂无明确高光记录';
  const painText = stats.painPoints.length > 0 ? stats.painPoints.map((line) => `- ${line}`).join('\n') : '- 暂无明确问题记录';
  const planText = stats.plans.length > 0 ? stats.plans.map((line) => `- ${line}`).join('\n') : '- 下期建议补充“明日计划/下一步”段落';

  return `
# ${periodTitle}（${periodRangeText}）

## 本期概览
- 覆盖日志：${stats.logCount} 篇
- 涉及日期：${stats.sourceDates.join('、') || '无'}
- 关键词趋势：${topKeywordText}
- 标签趋势：${topTagText}

## 核心收获
${winsText}

## 主要问题与根因
${painText}

## 下期可执行计划
${planText}

## 生成说明
- 当前为规则化自动汇总。
  `.trim();
}

async function generateAISummary(period, payload) {
  try {
    const summary = await tryGenerateByGateway(payload.prompt);
    return { content: summary, usedAI: true, provider: 'gateway' };
  } catch (gatewayErr) {
    console.warn(`[learning-journal] 周/月总结：网关失败 → ${gatewayErr.message}`);
    try {
      const summary = await tryGenerateByCli(payload.prompt);
      return { content: summary, usedAI: true, provider: 'cli' };
    } catch (cliErr) {
      console.warn(`[learning-journal] 周/月总结：CLI 失败 → ${cliErr.message}`);
      const reason = `${gatewayErr.message}; ${cliErr.message}`;
      return {
        content: buildRuleBasedSummary(payload.periodTitle, payload.periodRangeText, payload.stats, reason),
        usedAI: false,
        provider: 'fallback',
        error: reason
      };
    }
  }
}

async function collectEntries(basePath, start, end) {
  const dailyDir = path.join(basePath, 'daily');
  if (!await fs.pathExists(dailyDir)) return [];
  const files = await fs.readdir(dailyDir);
  const entries = [];
  for (const fileName of files) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(fileName)) continue;
    const dateStr = fileName.replace('.md', '');
    const m = moment(dateStr, 'YYYY-MM-DD', true);
    if (!m.isValid()) continue;
    if (m.isBefore(start, 'day') || m.isAfter(end, 'day')) continue;
    const fullPath = path.join(dailyDir, fileName);
    const content = await fs.readFile(fullPath, 'utf8');
    entries.push({ date: dateStr, content });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries.slice(-MAX_CONTEXT_LOGS);
}

async function generatePeriodSummaryDraft(basePath, period) {
  const isWeekly = period === 'weekly';
  const start = isWeekly ? moment().startOf('week') : moment().startOf('month');
  const end = isWeekly ? moment().endOf('week') : moment().endOf('month');
  const periodRangeText = `${start.format('YYYY-MM-DD')} ~ ${end.format('YYYY-MM-DD')}`;
  const periodTitle = isWeekly
    ? `学习周总结 ${start.format('GGGG-[W]WW')}`
    : `学习月总结 ${start.format('YYYY-MM')}`;
  const periodKey = isWeekly ? start.format('GGGG-[W]WW') : start.format('YYYY-MM');

  const entries = await collectEntries(basePath, start, end);
  const stats = aggregatePeriodSignals(entries);
  const prompt = buildSummaryPrompt(period, stats, periodRangeText);
  const generated = await generateAISummary(period, {
    prompt,
    stats,
    periodTitle,
    periodRangeText
  });

  const content = `
# ${periodTitle}
周期：${periodRangeText}
来源日期：${stats.sourceDates.join(', ') || '无'}

${generated.content}
  `.trim();

  return {
    periodType: period,
    periodKey,
    periodTitle,
    periodRangeText,
    sourceDates: stats.sourceDates,
    stats,
    usedAI: generated.usedAI,
    provider: generated.provider,
    error: generated.error,
    content
  };
}

/**
 * 生成周学习总结
 * @param {string} basePath - 日志根目录
 * @returns {string} 周总结内容
 */
async function generateWeeklySummary(basePath) {
  const draft = await generatePeriodSummaryDraft(basePath, 'weekly');
  return draft.content;
}

/**
 * 生成月学习总结
 * @param {string} basePath - 日志根目录
 * @returns {string} 月总结内容
 */
async function generateMonthlySummary(basePath) {
  const draft = await generatePeriodSummaryDraft(basePath, 'monthly');
  return draft.content;
}

/**
 * 从最近几天日志中提取“今日学习计划”内容
 * 优先提取“明日计划/计划/Top 3”段落，找不到则回退到最近日志摘要
 * @param {string} basePath - 日志根目录
 * @param {number} lookbackDays - 回溯天数，默认7天
 * @returns {string} 今日计划正文
 */
async function generateTodayPlanFromRecentLogs(basePath, lookbackDays = 7) {
  const dailyDir = path.join(basePath, 'daily');
  const today = moment().format('YYYY-MM-DD');

  if (!await fs.pathExists(dailyDir)) {
    return `
🗓 今日学习计划（${today}）

还没找到历史日志，先用轻量计划启动今天：
1. 先完成 1 个最重要学习任务（30-60 分钟）
2. 记录 1 个卡点和 1 个解决动作
3. 晚上用 5 分钟做复盘并写下明日计划
    `.trim();
  }

  const files = await fs.readdir(dailyDir);
  const datedLogs = files
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort()
    .reverse();

  const recentLogs = [];
  for (const fileName of datedLogs) {
    const dateStr = fileName.replace('.md', '');
    const diff = moment(today).diff(moment(dateStr), 'days');
    if (diff < 0 || diff > lookbackDays) continue;

    const fullPath = path.join(dailyDir, fileName);
    const content = await fs.readFile(fullPath, 'utf8');
    recentLogs.push({ date: dateStr, content });
  }

  if (recentLogs.length === 0) {
    return `
🗓 今日学习计划（${today}）

最近几天还没有可参考日志，建议先执行：
1. 选定 1 个核心主题，学习 45 分钟
2. 输出 1 份简短笔记（不少于 5 行）
3. 晚上补一条学习日志，沉淀明日计划
    `.trim();
  }

  const planSectionRegex = /(?:^|\n)(?:#+\s*)?(?:明日计划|明天计划|计划|Top ?3|TODO)[^\n]*\n([\s\S]*?)(?=\n(?:#+\s*[^\n]+|[-=]{3,}|$))/i;

  let extractedPlan = '';
  let sourceDate = '';
  for (const log of recentLogs) {
    const matched = log.content.match(planSectionRegex);
    if (matched && matched[1] && matched[1].trim()) {
      extractedPlan = matched[1].trim();
      sourceDate = log.date;
      break;
    }
  }

  if (!extractedPlan) {
    const latestLog = recentLogs[0];
    sourceDate = latestLog.date;
    const lines = latestLog.content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('*'))
      .slice(0, 3);
    extractedPlan = lines.length > 0
      ? lines.map((line, idx) => `${idx + 1}. ${line}`).join('\n')
      : '1. 完成一个最重要学习任务\n2. 记录关键收获与卡点\n3. 产出明日计划 Top 3';
  }

  return `
🗓 今日学习计划（${today}）
参考来源：${sourceDate} 日志

${extractedPlan}

提示：如果今天任务有变化，完成后请在晚间日志里更新“明日计划”段落。
  `.trim();
}

// 导出工具函数
module.exports = {
  saveJournal,
  extractJournalSignals,
  aggregatePeriodSignals,
  buildSummaryPrompt,
  tryGenerateByGateway,
  generateAISummary,
  generatePeriodSummaryDraft,
  generateWeeklySummary,
  generateMonthlySummary,
  generateTodayPlanFromRecentLogs
};