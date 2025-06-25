# Ring Buffer Logger Performance Benchmark

This directory contains a comprehensive performance benchmark suite for the RingBufferLogger.

## Usage

### Full Benchmark Suite

Run the complete benchmark with full datasets:

```bash
npm run benchmark
```

This includes:
- **Basic Logging**: 100,000 operations
- **Buffer Size Comparison**: 50,000 operations across different buffer sizes
- **Large Data Objects**: 10,000 operations with complex data
- **Error Handling**: 1,000 errors with context
- **Flush Performance**: 500 flush operations
- **Concurrent Simulation**: 5 threads with 10,000 operations each

### Quick Benchmark

For faster results during development:

```bash
npm run benchmark:quick
```

This uses smaller datasets:
- **Basic Logging**: 10,000 operations
- **Large Data Objects**: 1,000 operations
- **Error Handling**: 100 errors
- **Flush Performance**: 50 flush operations
- **Concurrent Simulation**: 3 threads with 1,000 operations each

## Benchmark Categories

### 1. Basic Logging Performance
Tests raw throughput for standard log operations without errors (no file I/O).

**Metrics:**
- Operations per second
- Memory usage delta
- Execution time

### 2. Buffer Size Comparison
Compares performance across different ring buffer capacities (10, 100, 1000, 10000).

**Metrics:**
- Throughput for each buffer size
- Memory efficiency

### 3. Large Data Objects Performance
Tests performance with complex, large data objects including:
- Large strings (5KB)
- Arrays with 1000 items
- Nested objects
- Data sanitization overhead

**Metrics:**
- Operations per second with complex data
- Memory consumption
- Sanitization overhead

### 4. Error Handling Performance
Tests the core feature - error logging with context capture and file flushing.

**Metrics:**
- Error handling throughput
- File creation rate
- Memory management during flushes

### 5. Flush Performance
Focuses specifically on the flush operations (writing to disk).

**Metrics:**
- Flushes per second
- Average file size
- File system performance

### 6. Concurrent Simulation
Simulates multiple threads/processes logging simultaneously.

**Metrics:**
- Concurrent throughput
- Memory usage under load
- File creation consistency

## Performance Results (Example)

On MacBook Pro M1 (Node.js v18.20.5):

```
=== Basic Logging Performance ===
Throughput: ~870,000 ops/sec
Memory delta: ~3MB for 100k operations

=== Error Handling Performance ===
Error throughput: ~1,200 errors/sec
File creation: ~200 files for 1000 errors

=== Large Data Performance ===
Throughput: ~2,200 ops/sec (with 5KB+ objects)
Memory overhead: ~84MB for 10k operations

=== Concurrent Performance ===
Multi-thread throughput: ~92,000 ops/sec
```

## Interpreting Results

### Good Performance Indicators
- High ops/sec for basic logging
- Consistent performance across buffer sizes
- Reasonable memory usage growth
- Fast error handling and file creation

### Performance Considerations
- Large data objects significantly impact throughput
- File I/O operations are naturally slower than in-memory operations
- Memory usage should be monitored for long-running applications
- Concurrent access performs well due to single-threaded nature

### Optimization Opportunities
- Buffer size tuning based on use case
- Data sanitization can be customized
- File naming and organization strategies
- Memory management for high-throughput scenarios

## Running Custom Benchmarks

You can also import and run individual benchmarks:

```javascript
const { benchmarks } = require('./benchmark/performance');

// Run specific benchmark
benchmarks.basicLogging(50000);
benchmarks.errorHandlingPerformance(500);
```

## System Requirements

The benchmark creates temporary directories and files during testing. Ensure you have:
- Write permissions in the project directory
- Sufficient disk space (benchmarks create many small files)
- Memory for large data object tests

All temporary files and directories are automatically cleaned up after each test. 