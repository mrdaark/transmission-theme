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
          if (!token) throw new Error('Сервер не передал X-Transmission-Session-Id. Проверьте reverse proxy.');
          this.sessionId = token;
          continue;
        }
        if (response.status === 401) throw new Error('Нужна авторизация. Откройте веб-интерфейс Transmission и войдите, затем обновите страницу.');
        if (response.status === 403) throw new Error('Transmission отклонил доступ. Проверьте RPC whitelist и настройки proxy.');
        if (!response.ok) throw new Error(`Ошибка HTTP ${response.status}. Проверьте путь к RPC в настройках.`);
        let data;
        try { data = await response.json(); } catch { throw new Error('Ответ сервера не похож на Transmission RPC. Проверьте путь в настройках.'); }
        if (data.result !== 'success') throw new Error(data.result || 'Неизвестная ошибка Transmission.');
        return data.arguments || {};
      }
      throw new Error('Не удалось согласовать сессию Transmission. Повторите подключение.');
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Сервер не ответил за 15 секунд.');
      throw error;
    } finally { clearTimeout(timer); }
  }
}
