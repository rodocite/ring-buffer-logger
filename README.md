# Ring Buffer Logger

Circular buffer logging for Node.js. Keeps recent log entries in memory and dumps them to disk when errors happen.

## Features

- Circular buffer with configurable capacity
- Auto-flush on errors (captures before/after context)
- Data sanitization for long strings and circular refs
- JSON file output with timestamps

## Installation

```bash
npm install
```

## Usage

### Basic Usage

```javascript
const RingBufferLogger = require('./index');

// Create logger with default settings (capacity: 100, logDir: './logs')
const logger = new RingBufferLogger();

// Or with custom settings
const logger = new RingBufferLogger(50, './custom-logs');

// Log events
logger.log('info', { message: 'Application started' });
logger.log('debug', { userId: 123, action: 'login' });
logger.log('error', { message: 'Database connection failed', error: 'ECONNREFUSED' });
```

### Error Context

When you log an error, the buffer gets flushed immediately (pre-error context). After the buffer cycles around to where the error was logged, it flushes again (post-error context).

```javascript
logger.log('info', { message: 'Processing request' });
logger.log('debug', { step: 1, data: 'validation' });

logger.log('error', { message: 'Validation failed', field: 'email' }); // triggers flush

logger.log('info', { message: 'Attempting recovery' });
logger.log('info', { message: 'Fallback method used' });
```

## API Reference

### Constructor

```javascript
new RingBufferLogger(capacity = 100, logDir = './logs')
```

- `capacity`: Maximum number of log entries to keep in buffer
- `logDir`: Directory where log files will be written

### Methods

#### `log(event, data = {})`

Log an event with optional data.

- `event`: String describing the event type (e.g., 'info', 'error', 'debug')
- `data`: Object containing additional data to log

#### `getCurrentBuffer()`

Returns the current buffer contents as an array.

#### `getStats()`

Returns internal statistics about the logger state.

## Log File Format

Generated log files follow this structure:

```json
{
  "schema": "v1",
  "reason": "pre-error-context",
  "flushId": 0,
  "flushedAt": "2024-01-15T10:30:00.000Z",
  "events": [
    {
      "ts": "2024-01-15T10:29:58.000Z",
      "flushId": 0,
      "event": "info",
      "data": { "message": "Processing request" }
    }
  ]
}
```

## Data Sanitization

- Long strings get truncated to 1000 chars with "..." appended
- Circular references become error messages
- Non-serializable data gets omitted

## Scripts

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run demo
npm start

# Lint code
npm run lint
npm run lint:fix
```

## Testing

```bash
npm test
```

## Demo

```bash
npm start
```

Creates sample log files in `./demo-logs`.

## License

MIT