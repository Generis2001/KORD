// Conversations are backed up before network requests and synchronized in order per thread.
(() => {
  class ConversationHistory {
    constructor(account, { storage = localStorage, request = fetch, onChange = () => {}, onError = () => {} } = {}) {
      this.account = account.trim().toLowerCase();
      this.storage = storage;
      this.request = request;
      this.onChange = onChange;
      this.onError = onError;
      this.key = 'kord_conversations_v1_' + this.account;
      this.records = new Map();
      this.queues = new Map();
      this.removing = new Set();
      this.deleted = new Set();
      try {
        const cached = JSON.parse(storage.getItem(this.key) || '{}');
        this.activeId = cached.activeId;
        for (const record of cached.records || []) {
          if (typeof record.id === 'string' && Array.isArray(record.messages)) this.records.set(record.id, { ...record, version: 0 });
        }
      } catch { this.onError('Local conversation backup could not be loaded.'); }
    }
    headers() { return { 'Content-Type': 'application/json', 'x-kord-account': this.account }; }
    cache() {
      try { this.storage.setItem(this.key, JSON.stringify({ activeId: this.activeId, records: [...this.records.values()] })); }
      catch { this.onError('Local backup is unavailable. Keep this page open until your conversation finishes syncing.'); }
      this.onChange();
    }
    create() {
      const record = { id: 'conv_' + crypto.randomUUID(), title: 'New conversation', messages: [], updatedAt: new Date().toISOString(), pending: false, loaded: true, version: 0 };
      this.records.set(record.id, record);
      this.setActive(record.id);
      return record;
    }
    setActive(id) { this.activeId = id; this.cache(); }
    get(id) { return this.records.get(id); }
    list() {
      return [...this.records.values()].filter(record => record.messages.length || !record.loaded)
        .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    }
    append(id, message) {
      const record = this.get(id);
      if (!record || this.deleted.has(id)) return;
      record.messages.push(message);
      this.changed(record);
    }
    reply(id, requestId, data) {
      const record = this.get(id);
      if (!record || this.deleted.has(id)) return false;
      const index = record.messages.findIndex(message => message.role === 'user' && message.requestId === requestId);
      if (index < 0 || record.messages.some(message => message.role === 'assistant' && message.requestId === requestId)) return false;
      // Insert beside the exact directive even when a later request finishes first.
      record.messages.splice(index + 1, 0, { role: 'assistant', requestId, data });
      this.changed(record);
      return true;
    }
    changed(record) {
      const id = record.id;
      const first = record.messages.find(message => message.role === 'user');
      record.title = first ? first.text.slice(0,36) + (first.text.length > 36 ? '…' : '') : 'KORD Session';
      record.updatedAt = new Date().toISOString();
      record.pending = true;
      record.version++;
      this.cache();
      if (!this.removing.has(id)) void this.sync(id);
    }
    sync(id) {
      const previous = this.queues.get(id) || Promise.resolve();
      const next = previous.catch(() => {}).then(async () => {
        const record = this.get(id);
        if (!record?.pending || this.deleted.has(id) || this.removing.has(id)) return true;
        const version = record.version;
        const body = JSON.stringify({ id, title: record.title, messages: record.messages });
        try {
          const response = await this.request('/api/conversations', { method: 'POST', headers: this.headers(), body, keepalive: body.length < 60000 });
          if (!response.ok) throw new Error('Conversation saved locally; cloud sync will retry when you return or reconnect.');
          if (record.version === version) record.pending = false;
          this.cache();
          return true;
        } catch { this.onError('Conversation saved locally; cloud sync will retry when you return or reconnect.'); return false; }
      });
      this.queues.set(id, next);
      return next;
    }
    async flush() {
      await Promise.all(this.list().filter(record => record.pending).map(record => this.sync(record.id)));
    }
    async refresh() {
      await this.flush();
      const versions = new Map([...this.records].map(([id, record]) => [id, record.version]));
      const response = await this.request('/api/conversations', { headers: this.headers() }).catch(() => null);
      if (!response?.ok) throw new Error('Showing saved conversations from this browser. Cloud history will retry when you reconnect.');
      const summaries = await response.json();
      if (!Array.isArray(summaries)) throw new Error('Conversation history could not be loaded.');
      const ids = new Set(summaries.map(record => record.id));
      for (const [id, record] of this.records) {
        if (!record.pending && record.version === versions.get(id) && (record.messages.length || record.loaded === false) && !ids.has(id)) this.records.delete(id);
      }
      for (const summary of summaries) {
        if (this.deleted.has(summary.id)) continue;
        const record = this.get(summary.id);
        if (record && (record.pending || record.version !== versions.get(summary.id))) continue;
        if (record) { record.title = summary.title; record.updatedAt = summary.updatedAt; }
        else this.records.set(summary.id, { ...summary, messages: [], loaded: false, pending: false, version: 0 });
      }
      this.cache();
      return this.list();
    }
    async load(id) {
      const cached = this.get(id);
      const version = cached?.version || 0;
      if (cached?.pending) return cached;
      try {
        const response = await this.request('/api/conversations?id=' + encodeURIComponent(id), { headers: this.headers() });
        if (!response.ok) throw new Error('Conversation could not be opened. Try again shortly.');
        const data = await response.json();
        const messages = Array.isArray(data.messages) ? data.messages : JSON.parse(data.messagesJson || '[]');
        if (!Array.isArray(messages)) throw new Error('Conversation messages could not be loaded.');
        if (this.deleted.has(id)) throw new Error('Conversation was deleted.');
        const record = this.get(id) || { id, messages: [], version: 0 };
        // An incoming reply or a new user message takes precedence over an older in-flight read.
        if (!record.pending && record.version === version) {
          record.messages.splice(0,record.messages.length,...messages);
          Object.assign(record, { title: data.title, updatedAt: data.updatedAt, loaded: true, pending: false });
          this.records.set(id, record);
          this.cache();
        }
        return record;
      } catch (error) {
        if (cached?.loaded && !this.deleted.has(id)) { this.onError('Showing the local copy of this conversation.'); return cached; }
        throw error;
      }
    }
    async remove(id) {
      this.removing.add(id);
      try {
        await this.queues.get(id);
        const response = await this.request('/api/conversations', { method: 'DELETE', headers: this.headers(), body: JSON.stringify({ id }) });
        if (!response.ok && response.status !== 404) throw new Error('Conversation could not be deleted. Try again shortly.');
        this.deleted.add(id);
        this.records.delete(id);
        if (this.activeId === id) this.activeId = null;
        this.cache();
      } finally { this.removing.delete(id); }
    }
  }
  window.ConversationHistory = ConversationHistory;
})();
