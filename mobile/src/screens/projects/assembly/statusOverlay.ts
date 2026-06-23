// Production / ship-status colour overlay for 3D assembly views — shared by the
// project-wide viewer (ProjectAssemblies) and the per-work-order viewer
// (OrderAssemblies3D). Pure: no RN/Viro imports, unit-testable.
import { MAuditItem } from '../../../services/projects.service';

// One colour per piece, by readiness (NCR > shipped > loaded > ready > prod > not).
export const C_NCR = 0xc62828;     // open NCR — ship blocked
export const C_SHIPPED = 0x64748b; // shipped
export const C_LOADED = 0x1565c0;  // allocated to a load
export const C_READY = 0x2e7d32;   // ready to ship
export const C_PROD = 0xf9a825;    // in production
export const C_NOT = 0x9aa7b0;     // not started

/** The single status colour for an audited piece (highest-priority condition wins). */
export function pieceColor(item: MAuditItem): number {
  if (item.openNcrs > 0 || item.shipStatus === 'blocked_ncr') return C_NCR;
  if (item.shipStatus === 'shipped') return C_SHIPPED;
  if (item.shipStatus === 'allocated') return C_LOADED;
  if (item.shipStatus === 'ready') return C_READY;
  if (item.status === 'in_progress') return C_PROD;
  return C_NOT;
}

export const STATUS_LEGEND: { c: number; label: string }[] = [
  { c: C_NOT, label: 'Not started' },
  { c: C_PROD, label: 'In production' },
  { c: C_READY, label: 'Ready' },
  { c: C_LOADED, label: 'On a load' },
  { c: C_SHIPPED, label: 'Shipped' },
  { c: C_NCR, label: 'NCR' },
];

export const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
