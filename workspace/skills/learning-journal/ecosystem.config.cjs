/**
 * PM2 配置：常驻 learning-journal（内含 node-cron 定时邮件）
 * 用法见 package.json 的 pm2:* 脚本
 */
module.exports = {
  apps: [
    {
      name: 'learning-journal',
      script: './learning-journal.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '5s',
      max_memory_restart: '250M',
      // 时间戳前缀，与默认日志目录 ~/.pm2/logs/ 下文件对应
      time: true,
    },
  ],
};
