#!/usr/bin/env node
/**
 * 本地预览周/月总结生成结果（不写文件、不发邮件、不启动 cron）。
 * 用法：
 *   npm run preview:summary -- weekly
 *   npm run preview:summary -- monthly
 */
require('dotenv').config();
const path = require('path');
const { generatePeriodSummaryDraft } = require('./utils');

const period = process.argv[2] === 'monthly' ? 'monthly' : 'weekly';
const journalPath =
  process.env.JOURNAL_PATH ||
  path.resolve(__dirname, '../../memory/learning-journal');

(async () => {
  try {
    const d = await generatePeriodSummaryDraft(journalPath, period);
    console.log('周期:', period, '| usedAI:', d.usedAI, '| provider:', d.provider);
    if (d.error) console.log('降级原因:', d.error);
    console.log('\n--- 正文前 800 字 ---\n');
    console.log(d.content.slice(0, 800) + (d.content.length > 800 ? '…' : ''));
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
