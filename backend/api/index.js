if (!process.argv[1]) process.argv[1] = __filename;

let handler, loadError;
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
      error: loadError.message,
      stack: loadError.stack?.split('\n').slice(0, 5),
    }));
  }

  if (typeof handler !== 'function') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      status: 'loaded',
      handlerType: typeof handler,
      keys: handler ? Object.keys(handler).slice(0, 5) : null,
    }));
  }

  return handler(req, res);
};
