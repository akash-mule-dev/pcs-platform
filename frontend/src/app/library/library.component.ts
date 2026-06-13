import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { LibraryApiService, LibraryProcess, LibrarySummary, LibraryTemplate } from './library.service';
import { OrganizationsApiService } from '../organizations/organizations.service';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Shared Library</h1>
          <p class="page-subtitle">
            Default processes &amp; templates owned by the platform. Publish them into tenant companies —
            re-publishing updates the tenant's copy in place. New companies are seeded automatically.
          </p>
        </div>
      </div>

      <div class="panel target">
        <mat-form-field appearance="outline">
          <mat-label>Publish target</mat-label>
          <mat-select [(ngModel)]="target">
            <mat-option value="__all__">All tenant companies</mat-option>
            @for (o of orgs; track o.id) { <mat-option [value]="o.id">{{ o.name }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <span class="hint">Choose where “Publish” sends an item. Idempotent — safe to re-run.</span>
      </div>

      <div class="grid2">
        <div class="panel">
          <h3>Processes <span class="count">{{ processes.length }}</span></h3>
          @for (p of processes; track p.id) {
            <div class="item">
              <div class="item-main">
                <div class="item-name">{{ p.name }} <span class="ver">v{{ p.version }}</span></div>
                <div class="item-sub">{{ stageNames(p) }}</div>
              </div>
              <button mat-stroked-button [disabled]="!target || busy" (click)="publishProcess(p)">
                <mat-icon>publish</mat-icon> Publish
              </button>
            </div>
          }
          @if (!processes.length && loaded) { <p class="empty">No library processes yet.</p> }
        </div>

        <div class="panel">
          <h3>Templates <span class="count">{{ templates.length }}</span></h3>
          @for (t of templates; track t.id) {
            <div class="item">
              <div class="item-main">
                <div class="item-name">{{ t.name }}</div>
                <div class="item-sub"><span class="chip">{{ t.type }}</span> v{{ t.version }}</div>
              </div>
              <button mat-stroked-button [disabled]="!target || busy" (click)="publishTemplate(t)">
                <mat-icon>publish</mat-icon> Publish
              </button>
            </div>
          }
          @if (!templates.length && loaded) { <p class="empty">No library templates yet.</p> }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; }
    .page-header { margin-bottom: 16px; }
    .page-title { margin: 0; font-size: 22px; }
    .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; max-width: 760px; }
    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .target { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .target mat-form-field { width: 320px; max-width: 100%; }
    .hint { color: var(--clay-text-muted, #64748b); font-size: 12px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
    @media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
    h3 { margin: 0 0 12px; font-size: 15px; }
    .count { display: inline-block; min-width: 20px; text-align: center; font-size: 12px; color: var(--clay-text-muted, #64748b); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 999px; padding: 0 6px; margin-left: 6px; }
    .item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--clay-border, #f1f5f9); }
    .item:last-child { border-bottom: 0; }
    .item-name { font-weight: 600; font-size: 14px; }
    .ver { font-weight: 400; font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .item-sub { font-size: 12px; color: var(--clay-text-muted, #64748b); margin-top: 2px; }
    .chip { background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 1px 8px; font-size: 11px; margin-right: 6px; }
    .empty { color: var(--clay-text-muted, #64748b); padding: 8px 0; }
  `],
})
export class LibraryComponent implements OnInit {
  summary: LibrarySummary | null = null;
  processes: LibraryProcess[] = [];
  templates: LibraryTemplate[] = [];
  orgs: Array<{ id: string; name: string }> = [];
  target = '__all__';
  loaded = false;
  busy = false;

  constructor(
    private api: LibraryApiService,
    private orgsApi: OrganizationsApiService,
    private snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    forkJoin({
      summary: this.api.summary(),
      processes: this.api.processes(),
      templates: this.api.templates(),
    }).subscribe({
      next: (r) => {
        this.summary = r.summary;
        this.processes = r.processes ?? [];
        this.templates = r.templates ?? [];
        this.loaded = true;
      },
      error: () => (this.loaded = true),
    });
    this.orgsApi.list().subscribe({
      next: (d) => (this.orgs = (Array.isArray(d) ? d : d?.data) ?? []),
      error: () => {},
    });
  }

  stageNames(p: LibraryProcess): string {
    return [...(p.stages ?? [])].sort((a, b) => a.sequence - b.sequence).map((s) => s.name).join(' → ');
  }

  private body() {
    return this.target === '__all__' ? { allTenants: true } : { organizationId: this.target };
  }

  private targetLabel(): string {
    return this.target === '__all__' ? 'all tenants' : (this.orgs.find((o) => o.id === this.target)?.name ?? 'the tenant');
  }

  publishProcess(p: LibraryProcess): void {
    this.busy = true;
    this.api.publishProcess(p.id, this.body()).subscribe({
      next: () => { this.busy = false; this.snack.open(`Published "${p.name}" to ${this.targetLabel()}`, 'OK', { duration: 3000 }); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Publish failed', 'Dismiss', { duration: 5000 }); },
    });
  }

  publishTemplate(t: LibraryTemplate): void {
    this.busy = true;
    this.api.publishTemplate(t.id, this.body()).subscribe({
      next: () => { this.busy = false; this.snack.open(`Published "${t.name}" to ${this.targetLabel()}`, 'OK', { duration: 3000 }); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Publish failed', 'Dismiss', { duration: 5000 }); },
    });
  }
}
