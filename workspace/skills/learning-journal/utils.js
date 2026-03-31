const fs = require('fs-extra');
const moment = require('moment');
const path = require('path');

/**
 * 保存日志内容到指定文件
 * @param {string} filePath - 文件路径
 * @param {string} content - 日志内容
 */
async function saveJournal(filePath, content) {
  await fs.ensureFile(filePath); // 确保文件所在目录存在
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * 生成周学习总结
 * @param {string} basePath - 日志根目录
 * @returns {string} 周总结内容
 */
async function generateWeeklySummary(basePath) {
  const weekStart = moment().startOf('week');
  let learningDays = 0;
  let allContent = [];

  // 遍历本周7天的日志
  for (let i = 0; i < 7; i++) {
    const day = weekStart.clone().add(i, 'days');
    const dayPath = `${basePath}/daily/${day.format('YYYY-MM-DD')}.md`;
    
    if (await fs.pathExists(dayPath)) {
      learningDays++;
      const dayContent = await fs.readFile(dayPath, 'utf8');
      allContent.push({ date: day.format('MM-DD'), content: dayContent });
    }
  }

  // 拼接周总结
  return `
📊 本周学习总结（${weekStart.format('MM-DD')} ~ ${moment().endOf('week').format('MM-DD')}）

📈 学习数据：
- 本周学习天数：${learningDays} 天
- 累计记录日志：${allContent.length} 篇

💡 核心收获：
${learningDays > 0 ? '- 你本周坚持了' + learningDays + '天学习，继续保持！' : '- 本周暂无学习记录，下周加油！'}

🏆 高光时刻：
${learningDays > 0 ? '- 回顾本周，你最有成就感的是：（请补充）' : '- 期待下周你的精彩记录！'}

🎯 下周建议：
- 保持每日记录的习惯
- 聚焦1-2个核心学习目标
- 遇到问题及时记录，方便复盘
  `.trim();
}

/**
 * 生成月学习总结
 * @param {string} basePath - 日志根目录
 * @returns {string} 月总结内容
 */
async function generateMonthlySummary(basePath) {
  const monthStart = moment().startOf('month');
  const daysInMonth = moment().daysInMonth();
  let learningDays = 0;

  // 遍历本月所有天数的日志
  for (let i = 0; i < daysInMonth; i++) {
    const day = monthStart.clone().add(i, 'days');
    const dayPath = `${basePath}/daily/${day.format('YYYY-MM-DD')}.md`;
    
    if (await fs.pathExists(dayPath)) {
      learningDays++;
    }
  }

  // 拼接月总结
  return `
📅 本月学习反思（${monthStart.format('YYYY-MM')}）

📈 月度数据：
- 本月总天数：${daysInMonth} 天
- 学习记录天数：${learningDays} 天
- 完成率：${((learningDays / daysInMonth) * 100).toFixed(1)}%

🔑 核心发现：
${learningDays > 0 
  ? `- 你本月最专注的学习领域是：（请补充）
- 你遇到的最大挑战是：（请补充）
- 你最大的进步是：（请补充）` 
  : '- 本月暂无学习记录，建议下月制定小目标开始！'}

💡 下月计划：
- 设定1-3个核心学习目标
- 保持每周至少4天的记录频率
- 定期复盘，优化学习方法
  `.trim();
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
  generateWeeklySummary,
  generateMonthlySummary,
  generateTodayPlanFromRecentLogs
};