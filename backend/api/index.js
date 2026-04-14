// Fix app-root-path crash
if (!process.argv[1]) {
  process.argv[1] = __filename;
}

let handler;
let loadError;

try {
  handler = require('../dist/serverless.js');
} catch (err) {
  loadError = err;
}

module.exports = async (req, res) => {
  if (loadError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Module load failed',
      message: loadError.message,
      stack: loadError.stack?.split('\n').slice(0, 8),
    }));
  }

  if (typeof handler !== 'function') {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Handler is not a function',
      type: typeof handler,
      keys: handler ? Object.keys(handler).slice(0, 10) : null,
    }));
  }

  try {
    return await handler(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Handler error',
      message: err.message,
    }));
  }
};

// nft trace hints — these are external in webpack and need to be in node_modules
// Using path-based requires so nft includes them without executing
const path = require('path');
try { require(path.resolve(__dirname, '../node_modules/bcrypt')); } catch (_) {}
try { require(path.resolve(__dirname, '../node_modules/pg')); } catch (_) {}
