import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface MeshConversionResult {
  outputPath: string;
  success: boolean;
  error?: string;
}

/**
 * Converts mesh/DCC formats (OBJ, FBX, DAE, STL, PLY, 3DS, glTF) to GLB by
 * spawning the assimpjs WASM script as an isolated child process — mirroring
 * the existing CAD/IFC converters.
 */
@Injectable()
export class MeshConverter {
  private readonly logger = new Logger(MeshConverter.name);
  private readonly scriptPath = path.join(__dirname, '..', 'scripts', 'convert-mesh.mjs');

  async convert(inputPath: string, outputPath: string): Promise<MeshConversionResult> {
    try {
      await this.run(inputPath, outputPath);
      if (!fs.existsSync(outputPath)) {
        return { outputPath: '', success: false, error: 'Mesh conversion produced no output file' };
      }
      return { outputPath, success: true };
    } catch (err) {
      this.logger.error(`Mesh conversion failed: ${err}`);
      return { outputPath: '', success: false, error: String(err) };
    }
  }

  private run(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [this.scriptPath, inputPath, outputPath], {
        timeout: 120_000, // 2 minutes
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        if (stdout.trim()) this.logger.log(stdout.trim());
        if (code === 0) resolve();
        else reject(new Error(`Mesh conversion exited with code ${code}: ${stderr.trim()}`));
      });
      child.on('error', (err) => reject(new Error(`Failed to spawn mesh conversion: ${err.message}`)));
    });
  }
}
