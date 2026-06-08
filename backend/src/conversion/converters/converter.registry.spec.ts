import {
  converterFor, isSupportedInput, extOf, SUPPORTED_INPUT_EXTS, SUPPORTED_FORMATS,
} from './converter.registry.js';

describe('converter.registry', () => {
  it('routes CAD/IFC formats to the cad converter', () => {
    for (const f of ['model.step', 'a.STP', 'b.iges', 'c.igs', 'd.ifc']) {
      expect(converterFor(f)).toBe('cad');
    }
  });

  it('routes mesh/DCC formats to the mesh converter', () => {
    for (const f of ['m.obj', 'm.fbx', 'm.dae', 'm.stl', 'm.ply', 'm.3ds', 'm.gltf']) {
      expect(converterFor(f)).toBe('mesh');
    }
  });

  it('treats GLB as passthrough (optimize only)', () => {
    expect(converterFor('x.glb')).toBe('passthrough');
  });

  it('accepts supported formats and rejects unsupported', () => {
    expect(isSupportedInput('a.step')).toBe(true);
    expect(isSupportedInput('a.obj')).toBe(true);
    expect(isSupportedInput('a.txt')).toBe(false);
    expect(isSupportedInput('noext')).toBe(false);
    expect(() => converterFor('a.txt')).toThrow();
  });

  it('extOf is case-insensitive', () => {
    expect(extOf('A.STP')).toBe('.stp');
    expect(extOf('path/to/Model.GLB')).toBe('.glb');
  });

  it('exposes a non-empty input + format catalogue', () => {
    expect(SUPPORTED_INPUT_EXTS).toContain('.ifc');
    expect(SUPPORTED_INPUT_EXTS.length).toBeGreaterThan(5);
    expect(SUPPORTED_FORMATS.length).toBeGreaterThan(5);
  });
});
