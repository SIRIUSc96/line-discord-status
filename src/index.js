const express = require('express');
const dns = require('dns');
const net = require('net');
const tls = require('tls');

// Render (Linux Node 18+) 環境で Discord Gateway (WSS) 接続がハングアップする問題を解決
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const patchConnectArgs = (args) => {
  if (typeof args[0] === 'object' && args[0] !== null) {
    args[0].family = 4;
  } else if (typeof args[1] === 'object' && args[1] !== null) {
    args[1].family = 4;
  }
};

const origNetConnect = net.connect;
net.connect = function (...args) {
  patchConnectArgs(args);
  return origNetConnect.apply(this, args);
};

const origTlsConnect = tls.connect;
tls.connect = function (...args) {
  patchConnectArgs(args);
  return origTlsConnect.apply(this, args);
};

console.log('🌐 Node.js Net/TLS: IPv4 ソケット接続パッチ適用完了');
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

  // VCに誰かが入室した時の処理 (LINEへPush通知 - 全ユーザーに送信)
  discordBot.onVoiceJoin(async (memberName, channelName) => {
    const allUserIds = statusManager.getAllKnownUserIds();
    if (allUserIds.length === 0) return;

    const text = `🎙️ 【Discord入室通知】\n${memberName} がボイスチャット「${channelName}」に入室しました！`;

    console.log(`LINEへPush通知を送信します: 対象 ${allUserIds.length} 人（全ユーザー）`);
    await sendLinePush(config.line.channelAccessToken, allUserIds, text);
  });

  // --- Express サーバー ---
  const app = express();

  // LINE Webhook エンドポイント
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

  // --- サーバー起動 (Renderのヘルスチェックを通すため最初にListenする) ---
  app.listen(config.port, () => {
    console.log('');
    console.log('✅ サーバー起動完了 (Port Binded)！');
    console.log(`   📌 URL: http://localhost:${config.port}`);
    console.log(`   📌 Webhook: http://localhost:${config.port}/webhook`);
    console.log('');
  });

  // Discord Bot 起動 (非同期で裏で進める)
  console.log('⌛ Discord Bot にログインしています...');
  discordBot.start().then(async () => {
    console.log('✅ Discord Bot 起動完了！');
    // 起動時に既存のアクティブユーザーで Embed を更新
    const activeOnStart = statusManager.getActiveUsers();
    if (activeOnStart.length > 0) {
      await discordBot.updateEmbed(activeOnStart);
      console.log(`📋 ${activeOnStart.length} 人のアクティブユーザーを復元`);
    }
  }).catch((e) => {
    console.error('❌ Discord Bot の起動に失敗:', e.message);
    process.exit(1);
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
}

// --- エラーハンドリング ---
process.on('unhandledRejection', (error) => {
  console.error('未処理の非同期エラー:', error);
});

main().catch((e) => {
  console.error('❌ 起動エラー:', e);
  process.exit(1);
});
