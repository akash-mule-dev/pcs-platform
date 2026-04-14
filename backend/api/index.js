if (!process.argv[1]) process.argv[1] = __filename;

const handler = require('../dist/serverless.js');

module.exports = async (req, res) => {
  if (typeof handler === 'function') {
    return handler(req, res);
  }
  if (handler && typeof handler.default === 'function') {
    return handler.default(req, res);
  }
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({
    error: 'Handler not found',
    handlerType: typeof handler,
    keys: handler ? Object.keys(handler).slice(0, 10) : null,
  }));
};
