/**
 * Bot の稼働スケジュール（日本時間）
 * - 土日: 終日稼働
 * - 平日: sleepStartHour 〜 sleepEndHour 未満は休止（例: 4:00〜19:00）、それ以外は稼働
 */
function getJstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday').value; // Mon, Tue, ...
  let hour = parseInt(parts.find((p) => p.type === 'hour').value, 10);
  if (hour === 24) hour = 0;
  return { weekday, hour };
}

/**
 * 通常スケジュール上、Bot を稼働させる時間帯かどうか
 */
function isScheduledActive(schedule, date = new Date()) {
  if (!schedule || !schedule.enabled) return true;
  const { weekday, hour } = getJstParts(date);
  if (weekday === 'Sat' || weekday === 'Sun') return true;
  return !(hour >= schedule.sleepStartHour && hour < schedule.sleepEndHour);
}

module.exports = { isScheduledActive, getJstParts };
