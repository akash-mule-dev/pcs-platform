// Fix app-root-path crash
if (!process.argv[1]) {
  process.argv[1] = __filename;
}

// Force nft to include native modules
try { require('bcrypt'); } catch (_) {}
try { require('pg'); } catch (_) {}

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
      stack: loadError.stack?.split('\n').slice(0, 5),
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

  return handler(req, res);
};
