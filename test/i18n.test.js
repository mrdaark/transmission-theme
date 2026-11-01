import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { english, tr, setLanguage, getLanguage, getLocale, LocalizedError } from '../lib/i18n.js';
import { FILTERS, status, formatBytes, formatEta, torrentCount, normalizeLabels, escapeHtml } from '../lib/model.js';
import { TransmissionRPC } from '../lib/rpc.js';

test.afterEach(() => setLanguage('ru'));
test('switches filter and status labels after the model has already been imported', () => {
  assert.equal(FILTERS[0].label, 'Все');
  setLanguage('en');
  assert.equal(getLanguage(), 'en');
  assert.equal(getLocale(), 'en-US');
  assert.equal(FILTERS[0].label, 'All');
  assert.equal(FILTERS.find(f => f.id === 'active').title, 'Active torrents');
  assert.equal(status({ status: 6 }).label, 'Seeding');
  setLanguage('ru');
  assert.equal(FILTERS[0].label, 'Все');
  assert.equal(status({ status: 6 }).label, 'Раздаётся');
});
test('formats English units, decimal separators, ETA and singular/plural counts', () => {
  setLanguage('en');
  assert.equal(formatBytes(1536, true), '1.5 KB/s');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatEta(90), '2 min');
  assert.equal(formatEta(7200), '2h 0m');
  assert.equal(formatEta(-1), '—');
  assert.deepEqual([0, 1, 2, 21].map(torrentCount), ['0 torrents', '1 torrent', '2 torrents', '21 torrents']);
  assert.equal(tr('{count} файлов', { count: 1 }), '1 file');
  assert.equal(tr('{count} пиров', { count: 2 }), '2 peers');
  setLanguage('ru');
  assert.equal(formatBytes(1536, true), '1,5 КБ/с');
  assert.equal(torrentCount(21), '21 торрент');
  assert.equal(tr('{count} файлов', { count: 21 }), '21 файл');
  assert.equal(tr('{count} файлов', { count: 22 }), '22 файла');
});
test('handles unknown language preferences and unknown messages safely', () => {
  setLanguage('de');
  assert.equal(getLanguage(), 'ru');
  setLanguage('en');
  assert.equal(tr('Unrecognized server text'), 'Unrecognized server text');
  assert.equal(tr('осталось {time}', { time: '2 min' }), '2 min remaining');
  // Substitution is one pass, preserving braces or HTML in user content as data.
  assert.equal(tr('Убрать метку {label}', { label: 'Кино {time} <b>' }), 'Remove label Кино {time} <b>');
  assert.deepEqual(normalizeLabels([' Кино ']), ['Кино']);
  assert.equal(escapeHtml(tr('Убрать метку {label}', { label: '<b>' })), 'Remove label &lt;b&gt;');
});
test('localizes existing errors after the language changes', async () => {
  const error = new LocalizedError('Нет подключения к Transmission.');
  assert.match(error.message, /Нет подключения/);
  setLanguage('en');
  assert.equal(error.message, 'No connection to Transmission.');
  const rpc = new TransmissionRPC('/rpc', { fetchImpl: async () => new Response('', { status: 403 }) });
  await assert.rejects(rpc.call('session-get'), /Transmission denied access/);
});
test('English translations cover every declared UI message and preserve placeholders', async () => {
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const [source, value] of Object.entries(english)) {
    assert.ok(value.trim(), source);
    assert.deepEqual(placeholders(value), placeholders(source), source);
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)) {
    assert.ok(Object.hasOwn(english, match[1]), `Untranslated HTML: ${match[1]}`);
  }
  for (const file of ['app.js', 'lib/rpc.js', 'lib/model.js', 'lib/demo.js']) {
    const js = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of js.matchAll(/(?:tr|LocalizedError)\('([^']+)'/g)) {
      assert.ok(Object.hasOwn(english, match[1]), `${file}: ${match[1]}`);
    }
  }
});
