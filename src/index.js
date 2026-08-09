const express = require('express');
const config = require('./config');
const StatusManager = require('./statusManager');
const DiscordBot = require('./discordBot');
const { createLineHandler, sendLinePush } = require('./lineHandler');

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🎮 LINE → Discord 通話ステータスボード     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // --- コンポーネント初期化 ---
  const statusManager = new StatusManager(config);
  const discordBot = new DiscordBot(config);

  // VCに誰かが入室した時の処理 (LINEへPush通知)
  discordBot.onVoiceJoin(async (memberName, channelName) => {
    const activeUsers = statusManager.getActiveUsers();
    if (activeUsers.length === 0) return;

    // ステータスがONになっている全ユーザーのIDを取得
    const userIds = activeUsers.map(u => u.userId);
    const text = `🎙️ 【Discord入室通知】\n${memberName} がボイスチャット「${channelName}」に入室しました！`;

    console.log(`LINEへPush通知を送信します: 対象 ${userIds.length} 人`);
    await sendLinePush(config.line.channelAccessToken, userIds, text);
  });

  // Discord Bot 起動
  try {
    await discordBot.start();
  } catch (e) {
    console.error('❌ Discord Bot の起動に失敗:', e.message);
    console.error('   DISCORD_BOT_TOKEN と DISCORD_CHANNEL_ID を確認してください');
    process.exit(1);
  }

  // 起動時に既存のアクティブユーザーで Embed を更新
  const activeOnStart = statusManager.getActiveUsers();
  if (activeOnStart.length > 0) {
    await discordBot.updateEmbed(activeOnStart);
    console.log(`📋 ${activeOnStart.length} 人のアクティブユーザーを復元`);
  }

  // --- Express サーバー ---
  const app = express();

  // LINE Webhook エンドポイント
  // express.json() の verify コールバックで rawBody を保存（署名検証用）
  app.post(
    '/webhook',
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString();
      },
    }),
    createLineHandler(config, statusManager, discordBot)
  );

  // ヘルスチェック
  app.get('/', (_req, res) => {
    const activeUsers = statusManager.getActiveUsers();
    res.json({
      status: 'ok',
      service: 'LINE → Discord ステータスボード',
      activeUsers: activeUsers.length,
      uptime: Math.floor(process.uptime()),
    });
  });

  // --- 自動タイムアウトチェック（1分ごと） ---
  setInterval(async () => {
    const expired = statusManager.checkTimeouts();
    if (expired.length > 0) {
      const names = expired.map((u) => u.displayName).join(', ');
      console.log(`⏰ タイムアウト: ${names}`);
      const activeUsers = statusManager.getActiveUsers();
      await discordBot.updateEmbed(activeUsers);
    }
  }, 60 * 1000);

  // --- サーバー起動 ---
  app.listen(config.port, () => {
    console.log('');
    console.log('✅ サーバー起動完了！');
    console.log(`   📌 URL: http://localhost:${config.port}`);
    console.log(`   📌 Webhook: http://localhost:${config.port}/webhook`);
    console.log(`   ⏰ 自動タイムアウト: ${config.statusTimeoutHours}時間`);
    console.log(`   🔔 通知ウィンドウ: ${config.notifyWindowMinutes}分`);
    console.log('');
    console.log('📖 使い方:');
    console.log('   1. LINE Bot にスタンプを送る → Discord にステータス表示');
    console.log('   2. 1時間以内にもう1つ送る   → @here で通知');
    console.log('   3. さらに2つ送る（計4個）   → ステータス取り消し');
    console.log('');
  });
}

// --- エラーハンドリング ---
process.on('unhandledRejection', (error) => {
  console.error('未処理の非同期エラー:', error);
});

main().catch((e) => {
  console.error('❌ 起動エラー:', e);
  process.exit(1);
});
