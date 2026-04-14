// Webpack-bundled NestJS app — serverless handler
const mod = require('../dist/serverless.js');
module.exports = mod.default || mod;
