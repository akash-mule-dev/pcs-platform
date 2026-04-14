const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  const bundlePath = path.join(__dirname, '..', 'dist', 'serverless.js');

  // Check if bundle exists
  const exists = fs.existsSync(bundlePath);
  if (!exists) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    const distFiles = fs.existsSync(path.join(__dirname, '..', 'dist'))
      ? fs.readdirSync(path.join(__dirname, '..', 'dist')).slice(0, 20)
      : 'dist dir not found';
    return res.end(JSON.stringify({
      error: 'Bundle not found',
      bundlePath,
      distFiles,
      dirname: __dirname,
    }));
  }

  // Check bundle size
  const stats = fs.statSync(bundlePath);

  // Try to load
  if (!process.argv[1]) process.argv[1] = __filename;

  let handler;
  try {
    handler = require(bundlePath);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Require failed',
      message: err.message,
      code: err.code,
      stack: err.stack?.split('\n').slice(0, 8),
      bundleSize: stats.size,
    }));
  }

  if (typeof handler !== 'function') {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'Not a function',
      type: typeof handler,
      bundleSize: stats.size,
    }));
  }

  try {
    return await handler(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Runtime', message: err.message }));
  }
};
