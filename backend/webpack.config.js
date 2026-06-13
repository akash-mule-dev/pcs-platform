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
      // TypeORM resolves entity metadata (and find-options relation/column
      // property paths) via the runtime class name — `connection.getMetadata`
      // and `findRelationWithPropertyPath` key off `Function.name`. Terser's
      // default name mangling renames `WorkOrder` -> `y`, so any query using a
      // `relations`/`where` option by name throws
      //   `Property "process" was not found in "y". Make sure your query is correct.`
      // ONLY in the bundled Vercel build (plain `nest start` is unbundled, so it
      // worked locally — this is why the deployed work-order detail 500'd while
      // the web app on a local backend was fine). Keeping class + function names
      // preserves the metadata the ORM depends on.
      minimizer: [
        new (require('terser-webpack-plugin'))({
          terserOptions: {
            keep_classnames: true,
            keep_fnames: true,
          },
        }),
      ],
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
