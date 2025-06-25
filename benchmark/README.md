# Ring Buffer Logger Performance Benchmarks

This directory contains performance benchmarks for the RingBufferLogger implementations.

## Available Benchmarks

### 1. Basic Performance (`performance.js`)
Tests the original implementation with various workloads:
- Basic logging performance
- Error handling with file I/O
- Large object processing

```bash
# Full benchmark
node benchmark/performance.js

# Quick benchmark (10% of operations)
node benchmark/performance.js --quick
```

### 2. Two-Way Comparison (`comparison.js`)
Compares original vs object-pooled implementations:
- Basic logging comparison
- Complex object processing comparison
- Memory usage analysis

```bash
# Full comparison
node benchmark/comparison.js

# Quick comparison
node benchmark/comparison.js --quick

# Stress test only
node benchmark/comparison.js --stress
```

### 3. Three-Way Comparison (`three-way-comparison.js`)
Compares all three implementations (original, object-pooled, bit-optimized):
- Micro benchmarks (1M operations)
- Basic logging (500K operations)  
- Complex objects (50K operations)

```bash
# Full three-way comparison
node benchmark/three-way-comparison.js

# Quick three-way comparison
node benchmark/three-way-comparison.js --quick
```

## NPM Scripts

The following npm scripts are available for convenience:

```bash
# Basic performance benchmark
npm run benchmark

# Quick basic benchmark
npm run benchmark:quick

# Three-way comparison (all implementations)
npm run benchmark:compare

# Quick three-way comparison
npm run benchmark:compare:quick
```

## Expected Performance Results

Based on Node.js v18.20.5 on macOS ARM64:

### Micro Benchmark (1,000,000 ops)
- **Original**: ~1,800,000 ops/sec
- **Object-Pooled**: ~3,600,000 ops/sec (**2.0x faster**)
- **Bit-Optimized**: ~4,800,000 ops/sec (**2.7x faster**)

### Basic Logging (500,000 ops)
- **Original**: ~850,000 ops/sec
- **Object-Pooled**: ~2,400,000 ops/sec (**2.8x faster**)
- **Bit-Optimized**: ~3,600,000 ops/sec (**4.2x faster**)

### Complex Objects (50,000 ops)
- **Original**: ~64,000 ops/sec
- **Object-Pooled**: ~234,000 ops/sec (**3.7x faster**)
- **Bit-Optimized**: ~3,100,000 ops/sec (**48x faster**) 🔥

## Understanding the Results

- **Object-Pooled** implementation shows consistent 2-4x improvements through memory allocation optimizations
- **Bit-Optimized** implementation shows dramatic improvements (up to 48x) for complex object processing due to aggressive low-level optimizations
- All implementations maintain 100% API compatibility
- Performance gains come from:
  - Object pooling (eliminates GC pressure)
  - Hash-based comparisons (faster than string comparisons)
  - Bit operations (faster than modulo)
  - Specialized type handling (optimized for different data types)
  - Manual memory management techniques 