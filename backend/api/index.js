// Fix app-root-path crash: process.argv[1] can be undefined in serverless
if (!process.argv[1]) {
  process.argv[1] = __filename;
}

module.exports = require('../dist/serverless.js');
