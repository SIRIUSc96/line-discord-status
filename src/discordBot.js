const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Events } = require('discord.js');

/**
 * Discord Bot の管理
 */
class DiscordBot {
  constructor(config) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates, // VCの入退室監視と接続に必要
      ],
      rest: {
        timeout: 15000,
        retries: 3,
      },
      ws: {
        timeout: 10000, // WebSocket接続タイムアウトを10秒に設定
      },
    });
    this.statusMessageId = null;
    this.channel = null;
    this.guild = null;
    this.ready = false;
    this.notificationMessages = new Map(); // lineUserId -> messageId
    this.onVoiceJoinCallback = null; // VC入室時に呼ばれるコールバック
  }

  /**
   * Discord Bot を起動してチャンネルに接続
   */
  async start() {
    return new Promise((resolve, reject) => {
      // Shard / WebSocket の接続状態をログに出力
      this.client.on('shardError', (error, shardId) => console.error(`❌ Shard ${shardId} エラー:`, error));
      this.client.on('shardDisconnect', (event, shardId) => console.warn(`⚠️ Shard ${shardId} 切断:`, event));
      this.client.on('shardReconnecting', (shardId) => console.log(`🔄 Shard ${shardId} 再接続中...`));

      // 接続状況のデバッグログを出力
      this.client.on('debug', (info) => {
        if (info.includes('Heartbeat') || info.includes('ping')) return;
        console.log(`[Discord Debug] ${info}`);
      });

      this.client.on('warn', (warn) => console.warn(`[Discord Warn] ${warn}`));
      this.client.on('invalidated', () => console.error('[Discord Error] セッションが無効化されました'));
      
      this.client.once(Events.ClientReady, async () => {
        console.log(`✅ Discord Bot ログイン成功: ${this.client.user.tag}`);

        try {
          this.channel = await this.client.channels.fetch(this.config.discord.channelId.trim());
          if (!this.channel) {
            throw new Error(`チャンネル ${this.config.discord.channelId} が見つかりません`);
          }
          if (!this.channel.isTextBased()) {
            throw new Error('指定されたチャンネルはテキストチャンネルではありません');
          }
          this.guild = this.channel.guild;

          await this._findOrCreateStatusMessage();
          this.ready = true;
          resolve();
        } catch (e) {
          console.error('❌ Discord Bot チャンネルフェッチ/メッセージ作成エラー:', e);
          reject(e);
        }
      });

      // VC入退室の監視
      this.client.on('voiceStateUpdate', (oldState, newState) => {
        this._handleVoiceStateUpdate(oldState, newState);
      });

      this.client.on('error', (error) => {
        console.error('❌ Discord Bot クライアントエラー:', error);
      });

      const token = (this.config.discord.botToken || '').trim();
      console.log(`🔑 client.login() を実行中... (Token長: ${token.length})`);
      
      // 15秒間ログインが完了しなかった場合のセイフティタイムアウト
      const loginTimer = setTimeout(() => {
        console.error('⚠️ Discord Gateway 接続が15秒間応答しなかったため、再接続を試みます...');
        this.client.destroy();
        this.client.login(token).catch(console.error);
      }, 15000);

      this.client.once(Events.ClientReady, () => {
        clearTimeout(loginTimer);
      });

      this.client.login(token).catch((err) => {
        clearTimeout(loginTimer);
        console.error('❌ client.login() で拒否されました:', err);
        reject(err);
      });
    });
  }

  /**
   * VC入退室時のイベントハンドラ
   */
  _handleVoiceStateUpdate(oldState, newState) {
    // Bot自身の移動は無視
    if (newState.member?.user?.bot) return;

    // 前はどこにも入っていなくて、新しくVCに入った（入室）
    if (!oldState.channelId && newState.channelId) {
      const channel = newState.channel;
      const memberName = newState.member?.displayName || newState.member?.user?.username || '誰か';
      console.log(`🎙️ ${memberName} が ${channel.name} に入室しました`);

      // もしBotがそのVCにいる場合、ユーザーが入ってきたので退出する（邪魔にならないように）
      const connection = getVoiceConnection(newState.guild.id);
      if (connection && connection.joinConfig.channelId === newState.channelId) {
        console.log('🚪 ユーザーが入室したため、BotはVCから退出します');
        connection.destroy();
      }

      // 登録されたコールバックがあれば実行（LINEへのPush通知など）
      if (this.onVoiceJoinCallback) {
        this.onVoiceJoinCallback(memberName, channel.name);
      }
    }
  }

  /**
   * コールバックの登録
   */
  onVoiceJoin(callback) {
    this.onVoiceJoinCallback = callback;
  }

  /**
   * 現在ギルド内のいずれかのVCにいるメンバー（Bot以外）の名前リストを取得
   */
  getVoiceChannelMembers() {
    if (!this.guild) return [];
    const members = [];
    this.guild.channels.cache.forEach(channel => {
      if (channel.isVoiceBased()) {
        channel.members.forEach(member => {
          if (!member.user.bot) {
            members.push(member.displayName || member.user.username);
          }
        });
      }
    });
    return members;
  }

  /**
   * Botを最初のVCに入室させる（サーバーアイコンにマークをつけるため）
   */
  async joinFirstVoiceChannel() {
    if (!this.guild) return;
    const vc = this.guild.channels.cache.find(c => c.type === 2); // 2: GuildVoice
    if (!vc) return;

    try {
      this.guild.shard.send({
        op: 4,
        d: {
          guild_id: this.guild.id,
          channel_id: vc.id,
          self_mute: false,
          self_deaf: true
        }
      });
      console.log(`🎙️ ボイスチャット ${vc.name} に入室しました (Gateway)`);
    } catch (e) {
      console.error('VC入室エラー:', e);
    }
  }

  /**
   * BotをVCから退出させる
   */
  leaveVoiceChannel() {
    if (!this.guild) return;
    try {
      this.guild.shard.send({
        op: 4,
        d: {
          guild_id: this.guild.id,
          channel_id: null,
          self_mute: false,
          self_deaf: false
        }
      });
      console.log(`🔇 ボイスチャットから退出しました (Gateway)`);
    } catch (e) {
      console.error('VC退出エラー:', e);
    }
  }

  /**
   * Botのステータス表示（アクティビティ）を更新
   */
  updateActivity(activeUsers) {
    if (!this.ready) return;
    const count = activeUsers.length;
    if (count > 0) {
      this.client.user.setActivity(`🟢 ${count}人が通話可能`, { type: ActivityType.Custom });
    } else {
      this.client.user.setActivity(); // クリア
    }
  }

  // --- Embed管理 ---

  async _findOrCreateStatusMessage() {
    try {
      const messages = await this.channel.messages.fetch({ limit: 50 });
      const botMessage = messages.find(
        (m) =>
          m.author.id === this.client.user.id &&
          m.embeds.length > 0 &&
          m.embeds[0].title?.includes('通話ステータスボード')
      );

      if (botMessage) {
        this.statusMessageId = botMessage.id;
        console.log('📋 既存のステータスメッセージを発見');
        if (!botMessage.pinned) {
          try {
            await botMessage.pin();
            console.log('📌 既存のステータスメッセージをピン留めしました');
          } catch (e) {
            console.error('ピン留めエラー:', e.message);
          }
        }
      } else {
        await this._createNewStatusMessage([]);
        console.log('📋 新しいステータスメッセージを作成');
      }
    } catch (e) {
      console.error('ステータスメッセージの検索に失敗:', e.message);
      await this._createNewStatusMessage([]);
    }
  }

  async _createNewStatusMessage(activeUsers) {
    const embed = this._buildEmbed(activeUsers);
    const msg = await this.channel.send({ embeds: [embed] });
    this.statusMessageId = msg.id;
    try {
      await msg.pin();
      console.log('📌 新しいステータスメッセージをピン留めしました');
    } catch (e) {
      console.error('ピン留めエラー:', e.message);
    }
  }

  _buildEmbed(activeUsers) {
    const hasUsers = activeUsers.length > 0;
    const hasNotified = activeUsers.some((u) => u.state === 'ON_NOTIFIED');

    let color = 0x2B2D31; // ダーク（誰もいない）
    if (hasNotified) color = 0xFEE75C; // 黄色（通知あり）
    else if (hasUsers) color = 0x57F287; // 緑（待機中）

    const embed = new EmbedBuilder()
      .setTitle('🎮 通話ステータスボード')
      .setColor(color)
      .setTimestamp();

    if (!hasUsers) {
      embed.setDescription(
        '```\n  待機中のメンバーはいません\n```\n' +
        '*LINEでスタンプを送ってステータスをONにしよう！*\n' +
        '*公式LINEのリッチメニューから「作業」「聞き専」も選べるよ！*'
      );
    } else {
      const lines = activeUsers.map((user) => {
        let icon = '🟢';
        let label = 'なんでもOK！';
        
        switch (user.state) {
          case 'ON_WORK':
            icon = '💻';
            label = '作業中（無言多め）';
            break;
          case 'ON_LISTEN':
            icon = '🎧';
            label = '聞き専（チャット参加）';
            break;
          case 'ON_NOTIFIED':
            icon = '🔔';
            label = '通話したい！来て！';
            break;
          case 'ON_ANY':
          default:
            icon = '🟢';
            label = '通話来たら入るよ！';
            break;
        }

        const time = new Date(user.startedAt).toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Tokyo',
        });
        return `${icon} **${user.displayName}** │ ${label} │ ${time}〜`;
      });

      embed.setDescription(
        lines.join('\n') +
        '\n\n*誰でも気軽にボイスチャンネルに入ってね！*'
      );
    }

    embed.setFooter({
      text: 'LINEでスタンプを送ってステータスを切り替え',
    });

    return embed;
  }

  async sendNotification(userId, displayName) {
    if (!this.ready || !this.channel) return;

    try {
      if (this.notificationMessages.has(userId)) {
        await this.deleteNotification(userId);
      }

      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setDescription(`🔔 **${displayName}** が通話したいみたい！誰か入ろう！`)
        .setTimestamp();

      const msg = await this.channel.send({
        content: '@here',
        embeds: [embed],
        allowedMentions: { parse: ['everyone'] }, // 確実にメンションを飛ばす
      });

      this.notificationMessages.set(userId, msg.id);
      console.log(`🔔 @here 通知送信完了 (ID: ${msg.id})`);
    } catch (e) {
      console.error('通知送信エラー:', e.message);
    }
  }

  async deleteNotification(userId) {
    if (!this.ready || !this.channel) return;
    const msgId = this.notificationMessages.get(userId);
    if (!msgId) return;

    try {
      const msg = await this.channel.messages.fetch(msgId);
      if (msg) {
        await msg.delete();
        console.log(`🗑️ 通知メッセージを削除しました (MsgID: ${msgId})`);
      }
    } catch (e) {
      console.error('通知メッセージ削除エラー:', e.message);
    } finally {
      this.notificationMessages.delete(userId);
    }
  }

  async cleanupNotifications(activeUsers) {
    const activeUserIds = new Set(activeUsers.map((u) => u.userId));
    for (const [userId] of this.notificationMessages.entries()) {
      if (!activeUserIds.has(userId)) {
        await this.deleteNotification(userId);
      }
    }
  }

  async updateEmbed(activeUsers) {
    if (!this.ready || !this.channel) return;

    // Botのステータスアクティビティ更新
    this.updateActivity(activeUsers);

    // VCの入退室制御（ステータスONが1人以上なら入り、0なら出る）
    // ただし、既に誰かユーザーがVCにいる場合は邪魔になるので入らない
    const hasUsers = activeUsers.length > 0;
    if (hasUsers && this.getVoiceChannelMembers().length === 0) {
      this.joinFirstVoiceChannel();
    } else if (!hasUsers) {
      this.leaveVoiceChannel();
    }

    await this.cleanupNotifications(activeUsers);

    if (this.statusMessageId) {
      try {
        const oldMsg = await this.channel.messages.fetch(this.statusMessageId);
        if (oldMsg) await oldMsg.delete();
      } catch (e) {
        // ignore
      }
      this.statusMessageId = null;
    }

    try {
      await this._createNewStatusMessage(activeUsers);
    } catch (e) {
      console.error('Embed再投稿エラー:', e.message);
    }
  }
}

module.exports = DiscordBot;
