// Fix app-root-path crash: process.argv[1] can be undefined in serverless
if (!process.argv[1]) {
  process.argv[1] = __filename;
}

const mod = require('../dist/serverless.js');
module.exports = mod.default || mod;
