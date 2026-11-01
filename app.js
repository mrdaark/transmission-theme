import { tr, getLocale, getLanguage, setLanguage, translateDocument, LocalizedError } from './lib/i18n.js';
import { TransmissionRPC } from './lib/rpc.js';
import { DemoRPC } from './lib/demo.js';
import { FILTERS, LIST_FIELDS, DETAIL_FIELDS, filterTorrents, matchesFilter, normalizeLabels, status, percent, formatBytes, formatEta, torrentCount, escapeHtml as e, rpcPath, validateRpcPath, validateTorrentUrl } from './lib/model.js';

const $ = id => document.getElementById(id);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const text = (id, value) => { $(id).textContent = value; };
const demo = new URLSearchParams(location.search).get('demo') === '1';
const readPref = (key, fallback) => { try { return localStorage.getItem(`transmission-theme:${key}`) || fallback; } catch { return fallback; } };
const writePref = (key, value) => { try { localStorage.setItem(`transmission-theme:${key}`, value); } catch { /* Storage is optional. */ } };
setLanguage(readPref('language', 'ru'));
translateDocument();
let endpoint;
try { endpoint = validateRpcPath(readPref('rpc', rpcPath(location.href)), location.href); } catch { endpoint = rpcPath(location.href); }
let rpc = demo ? new DemoRPC() : new TransmissionRPC(endpoint);
const savedInterval = Number(readPref('interval', '2000'));
const state = { torrents: [], session: {}, stats: null, filter: 'all', label: null, search: '', sort: readPref('sort', 'added'), selectedId: null, detail: null, detailId: null, tab: 'files', connected: false, initialized: false, error: '', interval: [2000, 5000, 10000].includes(savedInterval) ? savedInterval : 2000, history: [], files: [] };
let timer, polling = false, detailLoading = false, generation = 0, operationBusy = false, toastTimer, refreshQueued = false;
const rendered = new WeakMap();

function toast(message, error = false) {
  clearTimeout(toastTimer);
  text('toast', message);
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 7000 : 3500);
}
function errorText(error) { return error instanceof TypeError ? tr('Не удалось связаться с Transmission. Проверьте подключение и путь к RPC в настройках.') : error?.message || String(error || ''); }
function formatRatio(value) { return Math.max(0, value || 0).toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function setConnection(connected, message = '') {
  state.connected = connected;
  state.error = message;
  document.body.classList.toggle('connected', connected);
  document.body.classList.toggle('disconnected', !connected);
  text('connection-status-text', connected ? demo ? tr('Демонстрация') : tr('Сервер подключён') : tr('Нет подключения'));
  $('connection-error').hidden = !message;
  text('error-message', errorText(message));
  $('torrent-list').setAttribute('aria-busy', 'false');
  $('pause-all').disabled = !connected || operationBusy;
  $('alt-speed').disabled = !connected || operationBusy;
  $('mobile-alt').disabled = !connected || operationBusy;
}
function progressMarkup(t, extra = '') {
  const value = t.status === 2 ? t.recheckProgress : t.percentDone;
  return `<div class="progress ${extra}" style="--progress:${percent(value)}%" role="progressbar" aria-label="${t.status === 2 ? tr('Проверка') : tr('Загрузка')}" aria-valuenow="${Math.round(percent(value))}" aria-valuemin="0" aria-valuemax="100"></div>`;
}
function renderFilters() {
  const counts = Object.fromEntries(FILTERS.map(f => [f.id, state.torrents.filter(t => matchesFilter(t, f.id)).length]));
  const visible = FILTERS.filter(f => f.id !== 'error' || counts.error || state.filter === 'error');
  restoreFocusAfterRender($('filters'), visible.map(f => `<button class="nav-item ${state.filter === f.id && state.label === null ? 'active' : ''}" data-filter="${f.id}" ${state.filter === f.id && state.label === null ? 'aria-current="page"' : ''}>${icon(f.icon)}<span>${f.label}</span><span class="nav-count">${counts[f.id]}</span></button>`).join(''));
  restoreFocusAfterRender($('mobile-filters'), visible.map(f => `<button class="filter-chip ${state.filter === f.id && state.label === null ? 'active' : ''}" data-filter="${f.id}" aria-pressed="${state.filter === f.id && state.label === null}">${f.label}<span>${counts[f.id]}</span></button>`).join(''));
  const labels = new Map();
  for (const t of state.torrents) for (const label of new Set(t.labels || [])) labels.set(label, (labels.get(label) || 0) + 1);
  text('labels-count', labels.size || '');
  restoreFocusAfterRender($('labels'), labels.size ? [...labels].sort(([a], [b]) => a.localeCompare(b, getLocale())).map(([label, n]) => `<button class="nav-item ${state.label === label ? 'active' : ''}" data-label="${e(label)}" ${state.label === label ? 'aria-current="page"' : ''}>${icon('folder')}<span>${e(label)}</span><span class="nav-count">${n}</span></button>`).join('') : `<p class="no-labels">${tr('Метки из Transmission появятся здесь')}</p>`);
  const title = state.label ?? FILTERS.find(f => f.id === state.filter)?.title ?? tr('Все торренты');
  text('page-title-label', title);
  text('total-count', state.label !== null ? labels.get(state.label) || 0 : counts[state.filter]);
}
function torrentRow(t) {
  const s = status(t), p = percent(t.status === 2 ? t.recheckProgress : t.percentDone);
  const eta = t.status === 4 ? tr('осталось {time}', { time: formatEta(t.eta) }) : t.status === 6 ? tr('рейтинг {ratio}', { ratio: formatRatio(t.uploadRatio) }) : t.percentDone >= 1 ? tr('скачивание завершено') : tr('{done} из {total}', { done: formatBytes(t.downloadedEver), total: formatBytes(t.sizeWhenDone) });
  const subtitle = t.error ? t.errorString : `${tr('{count} пиров', { count: t.peersConnected || 0 })} · ${eta}`;
  const speed = t.status === 6 ? `↑ ${formatBytes(t.rateUpload, true)}` : `↓ ${formatBytes(t.rateDownload, true)}`;
  const mobileMeta = t.status === 4 ? `${speed} · ${formatEta(t.eta)}` : t.status === 6 ? speed : formatBytes(t.sizeWhenDone);
  return `<article class="torrent-row ${t.id === state.selectedId ? 'selected' : ''}" data-id="${t.id}" aria-label="${e(t.name)}"><span class="row-status-icon ${s.tone}">${icon(s.icon)}</span><div class="torrent-name-cell"><button class="torrent-name" data-select="${t.id}" title="${e(t.name)}" aria-expanded="${t.id === state.selectedId}" aria-controls="inspector">${e(t.name)}</button><div class="torrent-subtitle"><span title="${e(subtitle)}">${e(subtitle)}</span>${(t.labels || []).slice(0, 1).map(l => `<span class="row-label">${e(l)}</span>`).join('')}</div></div><div class="row-state ${s.tone}" title="${e(t.error ? t.errorString : s.label)}">${icon(s.icon)}<span>${s.label}</span></div><div class="row-progress">${progressMarkup(t)}<span class="progress-percent">${Math.floor(p)}%</span></div><div class="row-speed">${e(speed)}<span class="upload-speed">${t.status === 4 ? `↑ ${e(formatBytes(t.rateUpload, true))}` : ''}</span></div><div class="row-size">${e(formatBytes(t.sizeWhenDone))}</div><button class="icon-button row-action" data-row-action="${t.status === 0 ? 'start' : 'stop'}" aria-label="${t.status === 0 ? tr('Запустить') : tr('Приостановить')} ${e(t.name)}" ${!state.connected || operationBusy ? 'disabled' : ''}>${icon(t.status === 0 ? 'play' : 'pause')}</button><div class="mobile-row-footer"><span class="mobile-row-state ${s.tone}">${s.label}</span><span>${e(mobileMeta)}</span></div></article>`;
}
function restoreFocusAfterRender(container, html) {
  const previous = rendered.get(container);
  if (previous?.source === html && previous.dom === container.innerHTML) return;
  const active = document.activeElement;
  // Do not replace a native select while the user is choosing an option.
  if (container.contains(active) && active.tagName === 'SELECT' && !active.disabled) return;
  const identity = container.contains(active) ? [...active.attributes].find(a => ['data-select', 'data-row-action', 'data-file-index', 'data-priority', 'data-filter', 'data-label', 'data-action'].includes(a.name)) : null;
  const rowId = active?.closest('[data-id]')?.dataset.id;
  container.innerHTML = html;
  rendered.set(container, { source: html, dom: container.innerHTML });
  if (identity) {
    const candidates = [...container.querySelectorAll(`[${identity.name}]`)];
    const target = candidates.find(el => el.getAttribute(identity.name) === identity.value && (!rowId || el.closest('[data-id]')?.dataset.id === rowId));
    target?.focus({ preventScroll: true });
  }
}
function renderList() {
  renderFilters();
  const visible = filterTorrents(state.torrents, state);
  restoreFocusAfterRender($('torrent-list'), visible.map(torrentRow).join(''));
  text('shown-count', torrentCount(visible.length));
  text('total-size', formatBytes(visible.reduce((sum, t) => sum + (t.sizeWhenDone || 0), 0)));
  $('empty-state').hidden = visible.length > 0;
  $('torrent-list').hidden = !visible.length;
  const disconnected = !state.connected && !state.initialized;
  text('empty-title', disconnected ? tr('Подключимся к Transmission') : state.torrents.length ? tr('Ничего не найдено') : tr('Здесь будут ваши торренты'));
  text('empty-description', disconnected ? tr('Установите интерфейс на сервер Transmission. Путь к RPC можно изменить в настройках.') : state.torrents.length ? tr('Попробуйте другой запрос или выберите другой фильтр.') : tr('Добавьте .torrent-файл или magnet-ссылку, чтобы начать загрузку.'));
  $('empty-add').hidden = disconnected || state.torrents.length > 0;
  $('demo-link').hidden = !disconnected;
  text('list-footer-text', !state.connected ? state.initialized ? tr('Соединение потеряно · показаны последние данные') : tr('Ожидание подключения к серверу') : demo ? tr('Демонстрационные данные') : tr('Обновление каждые {seconds} секунды', { seconds: state.interval / 1000 }));
  text('session-count', `${torrentCount(state.torrents.length)} · ${formatBytes(state.torrents.reduce((s, t) => s + (t.sizeWhenDone || 0), 0))}`);
}
function renderSession(stats, recordHistory = true) {
  state.stats = stats;
  const down = formatBytes(stats.downloadSpeed, true), split = down.lastIndexOf(' ');
  text('download-rate', down.slice(0, split));
  text('download-unit', down.slice(split + 1));
  text('upload-rate', formatBytes(stats.uploadSpeed, true));
  text('mobile-down', down);
  text('mobile-up', formatBytes(stats.uploadSpeed, true));
  text('server-version', `Transmission ${state.session.version || ''}${demo ? ` · ${tr('демо')}` : ''}`);
  const enabled = !!state.session['alt-speed-enabled'];
  $('alt-speed').setAttribute('aria-pressed', String(enabled));
  $('mobile-alt').setAttribute('aria-pressed', String(enabled));
  text('speed-limit', enabled ? `${state.session['alt-speed-down']} ${tr('КБ/с')}` : state.session['speed-limit-down-enabled'] ? `${state.session['speed-limit-down']} ${tr('КБ/с')}` : tr('без лимита'));
  if (recordHistory) {
    state.history.push(Number(stats.downloadSpeed) || 0);
    if (state.history.length > 30) state.history.shift();
  }
  const history = [...Array(Math.max(0, 30 - state.history.length)).fill(0), ...state.history];
  const max = Math.max(...history, 1);
  const points = history.map((v, i) => [i * 180 / 29, 38 - (v / max) * 30]);
  const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  $('speed-line').setAttribute('d', path);
  $('speed-area').setAttribute('d', `${path} L180,42 L0,42 Z`);
}
function selectedTorrent() { return state.torrents.find(t => t.id === state.selectedId); }
function renderInspector() {
  const t = selectedTorrent();
  $('inspector').hidden = !t;
  document.body.classList.toggle('inspector-open', !!t);
  updateInspectorAccess();
  if (!t) return;
  text('detail-name', t.name);
  const detail = state.detailId === t.id ? state.detail : null;
  const s = status(t);
  $('detail-badges').innerHTML = `<span class="badge ${s.tone}">${s.label}</span><span class="badge">${detail ? tr('{count} файлов', { count: detail.files?.length || 0 }) : tr('Метаданные…')}</span><span class="badge">${tr('{count} пиров', { count: t.peersConnected || 0 })}</span><span class="badge">${e(formatBytes(t.sizeWhenDone))}</span>${(t.labels || []).map(label => `<span class="badge label-badge" title="${e(label)}">${e(label)}</span>`).join('')}`;
  $('detail-progress').outerHTML = progressMarkup(t).replace('class="progress', 'id="detail-progress" class="progress');
  text('detail-percent', `${Math.floor(percent(t.status === 2 ? t.recheckProgress : t.percentDone))}%`);
  $('detail-stats').innerHTML = `<span>${icon('down')} <b>${e(formatBytes(t.rateDownload, true))}</b></span><span>${icon('up')} <b>${e(formatBytes(t.rateUpload, true))}</b></span><span>${tr('осталось')} <b>${e(t.percentDone >= 1 ? '—' : formatEta(t.eta))}</b></span><span>${tr('скачано')} <b>${e(formatBytes(t.downloadedEver))}</b></span><span>${tr('отдано')} <b>${e(formatBytes(t.uploadedEver))}</b></span>`;
  const disabled = !state.connected || operationBusy ? 'disabled' : '';
  restoreFocusAfterRender($('detail-actions'), `<button class="button" data-action="labels" ${disabled}>${icon('tag')}${tr('Метки')}</button><button class="button" data-action="${t.status === 0 ? 'start' : 'stop'}" ${disabled}>${icon(t.status === 0 ? 'play' : 'pause')}${t.status === 0 ? tr('Запустить') : tr('Приостановить')}</button><button class="icon-button" data-action="verify" title="${tr('Проверить локальные данные')}" aria-label="${tr('Проверить локальные данные')}" ${disabled}>${icon('refresh')}</button><button class="icon-button" data-action="copy" title="${tr('Скопировать magnet')}" aria-label="${tr('Скопировать magnet')}" ${!detail?.magnetLink ? 'disabled' : ''}>${icon('link')}</button><button class="icon-button danger-icon" data-action="remove" title="${tr('Удалить торрент')}" aria-label="${tr('Удалить торрент')}" ${disabled}>${icon('trash')}</button>`);
  renderPieces(detail);
  renderDetailContent();
}
function updateInspectorAccess() {
  const modal = state.selectedId !== null && matchMedia('(max-width: 900px)').matches;
  for (const element of document.querySelectorAll('.workspace > :not(#inspector), .sidebar, .mobile-dock, #demo-banner')) element.inert = modal;
  if (modal) { $('inspector').setAttribute('role', 'dialog'); $('inspector').setAttribute('aria-modal', 'true'); }
  else { $('inspector').removeAttribute('role'); $('inspector').removeAttribute('aria-modal'); }
}
function renderPieces(detail) {
  let bits;
  try { bits = detail?.pieces ? atob(detail.pieces) : null; } catch { bits = null; }
  const count = Math.max(0, Number(detail?.pieceCount) || 0);
  if (!bits || !count) { $('piece-map').classList.add('empty'); $('piece-map').innerHTML = icon('download'); return; }
  $('piece-map').classList.remove('empty');
  const cells = Math.min(256, count);
  let html = '';
  // Each cell represents a real range of pieces; only full ranges are blue.
  for (let i = 0; i < cells; i++) {
    const from = Math.floor(i * count / cells), to = Math.floor((i + 1) * count / cells);
    let complete = true;
    for (let p = from; p < to; p++) if (!((bits.charCodeAt(p >> 3) || 0) & (128 >> (p & 7)))) { complete = false; break; }
    html += `<span${complete ? ' class="done"' : ''}></span>`;
  }
  $('piece-map').innerHTML = html;
}
function renderDetailContent() {
  const t = selectedTorrent(), detail = state.detailId === t?.id ? state.detail : null;
  if (!t) return;
  if (!detail) { $('detail-content').innerHTML = `<p class="detail-message">${tr('Загрузка подробностей…')}</p>`; return; }
  if (state.tab === 'files') {
    const files = detail.files || [];
    restoreFocusAfterRender($('detail-content'), files.length ? files.map((f, i) => {
      const stat = detail.fileStats?.[i] || {}, p = f.length ? percent((stat.bytesCompleted ?? f.bytesCompleted) / f.length) : 100;
      return `<div class="file-row" style="--progress:${p}"><input type="checkbox" data-file-index="${i}" aria-label="${e(tr('Скачивать {name}', { name: f.name }))}" ${stat.wanted !== false && stat.wanted !== 0 ? 'checked' : ''} ${!state.connected || operationBusy ? 'disabled' : ''}>${icon('file')}<span class="file-name" title="${e(f.name)}">${e(f.name)}</span><span class="file-size">${e(formatBytes(f.length))}</span><span class="file-percent">${Math.floor(p)}%</span><select data-priority="${i}" aria-label="${e(tr('Приоритет {name}', { name: f.name }))}" ${!state.connected || operationBusy ? 'disabled' : ''}>${[[-1, tr('Низкий')], [0, tr('Обычный')], [1, tr('Высокий')]].map(([value, label]) => `<option value="${value}" ${Number(stat.priority || 0) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`;
    }).join('') : `<p class="detail-message">${tr('Список файлов появится после получения метаданных.')}</p>`);
  } else if (state.tab === 'trackers') {
    $('detail-content').innerHTML = detail.trackerStats?.length ? `<table class="detail-table"><thead><tr><th>${tr('Трекер')}</th><th>${tr('Сиды')}</th><th>${tr('Пиры')}</th><th>${tr('Действие')}</th></tr></thead><tbody>${detail.trackerStats.map(tracker => `<tr><td><span class="tracker-host" title="${e(tracker.announce)}">${e(tracker.host || tracker.announce)}</span><span class="tracker-result" title="${e(tracker.lastAnnounceResult)}">${e(tracker.lastAnnounceResult || tr('Ожидание ответа'))}</span></td><td>${tracker.seederCount >= 0 ? Number(tracker.seederCount) : '—'}</td><td>${tracker.leecherCount >= 0 ? Number(tracker.leecherCount) : '—'}</td><td><button class="text-button" data-action="reannounce" ${!state.connected || operationBusy ? 'disabled' : ''}>${tr('Обновить')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="detail-message">${tr('У этого торрента нет трекеров.')}</p>`;
  } else if (state.tab === 'peers') {
    $('detail-content').innerHTML = detail.peers?.length ? `<table class="detail-table"><thead><tr><th>${tr('Адрес')}</th><th>${tr('Клиент')}</th><th>${tr('Прогресс')}</th><th>${tr('↓ Скачивание')}</th><th>${tr('↑ Отдача')}</th></tr></thead><tbody>${detail.peers.map(p => `<tr><td>${e(p.address)}${p.isEncrypted ? ' ◦' : ''}</td><td>${e(p.clientName)}</td><td>${Math.floor(percent(p.progress))}%</td><td>${e(formatBytes(p.rateToClient, true))}</td><td>${e(formatBytes(p.rateToPeer, true))}</td></tr>`).join('')}</tbody></table>` : `<p class="detail-message">${tr('Сейчас нет подключённых пиров.')}</p>`;
  } else {
    $('detail-content').innerHTML = `<dl class="info-grid"><dt>${tr('Размер')}</dt><dd>${e(formatBytes(t.totalSize))}</dd><dt>${tr('Рейтинг')}</dt><dd>${formatRatio(t.uploadRatio)}</dd><dt>${tr('Добавлен')}</dt><dd>${e(new Date(t.addedDate * 1000).toLocaleString(getLocale()))}</dd><dt>${tr('Приватный')}</dt><dd>${detail.isPrivate ? tr('Да') : tr('Нет')}</dd><dt>${tr('Папка')}</dt><dd class="wide">${e(t.downloadDir)}</dd><dt>${tr('Хеш')}</dt><dd class="wide">${e(detail.hashString || '—')}</dd><dt>${tr('Создан в')}</dt><dd class="wide">${e(detail.creator || '—')}</dd><dt>${tr('Комментарий')}</dt><dd class="wide">${e(detail.comment || '—')}</dd>${t.error ? `<dt>${tr('Ошибка')}</dt><dd class="wide error">${e(t.errorString)}</dd>` : ''}</dl>`;
  }
}
async function loadDetail() {
  const id = state.selectedId, client = rpc, version = generation;
  if (id === null || detailLoading) return;
  detailLoading = true;
  try {
    const data = await client.call('torrent-get', { ids: [id], fields: DETAIL_FIELDS });
    if (state.selectedId !== id || generation !== version) return;
    const detail = data.torrents?.[0];
    if (!detail) { closeInspector(); return; }
    state.detail = detail; state.detailId = id;
    renderInspector();
  } catch (error) {
    if (state.selectedId === id && generation === version) {
      $('detail-content').innerHTML = `<p class="detail-message error">${e(errorText(error))}</p>`;
    }
  } finally {
    detailLoading = false;
    // A different row may have been selected while this request was in flight.
    if (state.selectedId !== null && state.selectedId !== id) void loadDetail();
  }
}
function selectTorrent(id) {
  state.selectedId = id;
  state.detail = null; state.detailId = null;
  renderList(); renderInspector();
  $('inspector').scrollTop = 0;
  if (matchMedia('(max-width: 900px)').matches) $('close-inspector').focus();
  void loadDetail();
}
function closeInspector() {
  const previous = state.selectedId;
  state.selectedId = null; state.detail = null; state.detailId = null;
  renderInspector(); renderList();
  document.querySelector(`[data-select="${previous}"]`)?.focus({ preventScroll: true });
}
function schedulePoll(delay = state.interval) {
  clearTimeout(timer);
  if (!document.hidden) timer = setTimeout(poll, delay);
}
async function poll() {
  clearTimeout(timer);
  if (polling) { refreshQueued = true; return; }
  if (document.hidden) return;
  polling = true;
  const client = rpc, version = generation;
  try {
    const [list, stats, session] = await Promise.all([client.call('torrent-get', { fields: LIST_FIELDS }), client.call('session-stats'), client.call('session-get')]);
    if (version !== generation) return;
    state.torrents = list.torrents || [];
    state.session = session; state.initialized = true;
    setConnection(true);
    renderSession(stats);
    if (state.selectedId !== null && !selectedTorrent()) { state.selectedId = null; state.detail = null; state.detailId = null; }
    renderList(); renderInspector();
    if (state.selectedId !== null) await loadDetail();
  } catch (error) {
    if (version !== generation) return;
    setConnection(false, error);
    renderList(); renderInspector();
  } finally {
    polling = false;
    const immediate = refreshQueued;
    refreshQueued = false;
    schedulePoll(immediate ? 0 : state.connected ? state.interval : Math.max(state.interval, 5000));
  }
}
async function mutate(method, args, message) {
  if (operationBusy || !state.connected) return false;
  operationBusy = true;
  setConnection(state.connected, state.error);
  renderInspector();
  try {
    await rpc.call(method, args);
    if (message) toast(message);
    return true;
  } catch (error) { toast(errorText(error), true); return false; }
  finally { operationBusy = false; void poll(); }
}

let removeTarget = null;
async function action(name, id = state.selectedId) {
  const t = state.torrents.find(t => t.id === id);
  if (!t) return;
  if (name === 'labels') { openLabels(t); return; }
  if (name === 'remove') {
    removeTarget = { id: t.id, name: t.name };
    text('remove-name', t.name); $('delete-data').checked = false; $('remove-error').hidden = true;
    $('remove-dialog').showModal(); return;
  }
  if (name === 'copy') {
    try {
      if (state.detailId !== id || !state.detail?.magnetLink) throw new LocalizedError('Magnet-ссылка ещё не получена.');
      await navigator.clipboard.writeText(state.detail.magnetLink);
      toast(tr('Magnet-ссылка скопирована'));
    } catch { toast(tr('Копирование недоступно. Браузеру нужен HTTPS или разрешение на буфер обмена.'), true); }
    return;
  }
  const method = { start: 'torrent-start', stop: 'torrent-stop', verify: 'torrent-verify', reannounce: 'torrent-reannounce' }[name];
  if (method) await mutate(method, { ids: [id] }, { start: tr('Торрент запущен'), stop: tr('Торрент приостановлен'), verify: tr('Проверка данных запрошена'), reannounce: tr('Запрошено обновление трекеров') }[name]);
}
let labelsTarget = null, labelsDraft = [], labelsSaving = false;
function openLabels(t) {
  labelsTarget = { id: t.id, client: rpc, generation };
  labelsDraft = normalizeLabels(t.labels || []);
  text('labels-torrent-name', t.name);
  $('new-label').value = ''; $('labels-error').hidden = true;
  renderLabelEditor();
  $('labels-dialog').showModal();
  $('new-label').focus();
}
function renderLabelEditor() {
  $('assigned-labels').innerHTML = labelsDraft.length ? labelsDraft.map((label, i) => `<button type="button" class="label-chip selected" data-remove-label="${i}" aria-label="${e(tr('Убрать метку {label}', { label }))}">${icon('tag')}<span>${e(label)}</span>${icon('close')}</button>`).join('') : `<p class="field-hint">${tr('У этого торрента пока нет меток.')}</p>`;
  const available = normalizeLabels(state.torrents.flatMap(t => t.labels || [])).filter(label => !labelsDraft.includes(label)).sort((a, b) => a.localeCompare(b, getLocale()));
  $('label-suggestions').innerHTML = available.map(label => `<button type="button" class="label-chip" data-suggest-label="${e(label)}">${icon('plus')}<span>${e(label)}</span></button>`).join('');
  $('suggested-labels').hidden = !available.length;
}
function addDraftLabel() {
  labelsDraft = normalizeLabels([...labelsDraft, $('new-label').value]);
  $('new-label').value = ''; renderLabelEditor(); $('new-label').focus();
}
$('add-label').addEventListener('click', addDraftLabel);
$('new-label').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addDraftLabel(); }
});
$('labels-dialog').addEventListener('click', event => {
  const remove = event.target.closest('[data-remove-label]'), suggestion = event.target.closest('[data-suggest-label]');
  if (remove) { labelsDraft.splice(Number(remove.dataset.removeLabel), 1); renderLabelEditor(); }
  if (suggestion) { labelsDraft = normalizeLabels([...labelsDraft, suggestion.dataset.suggestLabel]); renderLabelEditor(); }
});
$('labels-dialog').addEventListener('cancel', event => { if (labelsSaving) event.preventDefault(); });
$('labels-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (labelsSaving) return;
  const target = labelsTarget;
  if (!target || target.generation !== generation || !state.connected || !state.torrents.some(t => t.id === target.id)) {
    showFormError('labels-error', tr('Торрент недоступен. Проверьте подключение и откройте редактор заново.')); return;
  }
  const labels = normalizeLabels([...labelsDraft, $('new-label').value]);
  labelsSaving = true; $('labels-error').hidden = true;
  const controls = [...$('labels-form').querySelectorAll('button, input')];
  controls.forEach(control => { control.disabled = true; });
  try {
    await target.client.call('torrent-set', { ids: [target.id], labels });
    if (generation === target.generation) {
      const torrent = state.torrents.find(t => t.id === target.id);
      if (torrent) torrent.labels = labels;
      // Return to the full list if the last torrent loses the selected label.
      if (state.label !== null && !state.torrents.some(t => (t.labels || []).includes(state.label))) state.label = null;
      renderList(); renderInspector();
    }
    $('labels-dialog').close(); toast(tr('Метки сохранены'));
  } catch (error) { showFormError('labels-error', errorText(error)); }
  finally { labelsSaving = false; controls.forEach(control => { control.disabled = false; }); void poll(); }
});
function openAdd(magnet = false) {
  $('add-form').reset(); state.files = []; text('file-label', tr('Выберите .torrent-файлы'));
  $('download-dir').value = state.session['download-dir'] || '';
  $('add-error').hidden = true;
  $('add-dialog').showModal();
  if (magnet) $('torrent-url').focus();
}
let settingsBaseline = {};
function readServerSettings() {
  const args = { 'speed-limit-down-enabled': $('limit-down-enabled').checked, 'speed-limit-up-enabled': $('limit-up-enabled').checked, 'speed-limit-down': Number($('limit-down').value), 'speed-limit-up': Number($('limit-up').value), 'alt-speed-down': Number($('alt-down').value), 'alt-speed-up': Number($('alt-up').value) };
  if ($('setting-dir').value.trim()) args['download-dir'] = $('setting-dir').value.trim();
  return args;
}
function openSettings() {
  const s = state.session;
  $('setting-dir').value = s['download-dir'] || '';
  $('limit-down-enabled').checked = !!s['speed-limit-down-enabled'];
  $('limit-up-enabled').checked = !!s['speed-limit-up-enabled'];
  $('limit-down').value = s['speed-limit-down'] ?? 10000;
  $('limit-up').value = s['speed-limit-up'] ?? 1000;
  $('alt-down').value = s['alt-speed-down'] ?? 500;
  $('alt-up').value = s['alt-speed-up'] ?? 100;
  $('refresh-interval').value = String(state.interval);
  $('interface-language').value = getLanguage();
  $('rpc-path').value = endpoint;
  settingsBaseline = readServerSettings();
  $('settings-error').hidden = true;
  $('settings-dialog').showModal();
}
function showFormError(id, message) { text(id, message); $(id).hidden = false; }
function setFiles(files) {
  try {
    if (files.length > 25) throw new LocalizedError('Можно добавить до 25 файлов за один раз.');
    for (const f of files) {
      if (!f.name.toLowerCase().endsWith('.torrent')) throw new LocalizedError('{name}: выберите .torrent-файл.', { name: f.name });
      if (f.size > 10 * 1024 * 1024) throw new LocalizedError('{name}: файл больше 10 МБ.', { name: f.name });
      if (!f.size) throw new LocalizedError('{name}: пустой файл.', { name: f.name });
    }
    state.files = [...files];
    text('file-label', files.length === 1 ? files[0].name : files.length ? tr('Выбрано файлов: {count}', { count: files.length }) : tr('Выберите .torrent-файлы'));
    $('add-error').hidden = true;
  } catch (error) { state.files = []; $('torrent-file').value = ''; text('file-label', tr('Выберите .torrent-файлы')); showFormError('add-error', error.message); }
}
async function fileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

$('demo-banner').hidden = !demo;
$('sort').value = state.sort;
$('torrent-list').innerHTML = Array(4).fill('<div class="skeleton-row" aria-hidden="true"></div>').join('');
renderFilters();
document.addEventListener('click', event => {
  const open = event.target.closest('[data-open]');
  if (open) { open.dataset.open === 'settings' ? openSettings() : openAdd(open.dataset.open === 'magnet'); return; }
  const close = event.target.closest('[data-close]');
  if (close) { close.closest('dialog').close(); return; }
  const filter = event.target.closest('[data-filter]');
  if (filter) { state.filter = filter.dataset.filter; state.label = null; renderList(); return; }
  const label = event.target.closest('[data-label]');
  if (label) { state.label = label.dataset.label; state.filter = 'all'; renderList(); return; }
  const rowAction = event.target.closest('[data-row-action]');
  if (rowAction) { void action(rowAction.dataset.rowAction, Number(rowAction.closest('[data-id]').dataset.id)); return; }
  const row = event.target.closest('[data-id]');
  if (row) { selectTorrent(Number(row.dataset.id)); return; }
  const detailAction = event.target.closest('[data-action]');
  if (detailAction) { void action(detailAction.dataset.action); return; }
  const tab = event.target.closest('[data-tab]');
  if (tab) selectTab(tab.dataset.tab);
});
function selectTab(name) {
  state.tab = name;
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  }
  $('detail-content').setAttribute('aria-labelledby', `tab-${name}`);
  $('detail-content').scrollTop = 0;
  renderDetailContent();
}
document.querySelector('.tabs').addEventListener('keydown', event => {
  const tabs = [...document.querySelectorAll('[data-tab]')], current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  let index;
  if (event.key === 'ArrowRight') index = (current + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') index = (current + tabs.length - 1) % tabs.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = tabs.length - 1;
  if (index !== undefined) { event.preventDefault(); selectTab(tabs[index].dataset.tab); tabs[index].focus(); }
});
$('search').addEventListener('input', event => { state.search = event.target.value; renderList(); });
$('sort').addEventListener('change', event => { state.sort = event.target.value; writePref('sort', state.sort); renderList(); });
$('retry').addEventListener('click', () => { void poll(); });
$('close-inspector').addEventListener('click', closeInspector);
$('pause-all').addEventListener('click', () => {
  const ids = state.torrents.filter(t => t.status !== 0).map(t => t.id);
  if (ids.length) void mutate('torrent-stop', { ids }, tr('Все активные торренты приостановлены'));
  else toast(tr('Все торренты уже на паузе'));
});
async function toggleAlt() { await mutate('session-set', { 'alt-speed-enabled': !state.session['alt-speed-enabled'] }, tr('Лимиты скорости обновлены')); }
$('alt-speed').addEventListener('click', toggleAlt);
$('mobile-alt').addEventListener('click', toggleAlt);
$('torrent-file').addEventListener('change', event => setFiles([...event.target.files]));
const dropZone = $('drop-zone');
for (const name of ['dragenter', 'dragover']) dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add('drag-over'); });
for (const name of ['dragleave', 'drop']) dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', event => { setFiles([...event.dataTransfer.files]); });
$('add-form').addEventListener('submit', async event => {
  event.preventDefault();
  const url = $('torrent-url').value.trim(), files = [...state.files];
  $('add-error').hidden = true;
  if (!files.length && !url) { showFormError('add-error', tr('Выберите .torrent-файл или вставьте magnet-ссылку.')); return; }
  if (url) try { validateTorrentUrl(url); } catch { showFormError('add-error', tr('Проверьте ссылку: нужен magnet или HTTP(S)-адрес .torrent-файла.')); return; }
  if (!state.connected) { showFormError('add-error', tr('Сначала подключитесь к Transmission.')); return; }
  const button = $('add-submit'); button.disabled = true;
  const client = rpc;
  const args = { paused: !$('start-added').checked };
  const dir = $('download-dir').value.trim(); if (dir) args['download-dir'] = dir;
  let added = 0, duplicates = 0;
  const failed = [];
  const inputs = [...files.map(file => ({ file })), ...(url ? [{ url }] : [])];
  for (const item of inputs) {
    try {
      const result = await client.call('torrent-add', { ...args, ...(item.file ? { metainfo: await fileBase64(item.file) } : { filename: item.url }) });
      if (result['torrent-duplicate']) duplicates++; else added++;
    } catch (error) { failed.push({ ...item, message: `${item.file?.name || tr('Ссылка')}: ${errorText(error)}` }); }
  }
  button.disabled = false;
  if (failed.length) {
    // Keep only failed inputs, so retrying cannot accidentally submit successful files again.
    state.files = failed.filter(f => f.file).map(f => f.file);
    text('file-label', state.files.length ? tr('Осталось файлов: {count}', { count: state.files.length }) : tr('Выберите .torrent-файлы'));
    $('torrent-url').value = failed.find(f => f.url)?.url || '';
    showFormError('add-error', `${added ? `${tr('Добавлено: {count}', { count: added })}. ` : ''}${duplicates ? `${tr('Уже в списке: {count}', { count: duplicates })}. ` : ''}${failed.map(f => f.message).join(' ')}`);
  } else { $('add-dialog').close(); toast(`${tr('Добавлено: {count}', { count: added })}${duplicates ? ` · ${tr('уже в списке: {count}', { count: duplicates })}` : ''}`); }
  void poll();
});
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); $('settings-error').hidden = true;
  let path;
  try { path = validateRpcPath($('rpc-path').value.trim(), location.href); }
  catch (error) { showFormError('settings-error', error.message); return; }
  const changedEndpoint = path !== endpoint;
  // Switching endpoints saves only local connection preferences, never server settings
  // loaded from a different daemon. Reopen settings after the new connection succeeds.
  if (!changedEndpoint && state.connected) {
    const args = Object.fromEntries(Object.entries(readServerSettings()).filter(([key, value]) => value !== settingsBaseline[key]));
    $('settings-submit').disabled = true;
    try { if (Object.keys(args).length) await rpc.call('session-set', args); }
    catch (error) { showFormError('settings-error', errorText(error)); return; }
    finally { $('settings-submit').disabled = false; }
  }
  state.interval = Number($('refresh-interval').value); writePref('interval', state.interval);
  setLanguage($('interface-language').value); writePref('language', getLanguage());
  translateDocument();
  if (changedEndpoint) {
    endpoint = path; writePref('rpc', endpoint); generation++;
    rpc = demo ? rpc : new TransmissionRPC(endpoint);
    state.torrents = []; state.session = {}; state.stats = null; state.initialized = false; state.selectedId = null; state.detail = null; state.detailId = null; state.history = [];
    setConnection(false); renderList(); renderInspector();
  }
  $('settings-dialog').close();
  setConnection(state.connected, state.error);
  if (state.stats) renderSession(state.stats, false);
  renderList(); renderInspector();
  toast(changedEndpoint ? tr('Путь к RPC сохранён. Подключаемся…') : state.connected ? tr('Настройки сохранены') : tr('Настройки интерфейса сохранены. Подключаемся…'));
  void poll();
});
$('remove-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!removeTarget || !state.connected) { showFormError('remove-error', tr('Нет подключения к Transmission.')); return; }
  $('remove-submit').disabled = true; $('remove-error').hidden = true;
  try {
    await rpc.call('torrent-remove', { ids: [removeTarget.id], 'delete-local-data': $('delete-data').checked });
    if (state.selectedId === removeTarget.id) closeInspector();
    $('remove-dialog').close(); toast(tr('Торрент удалён')); void poll();
  } catch (error) { showFormError('remove-error', errorText(error)); }
  finally { $('remove-submit').disabled = false; }
});
$('detail-content').addEventListener('change', async event => {
  const input = event.target, id = state.selectedId;
  if (id === null || !state.connected) return;
  let args;
  if (input.hasAttribute('data-file-index')) args = { [input.checked ? 'files-wanted' : 'files-unwanted']: [Number(input.dataset.fileIndex)] };
  if (input.hasAttribute('data-priority')) args = { [{ '-1': 'priority-low', 0: 'priority-normal', 1: 'priority-high' }[input.value]]: [Number(input.dataset.priority)] };
  if (!args) return;
  input.disabled = true;
  await mutate('torrent-set', { ids: [id], ...args });
});
document.addEventListener('keydown', event => {
  const input = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  const dialog = document.querySelector('dialog[open]');
  if (event.key === '/' && !input && !dialog) { event.preventDefault(); $('search').focus(); }
  if ((event.metaKey || event.ctrlKey) && event.key === ',' && !dialog) { event.preventDefault(); openSettings(); }
  if (event.key === 'Escape' && !dialog && state.selectedId !== null) closeInspector();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else void poll(); });
window.addEventListener('online', () => { void poll(); });
matchMedia('(max-width: 900px)').addEventListener('change', updateInspectorAccess);
window.addEventListener('offline', () => { setConnection(false, new LocalizedError('Нет соединения с сетью. После восстановления подключение возобновится.')); renderList(); renderInspector(); });
void poll();
