import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import {
  PermissionCatalog,
  PermissionFeatureDef,
  RolesApiService,
  RoleView,
} from '../core/services/roles.service';
import { PermissionsService } from '../core/services/permissions.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';

type EditorMode = 'view' | 'edit' | 'create';

@Component({
  selector: 'app-rbac',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatCheckboxModule, MatTooltipModule, MatDialogModule,
  ],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Roles &amp; Permissions</h1>
          <p class="page-subtitle">Built-in system roles plus your organization's custom roles with fine-grained permissions</p>
        </div>
        @if (perms.can('roles.create')) {
          <button mat-raised-button color="primary" (click)="newRole()"><mat-icon>add</mat-icon> New role</button>
        }
      </div>

      <div class="grid">
        <!-- ── Role list ─────────────────────────────────────────────── -->
        <div class="panel role-list">
          @for (r of roles; track r.id) {
            <div class="role-card" [class.active]="selected?.id === r.id && mode !== 'create'" (click)="selectRole(r)">
              <div class="role-card-head">
                <span class="role-name">{{ r.name }}</span>
                <span class="chip" [class.chip-system]="r.isSystem" [class.chip-custom]="!r.isSystem">
                  {{ r.isSystem ? 'System' : 'Custom' }}
                </span>
              </div>
              @if (r.description) { <p class="role-desc">{{ r.description }}</p> }
              <div class="role-meta">
                <span><mat-icon inline>group</mat-icon> {{ r.userCount }} user{{ r.userCount === 1 ? '' : 's' }}</span>
                <span><mat-icon inline>key</mat-icon> {{ permissionSummary(r) }}</span>
              </div>
            </div>
          }
          @if (!roles.length && loaded) { <p class="empty">No roles visible.</p> }
        </div>

        <!-- ── Editor ────────────────────────────────────────────────── -->
        <div class="panel editor">
          @if (mode === 'create' || selected) {
            <div class="editor-head">
              <div class="editor-title">
                @if (mode === 'create') {
                  <h3>New custom role</h3>
                } @else {
                  <h3>{{ selected!.name }}</h3>
                  <span class="chip" [class.chip-system]="selected!.isSystem" [class.chip-custom]="!selected!.isSystem">
                    {{ selected!.isSystem ? 'System role' : 'Custom role' }}
                  </span>
                }
              </div>
              <div class="editor-actions">
                @if (mode !== 'create' && perms.can('roles.create')) {
                  <button mat-stroked-button (click)="duplicateSelected()" matTooltip="Copy into an editable custom role">
                    <mat-icon>content_copy</mat-icon> Duplicate
                  </button>
                }
                @if (mode === 'edit' && !selected!.isSystem && perms.can('roles.delete')) {
                  <button mat-stroked-button color="warn" (click)="deleteSelected()" [disabled]="busy">
                    <mat-icon>delete</mat-icon> Delete
                  </button>
                }
                @if (mode === 'create' || (mode === 'edit' && !selected!.isSystem && perms.can('roles.update'))) {
                  <button mat-raised-button color="primary" (click)="save()" [disabled]="busy || !draft.name || !draftCount">
                    {{ mode === 'create' ? 'Create role' : 'Save changes' }}
                  </button>
                }
              </div>
            </div>

            @if (isReadonly) {
              <div class="banner">
                <mat-icon>lock</mat-icon>
                System roles are managed by the platform and can't be edited — duplicate one to customize it for your organization.
              </div>
            }

            @if (!isReadonly) {
              <div class="form-row">
                <mat-form-field appearance="outline" class="grow">
                  <mat-label>Role name</mat-label>
                  <input matInput [(ngModel)]="draft.name" maxlength="49" placeholder="e.g. QC Inspector">
                </mat-form-field>
                <mat-form-field appearance="outline" class="grow2">
                  <mat-label>Description</mat-label>
                  <input matInput [(ngModel)]="draft.description" maxlength="500" placeholder="What is this role for?">
                </mat-form-field>
              </div>
            }

            <div class="matrix-toolbar">
              <mat-form-field appearance="outline" class="search">
                <mat-label>Filter permissions</mat-label>
                <input matInput [(ngModel)]="search" placeholder="e.g. work orders, delete…">
                <mat-icon matSuffix>search</mat-icon>
              </mat-form-field>
              <span class="count">{{ draftCount }} permission{{ draftCount === 1 ? '' : 's' }} selected</span>
            </div>

            <!-- Permission matrix -->
            @for (cat of catalogCategories; track cat) {
              @if (featuresFor(cat).length) {
                <div class="category">
                  <h4>{{ cat }}</h4>
                  @for (f of featuresFor(cat); track f.key) {
                    <div class="feature-row">
                      <div class="feature-label">
                        <mat-checkbox
                          [checked]="allChecked(f)"
                          [indeterminate]="someChecked(f)"
                          [disabled]="isReadonly"
                          (change)="toggleFeature(f, $event.checked)">
                          <strong>{{ f.label }}</strong>
                        </mat-checkbox>
                      </div>
                      <div class="actions">
                        @for (a of f.actions; track a.action) {
                          <mat-checkbox
                            [checked]="has(f.key + '.' + a.action)"
                            [disabled]="isReadonly"
                            (change)="toggle(f.key + '.' + a.action, $event.checked)"
                            [matTooltip]="a.description">
                            {{ a.label }}
                          </mat-checkbox>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            }
          } @else {
            <div class="placeholder">
              <mat-icon>shield_person</mat-icon>
              <p>Select a role to inspect its permissions{{ perms.can('roles.create') ? ', or create a custom role.' : '.' }}</p>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
    .page-title { margin: 0; font-size: 22px; }
    .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .grid { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
    @media (max-width: 960px) { .grid { grid-template-columns: 1fr; } }
    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 12px; }

    .role-list { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 180px); overflow: auto; }
    .role-card { border: 1px solid var(--clay-border, #e2e8f0); border-radius: 8px; padding: 10px 12px; cursor: pointer; transition: border-color .15s, background .15s; }
    .role-card:hover { border-color: var(--clay-primary, #2563eb); }
    .role-card.active { border-color: var(--clay-primary, #2563eb); background: var(--clay-primary-soft, #eff6ff); }
    .role-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .role-name { font-weight: 600; font-size: 14px; }
    .role-desc { margin: 4px 0 0; font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .role-meta { display: flex; gap: 14px; margin-top: 6px; font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .role-meta mat-icon { font-size: 14px; vertical-align: -2px; }
    .chip { font-size: 11px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
    .chip-system { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    .chip-custom { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }

    .editor { min-height: 360px; }
    .editor-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .editor-title { display: flex; align-items: center; gap: 10px; }
    .editor-title h3 { margin: 0; font-size: 17px; }
    .editor-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .banner { display: flex; align-items: center; gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-bottom: 12px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .grow { flex: 1 1 220px; } .grow2 { flex: 2 1 320px; }
    .matrix-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .search { width: 280px; max-width: 100%; }
    .count { font-size: 13px; color: var(--clay-text-muted, #64748b); }

    .category { margin-bottom: 14px; }
    .category h4 { margin: 8px 0; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--clay-text-muted, #64748b); border-bottom: 1px solid var(--clay-border, #e2e8f0); padding-bottom: 4px; }
    .feature-row { display: grid; grid-template-columns: 220px 1fr; gap: 8px; padding: 4px 0; align-items: start; }
    @media (max-width: 720px) { .feature-row { grid-template-columns: 1fr; } }
    .actions { display: flex; flex-wrap: wrap; gap: 2px 18px; }
    .placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 280px; color: var(--clay-text-muted, #64748b); gap: 8px; }
    .placeholder mat-icon { font-size: 40px; width: 40px; height: 40px; }
    .empty { color: var(--clay-text-muted, #64748b); padding: 8px; }
  `],
})
export class RbacComponent implements OnInit {
  roles: RoleView[] = [];
  catalog: PermissionCatalog | null = null;
  loaded = false;
  busy = false;

  selected: RoleView | null = null;
  mode: EditorMode = 'view';
  draft: { name: string; description: string; permissions: Set<string> } = this.emptyDraft();
  search = '';

  constructor(
    private api: RolesApiService,
    public perms: PermissionsService,
    private snack: MatSnackBar,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.api.catalog().subscribe({ next: (c) => (this.catalog = c), error: () => {} });
    this.refresh();
  }

  private emptyDraft() {
    return { name: '', description: '', permissions: new Set<string>() };
  }

  refresh(keepSelection = false): void {
    const keptId = keepSelection ? this.selected?.id : null;
    this.api.list().subscribe({
      next: (list) => {
        this.roles = list ?? [];
        this.loaded = true;
        if (keptId) {
          const again = this.roles.find((r) => r.id === keptId);
          if (again) this.selectRole(again);
        }
      },
      error: () => (this.loaded = true),
    });
  }

  // ── selection / editing ─────────────────────────────────────────────

  get isReadonly(): boolean {
    return this.mode !== 'create' && (!this.selected || this.selected.isSystem || !this.perms.can('roles.update'));
  }

  get catalogCategories(): string[] {
    return this.catalog?.categories ?? [];
  }

  get draftCount(): number {
    return this.draft.permissions.size;
  }

  selectRole(r: RoleView): void {
    this.selected = r;
    this.mode = 'edit';
    this.draft = {
      name: r.name,
      description: r.description ?? '',
      permissions: new Set(this.expand(r.permissions)),
    };
  }

  newRole(): void {
    this.selected = null;
    this.mode = 'create';
    this.draft = this.emptyDraft();
  }

  duplicateSelected(): void {
    if (!this.selected) return;
    const source = this.selected;
    this.mode = 'create';
    this.draft = {
      name: this.uniqueCopyName(source.name),
      description: source.description ?? '',
      permissions: new Set(this.expand(source.permissions)),
    };
    this.selected = null;
    this.snack.open(`Duplicating "${source.name}" — adjust and create`, 'OK', { duration: 2500 });
  }

  private uniqueCopyName(base: string): string {
    const names = new Set(this.roles.map((r) => r.name.toLowerCase()));
    let candidate = `${base} copy`;
    let i = 2;
    while (names.has(candidate.toLowerCase())) candidate = `${base} copy ${i++}`;
    return candidate.slice(0, 49);
  }

  /**
   * Expand `*` / `feature.*` into concrete catalog keys for matrix display.
   * Mirrors the backend: the tenant `*` wildcard NEVER covers platform-scoped
   * features (organizations) — only an explicit grant does.
   */
  private expand(perms: string[]): string[] {
    if (!this.catalog) return perms;
    const out = new Set<string>();
    const tenant = this.catalog.features
      .filter((f) => !f.platform)
      .flatMap((f) => f.actions.map((a) => `${f.key}.${a.action}`));
    for (const p of perms) {
      if (p === this.catalog.wildcard) {
        tenant.forEach((k) => out.add(k));
        continue;
      }
      if (p.endsWith('.*')) {
        const key = p.slice(0, -2);
        const feature = this.catalog.features.find((f) => f.key === key);
        feature?.actions.forEach((a) => out.add(`${key}.${a.action}`));
      } else {
        out.add(p);
      }
    }
    return [...out];
  }

  permissionSummary(r: RoleView): string {
    if (r.permissions.includes('*')) return 'Full access';
    return `${this.expand(r.permissions).length} permissions`;
  }

  featuresFor(category: string): PermissionFeatureDef[] {
    // Platform-scoped features (org provisioning) can never be granted to
    // custom roles — keep them out of the matrix entirely.
    const features = (this.catalog?.features ?? []).filter((f) => f.category === category && !f.platform);
    const q = this.search.trim().toLowerCase();
    if (!q) return features;
    return features.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.key.includes(q) ||
        f.actions.some((a) => a.label.toLowerCase().includes(q) || a.action.includes(q)),
    );
  }

  has(key: string): boolean {
    return this.draft.permissions.has(key);
  }

  toggle(key: string, checked: boolean): void {
    if (this.isReadonly) return;
    if (checked) this.draft.permissions.add(key);
    else this.draft.permissions.delete(key);
  }

  allChecked(f: PermissionFeatureDef): boolean {
    return f.actions.every((a) => this.has(`${f.key}.${a.action}`));
  }

  someChecked(f: PermissionFeatureDef): boolean {
    return !this.allChecked(f) && f.actions.some((a) => this.has(`${f.key}.${a.action}`));
  }

  toggleFeature(f: PermissionFeatureDef, checked: boolean): void {
    for (const a of f.actions) this.toggle(`${f.key}.${a.action}`, checked);
  }

  // ── persistence ─────────────────────────────────────────────────────

  save(): void {
    const body = {
      name: this.draft.name.trim(),
      description: this.draft.description.trim() || undefined,
      permissions: [...this.draft.permissions],
    };
    if (!body.name || !body.permissions.length) return;
    this.busy = true;
    const obs = this.mode === 'create' ? this.api.create(body) : this.api.update(this.selected!.id, body);
    obs.subscribe({
      next: (saved) => {
        this.busy = false;
        this.snack.open(this.mode === 'create' ? `Role "${saved.name}" created` : 'Role updated', 'OK', { duration: 2500 });
        this.mode = 'edit';
        this.selected = saved;
        this.refresh(true);
        // Own permissions may have changed if my role was edited.
        this.perms.reload();
      },
      error: (e) => {
        this.busy = false;
        this.snack.open(e?.error?.message || 'Failed to save role', 'Dismiss', { duration: 5000 });
      },
    });
  }

  deleteSelected(): void {
    const role = this.selected;
    if (!role) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete role',
        message:
          role.userCount > 0
            ? `"${role.name}" is assigned to ${role.userCount} user(s) — deletion will be blocked until they are reassigned.`
            : `Delete the role "${role.name}"? This cannot be undone.`,
        confirmText: 'Delete',
      },
    });
    ref.afterClosed().subscribe((yes) => {
      if (!yes) return;
      this.busy = true;
      this.api.remove(role.id).subscribe({
        next: () => {
          this.busy = false;
          this.snack.open(`Role "${role.name}" deleted`, 'OK', { duration: 2500 });
          this.selected = null;
          this.mode = 'view';
          this.refresh();
        },
        error: (e) => {
          this.busy = false;
          this.snack.open(e?.error?.message || 'Failed to delete role', 'Dismiss', { duration: 5000 });
        },
      });
    });
  }
}
