import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Golden-file test: runs the real conversion scripts end-to-end and asserts a
 * valid, correctly-scaled GLB — the same checks done by hand during development,
 * now in CI. Skips automatically if the (optional) conversion deps aren't
 * installed (e.g. a pruned serverless install).
 */
const SCRIPTS = path.join(__dirname, 'scripts');

let haveDeps = true;
try {
  require.resolve('assimpjs');
  require.resolve('@gltf-transform/core');
} catch {
  haveDeps = false;
}

(haveDeps ? describe : describe.skip)('conversion scripts (golden file)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-test-'));
  const objPath = path.join(tmp, 'cube.obj');
  const glbPath = path.join(tmp, 'out.glb');
  const normPath = path.join(tmp, 'norm.glb');

  beforeAll(() => {
    fs.writeFileSync(objPath, [
      'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
      'v 0 0 1', 'v 1 0 1', 'v 1 1 1', 'v 0 1 1',
      'f 1 2 3 4', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8',
    ].join('\n'));
  });

  afterAll(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('converts OBJ -> valid GLB via assimp', () => {
    execFileSync('node', [path.join(SCRIPTS, 'convert-mesh.mjs'), objPath, glbPath], { stdio: 'pipe' });
    const buf = fs.readFileSync(glbPath);
    expect(buf.slice(0, 4).toString('ascii')).toBe('glTF');
  }, 60000);

  it('optimizes + normalizes (mm -> metres, Z-up) to a valid GLB with real dimensions', () => {
    const stdout = execFileSync('node', [
      path.join(SCRIPTS, 'optimize-glb.mjs'), glbPath, normPath,
      JSON.stringify({ sourceUnit: 'mm', upAxis: 'Z' }),
    ], { stdio: 'pipe' }).toString();

    const buf = fs.readFileSync(normPath);
    expect(buf.slice(0, 4).toString('ascii')).toBe('glTF');

    const line = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
    const report = JSON.parse(line);
    expect(report.dimensions).toBeDefined();
    // ~1-unit cube interpreted as mm => ~0.001 m per side (well under 1 cm).
    expect(report.dimensions.x).toBeGreaterThan(0);
    expect(report.dimensions.x).toBeLessThan(0.01);
    expect(report.sourceUnit).toBe('mm');
    expect(report.upAxis).toBe('Z');
  }, 60000);
});
