import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Organization } from '../organization/organization.entity.js';
import { Process } from '../processes/process.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { FormTemplate, TemplateType } from '../templates/entities/form-template.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import {
  DEFAULT_LIBRARY_PROCESSES,
  DEFAULT_LIBRARY_TEMPLATES,
  processCopyFields,
  reconcileStagesBySequence,
  stageCopyFields,
  StageRow,
  templateCopyFields,
} from './library-content.js';

export const PLATFORM_ORG_SLUG = 'platform';
export const PLATFORM_ORG_NAME = 'PCS Platform Library';

export interface PublishResult {
  organizationId: string;
  created: boolean;
  id: string;
}

/**
 * The shared library ("super company"): a single platform organization owns
 * master processes & form templates that are PUBLISHED (copied) into tenants.
 *
 * Platform admins are org-less, so every write here sets the target
 * organization id explicitly rather than relying on TenantContext.
 */
@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    @InjectRepository(Organization) private readonly orgRepo: Repository<Organization>,
    @InjectRepository(Process) private readonly processRepo: Repository<Process>,
    @InjectRepository(Stage) private readonly stageRepo: Repository<Stage>,
    @InjectRepository(FormTemplate) private readonly templateRepo: Repository<FormTemplate>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  // ── platform org + default seeding (idempotent, boot-time) ─────────────────

  async getPlatformOrg(): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { kind: 'platform' } as any });
    if (!org) throw new NotFoundException('Platform library organization not provisioned');
    return org;
  }

  /** Create the platform org if missing, then seed default library content. Idempotent. */
  async ensurePlatformOrgAndDefaults(): Promise<void> {
    let org = await this.orgRepo.findOne({ where: { kind: 'platform' } as any });
    if (!org) {
      // Reuse a pre-existing `platform`-slug row if one exists, else create.
      org = await this.orgRepo.findOne({ where: { slug: PLATFORM_ORG_SLUG } as any });
      if (org) {
        org.kind = 'platform';
        await this.orgRepo.save(org);
      } else {
        org = await this.orgRepo.save(
          this.orgRepo.create({
            name: PLATFORM_ORG_NAME,
            slug: PLATFORM_ORG_SLUG,
            kind: 'platform',
            description: 'Shared library of default processes & templates published to tenants',
            isActive: true,
          } as any) as unknown as Organization,
        );
      }
      this.logger.log('Provisioned platform library organization');
    }
    const platformOrg = org!;

    for (const seed of DEFAULT_LIBRARY_PROCESSES) {
      const exists = await this.processRepo.findOne({ where: { name: seed.name, organizationId: platformOrg.id } });
      if (exists) continue;
      const proc = await this.processRepo.save(
        this.processRepo.create({ name: seed.name, version: seed.version ?? 1, organizationId: platformOrg.id, libraryOriginId: null } as any),
      ) as unknown as Process;
      const stageRows = seed.stages.map((s, i) => ({
        name: s.name, sequence: i + 1, targetTimeSeconds: s.targetTimeSeconds,
        description: s.description ?? null, requiresInspection: !!s.requiresInspection,
        processId: proc.id, organizationId: platformOrg.id,
      }));
      await this.stageRepo.save(this.stageRepo.create(stageRows as any));
      this.logger.log(`Seeded library process "${seed.name}"`);
    }

    for (const seed of DEFAULT_LIBRARY_TEMPLATES) {
      const exists = await this.templateRepo.findOne({ where: { name: seed.name, organizationId: platformOrg.id } as any });
      if (exists) continue;
      await this.templateRepo.save(
        this.templateRepo.create({
          name: seed.name, type: seed.type as TemplateType, schema: seed.schema, version: 1,
          organizationId: platformOrg.id, libraryOriginId: null,
        } as any),
      );
      this.logger.log(`Seeded library template "${seed.name}"`);
    }
  }

  // ── reads ───────────────────────────────────────────────────────────────────

  async listProcesses(): Promise<Process[]> {
    const org = await this.getPlatformOrg();
    return this.processRepo.find({ where: { organizationId: org.id }, relations: ['stages'], order: { name: 'ASC' } });
  }

  async listTemplates(): Promise<FormTemplate[]> {
    const org = await this.getPlatformOrg();
    return this.templateRepo.find({ where: { organizationId: org.id } as any, order: { name: 'ASC' } });
  }

  /** What the library holds, for the admin page header. */
  async summary() {
    const org = await this.getPlatformOrg();
    const [processes, templates] = await Promise.all([
      this.processRepo.count({ where: { organizationId: org.id } }),
      this.templateRepo.count({ where: { organizationId: org.id } as any }),
    ]);
    return { organization: { id: org.id, name: org.name, slug: org.slug }, processes, templates };
  }

  // ── publishing (copy into tenants, idempotent by libraryOriginId) ───────────

  private async assertTenant(targetOrgId: string): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { id: targetOrgId } });
    if (!org) throw new NotFoundException('Target organization not found');
    if (org.kind === 'platform') throw new BadRequestException('Cannot publish into the platform library itself');
    return org;
  }

  async publishProcessToOrg(libProcessId: string, targetOrgId: string): Promise<PublishResult> {
    const platform = await this.getPlatformOrg();
    const lib = await this.processRepo.findOne({
      where: { id: libProcessId, organizationId: platform.id },
      relations: ['stages'],
    });
    if (!lib) throw new NotFoundException('Library process not found');
    await this.assertTenant(targetOrgId);

    const libStages: StageRow[] = [...(lib.stages ?? [])].sort((a, b) => a.sequence - b.sequence);

    const result = await this.dataSource.transaction(async (em) => {
      const procRepo = em.getRepository(Process);
      const stgRepo = em.getRepository(Stage);
      let target = await procRepo.findOne({ where: { organizationId: targetOrgId, libraryOriginId: lib.id }, relations: ['stages'] });
      let created = false;
      if (!target) {
        created = true;
        target = await procRepo.save(procRepo.create(processCopyFields(lib as any, targetOrgId) as any) as unknown as Process);
        const rows = libStages.map((s) => stageCopyFields(s, target!.id, targetOrgId));
        await stgRepo.save(stgRepo.create(rows as any));
      } else {
        target.name = lib.name;
        target.version = lib.version;
        await procRepo.save(target);
        const bySeq = new Map<number, { id: string }>((target.stages ?? []).map((s) => [s.sequence, { id: s.id }]));
        const { toInsert, toUpdate } = reconcileStagesBySequence(libStages, bySeq);
        if (toInsert.length) {
          const rows = toInsert.map((s) => stageCopyFields(s, target!.id, targetOrgId));
          await stgRepo.save(stgRepo.create(rows as any));
        }
        for (const u of toUpdate) {
          await stgRepo.update({ id: u.id }, {
            name: u.fields.name, targetTimeSeconds: u.fields.targetTimeSeconds,
            description: u.fields.description ?? null, requiresInspection: !!u.fields.requiresInspection,
          } as any);
        }
      }
      return { id: target.id, created };
    });

    await this.audit.log({
      userId: TenantContext.get()?.userId ?? null,
      action: result.created ? 'publish' : 'republish',
      entityType: 'library-process',
      entityId: lib.id,
      newValues: { targetOrgId, processId: result.id, name: lib.name },
    });
    return { organizationId: targetOrgId, created: result.created, id: result.id };
  }

  async publishTemplateToOrg(libTemplateId: string, targetOrgId: string): Promise<PublishResult> {
    const platform = await this.getPlatformOrg();
    const lib = await this.templateRepo.findOne({ where: { id: libTemplateId, organizationId: platform.id } as any });
    if (!lib) throw new NotFoundException('Library template not found');
    await this.assertTenant(targetOrgId);

    let target = await this.templateRepo.findOne({ where: { organizationId: targetOrgId, libraryOriginId: lib.id } as any });
    let created = false;
    if (!target) {
      created = true;
      target = await this.templateRepo.save(this.templateRepo.create(templateCopyFields(lib as any, targetOrgId) as any)) as unknown as FormTemplate;
    } else {
      Object.assign(target, templateCopyFields(lib as any, targetOrgId));
      await this.templateRepo.save(target);
    }

    await this.audit.log({
      userId: TenantContext.get()?.userId ?? null,
      action: created ? 'publish' : 'republish',
      entityType: 'library-template',
      entityId: lib.id,
      newValues: { targetOrgId, templateId: target.id, name: lib.name },
    });
    return { organizationId: targetOrgId, created, id: target.id };
  }

  private async activeTenants(): Promise<Organization[]> {
    const orgs = await this.orgRepo.find({ where: { isActive: true } as any });
    return orgs.filter((o) => o.kind !== 'platform');
  }

  async publishProcessToAllTenants(libProcessId: string): Promise<PublishResult[]> {
    const tenants = await this.activeTenants();
    const out: PublishResult[] = [];
    for (const t of tenants) out.push(await this.publishProcessToOrg(libProcessId, t.id));
    return out;
  }

  async publishTemplateToAllTenants(libTemplateId: string): Promise<PublishResult[]> {
    const tenants = await this.activeTenants();
    const out: PublishResult[] = [];
    for (const t of tenants) out.push(await this.publishTemplateToOrg(libTemplateId, t.id));
    return out;
  }

  /**
   * Copy every library item into a single (usually freshly provisioned) tenant.
   * Idempotent — safe to call again. Best-effort: never throws into the caller's
   * provisioning transaction (a seeding hiccup must not fail org creation).
   */
  async seedTenant(targetOrgId: string): Promise<{ processes: number; templates: number }> {
    try {
      const platform = await this.orgRepo.findOne({ where: { kind: 'platform' } as any });
      if (!platform || targetOrgId === platform.id) return { processes: 0, templates: 0 };
      const [procs, tmpls] = await Promise.all([
        this.processRepo.find({ where: { organizationId: platform.id } }),
        this.templateRepo.find({ where: { organizationId: platform.id } as any }),
      ]);
      let p = 0;
      let t = 0;
      for (const proc of procs) { await this.publishProcessToOrg(proc.id, targetOrgId); p++; }
      for (const tmpl of tmpls) { await this.publishTemplateToOrg(tmpl.id, targetOrgId); t++; }
      this.logger.log(`Seeded library into org ${targetOrgId}: ${p} processes, ${t} templates`);
      return { processes: p, templates: t };
    } catch (e) {
      this.logger.error(`Library seed for org ${targetOrgId} failed: ${(e as Error).message}`);
      return { processes: 0, templates: 0 };
    }
  }
}
