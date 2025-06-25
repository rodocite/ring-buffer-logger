const fs = require('fs');
const path = require('path');

// Import all three implementations
const OriginalLogger = require('../index');
const ObjectPooledLogger = require('../index-object-pooled');
const BitOptimizedLogger = require('../index-bit-optimized');

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
            cleanupLogDir(filePath);
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          // Ignore individual file deletion errors
        }
      });
      fs.rmdirSync(logDir);
    } catch (err) {
      // Ignore directory deletion errors
    }
  }
};

// Test configurations for each implementation
const implementations = [
  { name: 'Original', Logger: OriginalLogger, testDir: './test-original' },
  { name: 'Object-Pooled', Logger: ObjectPooledLogger, testDir: './test-object-pooled' },
  { name: 'Bit-Optimized', Logger: BitOptimizedLogger, testDir: './test-bit-optimized' }
];

// Run tests for each implementation
implementations.forEach(({ name, Logger, testDir }) => {
  describe(`${name} Implementation`, () => {
    let logger;

    beforeEach(() => {
      cleanupLogDir(testDir);
      logger = new Logger(5, testDir);
    });

    afterEach(() => {
      cleanupLogDir(testDir);
    });

    describe('Constructor', () => {
      test('default parameters', () => {
        const defaultLogger = new Logger();
        const stats = defaultLogger.getStats();

        expect(stats.capacity).toBeGreaterThanOrEqual(100); // Bit-optimized version may round up to power of 2
        expect(stats.currentIndex).toBe(0);
        expect(stats.flushId).toBe(0);
        expect(stats.errorSeen).toBe(false);
        expect(stats.errorLoggedAt).toBeNull();
        expect(stats.flushing).toBe(false);

        cleanupLogDir('./logs');
      });

      test('custom parameters', () => {
        const stats = logger.getStats();

        expect(stats.capacity).toBeGreaterThanOrEqual(5); // Bit-optimized version may round up to power of 2
        expect(fs.existsSync(testDir)).toBe(true);
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
        const capacity = logger.getStats().capacity;
        const testEntries = capacity + 2; // Go past capacity

        for (let i = 0; i < testEntries; i++) {
          logger.log('info', { count: i });
        }

        const buffer = logger.getCurrentBuffer();
        expect(buffer.length).toBeLessThanOrEqual(capacity);

        // Should have the most recent entries
        const lastEntry = buffer[buffer.length - 1];
        expect(lastEntry.data.count).toBe(testEntries - 1);
      });

      test('index rollover behavior', () => {
        const testLogger = new Logger(3, testDir + '-rollover');
        const capacity = testLogger.getStats().capacity;

        // Test initial state
        expect(testLogger.getStats().currentIndex).toBe(0);

        // Add entries and track index progression
        testLogger.log('info', { step: 1 });
        expect(testLogger.getStats().currentIndex).toBe(1);

        testLogger.log('info', { step: 2 });
        expect(testLogger.getStats().currentIndex).toBe(2);

        testLogger.log('info', { step: 3 });
                 // For power-of-2 implementations, index may wrap differently
         if (capacity === 4) { // Bit-optimized version rounds 3 up to 4
          expect(testLogger.getStats().currentIndex).toBe(3);
        } else {
          expect(testLogger.getStats().currentIndex).toBe(0);
        }

        cleanupLogDir(testDir + '-rollover');
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
        const files = fs.readdirSync(testDir);
        const preErrorFile = files.find(f => f.includes('pre-error-context-0'));
        expect(preErrorFile).toBeDefined();

        const content = JSON.parse(fs.readFileSync(path.join(testDir, preErrorFile), 'utf8'));
        expect(content.reason).toBe('pre-error-context');
        expect(content.flushId).toBe(0);
        expect(content.events).toHaveLength(3);
      });

      test('should flush post-error context after buffer cycles', () => {
        const capacity = logger.getStats().capacity;
        
        // Add context, then error
        logger.log('info', { message: 'context 1' });
        logger.log('error', { message: 'error occurred' });

        // Fill buffer to trigger post-error flush
        for (let i = 0; i < capacity; i++) {
          logger.log('info', { message: `recovery ${i}` });
        }

        const files = fs.readdirSync(testDir);
        const postErrorFile = files.find(f => f.includes('post-error-context'));
        expect(postErrorFile).toBeDefined();

        const content = JSON.parse(fs.readFileSync(path.join(testDir, postErrorFile), 'utf8'));
        expect(content.reason).toBe('post-error-context');
        expect(content.flushId).toBe(1);
      });
    });

    describe('Data Sanitization', () => {
      test('should handle null and undefined data', () => {
        logger.log('test', null);
        logger.log('test', undefined);

        const buffer = logger.getCurrentBuffer();
        expect(buffer[0].data).toEqual({});
        expect(buffer[1].data).toEqual({});
      });

      test('should truncate long strings', () => {
        const longString = 'x'.repeat(1500);
        logger.log('test', { longString });

        const buffer = logger.getCurrentBuffer();
        const data = buffer[0].data;
        expect(data.longString).toHaveLength(1003); // 1000 + '...'
        expect(data.longString.endsWith('...')).toBe(true);
      });

      test('should handle circular references', () => {
        const obj = { name: 'test' };
        obj.self = obj;

        logger.log('test', obj);

        const buffer = logger.getCurrentBuffer();
        // Should not throw and should have some representation
        expect(buffer[0].data).toBeDefined();
      });

      test('should handle complex nested objects', () => {
        const complexObj = {
          level1: {
            level2: {
              level3: {
                value: 'deep',
                array: [1, 2, 3, { nested: true }]
              }
            }
          },
          metadata: {
            timestamp: Date.now(),
            tags: ['test', 'complex']
          }
        };

        logger.log('complex', complexObj);

        const buffer = logger.getCurrentBuffer();
        const data = buffer[0].data;
        expect(data.level1.level2.level3.value).toBe('deep');
        expect(data.metadata.tags).toEqual(['test', 'complex']);
      });
    });

    describe('Edge Cases', () => {
      test('should handle rapid successive errors', () => {
        // Multiple errors in quick succession
        for (let i = 0; i < 3; i++) {
          logger.log('error', { errorNumber: i });
        }

        const files = fs.readdirSync(testDir);
        const errorFiles = files.filter(f => f.includes('error-context'));
        expect(errorFiles.length).toBeGreaterThan(0);
      });

      test('should handle empty event names', () => {
        logger.log('', { message: 'empty event' });
        logger.log(null, { message: 'null event' });

        const buffer = logger.getCurrentBuffer();
        expect(buffer).toHaveLength(2);
        expect(buffer[0].event).toBe('');
        expect(buffer[1].event).toBeNull();
      });

      test('should handle large objects efficiently', () => {
        const largeObj = {
          data: new Array(1000).fill(0).map((_, i) => ({
            id: i,
            value: `item-${i}`,
            metadata: { created: Date.now(), index: i }
          }))
        };

        const startTime = Date.now();
        logger.log('large', largeObj);
        const endTime = Date.now();

        // Should complete reasonably quickly (less than 100ms)
        expect(endTime - startTime).toBeLessThan(100);

        const buffer = logger.getCurrentBuffer();
        expect(buffer[0].data.data).toHaveLength(1000);
      });
    });

    describe('Performance Characteristics', () => {
      test('should handle high-frequency logging', () => {
        const iterations = 10000;
        const startTime = Date.now();

        for (let i = 0; i < iterations; i++) {
          logger.log('perf', { iteration: i, timestamp: Date.now() });
        }

        const endTime = Date.now();
        const duration = endTime - startTime;
        const opsPerSecond = Math.round(iterations / (duration / 1000));

        // Should handle at least 10,000 ops/sec (very conservative)
        expect(opsPerSecond).toBeGreaterThan(10000);

        const buffer = logger.getCurrentBuffer();
        const capacity = logger.getStats().capacity;
        expect(buffer.length).toBeLessThanOrEqual(capacity);
      });

      test('should maintain memory efficiency', () => {
        const capacity = logger.getStats().capacity;
        const iterations = capacity * 10; // Log 10x capacity

        for (let i = 0; i < iterations; i++) {
          logger.log('memory', { 
            iteration: i,
            data: `some data for iteration ${i}`,
            metadata: { timestamp: Date.now() }
          });
        }

        const buffer = logger.getCurrentBuffer();
        // Buffer should never exceed capacity
        expect(buffer.length).toBeLessThanOrEqual(capacity);

        // Should contain the most recent entries
        const lastEntry = buffer[buffer.length - 1];
        expect(lastEntry.data.iteration).toBe(iterations - 1);
      });
    });

    describe('API Compatibility', () => {
      test('getCurrentBuffer returns consistent format', () => {
        logger.log('test1', { value: 1 });
        logger.log('test2', { value: 2 });

        const buffer = logger.getCurrentBuffer();
        expect(Array.isArray(buffer)).toBe(true);
        
        buffer.forEach(entry => {
          expect(entry).toHaveProperty('ts');
          expect(entry).toHaveProperty('flushId');
          expect(entry).toHaveProperty('event');
          expect(entry).toHaveProperty('data');
          expect(typeof entry.ts).toBe('string');
          expect(typeof entry.flushId).toBe('number');
          expect(typeof entry.event).toBe('string');
        });
      });

      test('getStats returns consistent format', () => {
        const stats = logger.getStats();
        
        expect(stats).toHaveProperty('capacity');
        expect(stats).toHaveProperty('currentIndex');
        expect(stats).toHaveProperty('flushId');
        expect(stats).toHaveProperty('errorSeen');
        expect(stats).toHaveProperty('errorLoggedAt');
        expect(stats).toHaveProperty('flushing');

        expect(typeof stats.capacity).toBe('number');
        expect(typeof stats.currentIndex).toBe('number');
        expect(typeof stats.flushId).toBe('number');
        expect(typeof stats.errorSeen).toBe('boolean');
        expect(typeof stats.flushing).toBe('boolean');
      });
    });
  });
});

// Cross-implementation compatibility tests
describe('Cross-Implementation Compatibility', () => {
  const testDir = './test-compatibility';

  beforeEach(() => {
    cleanupLogDir(testDir);
  });

  afterEach(() => {
    cleanupLogDir(testDir);
  });

  test('all implementations produce compatible log files', () => {
    const testData = { message: 'compatibility test', value: 42 };
    
    implementations.forEach(({ name, Logger }) => {
      const logger = new Logger(5, `${testDir}-${name.toLowerCase()}`);
      
      // Add context and trigger error
      logger.log('info', { context: `from ${name}` });
      logger.log('error', testData);

      // Check file was created
      const files = fs.readdirSync(`${testDir}-${name.toLowerCase()}`);
      const errorFile = files.find(f => f.includes('pre-error-context'));
      expect(errorFile).toBeDefined();

      // Parse and validate structure
      const content = JSON.parse(fs.readFileSync(
        path.join(`${testDir}-${name.toLowerCase()}`, errorFile), 
        'utf8'
      ));

      expect(content).toHaveProperty('schema', 'v1');
      expect(content).toHaveProperty('reason', 'pre-error-context');
      expect(content).toHaveProperty('flushId', 0);
      expect(content).toHaveProperty('flushedAt');
      expect(content).toHaveProperty('events');
      expect(Array.isArray(content.events)).toBe(true);
      expect(content.events.length).toBeGreaterThan(0);

      // Clean up
      cleanupLogDir(`${testDir}-${name.toLowerCase()}`);
    });
  });

  test('all implementations handle same data consistently', () => {
    const testCases = [
      { event: 'simple', data: { message: 'hello' } },
      { event: 'complex', data: { nested: { deep: { value: 123 } }, array: [1, 2, 3] } },
      { event: 'edge', data: null },
      { event: 'string', data: 'just a string' },
      { event: 'number', data: 42 }
    ];

    const results = implementations.map(({ name, Logger }) => {
      const logger = new Logger(10, `${testDir}-${name.toLowerCase()}`);
      
      testCases.forEach(testCase => {
        logger.log(testCase.event, testCase.data);
      });

      const buffer = logger.getCurrentBuffer();
      cleanupLogDir(`${testDir}-${name.toLowerCase()}`);
      
      return { name, buffer };
    });

    // Compare results - all should have same number of entries
    const entryCounts = results.map(r => r.buffer.length);
    expect(new Set(entryCounts).size).toBe(1); // All counts should be the same

    // Compare event types and basic structure
    results.forEach(result => {
      expect(result.buffer).toHaveLength(testCases.length);
      
      result.buffer.forEach((entry, index) => {
        expect(entry.event).toBe(testCases[index].event);
        expect(entry).toHaveProperty('ts');
        expect(entry).toHaveProperty('flushId');
        expect(entry).toHaveProperty('data');
      });
    });
  });
}); 