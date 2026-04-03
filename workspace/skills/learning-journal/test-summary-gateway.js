#!/usr/bin/env node
/**
 * 诊断周/月总结用的 OpenClaw 网关是否可达、模型是否生效。
 * 用法：在 skills/learning-journal 目录执行  npm run test:summary-gateway
 */
require('dotenv').config();
const { tryGenerateByGateway } = require('./utils');

(async () => {
  const model = process.env.OPENCLAW_SUMMARY_MODEL;
  const endpoint =
    process.env.OPENCLAW_SUMMARY_ENDPOINT ||
    'http://127.0.0.1:18789/v1/chat/completions';
  console.log('OPENCLAW_SUMMARY_ENDPOINT:', endpoint);
  console.log(
    'OPENCLAW_SUMMARY_MODEL (x-openclaw-model):',
    model || '(未设置，将失败)'
  );
  console.log(
    'OPENCLAW_SUMMARY_GATEWAY_MODEL (body.model):',
    process.env.OPENCLAW_SUMMARY_GATEWAY_MODEL || 'openclaw/default'
  );
  console.log(
    'OPENCLAW_GATEWAY_TOKEN:',
    process.env.OPENCLAW_GATEWAY_TOKEN ? '已设置' : '未设置（若网关要鉴权请配置）'
  );
  console.log('---');
  if (!model) {
    console.error('请在 .env 中设置 OPENCLAW_SUMMARY_MODEL');
    process.exit(1);
  }
  try {
    const text = await tryGenerateByGateway('请只回复一句话：网关连接成功。');
    console.log('成功。模型回复预览：\n', text.slice(0, 800));
  } catch (e) {
    console.error('失败：', e.message);
    console.error(
      '\n常见原因：本机未启动 OpenClaw 网关(18789)、模型 ID 与网关配置不一致、缺少 OPENCLAW_GATEWAY_TOKEN。'
    );
    process.exit(1);
  }
})();
