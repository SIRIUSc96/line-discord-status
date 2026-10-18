const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const GAME_PANEL_COMMAND_NAME = 'gamepanel';

/**
 * ゲーム選択パネルのメッセージ内容（Embed + ボタン/セレクトメニュー）を生成
 * @param {string[]} games - ゲーム一覧の文字列配列
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function buildGamePanelPayload(games = []) {
  const embed = new EmbedBuilder()
    .setTitle('🎮 ゲーム選択パネル')
    .setDescription(
      'ボタンを押すと、対象のボイスチャンネル名が切り替わります。\n' +
      '※ ボイスチャンネルに入っていなくても変更できます。'
    )
    .setColor(0x5865F2)
    .setFooter({
      text: '⚠️ Discordの仕様により、チャンネル名変更は「10分に2回まで」の制限があります',
    })
    .setTimestamp();

  const components = [];

  // 登録数が10個前後の場合はボタン型（1行最大5個）、それ以上はプルダウン型
  if (games.length <= 10) {
    let currentRow = new ActionRowBuilder();

    games.forEach((game, index) => {
      // 5個ごとに新しい行を作成
      if (index > 0 && index % 5 === 0) {
        components.push(currentRow);
        currentRow = new ActionRowBuilder();
      }

      // 「雑談」やリセット系は緑(Success)またはグレー(Secondary)、他は青(Primary)
      const isReset = game.includes('雑談') || game.includes('リセット');
      const style = isReset ? ButtonStyle.Secondary : ButtonStyle.Primary;

      const button = new ButtonBuilder()
        .setCustomId(`game_btn_${index}`)
        .setLabel(game)
        .setStyle(style);

      currentRow.addComponents(button);
    });

    if (currentRow.components.length > 0) {
      components.push(currentRow);
    }
  } else {
    // 11個以上の場合はプルダウン型 (Select Menu)
    // ※ Discordの仕様上、1つのSelect Menuには最大25個までしか登録できないため、25個ごとに分割する
    const chunkSize = 25;
    const totalChunks = Math.ceil(games.length / chunkSize);

    for (let c = 0; c < totalChunks && components.length < 4; c++) {
      const start = c * chunkSize;
      const slice = games.slice(start, start + chunkSize);
      const placeholder =
        totalChunks === 1
          ? '🎮 プレイするゲームを選択してください'
          : `🎮 ゲームを選択 (${start + 1}〜${start + slice.length})`;

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`game_select_menu_${c}`)
        .setPlaceholder(placeholder);

      slice.forEach((game, idx) => {
        const globalIndex = start + idx;
        selectMenu.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(game)
            .setValue(String(globalIndex))
            .setDescription(`対象VCの名前を「${game}」に変更`)
        );
      });

      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    // 「雑談」に戻すワンタップボタンも下部に用意
    const resetIndex = games.findIndex((g) => g.includes('雑談'));
    if (resetIndex !== -1 && components.length < 5) {
      const resetBtn = new ButtonBuilder()
        .setCustomId(`game_btn_${resetIndex}`)
        .setLabel(`💬 ${games[resetIndex]} に戻す`)
        .setStyle(ButtonStyle.Secondary);
      components.push(new ActionRowBuilder().addComponents(resetBtn));
    }
  }

  return {
    embeds: [embed],
    components,
  };
}

// チャンネル名変更の履歴（Discordの「10分に2回まで」制限を事前判定するため）
const renameTimestamps = [];
const RENAME_WINDOW_MS = 10 * 60 * 1000; // 10分

/**
 * ゲーム選択ボタンまたはセレクトメニューが押されたときの処理
 * @param {import('discord.js').Interaction} interaction
 * @param {object} config - アプリ設定
 * @param {import('discord.js').Guild} guild
 */
async function handleGameSelectInteraction(interaction, config, guild) {
  const games = config.games || [];
  let selectedGame = null;

  if (interaction.isButton()) {
    const match = interaction.customId.match(/^game_btn_(\d+)$/);
    if (!match) return;
    const index = parseInt(match[1], 10);
    selectedGame = games[index];
  } else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('game_select_menu')) {
    const index = parseInt(interaction.values[0], 10);
    selectedGame = games[index];
  }

  if (!selectedGame) return;

  console.log(`🎮 [パネル操作] ${interaction.user?.tag} が「${selectedGame}」を選択しました`);

  const targetVcId = (config.targetVoiceChannelId || '').trim();

  // 対象VCをキャッシュから取得（Guildsインテントにより全チャンネルがキャッシュ済み）
  const targetVc = guild?.channels?.cache?.get(targetVcId);

  // 対象VCが見つからない、またはボイスチャンネルでない場合
  if (!targetVc || !targetVc.isVoiceBased()) {
    console.warn(`⚠️ [ゲーム選択] 対象VC (ID: ${targetVcId}) が見つかりません`);
    return await interaction.reply({
      content: '⚠️ 対象のVCが見つかりません。設定を確認してください。',
      ephemeral: true,
    });
  }

  // すでに同じ名前の場合はAPIを叩かずに即座に応答（レート制限節約）
  if (targetVc.name === selectedGame) {
    return await interaction.reply({
      content: `ℹ️ すでに「**${selectedGame}**」になっています。`,
      ephemeral: true,
    });
  }

  // 直近10分以内の変更回数をチェック（10分に2回まで）
  const now = Date.now();
  while (renameTimestamps.length > 0 && now - renameTimestamps[0] > RENAME_WINDOW_MS) {
    renameTimestamps.shift();
  }
  if (renameTimestamps.length >= 2) {
    const remainMin = Math.ceil((RENAME_WINDOW_MS - (now - renameTimestamps[0])) / 60000);
    console.warn(`⏳ [VC名変更制限] 10分に2回の上限によりスキップ (残り約${remainMin}分)`);
    return await interaction.reply({
      content: `⏳ チャンネル名の変更はDiscordの制限により「10分に2回まで」です。\nあと約 **${remainMin}分** 待ってからもう一度押してね。`,
      ephemeral: true,
    });
  }

  // 3秒ルールで「時間内に応答しませんでした」になるのを防ぐため、先に保留応答（deferReply）を送る
  await interaction.deferReply({ ephemeral: true });

  try {
    const oldName = targetVc.name;

    // Discord側でレート制限待機が発生してもハングしないよう5秒タイムアウトを設定
    await Promise.race([
      targetVc.setName(selectedGame),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('RENAME_TIMEOUT_RATE_LIMIT')), 5000)
      ),
    ]);

    renameTimestamps.push(Date.now());
    console.log(`🎮 [VC名変更成功] ${interaction.user.tag} が「${oldName}」→「${selectedGame}」に変更しました`);

    return await interaction.editReply({
      content: `✅ 対象VCの名前を「**${selectedGame}**」に変更しました！`,
    });
  } catch (error) {
    console.error('❌ VC名変更エラー:', error.message || error);

    // Discordのチャンネル名変更レート制限（10分に2回まで）またはタイムアウトに当たった場合
    const isRateLimit =
      error.message === 'RENAME_TIMEOUT_RATE_LIMIT' ||
      error.status === 429 ||
      error.code === 50035 ||
      error.name === 'RateLimitError' ||
      /rate limit|ratelimit|retry/i.test(error.message);

    if (isRateLimit) {
      return await interaction.editReply({
        content: '⏳ チャンネル名の変更制限（10分に2回まで）に達しました。少し待ってからもう一度押してね。',
      });
    }

    // 権限不足の場合
    if (error.code === 50013 || /missing permissions/i.test(error.message)) {
      return await interaction.editReply({
        content: '⚠️ Botに「チャンネルの管理」権限がないため、名前を変更できませんでした。サーバー管理者に確認してください。',
      });
    }

    return await interaction.editReply({
      content: '⚠️ チャンネル名の変更に失敗しました。少し待ってからもう一度試してください。',
    });
  }
}

/**
 * 管理者用コマンド (/gamepanel) の定義
 */
const GAME_PANEL_COMMAND_DEF = {
  name: GAME_PANEL_COMMAND_NAME,
  description: 'ゲーム選択パネルをこのチャンネルに投稿します（管理者専用）',
  defaultMemberPermissions: PermissionFlagsBits.Administrator.toString(),
};

module.exports = {
  GAME_PANEL_COMMAND_NAME,
  GAME_PANEL_COMMAND_DEF,
  buildGamePanelPayload,
  handleGameSelectInteraction,
};
