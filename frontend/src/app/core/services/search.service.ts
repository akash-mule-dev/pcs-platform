import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { ApiService } from './api.service';

export interface SearchResults {
  workOrders: any[];
  products: any[];
  users: any[];
}

@Injectable({ providedIn: 'root' })
export class SearchService {
  constructor(private api: ApiService) {}

  search(query: string): Observable<SearchResults> {
    if (!query || query.trim().length < 2) {
      return of({ workOrders: [], products: [], users: [] });
    }
    return this.api.get<SearchResults>('/search', { q: query.trim() });
  }
}
