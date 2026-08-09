const crypto = require('crypto');

/**
 * LINE Webhook の署名検証
 */
function verifySignature(channelSecret, rawBody, signature) {
  const hash = crypto
    .createHmac('SHA256', channelSecret)
    .update(rawBody)
    .digest('base64');
  return hash === signature;
}

/**
 * LINE API でユーザープロフィールを取得
 */
async function getLineProfile(accessToken, userId) {
  try {
    const response = await fetch(
      `https://api.line.me/v2/bot/profile/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (response.ok) {
      const data = await response.json();
      return data.displayName;
    }
    console.error('LINE プロフィール取得失敗:', response.status);
  } catch (e) {
    console.error('LINE プロフィール取得エラー:', e.message);
  }
  return 'Unknown';
}

/**
 * LINE チャットへ応答メッセージを送信
 */
async function sendLineReply(accessToken, replyToken, text) {
  if (!replyToken) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        replyToken: replyToken,
        messages: [
          {
            type: 'text',
            text: text,
          },
        ],
      }),
    });
  } catch (e) {
    console.error('LINE 返信エラー:', e.message);
  }
}

/**
 * LINE チャットへPushメッセージを送信
 */
async function sendLinePush(accessToken, userIds, text) {
  if (!userIds || userIds.length === 0) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: userIds,
        messages: [
          {
            type: 'text',
            text: text,
          },
        ],
      }),
    });
  } catch (e) {
    console.error('LINE Pushエラー:', e.message);
  }
}

/**
 * LINE Webhook ハンドラーを作成
 */
function createLineHandler(config, statusManager, discordBot) {
  return async (req, res) => {
    // --- 署名検証 ---
    const signature = req.headers['x-line-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    if (!verifySignature(config.line.channelSecret, req.rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // --- イベント処理 ---
    const events = req.body?.events || [];

    if (events.length === 0) {
      return res.status(200).json({ status: 'ok' });
    }

    for (const event of events) {
      if (event.type !== 'message') continue;

      const userId = event.source?.userId;
      const replyToken = event.replyToken;
      if (!userId) continue;

      let updateType = null;

      if (event.message.type === 'sticker') {
        updateType = 'STAMP';
      } else if (event.message.type === 'text') {
        const text = event.message.text.trim();
        if (text === 'なんでも') updateType = 'TEXT_ANY';
        else if (text === '作業') updateType = 'TEXT_WORK';
        else if (text === '聞き専') updateType = 'TEXT_LISTEN';
        else if (text === '通知削除') updateType = 'TEXT_OFF';
      }

      if (!updateType) {
        // スタンプでもリッチメニューのテキストでもない場合は無視
        continue;
      }

      // LINE 表示名を取得
      const displayName = await getLineProfile(
        config.line.channelAccessToken,
        userId
      );

      console.log(`📩 メッセージ受信 [${updateType}]: ${displayName} (userId: ${userId})`);

      // ステータス更新
      const result = statusManager.handleUpdate(userId, displayName, updateType);
      const activeUsers = statusManager.getActiveUsers();

      console.log(`   → アクション: ${result.action} (表示名: ${result.displayName})`);

      // Discord 更新 & LINE 応答メッセージ送信
      let replyText = '';

      switch (result.action) {
        case 'ON_ANY':
          await discordBot.updateEmbed(activeUsers);
          replyText = '🟢 通話ステータスを【なんでも】にしました！\n※スタンプを押すと @here 通知を送れます。';
          break;

        case 'ON_WORK':
          await discordBot.updateEmbed(activeUsers);
          replyText = '💻 通話ステータスを【作業】にしました！';
          break;

        case 'ON_LISTEN':
          await discordBot.updateEmbed(activeUsers);
          replyText = '🎧 通話ステータスを【聞き専】にしました！';
          break;

        case 'NOTIFY':
          await discordBot.sendNotification(userId, result.displayName);
          await discordBot.updateEmbed(activeUsers);
          replyText = '🔔 Discordに @here 通知を送信しました！（通話呼びかけ中）\n※あと2回スタンプを送るとステータスを取り消せます。';
          break;

        case 'OFF':
          await discordBot.updateEmbed(activeUsers);
          replyText = '⚪ 通話ステータスをOFF（取り消し）にしました。';
          break;

        case 'NONE':
          replyText = '💬 ステータス変更はありません。（現在通知済み状態です。あと1回スタンプでOFFになります）';
          break;
      }

      // LINE に返信
      if (replyText) {
        // 誰かが既にDiscordのVCにいるかチェック
        const vcMembers = discordBot.getVoiceChannelMembers();
        if (vcMembers.length > 0 && result.action.startsWith('ON_')) {
          replyText += `\n\n💡 現在、ボイスチャットで ${vcMembers.join('と')} が通話しています！`;
        }

        await sendLineReply(config.line.channelAccessToken, replyToken, replyText);
      }
    }

    res.status(200).json({ status: 'ok' });
  };
}

module.exports = { createLineHandler, sendLinePush };
