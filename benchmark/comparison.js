const OriginalLogger = require('../index');
const OptimizedLogger = require('../index-optimized');
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

// Test functions
const testBasicLogging = (LoggerClass, iterations, logDir) => {
  cleanup(logDir);
  const logger = new LoggerClass(1000, logDir);

  const { duration } = benchmark.time('Basic logging', () => {
    for (let i = 0; i < iterations; i++) {
      logger.log('info', {
        message: `Test message ${i}`,
        timestamp: Date.now(),
        data: { value: i * 2 }
      });
    }
  });

  cleanup(logDir);
  return duration;
};

const testComplexObjects = (LoggerClass, iterations, logDir) => {
  cleanup(logDir);
  const logger = new LoggerClass(500, logDir);

  // Create complex test data
  const largeString = 'x'.repeat(2000);
  const complexObject = {
    id: 12345,
    name: 'Test Object',
    data: largeString,
    nested: {
      level1: { level2: { level3: { value: 'deep' } } }
    },
    array: new Array(100).fill(0).map((_, i) => ({ id: i, value: i * 2 }))
  };

  const { duration } = benchmark.time('Complex objects', () => {
    for (let i = 0; i < iterations; i++) {
      logger.log('info', {
        iteration: i,
        complex: complexObject,
        metadata: { timestamp: Date.now(), batch: Math.floor(i / 10) }
      });
    }
  });

  cleanup(logDir);
  return duration;
};

const testErrorHandling = (LoggerClass, errorCount, logDir) => {
  cleanup(logDir);
  const logger = new LoggerClass(100, logDir);

  // Add some context first
  for (let i = 0; i < 50; i++) {
    logger.log('info', { context: i, phase: 'setup' });
  }

  const { duration } = benchmark.time('Error handling', () => {
    for (let i = 0; i < errorCount; i++) {
      logger.log('error', {
        error: `Error ${i}`,
        stack: `Stack trace for error ${i}`,
        details: { code: 500, message: 'Internal error', errorId: i }
      });

      // Add some recovery context
      for (let j = 0; j < 5; j++) {
        logger.log('info', { recovery: j, errorId: i, phase: 'recovery' });
      }
    }
  });

  cleanup(logDir);
  return duration;
};

const testHighFrequency = (LoggerClass, iterations, logDir) => {
  cleanup(logDir);
  const logger = new LoggerClass(2048, logDir); // Power of 2 for optimized version

  const { duration } = benchmark.time('High frequency', () => {
    for (let i = 0; i < iterations; i++) {
      // Mix of different event types
      if (i % 1000 === 0) {
        logger.log('error', { message: `Batch error ${i}`, batchId: Math.floor(i / 1000) });
      } else if (i % 100 === 0) {
        logger.log('warning', { message: `Warning ${i}`, level: 'moderate' });
      } else {
        logger.log('info', { message: `Info ${i}`, counter: i });
      }
    }
  });

  cleanup(logDir);
  return duration;
};

// Main comparison function
const runComparison = () => {
  console.log('🔥 Performance Comparison: Original vs Optimized');
  console.log('='.repeat(60));
  console.log(`Node.js version: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log();

  const tests = [
    {
      name: 'Basic Logging (100,000 ops)',
      test: (LoggerClass, logDir) => testBasicLogging(LoggerClass, 100000, logDir),
      operations: 100000
    },
    {
      name: 'Complex Objects (10,000 ops)',
      test: (LoggerClass, logDir) => testComplexObjects(LoggerClass, 10000, logDir),
      operations: 10000
    },
    {
      name: 'Error Handling (1,000 errors)',
      test: (LoggerClass, logDir) => testErrorHandling(LoggerClass, 1000, logDir),
      operations: 6000 // 1000 errors + 5000 recovery logs
    },
    {
      name: 'High Frequency (500,000 ops)',
      test: (LoggerClass, logDir) => testHighFrequency(LoggerClass, 500000, logDir),
      operations: 500000
    }
  ];

  for (const testCase of tests) {
    console.log(`\n=== ${testCase.name} ===`);

    const memBefore = benchmark.memoryUsage();

    // Test original implementation
    const originalTime = testCase.test(OriginalLogger, './benchmark-original');
    const originalThroughput = benchmark.formatThroughput(testCase.operations, originalTime);

    // Force garbage collection between tests
    if (global.gc) global.gc();

    // Test optimized implementation
    const optimizedTime = testCase.test(OptimizedLogger, './benchmark-optimized');
    const optimizedThroughput = benchmark.formatThroughput(testCase.operations, optimizedTime);

    const memAfter = benchmark.memoryUsage();
    const speedup = (originalTime / optimizedTime).toFixed(2);
    const timeDiff = (originalTime - optimizedTime).toFixed(2);

    console.log(`Original:   ${originalTime.toFixed(2)}ms (${originalThroughput})`);
    console.log(`Optimized:  ${optimizedTime.toFixed(2)}ms (${optimizedThroughput})`);
    console.log(`Speedup:    ${speedup}x (${timeDiff}ms faster)`);
    console.log(`Memory:     ${memBefore.heapUsed}MB -> ${memAfter.heapUsed}MB`);

    if (optimizedTime < originalTime) {
      const improvement = ((originalTime - optimizedTime) / originalTime * 100).toFixed(1);
      console.log(`🚀 ${improvement}% performance improvement!`);
    } else {
      const regression = ((optimizedTime - originalTime) / originalTime * 100).toFixed(1);
      console.log(`⚠️  ${regression}% performance regression`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Comparison complete!');
};

// Memory stress test
const memoryStressTest = () => {
  console.log('\n🧠 Memory Stress Test');
  console.log('='.repeat(30));

  const iterations = 1000000;
  const tests = [
    { name: 'Original', Logger: OriginalLogger, dir: './stress-original' },
    { name: 'Optimized', Logger: OptimizedLogger, dir: './stress-optimized' }
  ];

  for (const test of tests) {
    cleanup(test.dir);
    const logger = new test.Logger(1024, test.dir);

    const memBefore = benchmark.memoryUsage();

    const { duration } = benchmark.time(`${test.name} stress test`, () => {
      for (let i = 0; i < iterations; i++) {
        logger.log('info', {
          iteration: i,
          data: `Memory test ${i}`,
          payload: { value: i, timestamp: Date.now() }
        });

        // Trigger some errors to test memory management during flushes
        if (i % 50000 === 0) {
          logger.log('error', { message: `Stress error ${i}`, iteration: i });
        }
      }
    });

    const memAfter = benchmark.memoryUsage();
    const memDelta = memAfter.heapUsed - memBefore.heapUsed;

    console.log(`${test.name}:`);
    console.log(`  Time: ${duration.toFixed(2)}ms`);
    console.log(`  Throughput: ${benchmark.formatThroughput(iterations, duration)}`);
    console.log(`  Memory: ${memBefore.heapUsed}MB -> ${memAfter.heapUsed}MB (Δ${memDelta.toFixed(2)}MB)`);

    cleanup(test.dir);
  }
};

// Run with --expose-gc for more accurate memory testing
if (require.main === module) {
  runComparison();
  memoryStressTest();
}

module.exports = { runComparison, memoryStressTest };
