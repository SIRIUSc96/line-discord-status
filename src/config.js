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
  // 名前を変更する対象VCのチャンネルID（1箇所で管理）
  targetVoiceChannelId: process.env.TARGET_VC_ID || '1558922691132792832',

  // ゲーム一覧（1行足すだけで簡単に追加できます）
  games: [
    '雑談中',
    '作業中',
    'TRPG中',
    'Amang US中',
    'PUBG:BATTLEGROUNDS中',
    'MineCraft中',
    'Terraria中',
    'ARK:Survival Evolved中',
    "Sid Meier's Civilization VI中",
    'Overwatch中',
    'ボードゲームアリーナ中',
    'お絵かきの森中',
    'ガーティックフォン中',
    'GOD field中',
    'Dead by Daylight中',
    'Grand Theft Auto V中',
    'OMEGA STRIKERS中',
    'ミメシス中',
    'Unspottable中',
    'Gang Beasts中',
    'Pummel Party中',
    'R.E.P.O中',
    'Windrose中',
    'ApexLegends中',
    'モンハン中',
    'ドンスタ中',
    'BOMBANANA!中',
    'マーベルライバルズ中',
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
