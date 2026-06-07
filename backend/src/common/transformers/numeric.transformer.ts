/**
 * Postgres `numeric` columns come back as strings via node-postgres. This
 * transformer keeps entity fields typed as `number` while preserving precision.
 */
export const numericTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value?: string | null): number | null => {
    if (value === null || value === undefined) return null;
    const n = parseFloat(value as string);
    return Number.isNaN(n) ? null : n;
  },
};
