// Shared source-field normalization for offline generators and safe replay chrome.
const plain = (value) =>
  typeof value === 'string' && value.length <= 160 && !/\p{Cc}/u.test(value) ? value.trim() : '';
export function replaySourceUrl(value) {
  return typeof value === 'string' &&
    value.length <= 256 &&
    /^https?:\/\/(?:www\.)?dpxq\.com\/hldcg\/search\/view_m_[0-9]+\.html$/.test(value)
    ? value
    : null;
}
export function normalizeReplayMetadata(value) {
  if (!value || typeof value !== 'object') return {};
  const date = plain(value.date);
  const round = plain(value.round);
  const timeControl = plain(value.timeControl);
  const url = replaySourceUrl(value.source?.url);
  return {
    ...(date ? { date } : {}),
    ...(round ? { round } : {}),
    ...(timeControl ? { timeControl } : {}),
    ...(url ? { source: { label: 'DPXQ', url } } : {}),
  };
}
export function replayMetadataFromGame(game) {
  return normalizeReplayMetadata({
    date: game?.date,
    round: game?.round,
    timeControl: game?.timeControl === undefined ? game?.timerule : game.timeControl,
    source: { url: game?.sourceUrl },
  });
}
