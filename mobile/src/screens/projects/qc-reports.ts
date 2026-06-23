/**
 * Pure helpers for the per-assembly QC Reports sheet.
 *
 * A "QC report" and an "NCR" are the SAME backend record (a QualityReport); an
 * NCR is one whose templateType === 'ncr' and which carries the extra lifecycle
 * fields (ncrStatus / disposition / resolvedAt). This module classifies a node's
 * reports into "needs attention" vs "history", derives display status/severity,
 * and groups blank templates by purpose for the create flow.
 *
 * No React / Nest / network imports — unit-testable in isolation.
 */

export type Tone =
  | 'open' | 'review' | 'disp' | 'closed' | 'cancelled' | 'draft' | 'submitted' | 'neutral';

export interface QcReportLike {
  id: string;
  number: string;
  status?: string | null; // draft | submitted
  templateType?: string | null; // ncr | inspection | checklist | capa | other
  templateName?: string | null;
  ncrStatus?: string | null; // open | under_review | dispositioned | closed | cancelled
  disposition?: string | null;
  assemblyNodeId?: string | null;
  filledByName?: string | null;
  createdAt?: string | null;
  submittedAt?: string | null;
  resolvedAt?: string | null;
  data?: Record<string, unknown> | null;
}

export interface TemplateLike {
  id: string;
  name: string;
  type?: string | null;
}

export function isNcr(r: QcReportLike): boolean {
  return (r.templateType ?? '').toLowerCase() === 'ncr';
}

/** An NCR is "open" (blocks shipping/quality gates) while it has not been resolved. */
export function isOpenNcr(r: QcReportLike): boolean {
  return isNcr(r) && !r.resolvedAt;
}

/** A report that needs someone's attention: an open NCR, or any un-submitted draft. */
export function needsAttention(r: QcReportLike): boolean {
  return isOpenNcr(r) || (r.status ?? '') === 'draft';
}

export interface StatusMeta {
  label: string;
  tone: Tone;
}

/** Display status — NCR lifecycle for NCRs, draft/submitted otherwise. */
export function reportStatusMeta(r: QcReportLike): StatusMeta {
  if (isNcr(r)) {
    switch ((r.ncrStatus ?? '').toLowerCase()) {
      case 'open': return { label: 'Open', tone: 'open' };
      case 'under_review': return { label: 'Under review', tone: 'review' };
      case 'dispositioned': return { label: 'Dispositioned', tone: 'disp' };
      case 'closed': return { label: 'Closed', tone: 'closed' };
      case 'cancelled': return { label: 'Cancelled', tone: 'cancelled' };
      default: return r.resolvedAt ? { label: 'Closed', tone: 'closed' } : { label: 'Open', tone: 'open' };
    }
  }
  return (r.status ?? '') === 'submitted'
    ? { label: 'Submitted', tone: 'submitted' }
    : { label: 'Draft', tone: 'draft' };
}

const DISPOSITION_LABELS: Record<string, string> = {
  rework: 'Rework',
  repair: 'Repair',
  use_as_is: 'Use as-is',
  scrap: 'Scrap',
  return_to_supplier: 'Return to supplier',
};
export function dispositionLabel(d: string | null | undefined): string | null {
  if (!d) return null;
  return DISPOSITION_LABELS[d] ?? d;
}

/** Severity lives in the filled form data for NCRs (e.g. low/medium/high/critical). */
export function severityOf(r: QcReportLike): string | null {
  const raw = r.data && typeof r.data === 'object' ? (r.data as any)['severity'] : null;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function byCreatedDesc(a: QcReportLike, b: QcReportLike): number {
  return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
}

export interface NodeReportSplit {
  attention: QcReportLike[];
  history: QcReportLike[];
}

/**
 * Reports for ONE assembly node, split into the ones needing action (open NCRs +
 * drafts) and the historical trail (submitted reports + closed/cancelled NCRs),
 * each newest-first.
 */
export function splitNodeReports(reports: QcReportLike[] | null | undefined, nodeId: string): NodeReportSplit {
  const forNode = (reports ?? []).filter((r) => r.assemblyNodeId === nodeId);
  const attention = forNode.filter(needsAttention).sort(byCreatedDesc);
  const history = forNode.filter((r) => !needsAttention(r)).sort(byCreatedDesc);
  return { attention, history };
}

export interface TemplateTypeMeta {
  label: string;
  icon: string;
  tone: 'ncr' | 'inspection' | 'neutral';
}
const TEMPLATE_TYPE_META: Record<string, TemplateTypeMeta> = {
  inspection: { label: 'Inspection', icon: 'checkmark-done-circle-outline', tone: 'inspection' },
  checklist: { label: 'Checklist', icon: 'list-circle-outline', tone: 'neutral' },
  ncr: { label: 'Non-conformance (NCR)', icon: 'alert-circle-outline', tone: 'ncr' },
  capa: { label: 'Corrective action (CAPA)', icon: 'build-outline', tone: 'neutral' },
  other: { label: 'Other', icon: 'document-text-outline', tone: 'neutral' },
};
export function templateTypeMeta(type: string | null | undefined): TemplateTypeMeta {
  const key = (type ?? 'other').toLowerCase();
  return TEMPLATE_TYPE_META[key] ?? {
    label: key.charAt(0).toUpperCase() + key.slice(1),
    icon: 'document-text-outline',
    tone: 'neutral',
  };
}

export interface TemplateGroup extends TemplateTypeMeta {
  type: string;
  items: TemplateLike[];
}

// Routine work first, exceptions (NCR/CAPA) after.
const TYPE_ORDER = ['inspection', 'checklist', 'ncr', 'capa', 'other'];

/** Group blank templates by purpose for the "start a new report" picker. */
export function groupTemplatesByType(templates: TemplateLike[] | null | undefined): TemplateGroup[] {
  const groups = new Map<string, TemplateGroup>();
  for (const t of templates ?? []) {
    const type = (t.type ?? 'other').toLowerCase();
    if (!groups.has(type)) groups.set(type, { type, ...templateTypeMeta(type), items: [] });
    groups.get(type)!.items.push(t);
  }
  return Array.from(groups.values()).sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a.type), ib = TYPE_ORDER.indexOf(b.type);
    const ra = ia === -1 ? TYPE_ORDER.length : ia;
    const rb = ib === -1 ? TYPE_ORDER.length : ib;
    return ra !== rb ? ra - rb : a.label.localeCompare(b.label);
  });
}
