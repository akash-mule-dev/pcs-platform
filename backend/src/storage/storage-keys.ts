/**
 * Central blob key layout — the SINGLE source of truth for WHERE every object
 * lives in the object store. Import this everywhere a storage key is minted; do
 * not hand-write key strings at call sites.
 *
 * Every blob is TENANT-PARTITIONED: the organization id is the top-level folder,
 * so each client's data is isolated, listable, quota-able and migratable on its
 * own — and a future "one bucket/store per client" split is a prefix swap.
 *
 *   <orgId>/
 *     imports/<importId>.<ext>                uploaded packages (IFC / ZIP / CAD)
 *     documents/<id>.<ext>                    shop drawings & package documents
 *     models/<id>.glb                         converted GLB models
 *     models/<id>/thumbnail.png               model thumbnails
 *     conversions/<id>.<ext>                  conversion input sources
 *     quality/evidence/<entryId>/<id>.<ext>   inspection evidence photos
 *     quality/ncr/<ncrId>/<id>.<ext>          NCR evidence photos
 *     support/<ticketId>/<id>.<ext>           support-ticket attachments (img/pdf)
 *     coordination/drawings/<id>.pdf          coordination drawings
 *     media/<kind>/<id>.<ext>                 FUTURE: screenshots, videos, captures …
 *
 * Legacy blobs written before this layout keep their old flat keys; the DB row
 * stores the exact key, so reads/deletes still resolve — ONLY new writes adopt
 * this structure. When an org id is unavailable the blob lands under `_shared/`.
 */

/** Normalize a file extension to leading-dot, lowercase form ('' when none). */
function dot(ext?: string | null): string {
  if (!ext) return '';
  const e = ext.trim().toLowerCase();
  if (!e) return '';
  return e.startsWith('.') ? e : `.${e}`;
}

/** Tenant segment — every blob is partitioned by organization. */
function org(organizationId?: string | null): string {
  const o = (organizationId || '').trim();
  return o || '_shared';
}

export const StorageKeys = {
  importSource: (organizationId: string | null | undefined, importId: string, ext?: string): string =>
    `${org(organizationId)}/imports/${importId}${dot(ext)}`,

  document: (organizationId: string | null | undefined, id: string, ext?: string): string =>
    `${org(organizationId)}/documents/${id}${dot(ext)}`,

  conversionSource: (organizationId: string | null | undefined, id: string, ext?: string): string =>
    `${org(organizationId)}/conversions/${id}${dot(ext)}`,

  model: (organizationId: string | null | undefined, id: string): string =>
    `${org(organizationId)}/models/${id}.glb`,

  modelThumbnail: (organizationId: string | null | undefined, modelId: string): string =>
    `${org(organizationId)}/models/${modelId}/thumbnail.png`,

  qualityEvidence: (organizationId: string | null | undefined, entryId: string, id: string, ext?: string): string =>
    `${org(organizationId)}/quality/evidence/${entryId}/${id}${dot(ext)}`,

  supportAttachment: (organizationId: string | null | undefined, ticketId: string, id: string, ext?: string): string =>
    `${org(organizationId)}/support/${ticketId}/${id}${dot(ext)}`,

  ncrEvidence: (organizationId: string | null | undefined, ncrId: string, id: string, ext?: string): string =>
    `${org(organizationId)}/quality/ncr/${ncrId}/${id}${dot(ext)}`,

  coordinationDrawing: (organizationId: string | null | undefined, id: string): string =>
    `${org(organizationId)}/coordination/drawings/${id}.pdf`,

  /** FUTURE: screenshots, videos, captures and other per-org media. */
  media: (organizationId: string | null | undefined, kind: string, id: string, ext?: string): string =>
    `${org(organizationId)}/media/${kind}/${id}${dot(ext)}`,
};

/** The org segment of a key, or null for a legacy/flat key (or `_shared`). */
export function orgOfKey(key: string): string | null {
  const i = key.indexOf('/');
  if (i <= 0) return null;
  const seg = key.slice(0, i);
  return seg === '_shared' ? null : seg;
}
