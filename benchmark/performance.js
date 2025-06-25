const RingBufferLogger = require('../index');
const fs = require('fs');
const path = require('path');

// Benchmark utilities
const benchmark = {
  time: (label) => {
    const start = process.hrtime.bigint();
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000; // Convert to milliseconds
    console.log(`${label}: ${duration.toFixed(2)}ms`);
    return duration;
  },

  timeAsync: async(label) => {
    const start = process.hrtime.bigint();
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000;
    console.log(`${label}: ${duration.toFixed(2)}ms`);
    return duration;
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
  },

  silentConsole: () => {
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};
    return () => {
      console.log = originalLog;
      console.error = originalError;
    };
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

// Benchmark functions
const benchmarks = {
  basicLogging: (iterations = 100000) => {
    console.log(`\n=== Basic Logging Performance (${iterations.toLocaleString()} operations) ===`);
    const logDir = './benchmark-logs-basic';
    cleanup(logDir);

    const logger = new RingBufferLogger(1000, logDir);
    const memBefore = benchmark.memoryUsage();

    const duration = benchmark.time('Basic logging', () => {
      for (let i = 0; i < iterations; i++) {
        logger.log('info', {
          message: `Test message ${i}`,
          timestamp: Date.now(),
          data: { value: i * 2 }
        });
      }
    });

    const memAfter = benchmark.memoryUsage();
    console.log(`Throughput: ${benchmark.formatThroughput(iterations, duration)}`);
    console.log(`Memory before: ${memBefore.heapUsed}MB`);
    console.log(`Memory after: ${memAfter.heapUsed}MB`);
    console.log(`Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);

    cleanup(logDir);
  },

  errorHandlingPerformance: (errorCount = 1000) => {
    console.log(`\n=== Error Handling Performance (${errorCount.toLocaleString()} errors) ===`);
    const logDir = './benchmark-logs-errors';
    cleanup(logDir);

    const logger = new RingBufferLogger(100, logDir);

    // Fill buffer with some context
    for (let i = 0; i < 50; i++) {
      logger.log('info', { context: i });
    }

    const memBefore = benchmark.memoryUsage();
    const restore = benchmark.silentConsole();

    const duration = benchmark.time('Error handling', () => {
      for (let i = 0; i < errorCount; i++) {
        logger.log('error', {
          error: `Error ${i}`,
          stack: `Stack trace for error ${i}`,
          details: { code: 500, message: 'Internal error' }
        });

        // Add some context after each error
        for (let j = 0; j < 10; j++) {
          logger.log('info', { recovery: j, errorId: i });
        }
      }
    });

    restore();
    const memAfter = benchmark.memoryUsage();
    const totalOps = errorCount * 11; // error + 10 context logs

    console.log(`Throughput: ${benchmark.formatThroughput(totalOps, duration)}`);
    console.log(`Errors/sec: ${benchmark.formatThroughput(errorCount, duration)}`);
    console.log(`Files created: ${fs.readdirSync(logDir).length}`);
    console.log(`Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);

    cleanup(logDir);
  },

  bufferSizeComparison: () => {
    console.log('\n=== Buffer Size Performance Comparison ===');
    const iterations = 50000;
    const bufferSizes = [10, 100, 1000, 10000];

    bufferSizes.forEach(size => {
      const logDir = `./benchmark-logs-size-${size}`;
      cleanup(logDir);

      const logger = new RingBufferLogger(size, logDir);

      const duration = benchmark.time(`Buffer size ${size}`, () => {
        for (let i = 0; i < iterations; i++) {
          logger.log('info', {
            index: i,
            data: `Message for buffer size ${size}`,
            metadata: { size, iteration: i }
          });
        }
      });

      console.log(`  Throughput: ${benchmark.formatThroughput(iterations, duration)}`);
      cleanup(logDir);
    });
  },

  largeDataPerformance: (iterations = 10000) => {
    console.log(`\n=== Large Data Objects Performance (${iterations.toLocaleString()} operations) ===`);
    const logDir = './benchmark-logs-large';
    cleanup(logDir);

    const logger = new RingBufferLogger(100, logDir);

    // Create large data objects
    const largeString = 'x'.repeat(5000);
    const largeArray = new Array(1000).fill(0).map((_, i) => ({
      id: i,
      value: `item-${i}`,
      data: largeString.slice(0, 100)
    }));

    const memBefore = benchmark.memoryUsage();

    const duration = benchmark.time('Large data logging', () => {
      for (let i = 0; i < iterations; i++) {
        logger.log('info', {
          largeString: largeString,
          largeArray: largeArray,
          nestedObject: {
            level1: { level2: { level3: { data: largeString } } }
          },
          metadata: { iteration: i, timestamp: Date.now() }
        });
      }
    });

    const memAfter = benchmark.memoryUsage();
    console.log(`Throughput: ${benchmark.formatThroughput(iterations, duration)}`);
    console.log(`Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);
    console.log('Data sanitization overhead included');

    cleanup(logDir);
  },

  concurrentSimulation: async(threads = 5, operationsPerThread = 10000) => {
    console.log(`\n=== Concurrent Simulation (${threads} threads, ${operationsPerThread.toLocaleString()} ops each) ===`);
    const logDir = './benchmark-logs-concurrent';
    cleanup(logDir);

    const logger = new RingBufferLogger(1000, logDir);
    const memBefore = benchmark.memoryUsage();
    const restore = benchmark.silentConsole();

    const duration = await benchmark.timeAsync('Concurrent logging', async() => {
      const promises = [];

      for (let t = 0; t < threads; t++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              for (let i = 0; i < operationsPerThread; i++) {
                logger.log('info', {
                  thread: t,
                  operation: i,
                  message: `Thread ${t} operation ${i}`,
                  timestamp: Date.now()
                });

                // Simulate some errors
                if (i % 1000 === 0) {
                  logger.log('error', {
                    thread: t,
                    error: `Error in thread ${t} at operation ${i}`
                  });
                }
              }
              resolve();
            }, Math.random() * 10); // Random delay up to 10ms
          })
        );
      }

      await Promise.all(promises);
    });

    restore();
    const memAfter = benchmark.memoryUsage();
    const totalOps = threads * operationsPerThread;

    console.log(`Total operations: ${totalOps.toLocaleString()}`);
    console.log(`Throughput: ${benchmark.formatThroughput(totalOps, duration)}`);
    console.log(`Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);
    console.log(`Files created: ${fs.readdirSync(logDir).length}`);

    cleanup(logDir);
  },

  flushPerformance: (flushCount = 1000) => {
    console.log(`\n=== Flush Performance (${flushCount.toLocaleString()} flushes) ===`);
    const logDir = './benchmark-logs-flush';
    cleanup(logDir);

    const logger = new RingBufferLogger(50, logDir);
    const memBefore = benchmark.memoryUsage();
    const restore = benchmark.silentConsole();

    const duration = benchmark.time('Flush operations', () => {
      for (let i = 0; i < flushCount; i++) {
        // Add some context
        for (let j = 0; j < 25; j++) {
          logger.log('info', {
            context: j,
            flushGroup: i,
            data: `Context data for flush ${i}`
          });
        }

        // Trigger flush with error
        logger.log('error', {
          flushId: i,
          error: `Test error ${i}`,
          details: { timestamp: Date.now() }
        });
      }
    });

    restore();
    const memAfter = benchmark.memoryUsage();
    const files = fs.readdirSync(logDir);

    console.log(`Flushes/sec: ${benchmark.formatThroughput(flushCount, duration)}`);
    console.log(`Files created: ${files.length}`);
    console.log(`Avg file size: ${getAverageFileSize(logDir, files)}KB`);
    console.log(`Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);

    cleanup(logDir);
  }
};

// Helper function to calculate average file size
const getAverageFileSize = (logDir, files) => {
  const totalSize = files.reduce((sum, file) => {
    try {
      const stat = fs.statSync(path.join(logDir, file));
      return sum + stat.size;
    } catch (err) {
      return sum;
    }
  }, 0);

  return Math.round((totalSize / files.length / 1024) * 100) / 100;
};

// Run all benchmarks
const runBenchmarks = async() => {
  console.log('🚀 Ring Buffer Logger Performance Benchmark');
  console.log('='.repeat(50));

  const overallStart = process.hrtime.bigint();

  // System info
  console.log(`Node.js version: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Initial memory: ${benchmark.memoryUsage().heapUsed}MB`);

  try {
    benchmarks.basicLogging(100000);
    benchmarks.bufferSizeComparison();
    benchmarks.largeDataPerformance(10000);
    benchmarks.errorHandlingPerformance(1000);
    benchmarks.flushPerformance(500);
    await benchmarks.concurrentSimulation(5, 10000);

    const overallEnd = process.hrtime.bigint();
    const totalDuration = Number(overallEnd - overallStart) / 1000000;

    console.log(`\n${'='.repeat(50)}`);
    console.log(`🏁 Total benchmark time: ${totalDuration.toFixed(2)}ms`);
    console.log(`Final memory: ${benchmark.memoryUsage().heapUsed}MB`);

  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
};

// Quick benchmark for faster testing
const runQuickBenchmarks = async() => {
  console.log('⚡ Ring Buffer Logger Quick Benchmark');
  console.log('='.repeat(40));

  const overallStart = process.hrtime.bigint();

  // System info
  console.log(`Node.js version: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Initial memory: ${benchmark.memoryUsage().heapUsed}MB`);

  try {
    benchmarks.basicLogging(10000);
    benchmarks.largeDataPerformance(1000);
    benchmarks.errorHandlingPerformance(100);
    benchmarks.flushPerformance(50);
    await benchmarks.concurrentSimulation(3, 1000);

    const overallEnd = process.hrtime.bigint();
    const totalDuration = Number(overallEnd - overallStart) / 1000000;

    console.log(`\n${'='.repeat(40)}`);
    console.log(`🏁 Total benchmark time: ${totalDuration.toFixed(2)}ms`);
    console.log(`Final memory: ${benchmark.memoryUsage().heapUsed}MB`);

  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
};

// Run benchmarks based on command line argument
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--quick')) {
    runQuickBenchmarks().catch(console.error);
  } else {
    runBenchmarks().catch(console.error);
  }
}

module.exports = { benchmarks, benchmark, runQuickBenchmarks };
