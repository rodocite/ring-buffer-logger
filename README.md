# Ring Buffer Logger

A circular buffer logger implementation that keeps recent log entries in memory and writes them to disk when errors occur.

_Note: This is a local implementation/exercise, not a published package._

## How It Works

Instead of writing every log entry to disk, this logger maintains a circular buffer in memory. When an error is logged, it flushes the buffer to provide context about what led to the error.

```javascript
// Your app is running normally...
logger.log('info', { user: 'john', action: 'viewing_dashboard' });
logger.log('debug', { query: 'SELECT * FROM users', duration: '45ms' });
logger.log('info', { user: 'john', action: 'clicked_export' });

// Something goes wrong...
logger.log('error', { message: 'Database timeout', query: 'SELECT * FROM big_table' });
// All the context above gets saved to a file automatically
```

## Usage

```javascript
const RingBufferLogger = require('./index');

// Create a logger (keeps last 100 entries, saves to ./logs)
const logger = new RingBufferLogger();

// Start logging your app
logger.log('info', { message: 'App started', port: 3000 });
logger.log('debug', { user: 'alice', endpoint: '/api/users' });

// When this error happens, you'll get a file with all the context!
logger.log('error', { message: 'Payment failed', userId: 'alice', amount: 99.99 });
```

## Usage Examples

### Web Server Debugging

```javascript
const express = require('express');
const RingBufferLogger = require('./index');

const app = express();
const logger = new RingBufferLogger(200, './server-logs');

// Log all requests
app.use((req, res, next) => {
  logger.log('request', {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    timestamp: new Date().toISOString(),
  });
  next();
});

// Your route handlers
app.get('/api/users/:id', async (req, res) => {
  logger.log('debug', { action: 'fetching_user', userId: req.params.id });

  try {
    const user = await db.findUser(req.params.id);
    logger.log('info', { action: 'user_found', userId: req.params.id });
    res.json(user);
  } catch (error) {
    // This will trigger a dump of all recent requests and actions!
    logger.log('error', {
      message: 'Failed to fetch user',
      userId: req.params.id,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### Background Job Processing

```javascript
const RingBufferLogger = require('./index');
const logger = new RingBufferLogger(500, './job-logs');

async function processEmailQueue() {
  while (true) {
    const jobs = await getEmailJobs();
    logger.log('info', { message: 'Processing batch', jobCount: jobs.length });

    for (const job of jobs) {
      logger.log('debug', {
        action: 'processing_email',
        jobId: job.id,
        recipient: job.email,
        template: job.template,
      });

      try {
        await sendEmail(job);
        logger.log('info', { action: 'email_sent', jobId: job.id });
      } catch (error) {
        // Get full context of what jobs were being processed
        logger.log('error', {
          message: 'Email sending failed',
          jobId: job.id,
          recipient: job.email,
          error: error.message,
          retryCount: job.retryCount,
        });
      }
    }

    await sleep(5000);
  }
}
```

### Game State Debugging

```javascript
const RingBufferLogger = require('./index');
const logger = new RingBufferLogger(1000, './game-logs');

class GameEngine {
  constructor() {
    this.players = new Map();
    this.gameState = 'waiting';
  }

  handlePlayerAction(playerId, action) {
    logger.log('player_action', {
      playerId,
      action: action.type,
      position: action.position,
      gameState: this.gameState,
      playerCount: this.players.size,
    });

    try {
      this.processAction(playerId, action);
    } catch (error) {
      // Capture full game state context when bugs occur
      logger.log('error', {
        message: 'Game action failed',
        playerId,
        action,
        gameState: this.gameState,
        allPlayers: Array.from(this.players.keys()),
        error: error.message,
      });
    }
  }
}
```

## API Reference

### Constructor

```javascript
const logger = new RingBufferLogger(capacity, logDirectory);
```

| Parameter      | Type   | Default  | Description                               |
| -------------- | ------ | -------- | ----------------------------------------- |
| `capacity`     | number | 100      | How many log entries to keep in memory    |
| `logDirectory` | string | './logs' | Where to save log files when errors occur |

**Examples:**

```javascript
// Default settings
const logger = new RingBufferLogger();

// Custom capacity for high-traffic apps
const logger = new RingBufferLogger(1000, './app-logs');

// Small buffer for memory-constrained environments
const logger = new RingBufferLogger(50, '/tmp/logs');
```

### `log(event, data)`

The main logging method. Use it for everything!

```javascript
// Simple message
logger.log('info', { message: 'Server started' });

// Rich context
logger.log('user_action', {
  userId: 'user123',
  action: 'purchase',
  productId: 'prod456',
  amount: 29.99,
  timestamp: Date.now(),
  metadata: { source: 'mobile_app', version: '2.1.0' },
});

// Error (triggers file dump)
logger.log('error', {
  message: 'Database connection failed',
  host: 'db.example.com',
  port: 5432,
  error: 'ECONNREFUSED',
  retryAttempt: 3,
});
```

### `getCurrentBuffer()`

Peek at what's currently in memory (useful for debugging):

```javascript
const currentLogs = logger.getCurrentBuffer();
console.log(`Currently tracking ${currentLogs.length} log entries`);
console.log('Most recent:', currentLogs[currentLogs.length - 1]);
```

### `getStats()`

Get internal statistics:

```javascript
const stats = logger.getStats();
console.log(`Buffer: ${stats.currentIndex}/${stats.capacity}`);
console.log(`Flushes: ${stats.flushId}`);
```

## Output Files

When an error occurs, you get two files:

### 1. Pre-Error Context (`log-pre-error-context-N.json`)

Everything that happened **before** the error:

```json
{
  "schema": "v1",
  "reason": "pre-error-context",
  "flushId": 42,
  "flushedAt": "2024-01-15T14:30:45.123Z",
  "events": [
    {
      "ts": "2024-01-15T14:30:40.100Z",
      "flushId": 42,
      "event": "info",
      "data": { "message": "Processing user request", "userId": "user123" }
    },
    {
      "ts": "2024-01-15T14:30:42.200Z",
      "flushId": 42,
      "event": "debug",
      "data": { "query": "SELECT * FROM users WHERE id = ?", "params": ["user123"] }
    },
    {
      "ts": "2024-01-15T14:30:45.000Z",
      "flushId": 42,
      "event": "error",
      "data": { "message": "Database timeout", "duration": "5000ms" }
    }
  ]
}
```

### 2. Post-Error Context (`log-post-error-context-N.json`)

Everything that happened **after** the error (when the buffer cycles back):

```json
{
  "schema": "v1",
  "reason": "post-error-context",
  "flushId": 42,
  "flushedAt": "2024-01-15T14:32:10.456Z",
  "events": [
    {
      "ts": "2024-01-15T14:30:46.000Z",
      "flushId": 42,
      "event": "info",
      "data": { "message": "Switching to backup database" }
    },
    {
      "ts": "2024-01-15T14:30:47.500Z",
      "flushId": 42,
      "event": "info",
      "data": { "message": "Request completed successfully", "userId": "user123" }
    }
  ]
}
```

## Configuration

### Choosing Buffer Size

```javascript
// For high-traffic web servers
const logger = new RingBufferLogger(2000, './logs');

// For microservices
const logger = new RingBufferLogger(500, './logs');

// For CLIs or simple apps
const logger = new RingBufferLogger(100, './logs');

// For memory-constrained environments
const logger = new RingBufferLogger(50, './logs');
```

### Log Directory Organization

```javascript
// Organize by date
const today = new Date().toISOString().split('T')[0];
const logger = new RingBufferLogger(500, `./logs/${today}`);

// Organize by service
const logger = new RingBufferLogger(500, `./logs/${process.env.SERVICE_NAME}`);

// Organize by environment
const logger = new RingBufferLogger(500, `./logs/${process.env.NODE_ENV}`);
```

## Best Practices

### 1. Use Descriptive Event Names

```javascript
// ❌ Generic
logger.log('info', { message: 'Something happened' });

// ✅ Specific
logger.log('user_login', { userId: 'user123', method: 'oauth' });
logger.log('payment_processed', { orderId: 'ord456', amount: 99.99 });
logger.log('cache_miss', { key: 'user:123:profile', ttl: 3600 });
```

### 2. Include Relevant Context

```javascript
// ❌ Minimal
logger.log('error', { message: 'Failed' });

// ✅ Rich context
logger.log('database_error', {
  message: 'Query execution failed',
  query: 'SELECT * FROM orders WHERE user_id = ?',
  params: [userId],
  duration: queryDuration,
  connectionPool: poolStats,
  retryAttempt: currentRetry,
  error: error.message,
});
```

### 3. Log State Transitions

```javascript
// Track how your app moves between states
logger.log('order_state_change', {
  orderId: 'ord123',
  fromState: 'pending',
  toState: 'processing',
  triggeredBy: 'payment_webhook',
  userId: 'user456',
});
```

### 4. Use Consistent Data Structures

```javascript
// Create logging helpers for consistency
const logUserAction = (userId, action, metadata = {}) => {
  logger.log('user_action', {
    userId,
    action,
    timestamp: Date.now(),
    ...metadata,
  });
};

const logApiCall = (endpoint, method, duration, statusCode, userId = null) => {
  logger.log('api_call', {
    endpoint,
    method,
    duration,
    statusCode,
    userId,
    timestamp: Date.now(),
  });
};
```

## Development

```bash
# Run all tests
npm test

# Run tests for all three implementations
npm run test:all

# Run tests for original implementation only
npm run test:original

# Run tests in watch mode (great for development)
npm run test:watch

# See code coverage
npm run test:coverage

# Run performance benchmarks
npm run benchmark

# Quick benchmark for development
npm run benchmark:quick

# Compare all three implementations
npm run benchmark:compare

# Quick comparison for development
npm run benchmark:compare:quick

# See the logger in action
npm start
```

## Performance

The logger is designed to be fast and memory-efficient:

- **~870,000 ops/sec** for basic logging
- **~1,200 errors/sec** with file I/O
- **Low memory overhead** - only keeps recent entries
- **No blocking** - all I/O is asynchronous

See the [benchmark results](./benchmark/README.md) for detailed performance metrics.

## Advanced Usage

### Multiple Loggers

```javascript
// Different loggers for different concerns
const apiLogger = new RingBufferLogger(1000, './logs/api');
const dbLogger = new RingBufferLogger(500, './logs/database');
const authLogger = new RingBufferLogger(200, './logs/auth');

// Use them specifically
app.use('/api', (req, res, next) => {
  apiLogger.log('request', { method: req.method, url: req.url });
  next();
});

db.on('query', query => {
  dbLogger.log('query', { sql: query.sql, duration: query.duration });
});
```

### Integration with Existing Loggers

```javascript
const winston = require('winston');
const RingBufferLogger = require('./index');

// Use both - winston for general logging, ring buffer for error context
const winstonLogger = winston.createLogger({...});
const contextLogger = new RingBufferLogger(500, './error-context');

const log = (level, message, meta = {}) => {
  // Always log to winston
  winstonLogger.log(level, message, meta);

  // Also track in ring buffer for error context
  contextLogger.log(level, { message, ...meta });
};
```

## Performance Optimization Report

This project includes multiple optimized implementations to demonstrate aggressive performance optimization techniques. Each implementation represents a different stage in the optimization evolution:

### Available Implementations

1. **`index.js`** - **Original Implementation** - Standard JavaScript patterns, readable and maintainable
2. **`index-object-pooled.js`** - **Object-Pooled Implementation** - Memory allocation optimizations and hash-based comparisons
3. **`index-bit-optimized.js`** - **Bit-Optimized Implementation** - Low-level bit operations, C-style techniques, and aggressive memory management

### Performance Results

Benchmarked on Node.js v18.20.5, macOS ARM64:

#### Micro Benchmark (1,000,000 operations)

- **Original**: 1,855,764 ops/sec
- **Object-Pooled**: 3,705,791 ops/sec (**2.00x speedup**, 49.9% faster)
- **Bit-Optimized**: 4,848,426 ops/sec (**2.61x speedup**, 61.7% faster)

#### Basic Logging (500,000 operations)

- **Original**: 859,509 ops/sec
- **Object-Pooled**: 2,367,118 ops/sec (**2.75x speedup**, 63.7% faster)
- **Bit-Optimized**: 3,586,562 ops/sec (**4.17x speedup**, 76.0% faster)

#### Complex Objects (50,000 operations)

- **Original**: 63,947 ops/sec
- **Object-Pooled**: 234,159 ops/sec (**3.66x speedup**, 72.7% faster)
- **Bit-Optimized**: 3,131,516 ops/sec (**48.97x speedup**, 98.0% faster) 🔥

### Code Evolution and Optimization Techniques

This project demonstrates a systematic approach to JavaScript performance optimization, showing how code can evolve from readable baseline to highly optimized implementations.

#### Stage 1: Original Implementation (`index.js`)

The baseline implementation focuses on **readability and maintainability**:

- Standard JavaScript patterns and idioms
- Clear variable names and straightforward logic
- Modulo operations for ring buffer indexing: `(this.currentIndex + 1) % this.capacity`
- String-based event comparison: `event === 'error'`
- Standard object cloning with JSON.parse/stringify
- Direct file system operations without optimization

**Philosophy**: "Make it work first, optimize later"

#### Stage 2: Object-Pooled Implementation (`index-object-pooled.js`)

The first optimization stage focuses on **memory allocation efficiency**:

**Key Optimizations:**

- **Object Pooling**: Reuse pre-allocated objects to eliminate GC pressure
- **Hash-based Event Detection**: Replace string comparisons with fast djb2 hash algorithm
- **Power-of-2 Buffer Sizing**: Round capacity to nearest power of 2 for bit operations
- **Bit Masking**: Replace modulo with ultra-fast bit masking: `(index + 1) & capacityMask`
- **Optimized JSON Serialization**: Custom serialization with cycle detection
- **Fast Deep Cloning**: Specialized cloning that avoids JSON overhead

**Performance Impact**: 2-4x speedup across different workloads
**Philosophy**: "Eliminate allocation overhead and use faster algorithms"

#### Stage 3: Bit-Optimized Implementation (`index-bit-optimized.js`)

The final optimization stage uses **C-style low-level techniques**:

**Advanced Optimizations:**

- **Pre-computed Hash Constants**: Event types hashed at initialization for O(1) lookup
- **Unrolled Hash Loops**: Process 4 characters simultaneously for faster hashing
- **Integer Boolean Flags**: Use 0/1 instead of true/false for better CPU cache efficiency
- **Bit-field Usage Tracking**: Track object pool usage with packed bit operations
- **Specialized Type Handlers**: Different optimization paths for strings, numbers, objects
- **Manual Memory Layout**: Control object structure for optimal CPU cache usage
- **Ultra-fast Power-of-2 Detection**: Use `Math.clz32()` for instant power-of-2 calculation
- **Branchless Programming**: Minimize conditional statements for better CPU prediction

**Performance Impact**: Up to 49x speedup for complex object processing
**Philosophy**: "Squeeze every CPU cycle using low-level optimization techniques"

### Benchmark Data Examples

To understand the performance differences, here are examples of the data structures used in benchmarks:

#### Simple Objects (Basic Logging)
```javascript
// Typical simple log entry
{
  message: "User login successful",
  timestamp: 1703123456789,
  data: { 
    userId: 12345, 
    sessionId: "abc123",
    ip: "192.168.1.1"
  }
}

// API request logging
{
  method: "POST",
  endpoint: "/api/users",
  duration: 45,
  statusCode: 201,
  userId: 67890
}
```

#### Complex Objects (Stress Testing)
```javascript
// Large nested object with arrays and deep nesting
{
  id: 12345,
  name: "Complex Data Structure",
  data: "x".repeat(2000), // Large string (2KB)
  nested: {
    level1: {
      level2: {
        level3: {
          value: "deeply nested data",
          array: [
            { id: 0, value: 0, metadata: { type: "test", created: Date.now() } },
            { id: 1, value: 2, metadata: { type: "test", created: Date.now() } },
            // ... 48 more similar objects
          ]
        }
      }
    }
  },
  metadata: {
    created: Date.now(),
    tags: ["performance", "test", "benchmark", "complex"],
    config: { 
      retry: 3, 
      timeout: 5000,
      features: ["caching", "compression", "validation"]
    },
    stats: {
      processedItems: 1000,
      errors: 0,
      avgProcessingTime: 23.5
    }
  }
}
```

The **48x performance improvement** for complex objects comes from the bit-optimized implementation's ability to:
- Quickly identify object types and use specialized handlers
- Avoid redundant JSON serialization through smart caching
- Use pre-allocated object pools to eliminate garbage collection
- Process nested structures with minimal memory allocations

#### Real-World Performance Impact

```javascript
// High-frequency API logging scenario
const logger = new RingBufferLogger(1000, './api-logs');

// Simple objects: ~50,000 requests/minute
app.use((req, res, next) => {
  logger.log('request', {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    timestamp: Date.now()
  });
  next();
});

// Complex objects: Database query results, user profiles, etc.
db.on('query', (result) => {
  logger.log('database', {
    query: result.sql,
    duration: result.duration,
    rows: result.rows,
    metadata: result.metadata, // Large nested object
    performance: result.performanceMetrics
  });
});
```

**Performance Impact:**
- **Original**: Can handle ~850,000 simple logs/sec, ~64,000 complex logs/sec
- **Object-Pooled**: Can handle ~2,400,000 simple logs/sec, ~234,000 complex logs/sec  
- **Bit-Optimized**: Can handle ~3,600,000 simple logs/sec, ~3,100,000 complex logs/sec

For a high-traffic API processing complex database results, the bit-optimized version can handle **48x more throughput** without dropping logs or impacting application performance.

### Code Comparison Examples

Here are key differences between the implementations to illustrate the optimization evolution:

#### Ring Buffer Indexing

```javascript
// Original: Clear but slower
this.currentIndex = (this.currentIndex + 1) % this.capacity;

// Object-Pooled: Fast bit masking (requires power-of-2 capacity)
this.currentIndex = (this.currentIndex + 1) & this.capacityMask;

// Bit-Optimized: Same technique, but with pre-computed mask
this.currentIndex = (this.currentIndex + 1) & this.capacityMask;
```

#### Event Type Detection

```javascript
// Original: String comparison
if (event === 'error') {
  this.errorLoggedAt = Date.now();
}

// Object-Pooled: Hash-based lookup
const eventHash = this.djb2Hash(event);
if (eventHash === this.ERROR_HASH) {
  this.errorLoggedAt = Date.now();
}

// Bit-Optimized: Pre-computed constants with integer flags
if (eventHash === ERROR_HASH_CONST) {
  this.errorLoggedAt = Date.now();
  this.hasError = 1; // Integer instead of boolean
}
```

#### Object Cloning

```javascript
// Original: JSON-based (safe but slow)
const cloned = JSON.parse(JSON.stringify(data));

// Object-Pooled: Optimized deep clone with cycle detection
const cloned = this.fastDeepClone(data, new WeakSet());

// Bit-Optimized: Type-specific handlers
const cloned = this.cloneByType(data, typeFlags);
```

### Running Performance Tests

```bash
# Compare all three implementations
npm run benchmark:compare

# Quick comparison (fewer iterations)
npm run benchmark:compare:quick

# Run individual benchmarks
node benchmark/performance.js
node benchmark/comparison.js
node benchmark/three-way-comparison.js

# Test all implementations for correctness
npm run test:all
```

### Which Implementation Should You Use?

- **`index.js`** (Original): Use for production code where maintainability is key
- **`index-object-pooled.js`** (Object-Pooled): Use when you need better performance but still want readable code
- **`index-bit-optimized.js`** (Bit-Optimized): Use only when you need maximum performance and can accept complex, hard-to-maintain code

All implementations maintain 100% API compatibility and pass the same test suite.

### Project Structure

```
ring-buffer-logger/
├── index.js                     # Original implementation (baseline)
├── index-object-pooled.js       # Object pooling + hash optimizations
├── index-bit-optimized.js       # Bit operations + C-style techniques
├── test/
│   ├── RingBufferLogger.test.js # Original implementation tests
│   └── AllImplementations.test.js # Cross-implementation compatibility tests
└── benchmark/
    ├── performance.js           # Basic performance benchmarks
    ├── comparison.js            # Two-way comparison (original vs object-pooled)
    └── three-way-comparison.js  # All three implementations comparison
```

The bit-optimized version demonstrates that with aggressive optimization techniques like bit manipulation, object pooling, and manual memory management, it's possible to achieve nearly **50x performance improvements** for complex object processing while maintaining full API compatibility.

## License

MIT
