import { api } from './api.service';

/** A 3D model record (the GLB the viewers load). */
export interface MModel {
  id: string;
  name: string;
  modelType: string; // 'assembly' (project/fabrication) | 'quality'
  fileSize: number;
  updatedAt?: string;
}

export const modelsService = {
  /**
   * Every model across all pages. The list endpoint is paginated (limit ≤ 100),
   * so walk pages until a short one. Used to warm the offline model cache.
   */
  async listAll(maxPages = 30): Promise<MModel[]> {
    const out: MModel[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await api.getList<MModel>('/models', { page, limit: 100 });
      if (!batch.length) break;
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  },
};
