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

// --- 直近のログをメモリに保持（/debug で確認するため。トークンを含む行は除外） ---
const recentLogs = [];
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    const line = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    if (/token/i.test(line)) return;
    recentLogs.push(`${new Date().toISOString()} [${level}] ${line}`.slice(0, 500));
    if (recentLogs.length > 100) recentLogs.shift();
  };
}

const config = require('./config');
const StatusManager = require('./statusManager');
const DiscordBot = require('./discordBot');
const { createLineHandler, sendLineBroadcast } = require('./lineHandler');

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🎮 LINE → Discord 通話ステータスボード     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // --- コンポーネント初期化 ---
  const statusManager = new StatusManager(config);
  const discordBot = new DiscordBot(config);

  // 2人以上の通話が開始された時の処理 (公式LINEの友だち全員へ一斉送信)
  // ※ Renderは再起動のたびに保存データが消えるため、ユーザーIDに頼らずブロードキャストで送る
  discordBot.onVoiceStart(async (memberNames, channelName) => {
    const namesStr = memberNames.join(' と ');
    const text = `🎙️ 【通話開始】\n${namesStr} が「${channelName}」で通話を始めました！`;

    console.log(`LINEへ一斉送信します（通話開始: ${namesStr}）`);
    await sendLineBroadcast(config.line.channelAccessToken, text);
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
      discord: discordBot.client.isReady() ? 'online' : 'offline',
      activeUsers: activeUsers.length,
      uptime: Math.floor(process.uptime()),
    });
  });

  // 診断用: 直近のログと、このサーバーからDiscordへ届くかのテスト結果
  app.get('/debug', async (_req, res) => {
    const probeUrls = [
      'https://discord.com/api/v10/gateway',
      'https://canary.discord.com/api/v10/gateway',
      'https://ptb.discord.com/api/v10/gateway',
      'https://discordapp.com/api/v9/gateway',
    ];
    const probes = {};
    await Promise.all(
      probeUrls.map(async (u) => {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
          probes[u] = {
            status: r.status,
            retryAfter: r.headers.get('retry-after'),
            cfRay: r.headers.get('cf-ray'),
          };
        } catch (e) {
          probes[u] = { error: e.message };
        }
      })
    );
    res.json({
      discord: discordBot.client.isReady() ? 'online' : 'offline',
      wsStatus: discordBot.client.ws?.status,
      statusMessageId: discordBot.statusMessageId,
      gamePanelMessageId: discordBot.gamePanelMessageId,
      uptime: Math.floor(process.uptime()),
      discordProbe: probes,
      logs: recentLogs,
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
  const tryStartDiscord = async () => {
    try {
      await discordBot.start();
      console.log('✅ Discord Bot 起動完了！');
      const activeOnStart = statusManager.getActiveUsers();
      if (activeOnStart.length > 0) {
        await discordBot.updateEmbed(activeOnStart);
        console.log(`📋 ${activeOnStart.length} 人のアクティブユーザーを復元`);
      }
    } catch (e) {
      console.error('⚠️ Discord Bot の起動に失敗 (5分後に再試行します):', e.message);
      setTimeout(tryStartDiscord, 5 * 60 * 1000);
    }
  };
  tryStartDiscord();

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

  // --- 自己キープアライブ（10分ごとに自分の公開URLへアクセス） ---
  // Renderは15分アクセスがないとスリープするため、自分で自分を起こし続ける。
  // cron-job.org が止まってもスリープしないための二重の保険。
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) {
    setInterval(() => {
      fetch(selfUrl).catch((e) => console.error('キープアライブ失敗:', e.message));
    }, 10 * 60 * 1000);
    console.log(`💓 キープアライブ有効: ${selfUrl}`);
  }
}

// --- エラーハンドリング ---
process.on('unhandledRejection', (error) => {
  console.error('未処理の非同期エラー:', error);
});

main().catch((e) => {
  console.error('❌ 起動エラー:', e);
  process.exit(1);
});
