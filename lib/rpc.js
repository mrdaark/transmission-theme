import { tr, LocalizedError } from './i18n.js';
export class TransmissionRPC {
  constructor(endpoint, { fetchImpl = globalThis.fetch, timeout = 15000 } = {}) {
    this.endpoint = endpoint;
    this.fetch = (...args) => fetchImpl.call(globalThis, ...args);
    this.timeout = timeout;
    this.sessionId = '';
    this.tag = 0;
  }
  async call(method, args = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const tag = ++this.tag;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const headers = { 'Content-Type': 'application/json' };
        if (this.sessionId) headers['X-Transmission-Session-Id'] = this.sessionId;
        const response = await this.fetch(this.endpoint, {
          method: 'POST', headers, credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
          cache: 'no-store', signal: controller.signal, body: JSON.stringify({ method, arguments: args, tag }),
        });
        if (response.status === 409) {
          const token = response.headers.get('X-Transmission-Session-Id');
          if (!token) throw new LocalizedError('Сервер не передал X-Transmission-Session-Id. Проверьте reverse proxy.');
          this.sessionId = token;
          continue;
        }
        if (response.status === 401) throw new LocalizedError('Нужна авторизация. Откройте веб-интерфейс Transmission и войдите, затем обновите страницу.');
        if (response.status === 403) throw new LocalizedError('Transmission отклонил доступ. Проверьте RPC whitelist и настройки proxy.');
        if (!response.ok) throw new LocalizedError('Ошибка HTTP {status}. Проверьте путь к RPC в настройках.', { status: response.status });
        let data;
        try { data = await response.json(); } catch { throw new LocalizedError('Ответ сервера не похож на Transmission RPC. Проверьте путь в настройках.'); }
        if (data.result !== 'success') throw new Error(data.result || tr('Неизвестная ошибка Transmission.'));
        return data.arguments || {};
      }
      throw new LocalizedError('Не удалось согласовать сессию Transmission. Повторите подключение.');
    } catch (error) {
      if (error.name === 'AbortError') throw new LocalizedError('Сервер не ответил за {seconds} секунд.', { seconds: Math.ceil(this.timeout / 1000) });
      throw error;
    } finally { clearTimeout(timer); }
  }
}
