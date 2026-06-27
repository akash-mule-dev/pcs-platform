import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve a compiled `.mjs` helper script that the backend spawns as a child
 * process (the IFC extractor + the CAD/IFC→GLB converters). After the asset
 * copy (see nest-cli.json) the scripts live at `dist/<dir>/scripts/<name>`,
 * but the directory `__dirname` points at differs between build layouts:
 *
 *   - Plain `nest build` (unbundled): each module keeps its own folder, so the
 *     caller is e.g. `dist/projects` or `dist/cad-conversion` and the script
 *     tree is a sibling under `dist/`.
 *   - Vercel webpack build: everything collapses into a single
 *     `dist/serverless.js`, so `__dirname` is `dist` itself and a relative
 *     `..`-climb over-shoots `dist` entirely — which produced the deployed
 *     `Cannot find module '/var/task/backend/cad-conversion/scripts/...'`.
 *
 * Probe the candidate dist roots derived from the caller's `__dirname` and
 * return the first place the script actually exists. `distRelativePath` is the
 * path of the script relative to the `dist/` root (e.g.
 * `cad-conversion/scripts/extract-ifc-structure.mjs`), which is uniform across
 * both layouts. Falls back to the dist-root candidate so a genuinely-missing
 * file (e.g. a pruned serverless install) still errors with a sensible path.
 */
export function resolveDistScript(callerDir: string, distRelativePath: string): string {
  const candidates = [
    path.join(callerDir, distRelativePath), // __dirname === dist (bundled)
    path.join(callerDir, '..', distRelativePath), // __dirname === dist/<module>
    path.join(callerDir, '..', '..', distRelativePath), // __dirname === dist/<module>/<sub>
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore and try the next candidate */
    }
  }
  return candidates[0];
}
