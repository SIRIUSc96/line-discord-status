const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

/**
 * Discord Bot の管理
 * - ステータス Embed の作成・更新
 * - @here 通知の送信・自動削除
 */
class DiscordBot {
  constructor(config) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });
    this.statusMessageId = null;
    this.channel = null;
    this.ready = false;
    this.notificationMessages = new Map(); // lineUserId -> messageId
  }

  /**
   * Discord Bot を起動してチャンネルに接続
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.client.once('ready', async () => {
        console.log(`✅ Discord Bot ログイン: ${this.client.user.tag}`);

        try {
          this.channel = await this.client.channels.fetch(this.config.discord.channelId);
          if (!this.channel) {
            throw new Error(`チャンネル ${this.config.discord.channelId} が見つかりません`);
          }
          if (!this.channel.isTextBased()) {
            throw new Error('指定されたチャンネルはテキストチャンネルではありません');
          }

          await this._findOrCreateStatusMessage();
          this.ready = true;
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      this.client.on('error', (error) => {
        console.error('Discord Bot エラー:', error.message);
      });

      this.client.login(this.config.discord.botToken).catch(reject);
    });
  }

  /**
   * 既存のステータス Embed を探すか、新規作成
   */
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
      } else {
        await this._createNewStatusMessage([]);
        console.log('📋 新しいステータスメッセージを作成');
      }
    } catch (e) {
      console.error('ステータスメッセージの検索に失敗:', e.message);
      await this._createNewStatusMessage([]);
    }
  }

  /**
   * 新しいステータス Embed メッセージを作成
   */
  async _createNewStatusMessage(activeUsers) {
    const embed = this._buildEmbed(activeUsers);
    const msg = await this.channel.send({ embeds: [embed] });
    this.statusMessageId = msg.id;
  }

  /**
   * ステータスボード Embed を構築
   */
  _buildEmbed(activeUsers) {
    const hasUsers = activeUsers.length > 0;
    const hasNotified = activeUsers.some((u) => u.state === 'ON_NOTIFIED');

    // 状態に応じた色
    let color;
    if (hasNotified) {
      color = 0xFEE75C; // 黄色（通知あり）
    } else if (hasUsers) {
      color = 0x57F287; // 緑（待機中）
    } else {
      color = 0x2B2D31; // ダーク（誰もいない）
    }

    const embed = new EmbedBuilder()
      .setTitle('🎮 通話ステータスボード')
      .setColor(color)
      .setTimestamp();

    if (!hasUsers) {
      embed.setDescription(
        '```\n' +
        '  待機中のメンバーはいません\n' +
        '```\n' +
        '*LINEでスタンプを送ってステータスをONにしよう！*'
      );
    } else {
      const lines = activeUsers.map((user) => {
        const icon = user.state === 'ON_NOTIFIED' ? '🔔' : '🟢';
        const label =
          user.state === 'ON_NOTIFIED'
            ? '通話したい！来て！'
            : '通話来たら入るよ！';
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

  /**
   * @here 通知を送信
   */
  async sendNotification(userId, displayName) {
    if (!this.ready || !this.channel) return;

    try {
      // すでに送信済みの通知があれば削除
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
      });

      this.notificationMessages.set(userId, msg.id);
      console.log(`🔔 @here 通知送信完了 (ID: ${msg.id})`);
    } catch (e) {
      console.error('通知送信エラー:', e.message);
    }
  }

  /**
   * 特定のユーザーの通知メッセージを削除
   */
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

  /**
   * 非アクティブなユーザーの通知メッセージを整理・全削除
   */
  async cleanupNotifications(activeUsers) {
    const activeUserIds = new Set(activeUsers.map((u) => u.lineUserId));
    for (const [userId] of this.notificationMessages.entries()) {
      if (!activeUserIds.has(userId)) {
        await this.deleteNotification(userId);
      }
    }
  }

  /**
   * ステータス Embed を更新
   */
  async updateEmbed(activeUsers) {
    if (!this.ready || !this.channel) return;

    // OFFになったユーザーの @here 通知を自動削除
    await this.cleanupNotifications(activeUsers);

    try {
      const message = await this.channel.messages.fetch(this.statusMessageId);
      const embed = this._buildEmbed(activeUsers);
      await message.edit({ embeds: [embed] });
    } catch (e) {
      console.error('Embed更新エラー:', e.message);
      // メッセージが削除されていた場合は再作成
      try {
        await this._createNewStatusMessage(activeUsers);
        console.log('📋 ステータスメッセージを再作成');
      } catch (e2) {
        console.error('Embed再作成エラー:', e2.message);
      }
    }
  }
}

module.exports = DiscordBot;
