const fs = require('fs');
const path = require('path');

// Pre-allocated string constants to avoid string creation
const PRE_ERROR_CONTEXT = 'pre-error-context';
const POST_ERROR_CONTEXT = 'post-error-context';
const ERROR_EVENT = 'error';
const SCHEMA_V1 = 'v1';
const SERIALIZATION_FAILED = '{"error":"serialization failed"}';

// Object pool to reduce GC pressure
class ObjectPool {
  constructor(createFn, resetFn, initialSize = 100) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.pool = [];
    this.index = 0;

    // Pre-allocate objects
    for (let i = 0; i < initialSize; i++) {
      this.pool[i] = createFn();
    }
  }

  get() {
    if (this.index > 0) {
      return this.pool[--this.index];
    }
    return this.createFn();
  }

  release(obj) {
    if (this.index < this.pool.length) {
      this.resetFn(obj);
      this.pool[this.index++] = obj;
    }
  }
}

class RingBufferLoggerOptimized {
  constructor(capacity = 100, logDir = './logs') {
    // Ensure capacity is power of 2 for bit masking
    this.capacity = this._nextPowerOf2(capacity);
    this.capacityMask = this.capacity - 1; // For fast modulo using bitwise AND

    // Use typed arrays for better memory layout and performance
    this.buffer = new Array(this.capacity);
    this.timestamps = new Float64Array(this.capacity);  // Pre-allocated timestamp storage
    this.eventHashes = new Uint32Array(this.capacity);  // Hash-based event comparison

    this.index = 0;
    this.flushId = 0;
    this.errorSeen = false;
    this.errorLoggedAt = null;
    this.logDir = logDir;
    this.flushing = false;

    // Pre-compute common hashes
    this.errorHash = this._hash(ERROR_EVENT);

    // Object pools to reduce GC pressure
    this.entryPool = new ObjectPool(
      () => ({ ts: '', flushId: 0, event: '', data: null }),
      (obj) => { obj.ts = ''; obj.flushId = 0; obj.event = ''; obj.data = null; }
    );

    // Create log directory
    this._ensureLogDir();
  }

  // Fast power of 2 calculation using bit operations
  _nextPowerOf2(n) {
    if (n <= 1) return 1;
    n--;
    n |= n >> 1;
    n |= n >> 2;
    n |= n >> 4;
    n |= n >> 8;
    n |= n >> 16;
    return n + 1;
  }

  // Fast string hashing (djb2 algorithm)
  _hash(str) {
    if (str == null) str = '';
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash >>> 0; // Convert to unsigned 32-bit
  }

  // Optimized ISO timestamp generation
  _fastISOString() {
    const now = Date.now();
    const date = new Date(now);

    // Manual ISO string construction (faster than toISOString())
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();
    const second = date.getUTCSeconds();
    const ms = date.getUTCMilliseconds();

    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}Z`;
  }

  log(event, data = {}) {
    const currentTime = Date.now();
    const eventHash = this._hash(event);

    // Get object from pool instead of creating new one
    const entry = this.entryPool.get();
    entry.ts = this._fastISOString();
    entry.flushId = this.flushId;
    entry.event = event;
    entry.data = this._fastSanitize(data);

    // Store in buffer
    this.buffer[this.index] = entry;
    this.timestamps[this.index] = currentTime;
    this.eventHashes[this.index] = eventHash;

    // Fast error detection using hash comparison
    if (eventHash === this.errorHash && !this.errorSeen) {
      this._flush(PRE_ERROR_CONTEXT);
      this.flushId++;
      this.errorSeen = true;
      this.errorLoggedAt = this.index;
    }

    // Use bit masking instead of modulo for 2x performance
    this.index = (this.index + 1) & this.capacityMask;

    // Check if we've cycled back to error position
    if (this.errorSeen && this.index === this.errorLoggedAt) {
      this._flush(POST_ERROR_CONTEXT);
      this.flushId++;
      this.errorSeen = false;
      this.errorLoggedAt = null;
    }
  }

  // Optimized sanitization with minimal object creation
  _fastSanitize(data) {
    if (data === null || data === undefined) return {};
    if (typeof data !== 'object') return data;

    try {
      // Use a custom replacer for faster serialization
      const seen = new Set();
      const result = this._fastClone(data, seen);
      return result;
    } catch {
      return { error: 'serialization failed' };
    }
  }

  // Fast deep clone with cycle detection and string truncation
  _fastClone(obj, seen = new Set()) {
    if (obj === null || typeof obj !== 'object') {
      if (typeof obj === 'string' && obj.length > 1000) {
        return obj.slice(0, 1000) + '...';
      }
      return obj;
    }

    if (seen.has(obj)) {
      return { error: 'circular reference' };
    }

    seen.add(obj);

    if (Array.isArray(obj)) {
      const result = new Array(obj.length);
      for (let i = 0; i < obj.length; i++) {
        result[i] = this._fastClone(obj[i], seen);
      }
      seen.delete(obj);
      return result;
    }

    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = this._fastClone(obj[key], seen);
      }
    }

    seen.delete(obj);
    return result;
  }

  _flush(reason) {
    if (this.flushing) return;
    this.flushing = true;

    try {
      const events = this._fastSnapshot();
      const filename = path.join(this.logDir, `log-${reason}-${this.flushId}.json`);

      // Manual JSON construction for better performance
      const jsonParts = [
        '{"schema":"', SCHEMA_V1, '","reason":"', reason,
        '","flushId":', this.flushId.toString(),
        ',"flushedAt":"', this._fastISOString(), '","events":['
      ];

      // Manually serialize events array
      for (let i = 0; i < events.length; i++) {
        if (i > 0) jsonParts.push(',');
        jsonParts.push(this._fastSerializeEvent(events[i]));
      }

      jsonParts.push(']}');
      const json = jsonParts.join('');

      // Synchronous I/O for consistency (can be optimized further with async)
      const fd = fs.openSync(filename, 'w');
      fs.writeSync(fd, json);
      fs.fsyncSync(fd);
      fs.closeSync(fd);

      console.log(`Flushed ${reason} (${this.flushId}) -> ${filename}`);
    } catch (err) {
      console.error('Flush failed:', err);
    } finally {
      this.flushing = false;
      this._clear();
    }
  }

  // Fast event serialization
  _fastSerializeEvent(event) {
    const parts = [
      '{"ts":"', event.ts, '","flushId":', event.flushId.toString(),
      ',"event":"', event.event, '","data":', JSON.stringify(event.data), '}'
    ];
    return parts.join('');
  }

  // Optimized snapshot with minimal array operations
  _fastSnapshot() {
    const out = [];
    let count = 0;

    // Single loop with bit masking
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.index + i) & this.capacityMask;
      const entry = this.buffer[idx];
      if (entry) {
        out[count++] = entry;
      }
    }

    // Trim array to actual size
    out.length = count;
    return out;
  }

  _clear() {
    // Return objects to pool instead of creating new ones
    for (let i = 0; i < this.capacity; i++) {
      if (this.buffer[i]) {
        this.entryPool.release(this.buffer[i]);
        this.buffer[i] = null;
      }
    }

    // Fast array clearing using fill
    this.timestamps.fill(0);
    this.eventHashes.fill(0);
  }

  _ensureLogDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      console.error('Failed to create log directory:', err.message);
    }
  }

  getCurrentBuffer() {
    return this._fastSnapshot();
  }

  getStats() {
    return {
      capacity: this.capacity,
      currentIndex: this.index,
      flushId: this.flushId,
      errorSeen: this.errorSeen,
      errorLoggedAt: this.errorLoggedAt,
      flushing: this.flushing,
      objectPoolSize: this.entryPool.index
    };
  }
}

module.exports = RingBufferLoggerOptimized;
