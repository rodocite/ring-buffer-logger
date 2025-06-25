const fs = require('fs');
const path = require('path');
const RingBufferLogger = require('../index');

// Suppress console output during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  console.log.mockRestore();
  console.error.mockRestore();
  console.warn.mockRestore();
});

const cleanupLogDir = (logDir) => {
  if (fs.existsSync(logDir)) {
    try {
      const files = fs.readdirSync(logDir);
      files.forEach(file => {
        try {
          const filePath = path.join(logDir, file);
          const stat = fs.lstatSync(filePath);
          if (stat.isDirectory()) {
            cleanupLogDir(filePath); // Recursively clean subdirectories
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          // Ignore individual file deletion errors
          console.warn(`Warning: Could not delete file ${file}:`, err.message);
        }
      });
      fs.rmdirSync(logDir);
    } catch (err) {
      // Ignore directory deletion errors
      console.warn(`Warning: Could not delete directory ${logDir}:`, err.message);
    }
  }
};

describe('RingBufferLogger', () => {
  let logger;
  const testLogDir = './test-logs';

  beforeEach(() => {
    cleanupLogDir(testLogDir);
    logger = new RingBufferLogger(5, testLogDir);
  });

  afterEach(() => {
    cleanupLogDir(testLogDir);
  });

  describe('Constructor', () => {
    test('default parameters', () => {
      const defaultLogger = new RingBufferLogger();
      const stats = defaultLogger.getStats();

      expect(stats.capacity).toBe(100);
      expect(stats.currentIndex).toBe(0);
      expect(stats.flushId).toBe(0);
      expect(stats.errorSeen).toBe(false);
      expect(stats.errorLoggedAt).toBeNull();
      expect(stats.flushing).toBe(false);

      cleanupLogDir('./logs');
    });

    test('custom parameters', () => {
      const stats = logger.getStats();

      expect(stats.capacity).toBe(5);
      expect(fs.existsSync(testLogDir)).toBe(true);
    });
  });

  describe('Basic Logging', () => {
    test('log structure', () => {
      logger.log('info', { message: 'test message' });

      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(1);

      const entry = buffer[0];
      expect(entry).toHaveProperty('ts');
      expect(entry).toHaveProperty('flushId', 0);
      expect(entry).toHaveProperty('event', 'info');
      expect(entry).toHaveProperty('data', { message: 'test message' });
      expect(new Date(entry.ts)).toBeInstanceOf(Date);
    });

    test('log without data', () => {
      logger.log('info');

      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data).toEqual({});
    });

    test('buffer wraparound', () => {
      for (let i = 0; i < 7; i++) {
        logger.log('info', { count: i });
      }

      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(5);

      expect(buffer[0].data.count).toBe(2);
      expect(buffer[4].data.count).toBe(6);
    });

    test('index rollover behavior', () => {
      const logger = new RingBufferLogger(3, testLogDir);

      // Test initial state
      expect(logger.getStats().currentIndex).toBe(0);

      // Add entries and track index progression
      logger.log('info', { step: 1 });
      expect(logger.getStats().currentIndex).toBe(1);

      logger.log('info', { step: 2 });
      expect(logger.getStats().currentIndex).toBe(2);

      logger.log('info', { step: 3 });
      expect(logger.getStats().currentIndex).toBe(0); // Should wrap to 0

      logger.log('info', { step: 4 });
      expect(logger.getStats().currentIndex).toBe(1); // Should continue wrapping

      // Verify buffer contents after rollover
      // _snapshot starts from current index and goes chronologically (oldest first)
      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(3);
      expect(buffer[0].data.step).toBe(2); // Oldest remaining entry
      expect(buffer[1].data.step).toBe(3); // Middle entry
      expect(buffer[2].data.step).toBe(4); // Most recent entry
    });

    test('multiple complete rollovers', () => {
      const logger = new RingBufferLogger(3, testLogDir);

      // Log enough entries to do multiple complete rollovers
      for (let i = 1; i <= 10; i++) {
        logger.log('info', { iteration: i });
      }

      // After 10 entries in buffer of 3, index should be at (10 % 3) = 1
      expect(logger.getStats().currentIndex).toBe(1);

      // Buffer should contain the last 3 entries (8, 9, 10) in chronological order
      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(3);

      // _snapshot returns entries in chronological order (oldest first)
      expect(buffer[0].data.iteration).toBe(8);  // Oldest of the 3 remaining
      expect(buffer[1].data.iteration).toBe(9);  // Middle
      expect(buffer[2].data.iteration).toBe(10); // Most recent
    });

    test('rollover with mixed entry types', () => {
      const logger = new RingBufferLogger(4, testLogDir);

      // Mix different types of entries across rollover
      logger.log('info', { type: 'info', id: 1 });
      logger.log('debug', { type: 'debug', id: 2 });
      logger.log('warn', { type: 'warn', id: 3 });
      // Skip error type as it will trigger flush and clear buffer
      logger.log('trace', { type: 'trace', id: 4 });

      // This should trigger rollover and overwrite first entry
      logger.log('info', { type: 'info', id: 5 });

      expect(logger.getStats().currentIndex).toBe(1);

      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(4);

      // _snapshot returns entries in chronological order (oldest first)
      expect(buffer[0].data.id).toBe(2); // Original at index 1 (oldest remaining)
      expect(buffer[1].data.id).toBe(3); // Original at index 2
      expect(buffer[2].data.id).toBe(4); // Original at index 3
      expect(buffer[3].data.id).toBe(5); // New entry at index 0 (most recent)
    });
  });

  describe('Error Handling and Flushing', () => {
    test('should flush pre-error context when error occurs', () => {
      // Add some context before error
      logger.log('info', { message: 'context 1' });
      logger.log('info', { message: 'context 2' });
      logger.log('error', { message: 'something went wrong' });

      const stats = logger.getStats();
      expect(stats.errorSeen).toBe(true);
      expect(stats.flushId).toBe(1);

      // Check if file was created
      const files = fs.readdirSync(testLogDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/log-pre-error-context-0\.json/);
    });

    test('should flush post-error context after buffer cycles', () => {
      // Log an error
      logger.log('error', { message: 'error occurred' });

      // Fill buffer to cycle back to error position
      for (let i = 0; i < 5; i++) {
        logger.log('info', { message: `post-error ${i}` });
      }

      const stats = logger.getStats();
      expect(stats.errorSeen).toBe(false);
      expect(stats.errorLoggedAt).toBeNull();
      expect(stats.flushId).toBe(2);

      // Should have both pre and post error files
      const files = fs.readdirSync(testLogDir);
      expect(files).toHaveLength(2);
      expect(files.some(f => f.includes('pre-error-context'))).toBe(true);
      expect(files.some(f => f.includes('post-error-context'))).toBe(true);
    });

    test('should not flush multiple times for same error', () => {
      logger.log('error', { message: 'first error' });
      logger.log('error', { message: 'second error' }); // Should not trigger another flush

      const stats = logger.getStats();
      expect(stats.flushId).toBe(1); // Should still be 1

      const files = fs.readdirSync(testLogDir);
      expect(files).toHaveLength(1); // Should only have one file
    });
  });

  describe('File Output', () => {
    test('should create valid JSON files', () => {
      logger.log('info', { message: 'test' });
      logger.log('error', { message: 'error' });

      const files = fs.readdirSync(testLogDir);
      const logFile = files[0];
      const content = fs.readFileSync(path.join(testLogDir, logFile), 'utf8');

      expect(() => JSON.parse(content)).not.toThrow();

      const parsed = JSON.parse(content);
      expect(parsed).toHaveProperty('schema', 'v1');
      expect(parsed).toHaveProperty('reason', 'pre-error-context');
      expect(parsed).toHaveProperty('flushId', 0);
      expect(parsed).toHaveProperty('flushedAt');
      expect(parsed).toHaveProperty('events');
      expect(Array.isArray(parsed.events)).toBe(true);
    });
  });

  describe('Data Sanitization', () => {
    test('truncate long strings', () => {
      const longString = 'a'.repeat(1500);
      logger.log('info', { longValue: longString });

      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data.longValue).toHaveLength(1003);
      expect(buffer[0].data.longValue.endsWith('...')).toBe(true);
    });

    test('handle circular references', () => {
      const circular = { a: 1 };
      circular.self = circular;

      logger.log('info', circular);

      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data).toEqual({ error: 'serialization failed' });
    });

    test('should handle non-serializable data', () => {
      const func = () => {};
      logger.log('info', { func });

      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data.func).toBeUndefined();
    });
  });

  describe('Buffer Management', () => {
    test('should clear buffer after flush', () => {
      logger.log('info', { message: 'test' });
      logger.log('error', { message: 'error' });

      // Buffer should be cleared after error flush
      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(0);
    });

    test('should maintain proper index after flush', () => {
      logger.log('info', { message: 'test' });
      logger.log('error', { message: 'error' });

      const stats = logger.getStats();
      expect(stats.currentIndex).toBe(2); // Index continues after entries were logged
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty buffer flush', () => {
      logger.log('error', { message: 'immediate error' });

      // Should not throw error even with empty buffer
      const files = fs.readdirSync(testLogDir);
      expect(files).toHaveLength(1);
    });

    test('should handle concurrent flush attempts', () => {
      // Simulate concurrent flush by setting flushing flag
      logger.flushing = true;
      logger.log('error', { message: 'error during flush' });

      // Should not create additional files
      const files = fs.readdirSync(testLogDir);
      expect(files).toHaveLength(0);
    });

    test('should handle file system errors gracefully', () => {
      // Test flush errors by mocking fs.openSync to throw
      const originalOpenSync = fs.openSync;
      fs.openSync = jest.fn(() => {
        throw new Error('Mock file system error');
      });

      expect(() => {
        logger.log('error', { message: 'test' });
      }).not.toThrow();

      // Restore original function
      fs.openSync = originalOpenSync;
    });

    test('should handle capacity of 1', () => {
      const tinyLogger = new RingBufferLogger(1, testLogDir);

      tinyLogger.log('info', { message: 'first' });
      tinyLogger.log('info', { message: 'second' }); // Should overwrite first

      const buffer = tinyLogger.getCurrentBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].data.message).toBe('second');

      // Test error handling with capacity 1
      // With capacity 1, we get pre-error flush immediately, then when the buffer
      // cycles back to the error position (after 1 more log), we get post-error flush
      tinyLogger.log('error', { message: 'error' });

      // Add one more log to trigger the post-error flush
      tinyLogger.log('info', { message: 'after error' });

      const files = fs.readdirSync(testLogDir);
      expect(files.length).toBeGreaterThanOrEqual(1); // At least pre-error, possibly both
    });

    test('should handle capacity of 0', () => {
      const zeroLogger = new RingBufferLogger(0, testLogDir);

      // Should not crash with zero capacity
      expect(() => {
        zeroLogger.log('info', { message: 'test' });
        zeroLogger.log('error', { message: 'error' });
      }).not.toThrow();

      const buffer = zeroLogger.getCurrentBuffer();
      expect(buffer).toHaveLength(0);
    });

    test('should handle null and undefined data', () => {
      logger.log('info', null);
      logger.log('info', undefined);
      logger.log('info', { value: null, other: undefined });

      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(3);
      expect(buffer[0].data).toBeNull();
      // undefined gets converted to {} by the sanitizer
      expect(buffer[1].data).toEqual({});
      expect(buffer[2].data).toEqual({ value: null });
    });

    test('should handle extremely large numbers', () => {
      const largeData = {
        maxSafeInteger: Number.MAX_SAFE_INTEGER,
        maxValue: Number.MAX_VALUE,
        infinity: Infinity,
        negativeInfinity: -Infinity,
        nan: NaN
      };

      logger.log('info', largeData);
      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data.maxSafeInteger).toBe(Number.MAX_SAFE_INTEGER);
      expect(buffer[0].data.infinity).toBe(null); // Infinity becomes null in JSON
      expect(buffer[0].data.nan).toBe(null); // NaN becomes null in JSON
    });

    test('should handle deeply nested objects', () => {
      const deepObj = { level1: { level2: { level3: { level4: { level5: 'deep' } } } } };

      logger.log('info', deepObj);
      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data.level1.level2.level3.level4.level5).toBe('deep');
    });

    test('should handle arrays with mixed types', () => {
      const mixedArray = [1, 'string', { obj: true }, [1, 2, 3], null, undefined];

      logger.log('info', { array: mixedArray });
      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data.array).toHaveLength(6); // undefined becomes null, not filtered
      expect(buffer[0].data.array[0]).toBe(1);
      expect(buffer[0].data.array[1]).toBe('string');
      expect(buffer[0].data.array[2]).toEqual({ obj: true });
      expect(buffer[0].data.array[3]).toEqual([1, 2, 3]);
      expect(buffer[0].data.array[4]).toBe(null);
      expect(buffer[0].data.array[5]).toBe(null); // undefined becomes null in JSON
    });

    test('should handle empty event names', () => {
      logger.log('', { message: 'empty event' });
      logger.log(null, { message: 'null event' });
      logger.log(undefined, { message: 'undefined event' });

      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(3);
      expect(buffer[0].event).toBe('');
      expect(buffer[1].event).toBe(null);
      expect(buffer[2].event).toBe(undefined);
    });
  });

  describe('Comprehensive Error Scenarios', () => {
    test('multiple errors in quick succession', () => {
      logger.log('info', { message: 'context' });
      logger.log('error', { message: 'first error' });
      logger.log('error', { message: 'second error' });
      logger.log('error', { message: 'third error' });

      const stats = logger.getStats();
      expect(stats.flushId).toBe(1); // Should only flush once for the first error

      const files = fs.readdirSync(testLogDir);
      expect(files).toHaveLength(1);
    });

    test('error exactly at buffer capacity boundary', () => {
      // Fill buffer to capacity - 1
      for (let i = 0; i < 4; i++) {
        logger.log('info', { step: i });
      }

      // Log error at exact capacity
      logger.log('error', { message: 'boundary error' });

      const files = fs.readdirSync(testLogDir);
      expect(files).toHaveLength(1);

      // Verify pre-error context includes all preceding logs
      const content = JSON.parse(fs.readFileSync(path.join(testLogDir, files[0]), 'utf8'));
      expect(content.events).toHaveLength(5); // 4 info + 1 error
    });

    test('error followed by exact buffer wraparound', () => {
      logger.log('error', { message: 'initial error' });

      // Fill exactly to capacity to trigger post-error flush
      for (let i = 0; i < 5; i++) {
        logger.log('info', { step: i });
      }

      const files = fs.readdirSync(testLogDir);
      expect(files).toHaveLength(2);

      const stats = logger.getStats();
      expect(stats.errorSeen).toBe(false);
      expect(stats.flushId).toBe(2);
    });

    test('overlapping error cycles', () => {
      // First error
      logger.log('error', { message: 'first error' });

      // Partially fill buffer
      for (let i = 0; i < 3; i++) {
        logger.log('info', { step: i });
      }

      // Second error before first cycle completes
      logger.log('error', { message: 'second error' });

      // Complete the cycle
      logger.log('info', { final: true });

      const files = fs.readdirSync(testLogDir);
      const stats = logger.getStats();

      // Should have handled both errors appropriately
      expect(files.length).toBeGreaterThan(0);
      expect(stats.flushId).toBeGreaterThan(1);
    });
  });

  describe('Performance and Stress Tests', () => {
    test('high volume logging', () => {
      const startTime = Date.now();

      // Log 1000 entries
      for (let i = 0; i < 1000; i++) {
        logger.log('info', {
          iteration: i,
          data: `test data ${i}`,
          timestamp: Date.now()
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(1000); // 1 second

      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(5); // Only last 5 entries due to capacity
      expect(buffer[buffer.length - 1].data.iteration).toBe(999);
    });

    test('rapid error generation', () => {
      const largeLogger = new RingBufferLogger(100, testLogDir);

      // Generate many errors rapidly
      for (let i = 0; i < 10; i++) {
        largeLogger.log('info', { context: i });
        largeLogger.log('error', { error: i });

        // Fill buffer to trigger post-error flush
        for (let j = 0; j < 100; j++) {
          largeLogger.log('info', { recovery: j });
        }
      }

      const files = fs.readdirSync(testLogDir);
      expect(files.length).toBeGreaterThan(0);

      // Should handle all errors without crashing
      const stats = largeLogger.getStats();
      expect(stats.flushId).toBeGreaterThan(0);
    });

    test('memory usage with large objects', () => {
      const largeObject = {
        data: 'x'.repeat(10000), // 10KB string
        array: new Array(1000).fill(0).map((_, i) => ({ index: i, value: `item-${i}` })),
        nested: {
          level1: { level2: { level3: 'x'.repeat(5000) } }
        }
      };

      // Log large objects multiple times
      for (let i = 0; i < 10; i++) {
        logger.log('info', { ...largeObject, iteration: i });
      }

      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(5); // Should still maintain capacity

      // Verify data sanitization worked
      expect(buffer[0].data.data).toHaveLength(1003); // Truncated + "..."
    });
  });

  describe('File System Edge Cases', () => {
    let originalMkdirSync;
    let originalWriteSync;

    beforeEach(() => {
      // Store originals for proper restoration
      originalMkdirSync = fs.mkdirSync;
      originalWriteSync = fs.writeSync;
    });

    afterEach(() => {
      // Always restore mocks after each test
      fs.mkdirSync = originalMkdirSync;
      fs.writeSync = originalWriteSync;
    });

    test('invalid log directory characters', () => {
      // Mock fs.mkdirSync to simulate directory creation with invalid characters
      fs.mkdirSync = jest.fn(() => {
        throw new Error('Invalid directory name');
      });

      expect(() => {
        const invalidDirLogger = new RingBufferLogger(5, './test-logs/invalid<>chars');
        invalidDirLogger.log('info', { message: 'test' });
        invalidDirLogger.log('error', { message: 'test error' });
      }).not.toThrow();
    });

    test('very long file paths', () => {
      const longPath = './test-logs/' + 'a'.repeat(100);
      const longPathLogger = new RingBufferLogger(5, longPath);

      expect(() => {
        longPathLogger.log('error', { message: 'long path test' });
      }).not.toThrow();
    });

    test('disk space simulation', () => {
      // Mock fs.writeSync to simulate disk full
      fs.writeSync = jest.fn(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      expect(() => {
        logger.log('error', { message: 'disk full test' });
      }).not.toThrow();
    });

    test('directory creation failure', () => {
      // Mock fs.mkdirSync to fail
      fs.mkdirSync = jest.fn(() => {
        throw new Error('Permission denied');
      });

      expect(() => {
        new RingBufferLogger(5, './test-logs/restricted');
      }).not.toThrow();
    });
  });

  describe('Data Sanitization Edge Cases', () => {
    test('extremely long strings at exact boundary', () => {
      const exactlyLongString = 'a'.repeat(1000);
      const tooLongString = 'a'.repeat(1001);

      logger.log('info', {
        exactly: exactlyLongString,
        tooLong: tooLongString
      });

      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data.exactly).toHaveLength(1000);
      expect(buffer[0].data.exactly.endsWith('...')).toBe(false);
      expect(buffer[0].data.tooLong).toHaveLength(1003);
      expect(buffer[0].data.tooLong.endsWith('...')).toBe(true);
    });

    test('multiple circular references', () => {
      const obj1 = { name: 'obj1' };
      const obj2 = { name: 'obj2' };
      obj1.ref = obj2;
      obj2.ref = obj1;
      obj1.self = obj1;

      logger.log('info', { circular: obj1 });

      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data).toEqual({ error: 'serialization failed' });
    });

    test('functions and symbols', () => {
      const sym = Symbol('test');
      const data = {
        func: () => 'test',
        arrow: () => {},
        symbol: sym,
        symbolKey: 'value'
      };
      data[sym] = 'symbol value';

      logger.log('info', data);

      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data.func).toBeUndefined();
      expect(buffer[0].data.arrow).toBeUndefined();
      expect(buffer[0].data.symbol).toBeUndefined();
      expect(buffer[0].data.symbolKey).toBe('value');
    });

    test('dates and regexp objects', () => {
      const data = {
        date: new Date('2024-01-01'),
        regex: /test/gi,
        error: new Error('test error')
      };

      logger.log('info', data);

      const buffer = logger.getCurrentBuffer();
      expect(buffer[0].data.date).toBe('2024-01-01T00:00:00.000Z');
      expect(buffer[0].data.regex).toEqual({});
      // Error objects get serialized with their enumerable properties
      expect(buffer[0].data.error).toEqual({});
    });

    test('very large arrays', () => {
      const largeArray = new Array(10000).fill(0).map((_, i) => ({
        id: i,
        data: `item-${i}`,
        nested: { value: i * 2 }
      }));

      logger.log('info', { array: largeArray });

      const buffer = logger.getCurrentBuffer();
      expect(Array.isArray(buffer[0].data.array)).toBe(true);
      expect(buffer[0].data.array).toHaveLength(10000);
    });
  });

  describe('Concurrency Simulation', () => {
    test('simulated concurrent logging', async() => {
      const promises = [];

      // Simulate concurrent logging from multiple sources
      for (let i = 0; i < 50; i++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              logger.log('info', {
                source: `thread-${i % 5}`,
                message: `concurrent log ${i}`
              });
              resolve();
            }, Math.random() * 10);
          })
        );
      }

      await Promise.all(promises);

      const buffer = logger.getCurrentBuffer();
      expect(buffer).toHaveLength(5); // Should maintain capacity
    });

    test('concurrent error and regular logging', async() => {
      const promises = [];

      // Mix of regular logs and errors
      for (let i = 0; i < 20; i++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              if (i % 7 === 0) {
                logger.log('error', { error: `error-${i}` });
              } else {
                logger.log('info', { info: `info-${i}` });
              }
              resolve();
            }, Math.random() * 5);
          })
        );
      }

      await Promise.all(promises);

      // Should handle mixed logging without issues
      const stats = logger.getStats();
      expect(stats.flushId).toBeGreaterThan(0);
    });
  });
});
