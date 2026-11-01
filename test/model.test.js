import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTorrents, matchesFilter, normalizeLabels, status, formatBytes, formatEta, torrentCount, escapeHtml, percent, rpcPath, validateRpcPath, validateTorrentUrl } from '../lib/model.js';
import { DemoRPC } from '../lib/demo.js';

test('filters respect Transmission queued, checking, seeding, paused, and error states', () => {
  assert.equal(matchesFilter({ status: 3 }, 'downloading'), true);
  assert.equal(matchesFilter({ status: 2 }, 'downloading'), false);
  assert.equal(matchesFilter({ status: 5 }, 'seeding'), true);
  assert.equal(matchesFilter({ status: 0, percentDone: 1 }, 'completed'), true);
  assert.equal(matchesFilter({ status: 0, percentDone: .4 }, 'paused'), true);
  assert.equal(matchesFilter({ error: 2 }, 'error'), true);
  assert.equal(status({ status: 4, error: 1 }).tone, 'error');
  assert.equal(status({ status: 4, metadataPercentComplete: 0 }).label, 'Получение метаданных');
});
test('combines Unicode search and labels, sorts a copy', () => {
  const torrents = [
    { id: 1, name: 'Убунту 24.iso', labels: ['Linux'], status: 4, addedDate: 100 },
    { id: 2, name: 'Debian.iso', labels: ['Linux'], status: 0, addedDate: 200 },
  ];
  assert.deepEqual(filterTorrents(torrents, { search: ' УБУНТУ ', label: 'Linux', filter: 'downloading' }).map(t => t.id), [1]);
  assert.deepEqual(filterTorrents(torrents).map(t => t.id), [2, 1]);
  assert.deepEqual(torrents.map(t => t.id), [1, 2]);
  assert.deepEqual(filterTorrents(torrents, { label: 'Кино' }), []);
});
test('active means actual download or upload, excluding idle, queued and paused torrents', () => {
  for (const torrent of [
    { status: 4, rateDownload: 1, rateUpload: 0 },
    { status: 4, rateDownload: 0, rateUpload: 1 },
    { status: 6, rateDownload: 0, rateUpload: 2000 },
  ]) assert.equal(matchesFilter(torrent, 'active'), true);
  for (const torrent of [
    { status: 4, rateDownload: 0, rateUpload: 0 },
    { status: 6, rateDownload: 0, rateUpload: 0 },
    { status: 0, rateDownload: 50, rateUpload: 50 },
    { status: 3, rateDownload: 0, rateUpload: 0 },
    { status: 5, rateDownload: 0, rateUpload: 0 },
    { status: 2, recheckProgress: .5 },
  ]) assert.equal(matchesFilter(torrent, 'active'), false);
});
test('normalizes label drafts without splitting commas or mutating the input', () => {
  const labels = [' Linux ', '', 'Linux', 'Кино, сериалы', ' Работа ', 'работа'];
  assert.deepEqual(normalizeLabels(labels), ['Linux', 'Кино, сериалы', 'Работа', 'работа']);
  assert.equal(labels[0], ' Linux ');
  assert.deepEqual(normalizeLabels([' ', '']), []);
});
test('label assignment replaces and clears only the selected torrent labels and updates filters', async () => {
  const demo = new DemoRPC();
  const before = (await demo.call('torrent-get', { ids: [2] })).torrents[0].labels;
  await demo.call('torrent-set', { ids: [1], labels: ['Тест', '<img src=x>'] });
  let { torrents } = await demo.call('torrent-get');
  assert.deepEqual(filterTorrents(torrents, { label: 'Тест', filter: 'active' }).map(t => t.id), [1]);
  assert.deepEqual(torrents.find(t => t.id === 2).labels, before);
  await demo.call('torrent-set', { ids: [1], labels: [] });
  ({ torrents } = await demo.call('torrent-get'));
  assert.deepEqual(torrents.find(t => t.id === 1).labels, []);
  assert.deepEqual(filterTorrents(torrents, { label: 'Тест' }), []);
});
test('formats unknown ETA, zero bytes, percentages and Russian plurals', () => {
  assert.equal(formatBytes(0), '0 Б');
  assert.equal(formatBytes(1024, true), '1 КБ/с');
  assert.equal(formatBytes(-4), '0 Б');
  assert.equal(formatEta(-1), '—');
  assert.equal(formatEta(-2), '—');
  assert.equal(formatEta(0), '< 1 мин');
  assert.equal(formatEta(7200), '2 ч 0 мин');
  assert.equal(percent(1.9), 100);
  assert.equal(percent(-.2), 0);
  assert.deepEqual([1, 2, 5, 11, 21, 22, 112].map(torrentCount), ['1 торрент', '2 торрента', '5 торрентов', '11 торрентов', '21 торрент', '22 торрента', '112 торрентов']);
});
test('escapes untrusted torrent names, tracker text and attribute values', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)"> & \'url\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;url&#39;');
});
test('resolves RPC beside /web under a reverse proxy prefix', () => {
  assert.equal(rpcPath('https://host/transmission/web/'), '/transmission/rpc');
  assert.equal(rpcPath('https://host/seedbox/custom/web/index.html'), '/seedbox/custom/rpc');
  assert.equal(rpcPath('https://host/transmission/web'), '/transmission/rpc');
  assert.equal(rpcPath('https://host/'), '/transmission/rpc');
  assert.equal(rpcPath('https://host/website/'), '/transmission/rpc');
});
test('RPC config rejects foreign origins, credentials, query strings and URL ambiguities', () => {
  const base = 'https://server.example/transmission/web/';
  assert.equal(validateRpcPath('/proxy/rpc', base), '/proxy/rpc');
  for (const value of ['https://evil.test/rpc', '//evil.test/rpc', '/\\evil.test/rpc', 'rpc', '/rpc?secret=1', '/rpc#foo', 'javascript:alert(1)']) assert.throws(() => validateRpcPath(value, base));
});
test('torrent URLs accept magnet BTIH/BTMH and HTTP(S), reject local file paths and scripts', () => {
  for (const value of ['magnet:?xt=urn:btih:123abc', 'magnet:?xt=urn:btmh:1220abc', 'https://example.org/file.torrent']) assert.equal(validateTorrentUrl(value), value);
  for (const value of ['file:///etc/passwd', '/etc/passwd', 'javascript:alert(1)', 'ftp://example.org/file', 'https://user:pass@example.org/file', 'magnet:?foo=bar']) assert.throws(() => validateTorrentUrl(value));
});
test('demo mutations are isolated, support file priority and never fake torrent addition', async () => {
  const demo = new DemoRPC();
  const { torrents } = await demo.call('torrent-get');
  assert.equal(torrents.length, 7);
  await demo.call('torrent-stop', { ids: [1] });
  assert.equal((await demo.call('torrent-get', { ids: [1] })).torrents[0].status, 0);
  await demo.call('torrent-start', { ids: [1] });
  await demo.call('torrent-set', { ids: [1], 'files-unwanted': [0], 'priority-high': [0] });
  const t = (await demo.call('torrent-get', { ids: [1] })).torrents[0];
  assert.equal(t.status, 4);
  assert.equal(t.fileStats[0].wanted, false);
  assert.equal(t.fileStats[0].priority, 1);
  await assert.rejects(demo.call('torrent-add', { filename: 'magnet:example' }), /демо/);
  assert.equal((await new DemoRPC().call('torrent-get', { ids: [1] })).torrents[0].fileStats[0].wanted, true);
});
