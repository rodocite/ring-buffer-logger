const fs = require('fs');
const path = require('path');

class RingBufferLogger {
  constructor(capacity = 100, logDir = './logs') {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.index = 0;

    this.flushId = 0;
    this.errorSeen = false;
    this.errorLoggedAt = null;
    this.logDir = logDir;
    this.flushing = false;

    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch (err) {
        console.error('Failed to create log directory:', err.message);
        // Continue operation without the directory - flushes will fail gracefully
      }
    }
  }

  log(event, data = {}) {
    const entry = {
      ts: new Date().toISOString(),
      flushId: this.flushId,
      event,
      data: this._sanitize(data)
    };

    this.buffer[this.index] = entry;

    if (event === 'error' && !this.errorSeen) {
      this._flush('pre-error-context');
      this.flushId++;
      this.errorSeen = true;
      this.errorLoggedAt = this.index;
    }

    this.index = (this.index + 1) % this.capacity;

    if (this.errorSeen && this.index === this.errorLoggedAt) {
      this._flush('post-error-context');
      this.flushId++;
      this.errorSeen = false;
      this.errorLoggedAt = null;
    }
  }

  _flush(reason) {
    if (this.flushing) return;
    this.flushing = true;

    try {
      const events = this._snapshot();
      const filename = path.join(this.logDir, `log-${reason}-${this.flushId}.json`);
      const json = JSON.stringify({
        schema: 'v1',
        reason,
        flushId: this.flushId,
        flushedAt: new Date().toISOString(),
        events
      }, null, 2);

      const fd = fs.openSync(filename, 'w');
      fs.writeSync(fd, json);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      console.log(`Flushed ${reason} (${this.flushId}) -> ${filename}`);
    } catch (err) {
      console.error('Flush failed:', err);
    } finally {
      this.flushing = false;
      this._clear(); // wipe buffer after each flush
    }
  }

  _snapshot() {
    const out = [];
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.index + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry) out.push(entry);
    }
    return out;
  }

  _sanitize(data) {
    if (data === null || data === undefined) return {};
    try {
      const json = JSON.stringify(data, (_, value) =>
        typeof value === 'string' && value.length > 1000
          ? value.slice(0, 1000) + '...'
          : value
      );
      return JSON.parse(json);
    } catch {
      return { error: 'serialization failed' };
    }
  }

  _clear() {
    this.buffer.fill(undefined);
  }

  getCurrentBuffer() {
    return this._snapshot();
  }

  getStats() {
    return {
      capacity: this.capacity,
      currentIndex: this.index,
      flushId: this.flushId,
      errorSeen: this.errorSeen,
      errorLoggedAt: this.errorLoggedAt,
      flushing: this.flushing
    };
  }
}

module.exports = RingBufferLogger;
