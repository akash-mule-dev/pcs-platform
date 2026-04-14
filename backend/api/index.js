// Minimal test to verify functions still work with new config
module.exports = async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: 'ok',
    message: 'Test after config change',
    node: process.version,
  }));
};
