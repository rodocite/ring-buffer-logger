const RingBufferLogger = require('../index');
const fs = require('fs');
const path = require('path');

// Benchmark utilities
const benchmark = {
  time: (label, fn) => {
    const start = process.hrtime.bigint();
    const result = fn();
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000; // Convert to milliseconds
    return { duration, result };
  },

  memoryUsage: () => {
    const used = process.memoryUsage();
    return {
      heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100,
      external: Math.round(used.external / 1024 / 1024 * 100) / 100
    };
  },

  formatThroughput: (operations, timeMs) => {
    const opsPerSecond = Math.round((operations / timeMs) * 1000);
    return `${opsPerSecond.toLocaleString()} ops/sec`;
  }
};

// Clean up function
const cleanup = (logDir) => {
  if (fs.existsSync(logDir)) {
    const files = fs.readdirSync(logDir);
    files.forEach(file => {
      try {
        fs.unlinkSync(path.join(logDir, file));
      } catch (err) {
        // Ignore errors
      }
    });
    try {
      fs.rmdirSync(logDir);
    } catch (err) {
      // Ignore errors
    }
  }
};

// Suppress console output during benchmarks
const silentConsole = {
  log: () => {},
  error: () => {},
  warn: () => {}
};

const testWithSilentConsole = (testFn, ...args) => {
  const originalConsole = global.console;
  global.console = silentConsole;
  try {
    return testFn(...args);
  } finally {
    global.console = originalConsole;
  }
};

// Test functions
const testBasicLogging = (iterations = 100000) => {
  const logDir = './perf-basic';
  cleanup(logDir);

  const logger = new RingBufferLogger(1000, logDir);

  const { duration } = benchmark.time('Basic logging', () => {
    for (let i = 0; i < iterations; i++) {
      logger.log('info', {
        message: `Test message ${i}`,
        timestamp: Date.now(),
        data: { value: i * 2, batch: Math.floor(i / 100) }
      });
    }
  });

  cleanup(logDir);
  return { duration, throughput: benchmark.formatThroughput(iterations, duration) };
};

const testErrorHandling = (iterations = 1000) => {
  const logDir = './perf-error';
  cleanup(logDir);

  const logger = new RingBufferLogger(100, logDir);

  const { duration } = benchmark.time('Error handling', () => {
    for (let i = 0; i < iterations; i++) {
      // Log some context
      logger.log('info', { step: 'processing', item: i });
      logger.log('debug', { details: `Processing item ${i}` });

      // Trigger error every 10th iteration
      if (i % 10 === 0) {
        logger.log('error', { message: `Error at iteration ${i}`, code: 'TEST_ERROR' });
      }
    }
  });

  cleanup(logDir);
  return { duration, throughput: benchmark.formatThroughput(iterations, duration) };
};

const testLargeObjects = (iterations = 1000) => {
  const logDir = './perf-large';
  cleanup(logDir);

  const logger = new RingBufferLogger(50, logDir);

  // Create large test object
  const largeObject = {
    id: 12345,
    data: 'x'.repeat(5000),
    nested: {
      level1: {
        level2: {
          level3: {
            value: 'deep',
            array: new Array(100).fill(0).map((_, i) => ({ id: i, value: i * 2 }))
          }
        }
      }
    }
  };

  const { duration } = benchmark.time('Large objects', () => {
    for (let i = 0; i < iterations; i++) {
      logger.log('data', {
        iteration: i,
        large: largeObject,
        metadata: { timestamp: Date.now() }
      });
    }
  });

  cleanup(logDir);
  return { duration, throughput: benchmark.formatThroughput(iterations, duration) };
};

// Main benchmark runner
const runBenchmarks = () => {
  console.log('🚀 RingBufferLogger Performance Benchmark');
  console.log('='.repeat(50));
  console.log(`Node.js version: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log();

  const isQuick = process.argv.includes('--quick');
  const multiplier = isQuick ? 0.1 : 1;

  const tests = [
    {
      name: 'Basic Logging',
      test: () => testWithSilentConsole(testBasicLogging, Math.floor(100000 * multiplier)),
      description: 'Simple log entries with basic data'
    },
    {
      name: 'Error Handling',
      test: () => testWithSilentConsole(testErrorHandling, Math.floor(1000 * multiplier)),
      description: 'Mixed logging with error flushes'
    },
    {
      name: 'Large Objects',
      test: () => testWithSilentConsole(testLargeObjects, Math.floor(1000 * multiplier)),
      description: 'Complex nested objects with large data'
    }
  ];

  const memBefore = benchmark.memoryUsage();

  for (const test of tests) {
    console.log(`\n=== ${test.name} ===`);
    console.log(`Description: ${test.description}`);

    if (global.gc) global.gc(); // Force GC before test

    const result = test.test();
    console.log(`Time: ${result.duration.toFixed(2)}ms`);
    console.log(`Throughput: ${result.throughput}`);
  }

  const memAfter = benchmark.memoryUsage();

  console.log('\n' + '='.repeat(50));
  console.log('Benchmark complete!');
  console.log(`Memory usage: ${memBefore.heapUsed}MB -> ${memAfter.heapUsed}MB`);
  console.log(`Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);
};

// Run benchmarks if called directly
if (require.main === module) {
  runBenchmarks();
}

module.exports = { runBenchmarks, testBasicLogging, testErrorHandling, testLargeObjects };
