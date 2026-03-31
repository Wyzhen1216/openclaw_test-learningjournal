const fs = require('fs-extra');
const moment = require('moment');

// 状态文件路径
const STATE_FILE = './learning-journal-state.json';

/**
 * 加载学习日志状态（连续打卡天数等）
 * @returns {object} 状态对象
 */
async function loadState() {
  // 如果状态文件不存在，返回默认状态
  if (!await fs.pathExists(STATE_FILE)) {
    return {
      streak: 0,          // 连续打卡天数
      lastRecordDate: '', // 最后一次记录日期
      totalDays: 0,       // 累计记录天数
      draft: null,        // 待确认的日志草稿
      summaryDraft: null  // 待确认的周/月总结草稿
    };
  }

  // 读取并解析状态文件
  const stateContent = await fs.readFile(STATE_FILE, 'utf8');
  return JSON.parse(stateContent);
}

/**
 * 保存学习日志状态
 * @param {object} state - 要保存的状态对象
 */
async function saveState(state) {
  // 格式化状态内容，方便查看
  const stateContent = JSON.stringify(state, null, 2);
  await fs.writeFile(STATE_FILE, stateContent, 'utf8');
}

/**
 * 更新连续打卡天数（调用 saveJournal 后执行）
 */
async function updateStreak() {
  const state = await loadState();
  const today = moment().format('YYYY-MM-DD');
  const yesterday = moment().subtract(1, 'day').format('YYYY-MM-DD');

  // 如果今天已经记录过，不更新
  if (state.lastRecordDate === today) return;

  // 更新累计天数
  state.totalDays++;

  // 更新连续打卡天数
  if (state.lastRecordDate === yesterday) {
    state.streak++; // 连续打卡，天数+1
  } else if (state.lastRecordDate !== today) {
    state.streak = 1; // 中断后重新开始
  }

  // 更新最后记录日期
  state.lastRecordDate = today;

  // 保存更新后的状态
  await saveState(state);
  console.log(`📊 打卡状态更新：连续${state.streak}天，累计${state.totalDays}天`);
}

/**
 * 保存日志草稿，等待用户确认
 * @param {string} content - 草稿内容
 */
async function setDraft(content) {
  const state = await loadState();
  state.draft = {
    content,
    updatedAt: moment().format('YYYY-MM-DD HH:mm:ss')
  };
  await saveState(state);
}

/**
 * 获取当前日志草稿
 * @returns {object|null} 草稿对象
 */
async function getDraft() {
  const state = await loadState();
  return state.draft || null;
}

/**
 * 清空当前日志草稿
 */
async function clearDraft() {
  const state = await loadState();
  state.draft = null;
  await saveState(state);
}

/**
 * 保存周/月总结草稿，等待用户确认
 * @param {object} draft - 草稿对象
 */
async function setSummaryDraft(draft) {
  const state = await loadState();
  state.summaryDraft = {
    periodType: draft.periodType,
    periodKey: draft.periodKey,
    periodTitle: draft.periodTitle,
    periodRangeText: draft.periodRangeText,
    sourceDates: draft.sourceDates || [],
    content: draft.content || '',
    usedAI: !!draft.usedAI,
    provider: draft.provider || 'unknown',
    updatedAt: moment().format('YYYY-MM-DD HH:mm:ss')
  };
  await saveState(state);
}

/**
 * 获取当前周/月总结草稿
 * @returns {object|null}
 */
async function getSummaryDraft() {
  const state = await loadState();
  return state.summaryDraft || null;
}

/**
 * 清空当前周/月总结草稿
 */
async function clearSummaryDraft() {
  const state = await loadState();
  state.summaryDraft = null;
  await saveState(state);
}

// 导出状态管理函数
module.exports = {
  loadState,
  saveState,
  updateStreak,
  setDraft,
  getDraft,
  clearDraft,
  setSummaryDraft,
  getSummaryDraft,
  clearSummaryDraft
};
