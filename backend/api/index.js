// Fix app-root-path crash: process.argv[1] can be undefined in serverless
if (!process.argv[1]) {
  process.argv[1] = __filename;
}

// Force nft to include native modules that webpack externalizes
// Without these, Vercel's file tracer won't bundle them
try { require('bcrypt'); } catch (_) {}
try { require('pg'); } catch (_) {}

module.exports = require('../dist/serverless.js');
