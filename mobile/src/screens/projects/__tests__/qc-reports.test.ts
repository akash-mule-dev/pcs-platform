import {
  isNcr,
  isOpenNcr,
  needsAttention,
  reportStatusMeta,
  dispositionLabel,
  severityOf,
  splitNodeReports,
  templateTypeMeta,
  groupTemplatesByType,
  QcReportLike,
} from '../qc-reports';

const NODE = 'node-1';
const mk = (over: Partial<QcReportLike>): QcReportLike => ({
  id: Math.random().toString(36).slice(2),
  number: 'QR-2026-0001',
  assemblyNodeId: NODE,
  ...over,
});

describe('NCR classification', () => {
  it('isNcr / isOpenNcr keyed on templateType + resolvedAt', () => {
    expect(isNcr(mk({ templateType: 'ncr' }))).toBe(true);
    expect(isNcr(mk({ templateType: 'inspection' }))).toBe(false);
    expect(isOpenNcr(mk({ templateType: 'ncr', resolvedAt: null }))).toBe(true);
    expect(isOpenNcr(mk({ templateType: 'ncr', resolvedAt: '2026-06-01' }))).toBe(false);
    expect(isOpenNcr(mk({ templateType: 'inspection', resolvedAt: null }))).toBe(false);
  });

  it('needsAttention = open NCR or any draft', () => {
    expect(needsAttention(mk({ templateType: 'ncr', resolvedAt: null }))).toBe(true);
    expect(needsAttention(mk({ templateType: 'inspection', status: 'draft' }))).toBe(true);
    expect(needsAttention(mk({ templateType: 'inspection', status: 'submitted' }))).toBe(false);
    expect(needsAttention(mk({ templateType: 'ncr', resolvedAt: '2026-06-01', status: 'submitted' }))).toBe(false);
  });
});

describe('reportStatusMeta', () => {
  it('maps NCR lifecycle states', () => {
    expect(reportStatusMeta(mk({ templateType: 'ncr', ncrStatus: 'open' }))).toEqual({ label: 'Open', tone: 'open' });
    expect(reportStatusMeta(mk({ templateType: 'ncr', ncrStatus: 'under_review' }))).toEqual({ label: 'Under review', tone: 'review' });
    expect(reportStatusMeta(mk({ templateType: 'ncr', ncrStatus: 'dispositioned' }))).toEqual({ label: 'Dispositioned', tone: 'disp' });
    expect(reportStatusMeta(mk({ templateType: 'ncr', ncrStatus: 'closed' }))).toEqual({ label: 'Closed', tone: 'closed' });
    expect(reportStatusMeta(mk({ templateType: 'ncr', ncrStatus: 'cancelled' }))).toEqual({ label: 'Cancelled', tone: 'cancelled' });
  });
  it('falls back to resolvedAt when ncrStatus is missing', () => {
    expect(reportStatusMeta(mk({ templateType: 'ncr', resolvedAt: '2026-06-01' })).tone).toBe('closed');
    expect(reportStatusMeta(mk({ templateType: 'ncr', resolvedAt: null })).tone).toBe('open');
  });
  it('maps draft/submitted for non-NCR reports', () => {
    expect(reportStatusMeta(mk({ templateType: 'inspection', status: 'draft' }))).toEqual({ label: 'Draft', tone: 'draft' });
    expect(reportStatusMeta(mk({ templateType: 'inspection', status: 'submitted' }))).toEqual({ label: 'Submitted', tone: 'submitted' });
  });
});

describe('dispositionLabel & severityOf', () => {
  it('humanises dispositions', () => {
    expect(dispositionLabel('use_as_is')).toBe('Use as-is');
    expect(dispositionLabel('return_to_supplier')).toBe('Return to supplier');
    expect(dispositionLabel(null)).toBeNull();
  });
  it('reads + capitalises severity from form data', () => {
    expect(severityOf(mk({ data: { severity: 'high' } }))).toBe('High');
    expect(severityOf(mk({ data: { severity: 'CRITICAL' } }))).toBe('Critical');
    expect(severityOf(mk({ data: {} }))).toBeNull();
    expect(severityOf(mk({ data: null }))).toBeNull();
  });
});

describe('splitNodeReports', () => {
  const reports: QcReportLike[] = [
    mk({ number: 'QR-1', templateType: 'ncr', ncrStatus: 'open', resolvedAt: null, createdAt: '2026-06-01' }),
    mk({ number: 'QR-2', templateType: 'inspection', status: 'submitted', createdAt: '2026-06-03' }),
    mk({ number: 'QR-3', templateType: 'inspection', status: 'draft', createdAt: '2026-06-05' }),
    mk({ number: 'QR-4', templateType: 'ncr', ncrStatus: 'closed', resolvedAt: '2026-06-02', createdAt: '2026-06-02' }),
    mk({ number: 'QR-OTHER', assemblyNodeId: 'other-node', templateType: 'inspection', status: 'submitted', createdAt: '2026-06-09' }),
  ];

  it('filters to the node and splits attention vs history, newest-first', () => {
    const { attention, history } = splitNodeReports(reports, NODE);
    expect(attention.map((r) => r.number)).toEqual(['QR-3', 'QR-1']); // draft + open NCR, newest first
    expect(history.map((r) => r.number)).toEqual(['QR-2', 'QR-4']); // submitted + closed NCR
    expect([...attention, ...history].some((r) => r.number === 'QR-OTHER')).toBe(false); // other node excluded
  });

  it('handles null/empty', () => {
    expect(splitNodeReports(null, NODE)).toEqual({ attention: [], history: [] });
    expect(splitNodeReports([], NODE)).toEqual({ attention: [], history: [] });
  });
});

describe('template grouping', () => {
  it('groups by type with routine-first ordering and known labels', () => {
    const groups = groupTemplatesByType([
      { id: '1', name: 'Field weld NCR', type: 'ncr' },
      { id: '2', name: 'Dimensional check', type: 'inspection' },
      { id: '3', name: 'Fit-up checklist', type: 'checklist' },
      { id: '4', name: 'Visual inspection', type: 'inspection' },
    ]);
    expect(groups.map((g) => g.type)).toEqual(['inspection', 'checklist', 'ncr']);
    expect(groups[0].label).toBe('Inspection');
    expect(groups[0].items).toHaveLength(2);
    expect(groups.find((g) => g.type === 'ncr')!.tone).toBe('ncr');
  });
  it('templateTypeMeta falls back for unknown types', () => {
    expect(templateTypeMeta('inspection').tone).toBe('inspection');
    expect(templateTypeMeta('weird').label).toBe('Weird');
    expect(templateTypeMeta(null).tone).toBe('neutral');
  });
});
