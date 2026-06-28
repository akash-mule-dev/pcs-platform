// metres-per-GLB-unit — the entity scale that renders a converted GLB at TRUE 1:1
// size in AR (rendered size = GLB intrinsic size × metersPerUnit). It is determined
// by the CONVERSION PIPELINE's output units, NOT the source file's declared unit:
//
//   • IFC   → 1000.  web-ifc already emits geometry in METRES, but optimize-glb's
//     AR_Normalize node then multiplies by UNIT_TO_M['mm']=0.001 a SECOND time
//     (it assumes IFC is millimetres), so the stored GLB is 1000× too small.
//     Scaling by 1000 puts it back at real size. (Verified against conversion job
//     dimensions: IFC models store sizes 1000× smaller than reality.)
//   • everything else → 1.0.  STEP/IGES/CAD come from OpenCASCADE in millimetres
//     and optimize-glb's 0.001 correctly converts them to metres; raw glTF is
//     already metres; mesh formats are treated as metres. All land at real size.
//
// Keyed off the SOURCE file extension (the conversion job's originalName) — the
// converted output is always ".glb", which can't reveal the pipeline that made it.

/** metres-per-GLB-unit for a source file, accounting for the conversion pipeline. */
export function defaultMetersPerUnit(sourceName: string): number {
  const ext = (sourceName.split('.').pop() || '').toLowerCase();
  return ext === 'ifc' ? 1000 : 1;
}
