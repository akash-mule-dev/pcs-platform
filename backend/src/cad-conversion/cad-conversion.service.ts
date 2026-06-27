import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { resolveDistScript } from '../common/script-path.js';

export interface ConversionResult {
  outputPath: string;
  originalFormat: string;
  outputFormat: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class CadConversionService {
  private readonly logger = new Logger(CadConversionService.name);
  private readonly tempDir = path.join(os.tmpdir(), 'pcs-cad-conversion');
  private readonly scriptPath = resolveDistScript(__dirname, 'cad-conversion/scripts/convert-cad.mjs');

  constructor() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Check if a file extension is a CAD format that needs conversion.
   */
  isConvertibleFormat(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.step', '.stp', '.iges', '.igs', '.ifc'].includes(ext);
  }

  /**
   * Check if a file is an IFC file.
   */
  isIfcFormat(filename: string): boolean {
    return path.extname(filename).toLowerCase() === '.ifc';
  }

  /**
   * Convert a STEP, IGES, or IFC file to glTF/GLB format.
   * Returns the path to the converted GLB file.
   */
  async convert(inputPath: string, originalName: string): Promise<ConversionResult> {
    const ext = path.extname(originalName).toLowerCase();
    const outputId = crypto.randomUUID();
    const outputPath = path.join(this.tempDir, `${outputId}.glb`);

    this.logger.log(`Starting CAD conversion: ${originalName} (${ext}) -> GLB`);

    try {
      if (this.isIfcFormat(originalName)) {
        await this.runIfcConversion(inputPath, outputPath);
      } else {
        await this.runConversion(inputPath, outputPath, ext);
      }

      if (!fs.existsSync(outputPath)) {
        return {
          outputPath: '',
          originalFormat: ext,
          outputFormat: 'glb',
          success: false,
          error: 'Conversion produced no output file',
        };
      }

      this.logger.log(`CAD conversion completed: ${originalName} -> ${outputId}.glb`);

      return {
        outputPath,
        originalFormat: ext,
        outputFormat: 'glb',
        success: true,
      };
    } catch (err) {
      this.logger.error(`CAD conversion failed for ${originalName}: ${err}`);
      return {
        outputPath: '',
        originalFormat: ext,
        outputFormat: 'glb',
        success: false,
        error: String(err),
      };
    }
  }

  private runConversion(inputPath: string, outputPath: string, format: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // NB: no `--experimental-wasm-threads` — that flag was removed in Node 22+
      // (wasm threads are on by default) and passing it aborts with "bad option".
      const child = spawn('node', [
        this.scriptPath,
        inputPath,
        outputPath,
        format,
      ], {
        timeout: 300_000, // 5-minute timeout (loading the OCCT bundles + large models)
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Drain BOTH streams: OCCT prints verbose banners to stdout, and an
      // unread piped stream can fill its buffer and deadlock the child.
      let stderr = '';
      let stdout = '';
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          if (stdout.trim()) this.logger.log(`CAD conversion: ${stdout.trim().split('\n').pop()}`);
          resolve();
        } else {
          reject(new Error(`Conversion process exited with code ${code}: ${stderr || stdout}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn conversion process: ${err.message}`));
      });
    });
  }

  private readonly ifcScriptPath = resolveDistScript(__dirname, 'cad-conversion/scripts/convert-ifc.mjs');

  private runIfcConversion(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [
        this.ifcScriptPath,
        inputPath,
        outputPath,
      ], {
        timeout: 300_000, // 5-minute timeout for large IFC models
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let stdout = '';
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        if (stdout) this.logger.log(`IFC conversion output: ${stdout.trim()}`);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`IFC conversion exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn IFC conversion: ${err.message}`));
      });
    });
  }

  /**
   * Clean up a temporary converted file.
   */
  cleanup(filePath: string): void {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
