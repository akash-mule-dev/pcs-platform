import { Component, OnInit, OnDestroy, ViewChild, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TemplatesApiService } from './templates.service';

const TYPES = ['inspection', 'checklist', 'ncr', 'capa', 'other'];
const TYPE_LABEL: Record<string, string> = {
  inspection: 'Inspection', checklist: 'Checklist', ncr: 'NCR', capa: 'CAPA', other: 'Other',
};

// Form.io standalone bundle + the Bootstrap 4 base its templates are built on.
// Both stylesheets are attached ONLY while the editor is open (and the app's
// body font is pinned via an inline style so nothing visibly bleeds).
const BOOTSTRAP_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/4.6.2/css/bootstrap.min.css';
const FORMIO_CSS = 'https://cdn.form.io/formiojs/formio.full.min.css';
const FORMIO_JS = 'https://cdn.form.io/formiojs/formio.full.min.js';

/**
 * Report templates — per-customer drag-drop forms (Form.io builder) that drive
 * QC reports, NCR forms and checklists. The visual builder is the default;
 * JSON mode is there for advanced edits and copy/paste between environments.
 */
@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <div class="head">
        <div>
          <h1>Report Templates</h1>
          <p class="sub">Drag-drop forms, customized per customer — they drive QC reports, NCR forms and checklists.</p>
        </div>
        <button class="primary" (click)="editing ? cancel() : startNew()">
          <mat-icon>{{ editing ? 'close' : 'add' }}</mat-icon>{{ editing ? 'Cancel' : 'New template' }}
        </button>
      </div>

      @if (editing) {
        <section class="card editor">
          <div class="ed-head">
            <h3>{{ editing.id ? 'Edit template' : 'New template' }}</h3>
            <div class="mode">
              <button class="mode-btn" [class.on]="mode === 'visual'" (click)="setMode('visual')"><mat-icon>dashboard_customize</mat-icon>Visual</button>
              <button class="mode-btn" [class.on]="mode === 'json'" (click)="setMode('json')"><mat-icon>data_object</mat-icon>JSON</button>
            </div>
          </div>

          <div class="ed-meta">
            <label class="grow">Template name
              <input type="text" placeholder="e.g. Weld Inspection Report — Acme Steel" [(ngModel)]="editing.name">
            </label>
            <label>Type
              <select [(ngModel)]="editing.type">
                @for (t of types; track t) { <option [value]="t">{{ typeLabel(t) }}</option> }
              </select>
            </label>
          </div>

          @if (mode === 'visual') {
            @if (builderLoading) {
              <div class="builder-loading"><mat-spinner diameter="26"></mat-spinner><span>Loading the drag-drop builder…</span></div>
            }
            <p class="builder-hint"><mat-icon>info</mat-icon>Drag fields from the left palette onto the form. Click a placed field to set its label, required flag, values and validation.</p>
            <div #builderHost class="formio-host"></div>
            @if (builderError) { <p class="builder-error"><mat-icon>warning</mat-icon>{{ builderError }}</p> }
          } @else {
            <label class="json-label">Schema (Form.io JSON)
              <textarea rows="16" [(ngModel)]="schemaText" spellcheck="false"
                placeholder='{ "components": [ { "type": "textfield", "key": "inspector", "label": "Inspector" } ] }'></textarea>
            </label>
          }

          <div class="ed-actions">
            <button class="ghost" (click)="cancel()">Cancel</button>
            <button class="primary" [disabled]="!editing.name" (click)="save()"><mat-icon>save</mat-icon>Save template</button>
          </div>
        </section>
      }

      <section class="card list-card">
        @if (templates.length === 0 && !editing) {
          <div class="none">
            <mat-icon>dashboard_customize</mat-icon>
            <h3>No templates yet</h3>
            <p>Create your first one — drag fields together for a customer's QC report, then it appears in every "Start report" dropdown.</p>
            <button class="primary" (click)="startNew()"><mat-icon>add</mat-icon>New template</button>
          </div>
        } @else if (templates.length > 0) {
          <div class="thead"><span>Name</span><span>Type</span><span>Version</span><span>Fields</span><span></span></div>
          @for (t of templates; track t.id) {
            <div class="trow">
              <span class="t-name">{{ t.name }}</span>
              <span><span class="type-chip tt-{{ t.type }}">{{ typeLabel(t.type) }}</span></span>
              <span class="t-ver">v{{ t.version }}</span>
              <span class="t-fields">{{ (t.schema?.components?.length) || 0 }} fields</span>
              <span class="t-actions">
                <button class="link" (click)="edit(t)"><mat-icon>edit</mat-icon>Edit</button>
                <button class="link danger" (click)="remove(t)"><mat-icon>delete</mat-icon></button>
              </span>
            </div>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    .page { max-width: 1320px; margin: 0 auto; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .head h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--clay-text); }
    .sub { margin: 4px 0 0; font-size: 13px; color: var(--clay-text-muted); }
    .primary, .ghost { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .primary { background: var(--clay-primary); color: #fff; border: none; }
    .primary:disabled { opacity: .55; cursor: default; }
    .ghost { background: var(--clay-surface); color: var(--clay-text-secondary); border: 1px solid var(--clay-border); }
    .primary mat-icon, .ghost mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); box-shadow: var(--clay-shadow-soft); }
    .editor { padding: 16px 18px; margin-bottom: 16px; }
    .ed-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .ed-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--clay-text); }
    .mode { display: flex; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); overflow: hidden; }
    .mode-btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 13px; font-size: 12px; font-weight: 600; background: var(--clay-surface); color: var(--clay-text-secondary); border: none; cursor: pointer; font-family: inherit; }
    .mode-btn.on { background: var(--clay-primary); color: #fff; }
    .mode-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .ed-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .ed-meta label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); min-width: 180px; }
    .ed-meta .grow { flex: 1; }
    .ed-meta input, .ed-meta select { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); padding: 9px 11px; font-size: 14px; font-family: inherit; }
    .ed-meta input:focus, .ed-meta select:focus { outline: 2px solid color-mix(in srgb, var(--clay-primary) 35%, transparent); border-color: var(--clay-primary); }

    .builder-hint { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--clay-text-muted); margin: 0 0 10px; }
    .builder-hint mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--clay-primary); }
    .formio-host { width: 100%; min-height: 480px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 12px; background: #fff; }
    .builder-loading { display: flex; align-items: center; gap: 10px; color: var(--clay-text-muted); font-size: 13px; padding: 8px 0; }
    .builder-error { display: flex; align-items: center; gap: 6px; color: var(--danger-text); font-size: 13px; }
    .builder-error mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .json-label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); }
    .json-label textarea { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); background: var(--clay-bg-warm); color: var(--clay-text); padding: 12px; font-size: 12.5px; font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace; line-height: 1.5; resize: vertical; }
    .ed-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }

    .list-card { overflow: hidden; }
    .thead, .trow { display: grid; grid-template-columns: 2fr 130px 80px 110px 140px; gap: 12px; align-items: center; padding: 11px 16px; }
    .thead { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); border-bottom: 1px solid var(--clay-border); background: var(--clay-bg-warm); }
    .trow { border-bottom: 1px solid var(--clay-border); }
    .trow:last-child { border-bottom: none; }
    .trow:hover { background: var(--clay-surface-hover); }
    .t-name { font-size: 13px; font-weight: 600; color: var(--clay-text); }
    .type-chip { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .tt-inspection { background: var(--info-bg); color: var(--clay-primary); }
    .tt-checklist { background: var(--success-bg); color: var(--success-text); }
    .tt-ncr { background: var(--danger-bg); color: var(--danger-text); }
    .tt-capa { background: var(--warning-bg); color: var(--warning-text); }
    .tt-other { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .t-ver, .t-fields { font-size: 12px; color: var(--clay-text-muted); font-family: 'Space Grotesk', monospace; }
    .t-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .link { display: inline-flex; align-items: center; gap: 3px; background: none; border: none; color: var(--clay-primary); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 4px 6px; }
    .link.danger { color: var(--clay-text-muted); }
    .link.danger:hover { color: var(--danger); }
    .link mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .none { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 16px; text-align: center; }
    .none mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--clay-text-muted); opacity: .5; }
    .none h3 { margin: 0; font-size: 16px; color: var(--clay-text); }
    .none p { margin: 0 0 10px; font-size: 13px; color: var(--clay-text-muted); max-width: 460px; }

    /* Tame the Form.io builder inside its host so it blends with the app. */
    :host ::ng-deep .formio-host { font-size: 13.5px; }
    :host ::ng-deep .formio-host .formcomponents .formcomponent { font-size: 12px; padding: 6px 9px; border-radius: 7px; }
    :host ::ng-deep .formio-host .drag-container { min-height: 320px; border-radius: 8px; }
    :host ::ng-deep .formio-host .formarea { background: var(--clay-bg-warm, #f8fafc); border-radius: 8px; }
    :host ::ng-deep .formio-host .btn-primary { background-color: var(--clay-primary, #2563eb); border-color: var(--clay-primary, #2563eb); }
  `],
})
export class TemplatesComponent implements OnInit, OnDestroy {
  readonly types = TYPES;
  templates: any[] = [];
  editing: any = null;
  schemaText = '';
  mode: 'visual' | 'json' = 'visual';
  builderLoading = false;
  builderError = '';

  @ViewChild('builderHost') builderHost?: ElementRef<HTMLDivElement>;
  private builder: any = null;
  private static formioPromise: Promise<any> | null = null;
  private prevBodyFont: string | null = null;

  constructor(private api: TemplatesApiService, private snack: MatSnackBar, private zone: NgZone) {}

  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void { this.destroyBuilder(); this.detachCss(); }

  typeLabel(t: string): string { return TYPE_LABEL[t] ?? t; }

  load(): void {
    this.api.list().subscribe({ next: (d) => this.templates = Array.isArray(d) ? d : (d?.data || []), error: () => {} });
  }

  startNew(): void {
    this.editing = { name: '', type: 'inspection' };
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

  /** Bootstrap 4 (Form.io's expected base) + Form.io CSS, attached only while
   *  the editor is open. The app's body font is pinned with an inline style so
   *  Bootstrap's reboot doesn't visibly change the rest of the shell. */
  private attachCss(): void {
    if (!document.getElementById('bootstrap-css')) {
      this.prevBodyFont = getComputedStyle(document.body).fontFamily;
      const bs = document.createElement('link');
      bs.id = 'bootstrap-css';
      bs.rel = 'stylesheet';
      bs.href = BOOTSTRAP_CSS;
      document.head.appendChild(bs);
      document.body.style.fontFamily = this.prevBodyFont;
    }
    if (!document.getElementById('formio-css')) {
      const link = document.createElement('link');
      link.id = 'formio-css';
      link.rel = 'stylesheet';
      link.href = FORMIO_CSS;
      document.head.appendChild(link);
    }
  }

  private detachCss(): void {
    document.getElementById('formio-css')?.remove();
    document.getElementById('bootstrap-css')?.remove();
    document.body.style.removeProperty('font-family');
  }
}
