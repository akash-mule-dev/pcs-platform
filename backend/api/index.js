// Force Vercel's file tracer (nft) to include NestJS and all runtime deps.
// Without these explicit requires, nft can't follow NestJS's decorator-based
// dynamic module loading and produces a ~4MB bundle instead of ~130MB.
try {
  require('@nestjs/core');
  require('@nestjs/common');
  require('@nestjs/platform-express');
  require('@nestjs/typeorm');
  require('@nestjs/jwt');
  require('@nestjs/passport');
  require('@nestjs/schedule');
  require('@nestjs/serve-static');
  require('@nestjs/swagger');
  require('@nestjs/throttler');
  require('@nestjs/websockets');
  require('@nestjs/platform-socket.io');
  require('typeorm');
  require('pg');
  require('bcrypt');
  require('passport');
  require('passport-jwt');
  require('class-transformer');
  require('class-validator');
  require('helmet');
  require('multer');
  require('rxjs');
  require('socket.io');
  require('reflect-metadata');
  require('uuid');
  require('unzipper');
} catch (_) {
  // These requires are only for nft tracing; actual app loads from dist/
}

const mod = require('../dist/serverless.js');
module.exports = mod.default || mod;
