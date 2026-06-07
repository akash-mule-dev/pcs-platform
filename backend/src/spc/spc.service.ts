import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QualityData } from '../quality-data/quality-data.entity.js';

/**
 * Statistical Process Control over quality inspection measurements.
 * Produces a control chart (mean, ±3σ control limits), spec limits + Cp/Cpk
 * from tolerances, and basic rule violations (beyond 3σ, run of 8 one side).
 *
 * NOTE: quality_data is not yet tenant-scoped (part of the 0a rollout); results
 * are scoped by modelId/meshName supplied by the caller.
 */
@Injectable()
export class SpcService {
  constructor(@InjectRepository(QualityData) private readonly qdRepo: Repository<QualityData>) {}

  async controlChart(modelId?: string, meshName?: string) {
    const where: any = { isActive: true };
    if (modelId) where.modelId = modelId;
    if (meshName) where.meshName = meshName;

    const rows = await this.qdRepo.find({ where, order: { inspectionDate: 'ASC' } as any, take: 500 });
    const measured = rows.filter((r) => r.measurementValue !== null && r.measurementValue !== undefined);
    const values = measured.map((r) => Number(r.measurementValue));
    const n = values.length;
    if (n === 0) return { count: 0, points: [], violations: [], message: 'No measurement data for this selection' };

    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n > 1 ? n - 1 : 1);
    const sigma = Math.sqrt(variance);
    const ucl = mean + 3 * sigma;
    const lcl = mean - 3 * sigma;

    const tol = measured.find((r) => r.toleranceMin != null || r.toleranceMax != null);
    const usl = tol && tol.toleranceMax != null ? Number(tol.toleranceMax) : null;
    const lsl = tol && tol.toleranceMin != null ? Number(tol.toleranceMin) : null;
    let cp: number | null = null;
    let cpk: number | null = null;
    if (usl !== null && lsl !== null && sigma > 0) {
      cp = (usl - lsl) / (6 * sigma);
      cpk = Math.min(usl - mean, mean - lsl) / (3 * sigma);
    }

    const points = measured.map((r, i) => {
      const v = Number(r.measurementValue);
      return {
        index: i + 1,
        value: Number(v.toFixed(4)),
        date: r.inspectionDate || r.createdAt,
        outOfControl: v > ucl || v < lcl,
        outOfSpec: (usl !== null && v > usl) || (lsl !== null && v < lsl),
      };
    });

    const violations: any[] = [];
    points.forEach((p) => { if (p.outOfControl) violations.push({ index: p.index, rule: 'beyond_3sigma', value: p.value }); });
    let run = 0;
    let side = 0;
    for (const p of points) {
      const s = p.value >= mean ? 1 : -1;
      if (s === side) run++; else { side = s; run = 1; }
      if (run >= 8) violations.push({ index: p.index, rule: 'run_of_8_one_side' });
    }

    return {
      count: n,
      mean: Number(mean.toFixed(4)),
      sigma: Number(sigma.toFixed(4)),
      ucl: Number(ucl.toFixed(4)),
      lcl: Number(lcl.toFixed(4)),
      usl, lsl,
      cp: cp !== null ? Number(cp.toFixed(3)) : null,
      cpk: cpk !== null ? Number(cpk.toFixed(3)) : null,
      inControl: violations.length === 0,
      points,
      violations,
    };
  }
}
