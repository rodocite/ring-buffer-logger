# Ring Buffer Logger

A circular buffer logger implementation that keeps recent log entries in memory and writes them to disk when errors occur.

*Note: This is a local implementation/exercise, not a published package.*

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

This project includes multiple optimized implementations to demonstrate aggressive performance optimization techniques:

### Available Implementations

1. **`index.js`** - Original implementation (baseline)
2. **`index-optimized.js`** - Optimized with object pooling, bit operations, and hash-based comparisons
3. **`index-ultra.js`** - Ultra-optimized with C-style techniques and aggressive memory management

### Performance Results

Benchmarked on Node.js v18.20.5, macOS ARM64:

#### Micro Benchmark (1,000,000 operations)
- **Original**: 1,855,764 ops/sec
- **Optimized**: 3,705,791 ops/sec (**2.00x speedup**, 49.9% faster)
- **Ultra**: 4,848,426 ops/sec (**2.61x speedup**, 61.7% faster)

#### Basic Logging (500,000 operations)
- **Original**: 859,509 ops/sec  
- **Optimized**: 2,367,118 ops/sec (**2.75x speedup**, 63.7% faster)
- **Ultra**: 3,586,562 ops/sec (**4.17x speedup**, 76.0% faster)

#### Complex Objects (50,000 operations)
- **Original**: 63,947 ops/sec
- **Optimized**: 234,159 ops/sec (**3.66x speedup**, 72.7% faster)  
- **Ultra**: 3,131,516 ops/sec (**48.97x speedup**, 98.0% faster) 🔥

### Optimization Techniques Used

#### Core Optimizations
- **Bit masking** instead of modulo operations (`(index + 1) & capacityMask`)
- **Power-of-2 buffer sizing** for ultra-fast bit operations
- **Hash-based event comparison** (djb2 algorithm) instead of string comparison
- **Object pooling** to eliminate allocation/deallocation overhead
- **Typed arrays** (Float64Array, Uint32Array) for better memory layout

#### Ultra-Performance Techniques
- **Pre-computed hash constants** for instant event type detection
- **Unrolled hashing loops** processing 4 characters at once
- **Integer-based boolean flags** (0/1 instead of true/false)
- **Advanced object pooling** with bit-field usage tracking
- **Specialized data sanitization** for different object types
- **Manual JSON construction** with minimal allocations
- **C-style memory management** patterns

### Running Performance Tests

```bash
# Compare all three implementations
node benchmark/three-way-comparison.js

# Quick development test
node benchmark/three-way-comparison.js --quick

# Original two-way comparison
node benchmark/comparison.js

# Full benchmark suite
npm run benchmark
```

The ultra-optimized version demonstrates that with aggressive optimization techniques like bit manipulation, object pooling, and manual memory management, it's possible to achieve nearly **50x performance improvements** for complex object processing while maintaining full API compatibility.

## License

MIT
