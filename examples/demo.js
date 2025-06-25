const RingBufferLogger = require('../index');

// Create a logger with small capacity for demo purposes
const logger = new RingBufferLogger(10, './demo-logs');

console.log('Ring Buffer Logger Demo');
console.log('========================\n');

console.log('Logging normal events...');
logger.log('startup', { version: '1.0.0', pid: process.pid });
logger.log('info', { message: 'Application started successfully' });
logger.log('info', { message: 'Processing user request', userId: 12345 });
logger.log('debug', { message: 'Database connection established', host: 'localhost' });
logger.log('info', { message: 'Request processed', duration: 150 });

console.log('\nBuffer state:');
console.log('Entries:', logger.getCurrentBuffer().length);
console.log('Stats:', logger.getStats());

console.log('\nSimulating error...');
logger.log('error', {
  message: 'Failed to process payment',
  error: 'Connection timeout',
  userId: 12345,
  amount: 99.99
});

console.log('\nLogging post-error context...');
logger.log('info', { message: 'Retrying payment processing' });
logger.log('info', { message: 'Fallback payment method used' });
logger.log('info', { message: 'Payment completed successfully' });

console.log('\nContinuing operations...');
for (let i = 0; i < 8; i++) {
  logger.log('info', { message: `Operation ${i + 1}`, timestamp: Date.now() });
}

console.log('\nFinal buffer state:');
console.log('Entries:', logger.getCurrentBuffer().length);
console.log('Stats:', logger.getStats());

console.log('\nDemo completed. Check ./demo-logs for log files.');

console.log('\nTesting data sanitization...');
const longString = 'This is a very long string that exceeds the 1000 character limit. '.repeat(50);
logger.log('info', { longData: longString });

const circularData = { name: 'test' };
circularData.self = circularData;
logger.log('info', circularData);

console.log('Done.');
