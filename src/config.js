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

  // --- ゲーム選択パネル設定 ---
  // 名前を変更する対象VCのチャンネルID（1箇所で管理。後からIDを貼り替えてください）
  targetVoiceChannelId: process.env.TARGET_VC_ID || '123456789012345678',

  // ゲーム一覧（1行足すだけで簡単に追加できます）
  games: [
    '🟩マイクラ',
    '🏛Civ6',
    '😈ディアブロ4',
    '💬雑談',
  ],
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
