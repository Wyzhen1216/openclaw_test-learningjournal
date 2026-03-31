//引入dotenv包
require('dotenv').config();
// 引入依赖
const nodemailer = require('nodemailer');
const fs = require('fs-extra');
const moment = require('moment');
const cron = require('node-cron');
const path = require('path');
const {
  saveJournal,
  generateWeeklySummary,
  generateMonthlySummary,
  generateTodayPlanFromRecentLogs,
  generatePeriodSummaryDraft
} = require('./utils');
const {
  setDraft,
  getDraft,
  clearDraft,
  setSummaryDraft,
  getSummaryDraft,
  clearSummaryDraft
} = require('./state-store');

// 从 OpenClaw 环境变量读取 QQ 邮箱配置
const EMAIL_USER = process.env.EMAIL_USER;      // 你的 QQ 邮箱
const EMAIL_PASS = process.env.EMAIL_PASS;      // QQ 邮箱授权码
const TO_EMAIL = process.env.TO_EMAIL || EMAIL_USER;  // 接收邮件的邮箱（默认发给自己）
const JOURNAL_PATH = process.env.JOURNAL_PATH || path.resolve(__dirname, '../../memory/learning-journal');

// 初始化 QQ 邮箱发送器（固定配置，不用改）
const transporter = nodemailer.createTransport({
  service: 'qq',
  port: 465,
  secure: true,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

// 通用发送邮件函数
async function sendEmail(subject, content) {
  try {
    await transporter.sendMail({
      from: `"学习日志助手" <${EMAIL_USER}>`,
      to: TO_EMAIL,
      subject: subject,
      text: content
    });
    console.log(`✅ 邮件发送成功：${subject}`);
  } catch (error) {
    console.error(`❌ 邮件发送失败：${error.message}`);
  }
}

// 每日学习提醒（晚上 8 点触发）
function sendDailyLearningPrompt() {
  const promptContent = `
🌙 晚间学习签到 - ${moment().format('YYYY-MM-DD')}
花5分钟反思你的一天：

1️⃣ 你今天学到了什么？（新技能/知识点/见解）
2️⃣ 是什么挑战了你？（遇到的困难/卡点）
3️⃣ 你引以为豪的是什么？（进步/成就/小胜利）
4️⃣ 你明天会做什么不同的事情？（改进/计划）

提示：每个问题写2-3句话就够啦！
  `;
  sendEmail('📝 今日学习提醒', promptContent);
}

// 每日学习计划推送（上午 9 点触发）
async function sendTodayLearningPlan() {
  const planContent = await generateTodayPlanFromRecentLogs(JOURNAL_PATH, 7);
  sendEmail('🎯 今日学习计划', planContent);
}

function getSummaryPaths(periodType, periodKey) {
  const prefix = periodType === 'weekly' ? 'weekly' : 'monthly';
  return {
    draftPath: `${JOURNAL_PATH}/summaries/draft/${prefix}-${periodKey}.draft.md`,
    finalPath: `${JOURNAL_PATH}/summaries/final/${prefix}-${periodKey}.md`
  };
}

// 直接生成周/月总结：保存正式文件并发送邮件（不走草稿）
async function generateAndSendFinalSummary(periodType) {
  const draft = await generatePeriodSummaryDraft(JOURNAL_PATH, periodType);
  const { finalPath } = getSummaryPaths(periodType, draft.periodKey);
  await fs.ensureDir(`${JOURNAL_PATH}/summaries/final/`);
  await saveJournal(finalPath, draft.content);

  const subject = periodType === 'weekly' ? '📊 本周学习总结' : '📅 本月学习总结';
  await sendEmail(subject, `${draft.content}\n\n已保存到：${finalPath}`);
  return `${periodType === 'weekly' ? '周' : '月'}总结已生成并发送：${finalPath}`;
}

// 保存学习日志到文件（暴露给 OpenClaw 调用）
async function saveLearningJournal(content) {
  try {
    const today = moment().format('YYYY-MM-DD');
    const logFilePath = `${JOURNAL_PATH}/daily/${today}.md`;
    const logContent = `# 学习日志 - ${today}\n\n${content}\n\n*记录时间：${moment().format('HH:mm:ss')}*`;
    
    // 确保目录存在并保存文件
    await fs.ensureDir(`${JOURNAL_PATH}/daily/`);
    await saveJournal(logFilePath, logContent);
    
    // 等待邮件发送完成，避免调用结束过快导致邮件未真正发出
    await sendEmail('✅ 学习日志已保存', `你的今日学习日志已保存到：\n${logFilePath}\n\n完整内容：\n${content}`);
    return `日志保存成功！路径：${logFilePath}`;
  } catch (error) {
    console.error(`❌ 保存日志失败：${error.message}`);
    return `保存失败：${error.message}`;
  }
}

// 交互式流程：创建日志草稿（先不落盘、不发邮件）
async function createLearningJournalDraft(content) {
  if (!content || !content.trim()) {
    return '草稿内容为空，请先提供学习日志内容。';
  }
  await setDraft(content.trim());
  return `草稿已保存，可继续编辑。\n\n当前草稿预览：\n${content.trim().substring(0, 300)}${content.trim().length > 300 ? '...' : ''}\n\n如需保存并发送，请明确回复“同意保存”。`;
}

// 交互式流程：编辑日志草稿
async function editLearningJournalDraft(content) {
  const draft = await getDraft();
  if (!draft) {
    return '当前没有可编辑草稿，请先创建草稿。';
  }
  if (!content || !content.trim()) {
    return '新草稿内容为空，请提供修改后的日志内容。';
  }
  await setDraft(content.trim());
  return `草稿已更新。\n\n最新草稿预览：\n${content.trim().substring(0, 300)}${content.trim().length > 300 ? '...' : ''}\n\n确认无误后请回复“同意保存”。`;
}

// 交互式流程：查看当前草稿
async function previewLearningJournalDraft() {
  const draft = await getDraft();
  if (!draft) {
    return '当前没有待确认草稿。';
  }
  return `当前草稿（更新时间：${draft.updatedAt}）：\n\n${draft.content}`;
}

// 交互式流程：用户同意后再保存并发送
async function confirmAndSaveLearningJournal() {
  try {
    const draft = await getDraft();
    if (!draft || !draft.content) {
      return '当前没有待确认草稿，请先创建或编辑草稿。';
    }

    const today = moment().format('YYYY-MM-DD');
    const logFilePath = `${JOURNAL_PATH}/daily/${today}.md`;
    const logContent = `# 学习日志 - ${today}\n\n${draft.content}\n\n*记录时间：${moment().format('HH:mm:ss')}*`;

    await fs.ensureDir(`${JOURNAL_PATH}/daily/`);
    await saveJournal(logFilePath, logContent);

    await sendEmail(
      '✅ 学习日志已保存',
      `你的学习日志已确认保存到：\n${logFilePath}\n\n完整内容：\n${draft.content}`
    );
    await clearDraft();
    return `日志已确认保存并发送邮件，路径：${logFilePath}`;
  } catch (error) {
    console.error(`❌ 确认保存失败：${error.message}`);
    return `确认保存失败：${error.message}`;
  }
}

// 交互式流程：放弃草稿
async function discardLearningJournalDraft() {
  const draft = await getDraft();
  if (!draft) {
    return '当前没有待丢弃草稿。';
  }
  await clearDraft();
  return '已取消并清空当前草稿。';
}

// 交互式流程：生成周总结草稿（先不落正式文件）
async function createWeeklySummaryDraft() {
  try {
    const draft = await generatePeriodSummaryDraft(JOURNAL_PATH, 'weekly');
    const { draftPath } = getSummaryPaths('weekly', draft.periodKey);
    await fs.ensureDir(`${JOURNAL_PATH}/summaries/draft/`);
    await saveJournal(draftPath, draft.content);
    await setSummaryDraft(draft);
    return `周总结草稿已生成：${draftPath}\n\n${draft.content}\n\n可调用 previewSummaryDraft() 预览，确认后调用 confirmAndSaveSummaryDraft()。`;
  } catch (error) {
    console.error(`❌ 生成周总结草稿失败：${error.message}`);
    return `生成周总结草稿失败：${error.message}`;
  }
}

// 交互式流程：生成月总结草稿（先不落正式文件）
async function createMonthlySummaryDraft() {
  try {
    const draft = await generatePeriodSummaryDraft(JOURNAL_PATH, 'monthly');
    const { draftPath } = getSummaryPaths('monthly', draft.periodKey);
    await fs.ensureDir(`${JOURNAL_PATH}/summaries/draft/`);
    await saveJournal(draftPath, draft.content);
    await setSummaryDraft(draft);
    return `月总结草稿已生成：${draftPath}\n\n${draft.content}\n\n可调用 previewSummaryDraft() 预览，确认后调用 confirmAndSaveSummaryDraft()。`;
  } catch (error) {
    console.error(`❌ 生成月总结草稿失败：${error.message}`);
    return `生成月总结草稿失败：${error.message}`;
  }
}

// 交互式流程：查看当前总结草稿
async function previewSummaryDraft() {
  const draft = await getSummaryDraft();
  if (!draft) {
    return '当前没有待确认的周/月总结草稿。';
  }
  return `当前总结草稿（${draft.periodType}-${draft.periodKey}，更新时间：${draft.updatedAt}）：\n\n${draft.content}`;
}

// 交互式流程：编辑当前总结草稿
async function editSummaryDraft(content) {
  const draft = await getSummaryDraft();
  if (!draft) {
    return '当前没有可编辑的周/月总结草稿，请先创建草稿。';
  }
  if (!content || !content.trim()) {
    return '新草稿内容为空，请提供修改后的总结内容。';
  }
  await setSummaryDraft({
    ...draft,
    content: content.trim()
  });
  return '总结草稿已更新。确认后请调用 confirmAndSaveSummaryDraft()。';
}

// 交互式流程：确认保存当前总结草稿
async function confirmAndSaveSummaryDraft() {
  try {
    const draft = await getSummaryDraft();
    if (!draft || !draft.content) {
      return '当前没有待确认的周/月总结草稿。';
    }
    const { draftPath, finalPath } = getSummaryPaths(draft.periodType, draft.periodKey);
    await fs.ensureDir(`${JOURNAL_PATH}/summaries/draft/`);
    await fs.ensureDir(`${JOURNAL_PATH}/summaries/final/`);
    await saveJournal(draftPath, draft.content);
    await saveJournal(finalPath, draft.content);

    await sendEmail(
      `✅ ${draft.periodType === 'weekly' ? '周' : '月'}总结已确认保存`,
      `已确认保存总结：\n${finalPath}\n\n来源日期：${(draft.sourceDates || []).join(', ') || '无'}\n生成方式：${draft.usedAI ? `AI(${draft.provider})` : '规则降级'}`
    );
    await clearSummaryDraft();
    return `总结已确认保存并发送邮件：${finalPath}`;
  } catch (error) {
    console.error(`❌ 确认保存总结失败：${error.message}`);
    return `确认保存总结失败：${error.message}`;
  }
}

// 交互式流程：放弃当前总结草稿
async function discardSummaryDraft() {
  const draft = await getSummaryDraft();
  if (!draft) {
    return '当前没有待丢弃的周/月总结草稿。';
  }
  await clearSummaryDraft();
  return '已取消并清空当前周/月总结草稿。';
}

// 定时任务配置
// 1. 每日 09:00 发送今日学习计划
cron.schedule('0 9 * * *', sendTodayLearningPlan);

// 2. 每日 20:00 发送学习提醒
cron.schedule('0 20 * * *', sendDailyLearningPrompt);

// 3. 每周日 19:00 直接生成并发送周总结（正式文件）
cron.schedule('0 19 * * 0', async () => {
  try {
    const result = await generateAndSendFinalSummary('weekly');
    console.log(`✅ ${result}`);
  } catch (error) {
    console.error(`❌ 周总结自动发送失败：${error.message}`);
  }
});

// 4. 每月最后一天 20:00 直接生成并发送月总结（正式文件）
cron.schedule('0 20 28-31 * *', async () => {
  if (moment().date() === moment().daysInMonth()) {
    try {
      const result = await generateAndSendFinalSummary('monthly');
      console.log(`✅ ${result}`);
    } catch (error) {
      console.error(`❌ 月总结自动发送失败：${error.message}`);
    }
  }
});

// 暴露函数给 OpenClaw 调用
module.exports = {
  saveLearningJournal,
  createWeeklySummaryDraft,
  createMonthlySummaryDraft,
  previewSummaryDraft,
  editSummaryDraft,
  confirmAndSaveSummaryDraft,
  discardSummaryDraft,
  generateWeeklySummary,
  generateMonthlySummary,
  createLearningJournalDraft,
  editLearningJournalDraft,
  previewLearningJournalDraft,
  confirmAndSaveLearningJournal,
  discardLearningJournalDraft,
  sendDailyLearningPrompt,
  sendTodayLearningPlan
};

// 启动提示
console.log('✅ 学习日志技能（QQ邮箱版）已启动！');
console.log(`📧 配置的发送邮箱：${EMAIL_USER}`);
console.log(`📂 日志保存路径：${JOURNAL_PATH}`);