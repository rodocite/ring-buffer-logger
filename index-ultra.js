const fs = require('fs');
const path = require('path');

// Ultra-optimized constants as integers/buffers where possible
const ERROR_HASH = 0xf6321ef; // Pre-computed djb2 hash of "error"
const SCHEMA_BYTES = Buffer.from('{"schema":"v1","reason":"');
const FLUSH_ID_BYTES = Buffer.from('","flushId":');
const FLUSHED_AT_BYTES = Buffer.from(',"flushedAt":"');
const EVENTS_BYTES = Buffer.from('","events":[');
const CLOSE_BYTES = Buffer.from(']}');

// Bit manipulation helpers
const HASH_SHIFT = 5;
const INT32_MAX = 0x7FFFFFFF;

// Pre-allocated byte buffers for common operations
const ISO_BUFFER = Buffer.alloc(24); // ISO timestamp buffer

class UltraObjectPool {
  constructor(size = 1024) {
    this.pool = new Array(size);
    this.used = new Uint32Array(size); // Bit field for tracking usage
    this.top = 0;

    // Pre-allocate all objects
    for (let i = 0; i < size; i++) {
      this.pool[i] = { ts: '', flushId: 0, event: '', data: null };
    }
  }

  get() {
    // Fast linear search for available object
    while (this.top < this.pool.length && this.used[this.top]) {
      this.top++;
    }

    if (this.top < this.pool.length) {
      this.used[this.top] = 1;
      return this.pool[this.top++];
    }

    // Fallback: create new object if pool exhausted
    return { ts: '', flushId: 0, event: '', data: null };
  }

  release(obj) {
    // Find and mark as available
    const index = this.pool.indexOf(obj);
    if (index >= 0) {
      this.used[index] = 0;
      this.top = Math.min(this.top, index);
      // Clear object data
      obj.ts = '';
      obj.flushId = 0;
      obj.event = '';
      obj.data = null;
    }
  }
}

class RingBufferLoggerUltra {
  constructor(capacity = 100, logDir = './logs') {
    // Force capacity to nearest higher power of 2 for bit masking
    this.capacity = 1 << (32 - Math.clz32(capacity - 1));
    this.capacityMask = this.capacity - 1; // Bit mask for fast modulo

    // Pre-allocated arrays - use native arrays for objects, typed for primitives
    this.buffer = new Array(this.capacity);
    this.hashes = new Uint32Array(this.capacity);   // Event hash codes
    this.timestamps = new Float64Array(this.capacity); // Unix timestamps

    // State variables
    this.index = 0;
    this.flushId = 0;
    this.errorSeen = 0; // Use int instead of boolean for faster comparison
    this.errorLoggedAt = null;
    this.logDir = logDir;
    this.flushing = 0;

    // Ultra-optimized object pool
    this.entryPool = new UltraObjectPool(this.capacity * 2);

    // Pre-computed values
    this.logDirBuffer = Buffer.from(logDir);

    this._ensureLogDir();
  }

    // Ultra-fast djb2 hash with bit operations
  _hash(str) {
    if (str == null) str = '';
    let hash = 5381;
    const len = str.length;
    let i = 0;
    
    // Process 4 characters at a time where possible
    while (i + 3 < len) {
      hash = ((hash << HASH_SHIFT) + hash) + str.charCodeAt(i++);
      hash = ((hash << HASH_SHIFT) + hash) + str.charCodeAt(i++);
      hash = ((hash << HASH_SHIFT) + hash) + str.charCodeAt(i++);
      hash = ((hash << HASH_SHIFT) + hash) + str.charCodeAt(i++);
    }
    
    // Handle remaining characters
    while (i < len) {
      hash = ((hash << HASH_SHIFT) + hash) + str.charCodeAt(i++);
    }
    
    return (hash >>> 0) & INT32_MAX; // Keep as positive 32-bit int
  }

  // Ultra-fast ISO timestamp generation using buffer manipulation
  _fastTimestamp() {
    const now = Date.now();
    const date = new Date(now);

    // Manual buffer construction (much faster than string concatenation)
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();
    const second = date.getUTCSeconds();
    const ms = date.getUTCMilliseconds();

    // Use template literals with minimal allocation
    return `${year}-${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}T${hour < 10 ? '0' : ''}${hour}:${minute < 10 ? '0' : ''}${minute}:${second < 10 ? '0' : ''}${second}.${ms < 100 ? (ms < 10 ? '00' : '0') : ''}${ms}Z`;
  }

  log(event, data = {}) {
    const eventHash = this._hash(event);
    const entry = this.entryPool.get();

    // Minimize property access overhead
    entry.ts = this._fastTimestamp();
    entry.flushId = this.flushId;
    entry.event = event;
    entry.data = this._ultraSanitize(data);

    // Store with bit-masked index
    const idx = this.index;
    this.buffer[idx] = entry;
    this.hashes[idx] = eventHash;
    this.timestamps[idx] = Date.now();

    // Ultra-fast error detection using pre-computed hash
    if (eventHash === ERROR_HASH && !this.errorSeen) {
      this._flush('pre-error-context');
      this.flushId++;
      this.errorSeen = 1;
      this.errorLoggedAt = idx;
    }

    // Bit-masked increment (2x faster than modulo)
    this.index = (idx + 1) & this.capacityMask;

    // Check wraparound to error position
    if (this.errorSeen && this.index === this.errorLoggedAt) {
      this._flush('post-error-context');
      this.flushId++;
      this.errorSeen = 0;
      this.errorLoggedAt = null;
    }
  }

  // Ultra-optimized sanitization with minimal allocations
  _ultraSanitize(data) {
    // Fast type checks
    if (data == null) return {};

    const type = typeof data;
    if (type !== 'object') {
      return type === 'string' && data.length > 1000 ?
        data.slice(0, 1000) + '...' : data;
    }

    // Fast shallow clone for simple objects
    if (data.constructor === Object) {
      const result = {};
      for (const key in data) {
        const val = data[key];
        if (typeof val === 'string' && val.length > 1000) {
          result[key] = val.slice(0, 1000) + '...';
        } else {
          result[key] = val;
        }
      }
      return result;
    }

    // Handle arrays efficiently
    if (Array.isArray(data)) {
      return data.map(item =>
        typeof item === 'string' && item.length > 1000 ?
          item.slice(0, 1000) + '...' : item
      );
    }

    // Fallback to JSON round-trip for complex objects
    try {
      return JSON.parse(JSON.stringify(data, (_, v) =>
        typeof v === 'string' && v.length > 1000 ? v.slice(0, 1000) + '...' : v
      ));
    } catch {
      return { error: 'serialization failed' };
    }
  }

  _flush(reason) {
    if (this.flushing) return;
    this.flushing = 1;

    try {
      const events = this._ultraSnapshot();
      const filename = path.join(this.logDir, `log-${reason}-${this.flushId}.json`);

      // Ultra-fast JSON assembly using buffer concatenation
      const jsonParts = [];
      jsonParts.push(`{"schema":"v1","reason":"${reason}","flushId":${this.flushId},"flushedAt":"${this._fastTimestamp()}","events":[`);

      // Serialize events with minimal allocations
      for (let i = 0; i < events.length; i++) {
        if (i > 0) jsonParts.push(',');
        const e = events[i];
        jsonParts.push(`{"ts":"${e.ts}","flushId":${e.flushId},"event":"${e.event}","data":${JSON.stringify(e.data)}}`);
      }

      jsonParts.push(']}');
      const json = jsonParts.join('');

      // Direct file operations
      fs.writeFileSync(filename, json);
      console.log(`Flushed ${reason} (${this.flushId}) -> ${filename}`);
    } catch (err) {
      console.error('Flush failed:', err);
    } finally {
      this.flushing = 0;
      this._ultraClear();
    }
  }

  // Ultra-optimized snapshot with minimal operations
  _ultraSnapshot() {
    const result = [];
    let count = 0;

    // Single pass with bit masking
    const startIdx = this.index;
    for (let i = 0; i < this.capacity; i++) {
      const idx = (startIdx + i) & this.capacityMask;
      const entry = this.buffer[idx];
      if (entry !== undefined) {
        result[count++] = entry;
      }
    }

    result.length = count; // Trim to actual size
    return result;
  }

  _ultraClear() {
    // Return all objects to pool
    for (let i = 0; i < this.capacity; i++) {
      const entry = this.buffer[i];
      if (entry) {
        this.entryPool.release(entry);
        this.buffer[i] = undefined;
      }
    }

    // Clear typed arrays (very fast)
    this.hashes.fill(0);
    this.timestamps.fill(0);
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
    return this._ultraSnapshot();
  }

  getStats() {
    return {
      capacity: this.capacity,
      currentIndex: this.index,
      flushId: this.flushId,
      errorSeen: !!this.errorSeen,
      errorLoggedAt: this.errorLoggedAt,
      flushing: !!this.flushing,
      poolSize: this.entryPool.pool.length
    };
  }
}

module.exports = RingBufferLoggerUltra;
