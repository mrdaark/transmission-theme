import { tr, getLocale, getLanguage, LocalizedError } from './i18n.js';
export const FILTERS = [
  { id: 'all', label: 'Все', title: 'Все торренты', icon: 'list' },
  { id: 'active', label: 'Активные', title: 'Активные торренты', icon: 'gauge' },
  { id: 'downloading', label: 'Загрузка', title: 'Загрузка', icon: 'down' },
  { id: 'seeding', label: 'Раздача', title: 'Раздача', icon: 'up' },
  { id: 'completed', label: 'Завершено', title: 'Завершённые', icon: 'check' },
  { id: 'paused', label: 'Пауза', title: 'На паузе', icon: 'pause' },
  { id: 'error', label: 'Ошибки', title: 'С ошибками', icon: 'alert' },
].map(({ label, title, ...filter }) => ({ ...filter, get label() { return tr(label); }, get title() { return tr(title); } }));
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
    if (sort === 'name') return a.name.localeCompare(b.name, getLocale(), { numeric: true });
    if (sort === 'progress') return b.percentDone - a.percentDone || b.addedDate - a.addedDate;
    if (sort === 'speed') return b.rateDownload + b.rateUpload - a.rateDownload - a.rateUpload;
    if (sort === 'size') return b.sizeWhenDone - a.sizeWhenDone;
    return b.addedDate - a.addedDate || a.id - b.id;
  });
}
export function status(t) {
  if (t.error) return { label: tr('Ошибка'), icon: 'alert', tone: 'error' };
  return [
    { label: tr('На паузе'), icon: 'pause', tone: 'muted' },
    { label: tr('В очереди проверки'), icon: 'refresh', tone: 'muted' },
    { label: tr('Проверяется'), icon: 'refresh', tone: 'blue' },
    { label: tr('В очереди загрузки'), icon: 'down', tone: 'muted' },
    { label: t.metadataPercentComplete < 1 ? tr('Получение метаданных') : tr('Скачивается'), icon: 'down', tone: 'blue' },
    { label: tr('В очереди раздачи'), icon: 'up', tone: 'muted' },
    { label: tr('Раздаётся'), icon: 'up', tone: 'green' },
  ][t.status] || { label: tr('Неизвестно'), icon: 'info', tone: 'muted' };
}
export const percent = n => Math.max(0, Math.min(100, Number(n || 0) * 100));
export function formatBytes(value, speed = false) {
  let n = Math.max(0, Number(value) || 0), i = 0;
  const units = getLanguage() === 'en' ? ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] : ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'];
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const number = n.toLocaleString(getLocale(), { maximumFractionDigits: i === 0 ? 0 : n < 10 ? 2 : 1 });
  return `${number} ${units[i]}${speed ? getLanguage() === 'en' ? '/s' : '/с' : ''}`;
}
export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return tr('< 1 мин');
  if (seconds < 3600) return tr('{minutes} мин', { minutes: Math.ceil(seconds / 60) });
  if (seconds < 86400) return tr('{hours} ч {minutes} мин', { hours: Math.floor(seconds / 3600), minutes: Math.floor(seconds % 3600 / 60) });
  return tr('{days} д {hours} ч', { days: Math.floor(seconds / 86400), hours: Math.floor(seconds % 86400 / 3600) });
}
export function torrentCount(n) {
  if (getLanguage() === 'en') return `${n} ${n === 1 ? tr('торрент') : tr('торрентов')}`;
  const word = n % 10 === 1 && n % 100 !== 11 ? tr('торрент') : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? tr('торрента') : tr('торрентов');
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
  if (!path.startsWith('/') || path.startsWith('//') || url.origin !== origin || url.username || url.password || url.search || url.hash) throw new LocalizedError('Укажите абсолютный путь на этом сервере, например /transmission/rpc.');
  return url.pathname;
}
export function validateTorrentUrl(value) {
  const url = new URL(value);
  if (url.protocol === 'magnet:' && url.searchParams.getAll('xt').some(x => /^urn:bt(?:ih|mh):.+/i.test(x))) return value;
  if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return value;
  throw new LocalizedError('Нужна magnet-ссылка или HTTP(S)-адрес .torrent-файла.');
}
