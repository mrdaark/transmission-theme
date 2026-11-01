export const FILTERS = [
  { id: 'all', label: 'Все', title: 'Все торренты', icon: 'list' },
  { id: 'active', label: 'Активные', title: 'Активные торренты', icon: 'gauge' },
  { id: 'downloading', label: 'Загрузка', title: 'Загрузка', icon: 'down' },
  { id: 'seeding', label: 'Раздача', title: 'Раздача', icon: 'up' },
  { id: 'completed', label: 'Завершено', title: 'Завершённые', icon: 'check' },
  { id: 'paused', label: 'Пауза', title: 'На паузе', icon: 'pause' },
  { id: 'error', label: 'Ошибки', title: 'С ошибками', icon: 'alert' },
];
export const LIST_FIELDS = ['id', 'name', 'status', 'percentDone', 'recheckProgress', 'rateDownload', 'rateUpload', 'eta', 'sizeWhenDone', 'totalSize', 'uploadedEver', 'downloadedEver', 'uploadRatio', 'peersConnected', 'error', 'errorString', 'addedDate', 'downloadDir', 'labels', 'metadataPercentComplete'];
export const DETAIL_FIELDS = ['id', 'files', 'fileStats', 'trackerStats', 'peers', 'hashString', 'magnetLink', 'comment', 'creator', 'dateCreated', 'pieces', 'pieceCount', 'pieceSize', 'isPrivate'];
export function matchesFilter(t, filter) {
  if (filter === 'active') return (t.status === 4 || t.status === 6) && (t.rateDownload > 0 || t.rateUpload > 0);
  if (filter === 'downloading') return t.status === 3 || t.status === 4;
  if (filter === 'seeding') return t.status === 5 || t.status === 6;
  if (filter === 'completed') return t.percentDone >= 1;
  if (filter === 'paused') return t.status === 0;
  if (filter === 'error') return !!t.error;
  return true;
}
export function normalizeLabels(labels) {
  return [...new Set(labels.map(label => label.trim()).filter(Boolean))];
}
export function filterTorrents(torrents, { filter = 'all', label = null, search = '', sort = 'added' } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return torrents.filter(t => matchesFilter(t, filter) && (label === null || (t.labels || []).includes(label)) && t.name.toLocaleLowerCase().includes(query)).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'ru', { numeric: true });
    if (sort === 'progress') return b.percentDone - a.percentDone || b.addedDate - a.addedDate;
    if (sort === 'speed') return b.rateDownload + b.rateUpload - a.rateDownload - a.rateUpload;
    if (sort === 'size') return b.sizeWhenDone - a.sizeWhenDone;
    return b.addedDate - a.addedDate || a.id - b.id;
  });
}
export function status(t) {
  if (t.error) return { label: 'Ошибка', icon: 'alert', tone: 'error' };
  return [
    { label: 'На паузе', icon: 'pause', tone: 'muted' },
    { label: 'В очереди проверки', icon: 'refresh', tone: 'muted' },
    { label: 'Проверяется', icon: 'refresh', tone: 'blue' },
    { label: 'В очереди загрузки', icon: 'down', tone: 'muted' },
    { label: t.metadataPercentComplete < 1 ? 'Получение метаданных' : 'Скачивается', icon: 'down', tone: 'blue' },
    { label: 'В очереди раздачи', icon: 'up', tone: 'muted' },
    { label: 'Раздаётся', icon: 'up', tone: 'green' },
  ][t.status] || { label: 'Неизвестно', icon: 'info', tone: 'muted' };
}
export const percent = n => Math.max(0, Math.min(100, Number(n || 0) * 100));
export function formatBytes(value, speed = false) {
  let n = Math.max(0, Number(value) || 0), i = 0;
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'];
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const number = n.toLocaleString('ru-RU', { maximumFractionDigits: i === 0 ? 0 : n < 10 ? 2 : 1 });
  return `${number} ${units[i]}${speed ? '/с' : ''}`;
}
export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return '< 1 мин';
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} мин`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч ${Math.floor(seconds % 3600 / 60)} мин`;
  return `${Math.floor(seconds / 86400)} д ${Math.floor(seconds % 86400 / 3600)} ч`;
}
export function torrentCount(n) {
  const word = n % 10 === 1 && n % 100 !== 11 ? 'торрент' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'торрента' : 'торрентов';
  return `${n} ${word}`;
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function rpcPath(base) {
  const url = new URL(base);
  const web = url.pathname.lastIndexOf('/web');
  return web >= 0 && /^\/web(?:\/|$)/.test(url.pathname.slice(web)) ? `${url.pathname.slice(0, web)}/rpc` : '/transmission/rpc';
}
export function validateRpcPath(path, base) {
  const url = new URL(path, base), origin = new URL(base).origin;
  if (!path.startsWith('/') || path.startsWith('//') || url.origin !== origin || url.username || url.password || url.search || url.hash) throw new Error('Укажите абсолютный путь на этом сервере, например /transmission/rpc.');
  return url.pathname;
}
export function validateTorrentUrl(value) {
  const url = new URL(value);
  if (url.protocol === 'magnet:' && url.searchParams.getAll('xt').some(x => /^urn:bt(?:ih|mh):.+/i.test(x))) return value;
  if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return value;
  throw new Error('Нужна magnet-ссылка или HTTP(S)-адрес .torrent-файла.');
}
