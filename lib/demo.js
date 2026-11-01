// Explicit, isolated preview. Never used as a fallback for an unavailable daemon.
const GiB = 1024 ** 3;
const examples = [
  ['ubuntu-24.04.3-desktop-amd64.iso', 4, .734, 5.9, 4.31, .38, ['Linux']],
  ['Blender.Splash.Screens.Collection', 6, 1, 2.4, 0, 1.24, ['Творчество']],
  ['big_buck_bunny_1080p_surround.avi', 6, 1, .89, 0, .74, ['Кино']],
  ['debian-13.0.0-amd64-netinst.iso', 4, .382, .75, 1.82, .04, ['Linux']],
  ['Sintel.2010.1080p.mkv', 0, 1, 1.42, 0, 0, ['Кино']],
  ['fedora-workstation-live-43.x86_64.iso', 0, .168, 2.6, 0, 0, ['Linux']],
  ['Tears.of.Steel.2012.4K.mov', 6, 1, 6.7, 0, 2.08, ['Кино']],
];
export class DemoRPC {
  constructor() {
    this.session = { version: '4.0.6 · демо', 'download-dir': '/downloads', 'speed-limit-down-enabled': false, 'speed-limit-up-enabled': false, 'speed-limit-down': 10000, 'speed-limit-up': 1000, 'alt-speed-enabled': false, 'alt-speed-down': 500, 'alt-speed-up': 100 };
    this.torrents = examples.map(([name, status, percentDone, size, down, up, labels], i) => ({ id: i + 1, name, status, percentDone, sizeWhenDone: size * GiB, totalSize: size * GiB, rateDownload: down * 1024 ** 2, rateUpload: up * 1024 ** 2, peersConnected: [42, 18, 7, 23, 0, 0, 11][i], uploadRatio: .42 + i * .31, downloadedEver: size * GiB * percentDone, uploadedEver: size * GiB * .42, eta: 382 + i * 182, addedDate: 1770000000 - i * 86400, labels, error: 0, errorString: '', downloadDir: '/downloads', metadataPercentComplete: 1, hashString: String(i + 1).repeat(40), magnetLink: `magnet:?xt=urn:btih:${String(i + 1).repeat(40)}` }));
  }
  async call(method, args = {}) {
    await new Promise(resolve => setTimeout(resolve, 80));
    const targets = args.ids ? this.torrents.filter(t => args.ids.includes(t.id)) : this.torrents;
    if (method === 'session-get') return structuredClone(this.session);
    if (method === 'session-set') { Object.assign(this.session, args); return {}; }
    if (method === 'session-stats') return { downloadSpeed: this.torrents.reduce((s, t) => s + t.rateDownload, 0), uploadSpeed: this.torrents.reduce((s, t) => s + t.rateUpload, 0), torrentCount: this.torrents.length };
    if (method === 'torrent-get') return { torrents: targets.map(t => ({ ...t, ...this.details(t) })) };
    if (method === 'torrent-stop') { targets.forEach(t => Object.assign(t, { status: 0, rateDownload: 0, rateUpload: 0 })); return {}; }
    if (method === 'torrent-start') { targets.forEach(t => Object.assign(t, { status: t.percentDone === 1 ? 6 : 4, rateDownload: t.percentDone === 1 ? 0 : 1600000, rateUpload: 240000 })); return {}; }
    if (method === 'torrent-verify') { targets.forEach(t => Object.assign(t, { status: 2, recheckProgress: .4, rateDownload: 0, rateUpload: 0 })); return {}; }
    if (method === 'torrent-remove') { this.torrents = this.torrents.filter(t => !args.ids.includes(t.id)); return {}; }
    if (method === 'torrent-set') {
      for (const t of targets) {
        const details = this.details(t);
        for (const i of args['files-wanted'] || []) details.fileStats[i].wanted = true;
        for (const i of args['files-unwanted'] || []) details.fileStats[i].wanted = false;
        for (const [key, priority] of [['priority-high', 1], ['priority-normal', 0], ['priority-low', -1]]) for (const i of args[key] || []) details.fileStats[i].priority = priority;
      }
      return {};
    }
    if (method === 'torrent-add') throw new Error('Это демо. Добавление файлов доступно при подключении к Transmission.');
    if (method === 'torrent-reannounce') return {};
    throw new Error(`Метод ${method} не поддерживается в демо.`);
  }
  details(t) {
    if (t.details) return t.details;
    const files = t.name.endsWith('.Collection') ? ['01 - Blender 4.5.png', '02 - Studio lights.png', '03 - Geometry nodes.png', '04 - Cycles render.png', 'LICENSE.txt'].map((name, i) => ({ name: `${t.name}/${name}`, length: i === 4 ? 1024 : Math.round(t.totalSize / 4), bytesCompleted: i === 4 ? 1024 : Math.round(t.totalSize / 4) })) : [{ name: t.name, length: t.totalSize, bytesCompleted: t.totalSize * t.percentDone }];
    t.details = { files, fileStats: files.map(f => ({ bytesCompleted: f.bytesCompleted, wanted: true, priority: 0 })), trackerStats: [{ id: 0, host: 'tracker.opentrackr.org', announce: 'udp://tracker.opentrackr.org:1337/announce', lastAnnounceResult: 'Success', seederCount: 128, leecherCount: 42 }], peers: Array.from({ length: Math.min(t.peersConnected, 6) }, (_, i) => ({ address: `192.0.2.${10 + i}`, clientName: ['Transmission 4.0.6', 'qBittorrent 5.1.0', 'libtorrent 2.0'][i % 3], progress: .3 + i * .12, rateToClient: t.rateDownload / 6, rateToPeer: t.rateUpload / 6, isEncrypted: true })), pieces: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i < 32 * t.percentDone ? 255 : 0))), pieceCount: 256, pieceSize: 262144, comment: 'Свободно распространяемый контент. Данные приведены для демонстрации интерфейса.', creator: 'Transmission', dateCreated: 1750000000, isPrivate: false };
    return t.details;
  }
}
