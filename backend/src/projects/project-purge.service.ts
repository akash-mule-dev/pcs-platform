import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Project } from './project.entity.js';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.interface.js';

/**
 * How long a soft-deleted project stays recoverable in the Trash before it is
 * permanently purged. After this window the scheduled sweep deletes the project
 * and its entire owned subtree (and the blobs those rows point at) for good.
 */
export const PROJECT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Permanent deletion of a project and EVERYTHING it owns, transitively, across
 * every module — work orders, quality, shipping, traceability, imports, models,
 * conversions — plus the object-storage blobs those rows point at.
 *
 * The project graph is only PARTLY wired with `ON DELETE CASCADE` FKs (many
 * cross-module links are bare uuid columns with no constraint), so a naive
 * `DELETE FROM projects` would orphan `work_orders`, `work_order_stage_events`,
 * `serial_units`, `genealogy_links`, `quality_data`, `quality_reports`,
 * `conversion_jobs`, `models` and project-level `assembly_documents`. We instead
 * delete child-first, in dependency order, in a single transaction, scoping
 * every statement to the project's id-subtree. Blob keys are collected BEFORE
 * the DB delete and removed best-effort AFTER it commits (so a rolled-back
 * delete never loses files that are still referenced).
 *
 * Runs WITHOUT request/tenant context (the cron + internal endpoint have no JWT)
 * — it is given an explicit project id, so it never reads `TenantContext`. The
 * org-scoped existence check lives in `ProjectsService.purge`.
 */
@Injectable()
export class ProjectPurgeService {
  private readonly logger = new Logger(ProjectPurgeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /** Permanently delete one project (and its whole subtree + blobs). */
  async hardDelete(projectId: string): Promise<void> {
    const { keys, modelIds, convJobIds } = await this.collectBlobsAndIds(projectId);
    await this.dataSource.transaction((m) => this.deleteGraph(m, projectId, modelIds, convJobIds));
    await this.deleteBlobs(keys);
  }

  /**
   * Cross-org retention sweep: permanently delete every project whose
   * `deleted_at` is older than the retention window. Context-less by design —
   * mirrors `AlertsService`/`TenantBootstrapService`: a raw query with no org
   * filter (RLS permits it when no `app.current_org` is set), purging each.
   * Returns the number of projects purged.
   */
  async purgeExpired(retentionDays = PROJECT_RETENTION_DAYS): Promise<number> {
    const rows: { id: string }[] = await this.projectRepo.query(
      `SELECT id FROM projects
        WHERE deleted_at IS NOT NULL
          AND deleted_at < now() - ($1::int * interval '1 day')`,
      [retentionDays],
    );
    let purged = 0;
    for (const r of rows) {
      try {
        await this.hardDelete(r.id);
        purged++;
      } catch (e: any) {
        this.logger.error(`Failed to purge project ${r.id}: ${e?.message ?? e}`);
      }
    }
    if (purged) this.logger.log(`Purged ${purged} project(s) past the ${retentionDays}-day retention window`);
    return purged;
  }

  /**
   * Daily retention sweep for long-running instances. NOTE: in-process cron is
   * unreliable on serverless (no always-on process) — production also drives the
   * purge via the secret-guarded `GET /api/internal/projects/purge-expired`
   * endpoint hit by a Vercel Cron. Both call `purgeExpired`, which is idempotent.
   */
  @Cron('0 0 3 * * *')
  async scheduledPurge(): Promise<void> {
    try {
      await this.purgeExpired();
    } catch (e: any) {
      this.logger.error(`Scheduled project purge failed: ${e?.message ?? e}`);
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Collect (a) every blob storage key reachable from the project and (b) the
   * model + conversion-job id sets — resolved NOW, before the DB delete removes
   * the `assembly_nodes`/`import_files` rows that point at them.
   */
  private async collectBlobsAndIds(
    projectId: string,
  ): Promise<{ keys: string[]; modelIds: string[]; convJobIds: string[] }> {
    const keys = new Set<string>();
    const add = (k: unknown) => {
      if (typeof k === 'string' && k.trim()) keys.add(k);
    };

    // Models referenced by this project's nodes / import files.
    const modelRows: { id: string; file_name: string | null; file_path: string | null; thumbnail_path: string | null }[] =
      await this.projectRepo.query(
        `SELECT id, file_name, file_path, thumbnail_path FROM models
          WHERE id IN (SELECT model_id FROM assembly_nodes WHERE project_id = $1 AND model_id IS NOT NULL
                       UNION
                       SELECT model_id FROM import_files  WHERE project_id = $1 AND model_id IS NOT NULL)`,
        [projectId],
      );
    const modelIds = modelRows.map((r) => r.id);
    for (const r of modelRows) { add(r.file_name); add(r.file_path); add(r.thumbnail_path); }

    // Conversion jobs reachable via import files OR the resolved model ids.
    const convRows: { id: string; source_key: string | null; output_key: string | null }[] =
      await this.projectRepo.query(
        `SELECT id, source_key, output_key FROM conversion_jobs
          WHERE id IN (SELECT conversion_job_id FROM import_files WHERE project_id = $1 AND conversion_job_id IS NOT NULL)
             OR model_id = ANY($2::uuid[])`,
        [projectId, modelIds],
      );
    const convJobIds = convRows.map((r) => r.id);
    for (const r of convRows) { add(r.source_key); add(r.output_key); }

    // Import sources.
    const importRows: { storage_key: string | null }[] = await this.projectRepo.query(
      `SELECT storage_key FROM import_files WHERE project_id = $1 AND storage_key IS NOT NULL`,
      [projectId],
    );
    for (const r of importRows) add(r.storage_key);

    // Shop drawings / package documents (project- and node-level).
    const docRows: { storage_key: string | null }[] = await this.projectRepo.query(
      `SELECT storage_key FROM assembly_documents WHERE project_id = $1`,
      [projectId],
    );
    for (const r of docRows) add(r.storage_key);

    // Quality inspection evidence (jsonb array of keys; project- or node-scoped rows).
    const evidenceRows: { k: string | null }[] = await this.projectRepo.query(
      `SELECT jsonb_array_elements_text(attachments) AS k FROM quality_data
        WHERE (project_id = $1 OR assembly_node_id IN (SELECT id FROM assembly_nodes WHERE project_id = $1))
          AND attachments IS NOT NULL`,
      [projectId],
    );
    for (const r of evidenceRows) add(r.k);

    return { keys: [...keys], modelIds, convJobIds };
  }

  /** Delete the project's whole subtree child-first within one transaction. */
  private async deleteGraph(m: EntityManager, projectId: string, modelIds: string[], convJobIds: string[]): Promise<void> {
    const p = [projectId];
    // Reusable id-subqueries (all keyed off the single project id).
    const PO = `(SELECT id FROM production_orders WHERE project_id = $1)`;
    const NODES = `(SELECT id FROM assembly_nodes WHERE project_id = $1)`;
    const WO = `(SELECT id FROM work_orders WHERE production_order_id IN ${PO} OR assembly_node_id IN ${NODES})`;
    const WOS = `(SELECT id FROM work_order_stages WHERE work_order_id IN ${WO})`;
    const IMPORTS = `(SELECT id FROM import_files WHERE project_id = $1)`;
    const SHIPMENTS = `(SELECT id FROM shipments WHERE project_id = $1 OR production_order_id IN ${PO})`;
    const QR = `(SELECT id FROM quality_reports WHERE project_id = $1 OR production_order_id IN ${PO} OR assembly_node_id IN ${NODES})`;

    // 1–6: work-order subtree (no/weak FKs → must be explicit + child-first)
    await m.query(`DELETE FROM genealogy_links WHERE serial_id IN (SELECT id FROM serial_units WHERE work_order_id IN ${WO})`, p);
    await m.query(`DELETE FROM serial_units WHERE work_order_id IN ${WO}`, p);
    await m.query(`DELETE FROM time_entries WHERE work_order_stage_id IN ${WOS}`, p); // FK NO ACTION → before stages
    await m.query(`DELETE FROM work_order_stage_events WHERE work_order_id IN ${WO} OR production_order_id IN ${PO} OR assembly_node_id IN ${NODES}`, p);
    await m.query(`DELETE FROM work_order_stages WHERE work_order_id IN ${WO}`, p);
    await m.query(`UPDATE work_orders SET depends_on_id = NULL WHERE id IN ${WO}`, p); // drop self-FK before delete
    await m.query(`DELETE FROM work_orders WHERE id IN ${WO}`, p);

    // 7–8: shipping
    await m.query(`DELETE FROM shipment_items WHERE shipment_id IN ${SHIPMENTS}`, p);
    await m.query(`DELETE FROM shipments WHERE id IN ${SHIPMENTS}`, p);

    // 9–11: quality
    await m.query(`DELETE FROM quality_report_events WHERE report_id IN ${QR}`, p);
    await m.query(`DELETE FROM quality_reports WHERE id IN ${QR}`, p);
    await m.query(`DELETE FROM quality_data WHERE project_id = $1 OR assembly_node_id IN ${NODES}`, p);

    // 12–17: project-owned tables
    await m.query(`DELETE FROM piece_lot_assignments WHERE project_id = $1`, p);
    await m.query(`DELETE FROM assembly_documents WHERE project_id = $1`, p);
    await m.query(`DELETE FROM import_file_events WHERE import_file_id IN ${IMPORTS}`, p);
    await m.query(`DELETE FROM assembly_nodes WHERE project_id = $1`, p); // self-tree cascades by parent_id
    await m.query(`DELETE FROM import_files WHERE project_id = $1`, p);
    await m.query(`DELETE FROM production_orders WHERE project_id = $1`, p);

    // 18–19: 3D pipeline artifacts (resolved before nodes/imports were deleted)
    if (convJobIds.length) await m.query(`DELETE FROM conversion_jobs WHERE id = ANY($1::uuid[])`, [convJobIds]);
    if (modelIds.length) await m.query(`DELETE FROM models WHERE id = ANY($1::uuid[])`, [modelIds]);

    // 20: the project itself
    await m.query(`DELETE FROM projects WHERE id = $1`, p);
  }

  /** Best-effort blob removal — one missing/failed key never aborts the purge. */
  private async deleteBlobs(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (e: any) {
        this.logger.warn(`Could not delete blob ${key}: ${e?.message ?? e}`);
      }
    }
  }
}
