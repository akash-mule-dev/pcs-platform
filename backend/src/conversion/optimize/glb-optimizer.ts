import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface OptimizeOptions {
  simplifyRatio?: number;
  maxTexture?: number;
  draco?: boolean;
  quantize?: boolean;
  sourceUnit?: string;
  upAxis?: 'Y' | 'Z';
}

export interface OptimizeResult {
  outputPath: string;
  success: boolean;
  trianglesBefore?: number;
  trianglesAfter?: number;
  bytesBefore?: number;
  bytesAfter?: number;
  dimensions?: { x: number; y: number; z: number };
  error?: string;
}

/**
 * Optimizes a GLB for AR/web/app by spawning the gltf-transform script.
 * Default ops are decoder-agnostic; Draco/quantize are opt-in.
 */
@Injectable()
export class GlbOptimizer {
  private readonly logger = new Logger(GlbOptimizer.name);
  private readonly scriptPath = path.join(__dirname, '..', 'scripts', 'optimize-glb.mjs');

  async optimize(
    inputPath: string,
    outputPath: string,
    options: OptimizeOptions = {},
  ): Promise<OptimizeResult> {
    try {
      const report = await this.run(inputPath, outputPath, options);
      if (!fs.existsSync(outputPath)) {
        return { outputPath: '', success: false, error: 'Optimization produced no output file' };
      }
      return { outputPath, success: true, ...report };
    } catch (err) {
      this.logger.error(`GLB optimization failed: ${err}`);
      return { outputPath: '', success: false, error: String(err) };
    }
  }

  private run(
    inputPath: string,
    outputPath: string,
    options: OptimizeOptions,
  ): Promise<Partial<OptimizeResult>> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'node',
        [this.scriptPath, inputPath, outputPath, JSON.stringify(options)],
        { timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        if (stderr.trim()) this.logger.warn(stderr.trim());
        if (code !== 0) {
          return reject(new Error(`Optimization exited with code ${code}: ${stderr.trim()}`));
        }
        // The script prints a single JSON report line on stdout.
        const line = stdout.trim().split('\n').filter(Boolean).pop();
        let report: Partial<OptimizeResult> = {};
        try { report = line ? JSON.parse(line) : {}; } catch { /* non-JSON output */ }
        resolve(report);
      });
      child.on('error', (err) => reject(new Error(`Failed to spawn optimization: ${err.message}`)));
    });
  }
}
