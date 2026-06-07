import { Component, OnInit, OnDestroy, ViewChild, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TemplatesApiService } from './templates.service';

const TYPES = ['ncr', 'inspection', 'checklist', 'capa', 'other'];
// Form.io standalone bundle — loaded on demand from the CDN, so no npm install
// or build-time dependency is required. The CSS is attached only while the
// builder is open (see attachCss/detachCss) so its Bootstrap base styles don't
// bleed into the rest of the Material UI.
const FORMIO_CSS = 'https://cdn.form.io/formiojs/formio.full.min.css';
const FORMIO_JS = 'https://cdn.form.io/formiojs/formio.full.min.js';

@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatTableModule, MatButtonModule, MatButtonToggleModule,
    MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Form &amp; Report Templates</h1>
          <p class="page-subtitle">Per-customer configurable forms (NCR, inspections, checklists…)</p>
        </div>
        <button mat-raised-button color="primary" (click)="startNew()"><mat-icon>add</mat-icon> New Template</button>
      </div>

      <div class="note">
        <mat-icon>info</mat-icon>
        <span>Build forms visually by dragging fields from the palette. Each template is stored per customer and
          drives the matching NCR / inspection / checklist form. Switch to <strong>JSON</strong> for advanced edits.</span>
      </div>

      @if (editing) {
        <div class="panel">
          <div class="panel-head">
            <h3>{{ editing.id ? 'Edit' : 'New' }} template</h3>
            <mat-button-toggle-group [value]="mode" (change)="setMode($event.value)" class="mode-toggle" aria-label="Editor mode">
              <mat-button-toggle value="visual"><mat-icon>dashboard_customize</mat-icon> Visual</mat-button-toggle>
              <mat-button-toggle value="json"><mat-icon>data_object</mat-icon> JSON</mat-button-toggle>
            </mat-button-toggle-group>
          </div>

          <div class="form-row">
            <mat-form-field appearance="outline" class="grow"><mat-label>Name</mat-label><input matInput [(ngModel)]="editing.name"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Type</mat-label>
              <mat-select [(ngModel)]="editing.type">@for (t of types; track t) { <mat-option [value]="t">{{ t }}</mat-option> }</mat-select></mat-form-field>
          </div>

          @if (mode === 'visual') {
            @if (builderLoading) {
              <div class="builder-loading"><mat-progress-spinner mode="indeterminate" diameter="28"></mat-progress-spinner><span>Loading builder…</span></div>
            }
            <div #builderHost class="formio-host"></div>
            @if (builderError) { <p class="builder-error"><mat-icon>warning</mat-icon> {{ builderError }}</p> }
          } @else {
            <mat-form-field appearance="outline" class="full">
              <mat-label>Schema (Form.io / JSON)</mat-label>
              <textarea matInput rows="14" [(ngModel)]="schemaText" placeholder='{ "components": [ { "type": "textfield", "key": "defectDescription", "label": "Defect" } ] }'></textarea>
            </mat-form-field>
          }

          <div class="panel-actions">
            <button mat-button (click)="cancel()">Cancel</button>
            <button mat-raised-button color="primary" [disabled]="!editing.name" (click)="save()">Save</button>
          </div>
        </div>
      }

      <table mat-table [dataSource]="templates" class="full mat-elevation-z1">
        <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>Name</th><td mat-cell *matCellDef="let t">{{ t.name }}</td></ng-container>
        <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>Type</th><td mat-cell *matCellDef="let t">{{ t.type }}</td></ng-container>
        <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>Version</th><td mat-cell *matCellDef="let t">v{{ t.version }}</td></ng-container>
        <ng-container matColumnDef="fields"><th mat-header-cell *matHeaderCellDef>Fields</th><td mat-cell *matCellDef="let t">{{ (t.schema?.components?.length) || 0 }}</td></ng-container>
        <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let t">
            <button mat-button color="primary" (click)="edit(t)">Edit</button>
            <button mat-icon-button (click)="remove(t)"><mat-icon>delete</mat-icon></button>
          </td></ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr><tr mat-row *matRowDef="let r; columns: cols"></tr>
      </table>
      @if (!templates.length) { <p class="empty">No templates yet. Create one to drive a configurable NCR/inspection form.</p> }
    </div>
  `,
  styles: [`
    .page-shell { padding:24px; } .page-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
    .page-title { margin:0; font-size:22px; } .page-subtitle { margin:2px 0 0; color: var(--clay-text-muted,#64748b); font-size:13px; }
    .note { display:flex; gap:8px; align-items:flex-start; background:#eff6ff; border:1px solid #bfdbfe; color:#1e3a5f; border-radius:8px; padding:10px 12px; margin-bottom:16px; font-size:13px; }
    .note mat-icon { font-size:18px; width:18px; height:18px; }
    .panel { background: var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:16px; margin-bottom:16px; }
    .panel-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin:0 0 12px; }
    .panel-head h3 { margin:0; font-size:15px; } .mode-toggle { transform: scale(0.85); transform-origin:right center; }
    .form-row { display:flex; flex-wrap:wrap; gap:12px; } .grow { flex:1; min-width:200px; } .full { width:100%; }
    .panel-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
    .formio-host { width:100%; min-height:460px; border:1px dashed var(--clay-border,#e2e8f0); border-radius:8px; padding:8px; }
    .builder-loading { display:flex; align-items:center; gap:10px; color: var(--clay-text-muted,#64748b); font-size:13px; padding:8px 0; }
    .builder-error { display:flex; align-items:center; gap:6px; color:#b91c1c; font-size:13px; }
    .builder-error mat-icon { font-size:18px; width:18px; height:18px; }
    table.full { width:100%; } .empty { text-align:center; color: var(--clay-text-muted,#64748b); padding:24px; }
  `],
})
export class TemplatesComponent implements OnInit, OnDestroy {
  readonly types = TYPES;
  cols = ['name', 'type', 'version', 'fields', 'actions'];
  templates: any[] = [];
  editing: any = null;
  schemaText = '';
  mode: 'visual' | 'json' = 'visual';
  builderLoading = false;
  builderError = '';

  @ViewChild('builderHost') builderHost?: ElementRef<HTMLDivElement>;
  private builder: any = null;
  private static formioPromise: Promise<any> | null = null;

  constructor(private api: TemplatesApiService, private snack: MatSnackBar, private zone: NgZone) {}

  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void { this.destroyBuilder(); this.detachCss(); }

  load(): void {
    this.api.list().subscribe({ next: (d) => this.templates = Array.isArray(d) ? d : (d?.data || []), error: () => {} });
  }

  startNew(): void {
    this.editing = { name: '', type: 'ncr' };
    this.schemaText = '{\n  "components": []\n}';
    this.openEditor();
  }

  edit(t: any): void {
    this.editing = { ...t };
    this.schemaText = JSON.stringify(t.schema || { components: [] }, null, 2);
    this.openEditor();
  }

  cancel(): void { this.destroyBuilder(); this.detachCss(); this.editing = null; }

  setMode(m: 'visual' | 'json'): void {
    if (m === this.mode) return;
    if (m === 'json') {
      this.syncFromBuilder();
      this.destroyBuilder();
      this.mode = 'json';
    } else {
      this.mode = 'visual';
      setTimeout(() => this.mountBuilder(), 0);
    }
  }

  save(): void {
    if (this.mode === 'visual') this.syncFromBuilder();
    let schema: any;
    try { schema = this.schemaText.trim() ? JSON.parse(this.schemaText) : { components: [] }; }
    catch { this.snack.open('Schema is not valid JSON', 'Dismiss', { duration: 4000 }); return; }
    const body = { name: this.editing.name, type: this.editing.type, schema };
    const op = this.editing.id ? this.api.update(this.editing.id, body) : this.api.create(body);
    op.subscribe({
      next: () => { this.snack.open('Template saved', 'OK', { duration: 2500 }); this.destroyBuilder(); this.detachCss(); this.editing = null; this.load(); },
      error: (e) => this.snack.open(e?.error?.message || 'Save failed', 'Dismiss', { duration: 4000 }),
    });
  }

  remove(t: any): void {
    this.api.remove(t.id).subscribe({ next: () => { this.snack.open('Deleted', 'OK', { duration: 1500 }); this.load(); }, error: () => {} });
  }

  // ── Form.io visual builder (lazy-loaded from CDN) ────────────────────────
  private openEditor(): void {
    if (this.mode === 'visual') setTimeout(() => this.mountBuilder(), 0);
  }

  private currentSchema(): any {
    try {
      const s = this.schemaText.trim() ? JSON.parse(this.schemaText) : {};
      return { display: 'form', components: Array.isArray(s.components) ? s.components : [] };
    } catch { return { display: 'form', components: [] }; }
  }

  private async mountBuilder(): Promise<void> {
    if (!this.builderHost || this.mode !== 'visual') return;
    this.builderError = '';
    this.builderLoading = true;
    try {
      const Formio = await this.ensureFormio();
      this.attachCss();
      this.destroyBuilder();
      const builder = await Formio.builder(this.builderHost.nativeElement, this.currentSchema(), {});
      this.builder = builder;
      builder.on('change', () => {
        this.zone.run(() => {
          const form = builder.form || builder.schema || { components: [] };
          this.schemaText = JSON.stringify(form, null, 2);
        });
      });
    } catch {
      this.builderError = 'Could not load the visual builder (network/offline). Switched to the JSON editor.';
      this.mode = 'json';
    } finally {
      this.builderLoading = false;
    }
  }

  private syncFromBuilder(): void {
    if (this.builder && (this.builder.form || this.builder.schema)) {
      this.schemaText = JSON.stringify(this.builder.form || this.builder.schema, null, 2);
    }
  }

  private destroyBuilder(): void {
    try { if (this.builder && this.builder.destroy) this.builder.destroy(true); } catch { /* ignore */ }
    this.builder = null;
    if (this.builderHost) this.builderHost.nativeElement.innerHTML = '';
  }

  private ensureFormio(): Promise<any> {
    const w = window as any;
    if (w.Formio) return Promise.resolve(w.Formio);
    if (TemplatesComponent.formioPromise) return TemplatesComponent.formioPromise;
    TemplatesComponent.formioPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = FORMIO_JS;
      script.async = true;
      script.onload = () => (w.Formio ? resolve(w.Formio) : reject(new Error('Formio global missing after load')));
      script.onerror = () => { TemplatesComponent.formioPromise = null; reject(new Error('Formio CDN load failed')); };
      document.head.appendChild(script);
    });
    return TemplatesComponent.formioPromise;
  }

  private attachCss(): void {
    if (document.getElementById('formio-css')) return;
    const link = document.createElement('link');
    link.id = 'formio-css';
    link.rel = 'stylesheet';
    link.href = FORMIO_CSS;
    document.head.appendChild(link);
  }

  private detachCss(): void {
    document.getElementById('formio-css')?.remove();
  }
}
