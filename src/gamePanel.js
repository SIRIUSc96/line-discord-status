const fs = require('fs');
const path = require('path');
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
const RECENT_GAMES_FILE = path.join(__dirname, '..', 'data', 'recentGames.json');

// 最近使用した順のゲームリスト（メモリキャッシュ）
let orderedGamesCache = null;

/**
 * 保存ファイルから並び順を読み込む
 */
function loadSavedOrder() {
  try {
    if (fs.existsSync(RECENT_GAMES_FILE)) {
      const data = JSON.parse(fs.readFileSync(RECENT_GAMES_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.warn('⚠️ recentGames.json 読み込み警告:', e.message);
  }
  return null;
}

/**
 * 並び順をファイルに保存する
 */
function saveOrder(list) {
  try {
    const dir = path.dirname(RECENT_GAMES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(RECENT_GAMES_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('⚠️ recentGames.json 保存警告:', e.message);
  }
}

/**
 * config.games と現在の並び順をマージして最新の並び順配列を返す
 * - config.games に新しく追加された項目は、config.games 内の直前の項目の後ろ（または先頭付近）に挿入する
 * - config.games から削除された項目は除外する
 */
function getOrderedGames(configGames = []) {
  if (!orderedGamesCache) {
    orderedGamesCache = loadSavedOrder() || [...configGames];
  }

  const validSet = new Set(configGames);
  const result = orderedGamesCache.filter((g) => validSet.has(g));
  const existingSet = new Set(result);

  // config.games に新しく追加されたゲームがあれば適切な位置に差し込む
  configGames.forEach((game, idx) => {
    if (!existingSet.has(game)) {
      if (idx === 0) {
        result.unshift(game);
      } else {
        const prevGame = configGames[idx - 1];
        const prevIdx = result.indexOf(prevGame);
        if (prevIdx !== -1) {
          result.splice(prevIdx + 1, 0, game);
        } else {
          result.unshift(game);
        }
      }
      existingSet.add(game);
    }
  });

  orderedGamesCache = result;
  return orderedGamesCache;
}

/**
 * Discord上の既存パネルメッセージからプルダウンの並び順を復元する（Render再起動対策）
 */
function restoreOrderFromMessage(panelMessage, configGames = []) {
  try {
    if (!panelMessage?.components?.length) return;
    const extracted = [];
    for (const row of panelMessage.components) {
      for (const comp of row.components || []) {
        if (Array.isArray(comp.options)) {
          for (const opt of comp.options) {
            if (opt.label) extracted.push(opt.label);
          }
        }
      }
    }
    if (extracted.length > 0) {
      orderedGamesCache = extracted;
      getOrderedGames(configGames);
      saveOrder(orderedGamesCache);
      console.log(`🔄 既存パネルからゲームの並び順（${orderedGamesCache.length}件）を復元しました`);
    }
  } catch (e) {
    console.warn('⚠️ 既存パネルからの並び順復元警告:', e.message);
  }
}

/**
 * 指定したゲームを「最近使用した順」の先頭へ移動する
 */
function recordGameUsed(selectedGame, configGames = []) {
  const current = getOrderedGames(configGames);
  orderedGamesCache = [selectedGame, ...current.filter((g) => g !== selectedGame)];
  saveOrder(orderedGamesCache);
  return orderedGamesCache;
}

/**
 * ゲーム選択パネルのメッセージ内容（Embed + ボタン/セレクトメニュー）を生成
 * @param {string[]} configGames - 設定上のゲーム一覧の文字列配列
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function buildGamePanelPayload(configGames = []) {
  const games = getOrderedGames(configGames);

  const embed = new EmbedBuilder()
    .setTitle('🎮 ゲーム選択パネル')
    .setDescription(
      'プルダウンまたはボタンを押すと、対象のボイスチャンネル名が切り替わります。\n' +
      '※ ボイスチャンネルに入っていなくても変更できます（プルダウンは最近使用した順に並び替わります）。'
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

    games.forEach((game) => {
      // 5個ごとに新しい行を作成
      if (currentRow.components.length === 5) {
        components.push(currentRow);
        currentRow = new ActionRowBuilder();
      }

      // 「雑談」やリセット系はグレー(Secondary)、他は青(Primary)
      const isReset = game.includes('雑談') || game.includes('リセット');
      const style = isReset ? ButtonStyle.Secondary : ButtonStyle.Primary;

      const button = new ButtonBuilder()
        .setCustomId(`game_btn_${game}`)
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
          ? '🎮 プレイするゲームを選択（最近使用した順）'
          : c === 0
            ? `🎮 ゲームを選択 (${start + 1}〜${start + slice.length}・最近使用した順)`
            : `🎮 ゲームを選択 (${start + 1}〜${start + slice.length})`;

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`game_select_menu_${c}`)
        .setPlaceholder(placeholder);

      slice.forEach((game) => {
        selectMenu.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(game)
            .setValue(game)
            .setDescription(`対象VCの名前を「${game}」に変更`)
        );
      });

      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    // 「雑談中」「作業中」にワンタップで切り替えられるボタンも下部に用意
    const quickRow = new ActionRowBuilder();
    const zatsudanGame = configGames.find((g) => g.includes('雑談'));
    if (zatsudanGame) {
      quickRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`game_btn_${zatsudanGame}`)
          .setLabel(`💬 ${zatsudanGame} に戻す`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    const sagyoGame = configGames.find((g) => g.includes('作業'));
    if (sagyoGame) {
      quickRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`game_btn_${sagyoGame}`)
          .setLabel(`💻 ${sagyoGame} にする`)
          .setStyle(ButtonStyle.Primary)
      );
    }
    if (quickRow.components.length > 0 && components.length < 5) {
      components.push(quickRow);
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

  if (interaction.isButton() && interaction.customId.startsWith('game_btn_')) {
    const raw = interaction.customId.slice('game_btn_'.length);
    if (/^\d+$/.test(raw) && !games.includes(raw)) {
      selectedGame = games[parseInt(raw, 10)];
    } else {
      selectedGame = raw;
    }
  } else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('game_select_menu')) {
    const raw = interaction.values[0];
    if (/^\d+$/.test(raw) && !games.includes(raw)) {
      selectedGame = games[parseInt(raw, 10)];
    } else {
      selectedGame = raw;
    }
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

  // 選択されたゲームを「最近使用した順」の先頭へ移動する
  recordGameUsed(selectedGame, games);

  // パネルのプルダウン順序（最近使用した順）＆選択状態を非同期で更新
  const refreshPanelMessage = () => {
    if (interaction.message?.editable) {
      interaction.message
        .edit(buildGamePanelPayload(games))
        .catch((err) => console.warn('⚠️ パネル並び順更新警告:', err.message));
    }
  };

  // すでに同じ名前の場合はAPIを叩かずに即座に応答（レート制限節約）
  if (targetVc.name === selectedGame) {
    await interaction.reply({
      content: `ℹ️ すでに「**${selectedGame}**」になっています。`,
      ephemeral: true,
    });
    refreshPanelMessage();
    return;
  }

  // 直近10分以内の変更回数をチェック（10分に2回まで）
  const now = Date.now();
  while (renameTimestamps.length > 0 && now - renameTimestamps[0] > RENAME_WINDOW_MS) {
    renameTimestamps.shift();
  }
  if (renameTimestamps.length >= 2) {
    const remainMin = Math.ceil((RENAME_WINDOW_MS - (now - renameTimestamps[0])) / 60000);
    console.warn(`⏳ [VC名変更制限] 10分に2回の上限によりスキップ (残り約${remainMin}分)`);
    await interaction.reply({
      content: `⏳ チャンネル名の変更はDiscordの制限により「10分に2回まで」です。\nあと約 **${remainMin}分** 待ってからもう一度押してね。`,
      ephemeral: true,
    });
    refreshPanelMessage();
    return;
  }

  try {
    const oldName = targetVc.name;

    // Discordの3秒ルール内に必ず応答するため、2秒タイムアウトで競合させる
    await Promise.race([
      targetVc.setName(selectedGame),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('RENAME_TIMEOUT_RATE_LIMIT')), 2000)
      ),
    ]);

    renameTimestamps.push(Date.now());
    console.log(`🎮 [VC名変更成功] ${interaction.user.tag} が「${oldName}」→「${selectedGame}」に変更しました`);

    await interaction.reply({
      content: `✅ 対象VCの名前を「**${selectedGame}**」に変更しました！`,
      ephemeral: true,
    });
    refreshPanelMessage();
    return;
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
      await interaction.reply({
        content: '⏳ チャンネル名の変更制限（10分に2回まで）に達しました。少し待ってからもう一度押してね。',
        ephemeral: true,
      });
      refreshPanelMessage();
      return;
    }

    // 権限不足の場合
    if (error.code === 50013 || /missing permissions/i.test(error.message)) {
      return await interaction.reply({
        content: '⚠️ Botに「チャンネルの管理」権限がないため、名前を変更できませんでした。サーバー管理者に確認してください。',
        ephemeral: true,
      });
    }

    return await interaction.reply({
      content: '⚠️ チャンネル名の変更に失敗しました。少し待ってからもう一度試してください。',
      ephemeral: true,
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
  restoreOrderFromMessage,
  handleGameSelectInteraction,
};
