const OriginalLogger = require('../index');
const ObjectPooledLogger = require('../index-object-pooled');
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
  const logger = new LoggerClass(1024, logDir);

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
  const largeString = 'x'.repeat(1000);
  const complexObject = {
    id: 12345,
    name: 'Test Object',
    data: largeString,
    nested: {
      level1: {
        level2: {
          level3: {
            value: 'deep',
            array: new Array(25).fill(0).map((_, i) => ({ id: i, value: i * 2 }))
          }
        }
      }
    },
    metadata: {
      created: Date.now(),
      tags: ['performance', 'test'],
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
          batch: Math.floor(i / 10)
        }
      });
    }
  });

  cleanup(logDir);
  return duration;
};

// Main comparison function
const runComparison = () => {
  console.log('🔥 Performance Comparison: Original vs Object-Pooled');
  console.log('='.repeat(60));
  console.log(`Node.js version: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log();

  const isQuick = process.argv.includes('--quick');
  const multiplier = isQuick ? 0.1 : 1;

  const tests = [
    {
      name: `Basic Logging (${Math.floor(500000 * multiplier).toLocaleString()} ops)`,
      test: (LoggerClass, logDir) => testWithSilentConsole(testBasicLogging, LoggerClass, Math.floor(500000 * multiplier), logDir),
      operations: Math.floor(500000 * multiplier)
    },
    {
      name: `Complex Objects (${Math.floor(10000 * multiplier).toLocaleString()} ops)`,
      test: (LoggerClass, logDir) => testWithSilentConsole(testComplexObjects, LoggerClass, Math.floor(10000 * multiplier), logDir),
      operations: Math.floor(10000 * multiplier)
    }
  ];

  for (const testCase of tests) {
    console.log(`\n=== ${testCase.name} ===`);

    const memBefore = benchmark.memoryUsage();

    if (global.gc) global.gc();

    // Test original implementation
    const originalTime = testCase.test(OriginalLogger, './benchmark-original');
    const originalThroughput = benchmark.formatThroughput(testCase.operations, originalTime);

    if (global.gc) global.gc();

    // Test object-pooled implementation
    const optimizedTime = testCase.test(ObjectPooledLogger, './benchmark-object-pooled');
    const optimizedThroughput = benchmark.formatThroughput(testCase.operations, optimizedTime);

    const memAfter = benchmark.memoryUsage();

    // Calculate improvements
    const speedup = (originalTime / optimizedTime).toFixed(2);
    const improvement = ((originalTime - optimizedTime) / originalTime * 100).toFixed(1);
    const timeDiff = (originalTime - optimizedTime).toFixed(2);

    console.log(`Original:     ${originalTime.toFixed(2)}ms (${originalThroughput})`);
    console.log(`Object-Pooled: ${optimizedTime.toFixed(2)}ms (${optimizedThroughput})`);
    console.log(`Speedup:    ${speedup}x (${timeDiff}ms faster)`);
    console.log(`Improvement: ${improvement}% faster`);
    console.log(`Memory:     ${memBefore.heapUsed}MB -> ${memAfter.heapUsed}MB`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Comparison complete!');
};

// Stress test
const runStressTest = () => {
  console.log('\n🔥 Stress Test: High-frequency logging');
  console.log('='.repeat(50));

  const tests = [
    { name: 'Original', Logger: OriginalLogger, dir: './stress-original' },
    { name: 'Object-Pooled', Logger: ObjectPooledLogger, dir: './stress-object-pooled' }
  ];

  const iterations = 1000000;

  for (const test of tests) {
    cleanup(test.dir);
    const logger = new test.Logger(2048, test.dir);

    const memBefore = benchmark.memoryUsage();
    const time = testWithSilentConsole(() => {
      const { duration } = benchmark.time('Stress test', () => {
        for (let i = 0; i < iterations; i++) {
          logger.log('trace', { i, data: i * 2 });
        }
      });
      return duration;
    });
    const memAfter = benchmark.memoryUsage();

    const throughput = benchmark.formatThroughput(iterations, time);
    console.log(`${test.name}: ${time.toFixed(2)}ms (${throughput})`);
    console.log(`  Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);

    cleanup(test.dir);
  }
};

// Run comparison if called directly
if (require.main === module) {
  if (process.argv.includes('--stress')) {
    runStressTest();
  } else {
    runComparison();
    if (!process.argv.includes('--quick')) {
      runStressTest();
    }
  }
}

module.exports = { runComparison, runStressTest };
