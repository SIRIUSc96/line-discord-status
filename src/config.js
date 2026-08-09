require('dotenv').config();

const config = {
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  },
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN,
    channelId: process.env.DISCORD_CHANNEL_ID,
  },
  statusTimeoutHours: parseInt(process.env.STATUS_TIMEOUT_HOURS || '1', 10),
  notifyWindowMinutes: parseInt(process.env.NOTIFY_WINDOW_MINUTES || '60', 10),
  port: parseInt(process.env.PORT || '3000', 10),
};

// 必須環境変数のバリデーション
const required = [
  ['LINE_CHANNEL_SECRET', config.line.channelSecret],
  ['LINE_CHANNEL_ACCESS_TOKEN', config.line.channelAccessToken],
  ['DISCORD_BOT_TOKEN', config.discord.botToken],
  ['DISCORD_CHANNEL_ID', config.discord.channelId],
];

const missing = required.filter(([, value]) => !value).map(([name]) => name);

if (missing.length > 0) {
  console.error('❌ 以下の環境変数が設定されていません:');
  missing.forEach((name) => console.error(`   - ${name}`));
  console.error('\n.env.example を .env にコピーして設定してください');
  process.exit(1);
}

module.exports = config;
