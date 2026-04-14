/**
 * Custom webpack config for Vercel deployment.
 * Bundles all JS dependencies into a single file so Vercel's nft
 * doesn't need to trace NestJS's dynamic module loading.
 * Native/binary modules are kept external.
 */
module.exports = function (options) {
  return {
    ...options,
    output: {
      ...options.output,
      libraryTarget: 'commonjs2',
    },
    node: {
      __dirname: false,
      __filename: false,
    },
    optimization: {
      splitChunks: false,
      minimize: true,
    },
    resolve: {
      ...options.resolve,
      extensions: ['.ts', '.js', '.json'],
      extensionAlias: {
        '.js': ['.ts', '.js'],
      },
    },
    externals: [
      ({ request }, callback) => {
        const nativeModules = [
          'pg-native',
          'sharp',
          'cpu-features',
          'ssh2',
          'opencascade.js',
          'web-ifc',
          'mikktspace',
        ];
        if (nativeModules.some(m => request === m || request.startsWith(m + '/'))) {
          return callback(null, 'commonjs ' + request);
        }
        callback();
      },
    ],
    plugins: [
      ...options.plugins,
      new (require('webpack')).optimize.LimitChunkCountPlugin({
        maxChunks: 1,
      }),
      new (require('webpack')).IgnorePlugin({
        checkResource(resource) {
          const lazyImports = [
            '@nestjs/microservices',
            '@fastify/static',
            'cache-manager',
            'class-transformer/storage',
            'pg-native',
            'opencascade.js',
            'web-ifc',
            'mikktspace',
            '@gltf-transform/core',
            '@gltf-transform/functions',
          ];
          return lazyImports.some(m => resource.startsWith(m));
        },
      }),
    ],
  };
};
