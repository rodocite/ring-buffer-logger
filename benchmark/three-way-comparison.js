const OriginalLogger = require('../index');
const ObjectPooledLogger = require('../index-object-pooled');
const BitOptimizedLogger = require('../index-bit-optimized');
const fs = require('fs');
const path = require('path');

// Suppress console output during benchmarks
const silentConsole = {
  log: () => {},
  error: () => {},
  warn: () => {}
};

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

// Test functions with silent console
const testWithSilentConsole = (testFn, LoggerClass, ...args) => {
  const originalConsole = global.console;
  global.console = silentConsole;
  try {
    return testFn(LoggerClass, ...args);
  } finally {
    global.console = originalConsole;
  }
};

const testBasicLogging = (LoggerClass, iterations, logDir) => {
  cleanup(logDir);
  const logger = new LoggerClass(1024, logDir); // Use power of 2 for all

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
  return duration;
};

const testComplexObjects = (LoggerClass, iterations, logDir) => {
  cleanup(logDir);
  const logger = new LoggerClass(512, logDir);

  // Create complex test data
  const largeString = 'x'.repeat(2000);
  const complexObject = {
    id: 12345,
    name: 'Test Object',
    data: largeString,
    nested: {
      level1: {
        level2: {
          level3: {
            value: 'deep',
            array: new Array(50).fill(0).map((_, i) => ({ id: i, value: i * 2 }))
          }
        }
      }
    },
    metadata: {
      created: Date.now(),
      tags: ['performance', 'test', 'benchmark'],
      config: { retry: 3, timeout: 5000 }
    }
  };

  const { duration } = benchmark.time('Complex objects', () => {
    for (let i = 0; i < iterations; i++) {
      logger.log('data', {
        iteration: i,
        complex: complexObject,
        metadata: {
          timestamp: Date.now(),
          batch: Math.floor(i / 10),
          processor: `worker-${i % 4}`
        }
      });
    }
  });

  cleanup(logDir);
  return duration;
};

const testMicroBenchmark = (LoggerClass, iterations, logDir) => {
  cleanup(logDir);
  const logger = new LoggerClass(2048, logDir);

  const { duration } = benchmark.time('Micro benchmark', () => {
    for (let i = 0; i < iterations; i++) {
      // Minimal data to test raw logging overhead
      logger.log('trace', { i });
    }
  });

  cleanup(logDir);
  return duration;
};

// Main comparison function
const runThreeWayComparison = () => {
  console.log('🔥 Three-Way Performance Comparison');
  console.log('Original vs Object-Pooled vs Bit-Optimized');
  console.log('='.repeat(70));
  console.log(`Node.js version: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log();

  const tests = [
    {
      name: 'Micro Benchmark (1,000,000 ops)',
      test: (LoggerClass, logDir) => testWithSilentConsole(testMicroBenchmark, LoggerClass, 1000000, logDir),
      operations: 1000000
    },
    {
      name: 'Basic Logging (500,000 ops)',
      test: (LoggerClass, logDir) => testWithSilentConsole(testBasicLogging, LoggerClass, 500000, logDir),
      operations: 500000
    },
    {
      name: 'Complex Objects (50,000 ops)',
      test: (LoggerClass, logDir) => testWithSilentConsole(testComplexObjects, LoggerClass, 50000, logDir),
      operations: 50000
    }
  ];

  const implementations = [
    { name: 'Original', Logger: OriginalLogger, dir: './bench-original' },
    { name: 'Object-Pooled', Logger: ObjectPooledLogger, dir: './bench-object-pooled' },
    { name: 'Bit-Optimized', Logger: BitOptimizedLogger, dir: './bench-bit-optimized' }
  ];

  for (const testCase of tests) {
    console.log(`\n=== ${testCase.name} ===`);

    const results = {};

    // Run all implementations
    for (const impl of implementations) {
      if (global.gc) global.gc(); // Force GC between tests

      const memBefore = benchmark.memoryUsage();
      const time = testCase.test(impl.Logger, impl.dir);
      const memAfter = benchmark.memoryUsage();

      results[impl.name] = {
        time,
        throughput: benchmark.formatThroughput(testCase.operations, time),
        memDelta: memAfter.heapUsed - memBefore.heapUsed
      };
    }

    // Display results
    const baseline = results['Original'].time;

    for (const impl of implementations) {
      const result = results[impl.name];
      const speedup = impl.name === 'Original' ? '1.00x' : `${(baseline / result.time).toFixed(2)}x`;
      const improvement = impl.name === 'Original' ? '' : ` (${((baseline - result.time) / baseline * 100).toFixed(1)}% faster)`;

      console.log(`${impl.name.padEnd(12)}: ${result.time.toFixed(2)}ms | ${result.throughput.padEnd(20)} | ${speedup.padEnd(6)}${improvement}`);
    }

    // Show speedup summary
    const objectPooledSpeedup = (baseline / results['Object-Pooled'].time).toFixed(2);
    const bitOptimizedSpeedup = (baseline / results['Bit-Optimized'].time).toFixed(2);

    console.log(`\n🚀 Speedups: Object-Pooled ${objectPooledSpeedup}x, Bit-Optimized ${bitOptimizedSpeedup}x`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Performance comparison complete!');

  // Clean up all test directories
  implementations.forEach(impl => cleanup(impl.dir));
};

// Quick single test for development
const quickTest = () => {
  console.log('⚡ Quick Performance Test');
  console.log('='.repeat(30));

  const iterations = 100000;
  const tests = [
    { name: 'Original', Logger: OriginalLogger, dir: './quick-original' },
    { name: 'Object-Pooled', Logger: ObjectPooledLogger, dir: './quick-object-pooled' },
    { name: 'Bit-Optimized', Logger: BitOptimizedLogger, dir: './quick-bit-optimized' }
  ];

  for (const test of tests) {
    const time = testWithSilentConsole(testBasicLogging, test.Logger, iterations, test.dir);
    const throughput = benchmark.formatThroughput(iterations, time);
    console.log(`${test.name.padEnd(12)}: ${time.toFixed(2)}ms (${throughput})`);
    cleanup(test.dir);
  }
};

// Run with --quick for fast test
if (require.main === module) {
  if (process.argv.includes('--quick')) {
    quickTest();
  } else {
    runThreeWayComparison();
  }
}

module.exports = { runThreeWayComparison, quickTest };
