import { Component, OnDestroy, AfterViewInit, ViewChild, ElementRef, NgZone, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TemplatesApiService } from './templates.service';
import { TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL } from './template-types';

// Form.io standalone bundle + the Bootstrap 4 base its templates are built on.
// Both stylesheets are attached ONLY while the dialog is open (and the app's
// body font is pinned via an inline style so nothing visibly bleeds).
const BOOTSTRAP_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/4.6.2/css/bootstrap.min.css';
const FORMIO_CSS = 'https://cdn.form.io/formiojs/formio.full.min.css';
const FORMIO_JS = 'https://cdn.form.io/formiojs/formio.full.min.js';

export interface TemplateDialogData {
  /** create → blank editor · edit → editable existing · view → read-only preview. */
  mode: 'create' | 'edit' | 'view';
  /** The existing template (required for edit/view). */
  template?: any;
  /** Optional usage count (reports filled from this template) — shown in view. */
  usageCount?: number;
}

/**
 * Report-template editor/viewer — opened as a Material dialog from the templates
 * list. Hosts the drag-drop Form.io builder (default), a raw JSON editor for
 * advanced edits, and a read-only rendered preview for "view". All Form.io
 * assets are lazy-loaded from CDN and only while the dialog is open.
 *
 * Resolves to the saved template on success, or undefined on cancel/close.
 */
@Component({
  selector: 'app-template-editor-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="dlg-head">
      <div class="dlg-title">
        <h2 mat-dialog-title>{{ title() }}</h2>
        @if (mode === 'view') {
          <span class="type-chip tt-{{ editing.type }}">{{ typeLabel(editing.type) }}</span>
          @if (editing.version != null) { <span class="meta-pill">v{{ editing.version }}</span> }
          <span class="meta-pill">{{ fieldCount() }} field{{ fieldCount() === 1 ? '' : 's' }}</span>
          @if (data.usageCount) { <span class="meta-pill use">{{ data.usageCount }} report{{ data.usageCount === 1 ? '' : 's' }}</span> }
          @if (editing.libraryOriginId) { <span class="lib-badge" title="Published from the shared library"><mat-icon>auto_awesome</mat-icon>Library</span> }
        }
      </div>
      <div class="mode">
        <button class="mode-btn" [class.on]="viewMode === 'visual'" (click)="setMode('visual')">
          <mat-icon>{{ editable ? 'dashboard_customize' : 'visibility' }}</mat-icon>{{ editable ? 'Visual' : 'Preview' }}
        </button>
        <button class="mode-btn" [class.on]="viewMode === 'json'" (click)="setMode('json')"><mat-icon>data_object</mat-icon>JSON</button>
      </div>
    </div>

    <mat-dialog-content>
      @if (editable) {
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
      }

      @if (viewMode === 'visual') {
        @if (editable) {
          <p class="builder-hint"><mat-icon>info</mat-icon>Drag fields from the left palette onto the form. Click a placed field to set its label, required flag, values and validation.</p>
        } @else if (fieldCount() === 0) {
          <p class="builder-hint empty"><mat-icon>info</mat-icon>This template has no fields yet.</p>
        }
        @if (builderLoading) {
          <div class="builder-loading"><mat-spinner diameter="26"></mat-spinner><span>{{ editable ? 'Loading the drag-drop builder…' : 'Loading the preview…' }}</span></div>
        }
      }

      <!-- Single host; the builder or the read-only preview mounts here. Kept in
           the DOM (hidden in JSON mode) so the @ViewChild reference is stable. -->
      <div #formioHost class="formio-host" [class.hidden]="viewMode === 'json'" [class.readonly]="!editable"></div>
      @if (builderError) { <p class="builder-error"><mat-icon>warning</mat-icon>{{ builderError }}</p> }

      @if (viewMode === 'json') {
        <label class="json-label">Schema (Form.io JSON)
          <textarea rows="16" [(ngModel)]="schemaText" spellcheck="false" [readonly]="!editable"
            placeholder='{ "components": [ { "type": "textfield", "key": "inspector", "label": "Inspector" } ] }'></textarea>
        </label>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (mode === 'view') {
        <button class="ghost" (click)="close()">Close</button>
        <button class="primary" (click)="startEdit()"><mat-icon>edit</mat-icon>Edit template</button>
      } @else {
        <button class="ghost" (click)="close()" [disabled]="saving">Cancel</button>
        <button class="primary" [disabled]="!editing.name?.trim() || saving" (click)="save()">
          <mat-icon>save</mat-icon>{{ saving ? 'Saving…' : 'Save template' }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .dlg-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 24px 0; flex-wrap: wrap; }
    .dlg-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
    h2[mat-dialog-title] { margin: 0; padding: 0; font-size: 17px; font-weight: 700; color: var(--clay-text); }
    .meta-pill { font-size: 11px; font-weight: 700; color: var(--clay-text-muted); font-family: 'Space Grotesk', monospace; padding: 2px 8px; border-radius: 999px; background: var(--clay-bg-warm); }
    .meta-pill.use { background: var(--info-bg); color: var(--info-text); }
    .lib-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 5px; font-size: 10px; font-weight: 700; background: #ede9fe; color: #6d28d9; }
    .lib-badge mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .type-chip { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .tt-inspection { background: var(--info-bg); color: var(--clay-primary); }
    .tt-checklist { background: var(--success-bg); color: var(--success-text); }
    .tt-ncr { background: var(--danger-bg); color: var(--danger-text); }
    .tt-capa { background: var(--warning-bg); color: var(--warning-text); }
    .tt-other { background: var(--badge-draft-bg); color: var(--badge-draft-text); }

    .mode { display: flex; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); overflow: hidden; flex-shrink: 0; }
    .mode-btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 13px; font-size: 12px; font-weight: 600; background: var(--clay-surface); color: var(--clay-text-secondary); border: none; cursor: pointer; font-family: inherit; }
    .mode-btn.on { background: var(--clay-primary); color: #fff; }
    .mode-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    mat-dialog-content { min-width: min(1040px, 92vw); max-width: 92vw; max-height: 72vh; padding-top: 14px; }

    .ed-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .ed-meta label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); min-width: 180px; }
    .ed-meta .grow { flex: 1; }
    .ed-meta input, .ed-meta select { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); padding: 9px 11px; font-size: 14px; font-family: inherit; }
    .ed-meta input:focus, .ed-meta select:focus { outline: 2px solid color-mix(in srgb, var(--clay-primary) 35%, transparent); border-color: var(--clay-primary); }

    .builder-hint { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--clay-text-muted); margin: 0 0 10px; }
    .builder-hint.empty { color: var(--clay-text-secondary); }
    .builder-hint mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--clay-primary); }
    .formio-host { width: 100%; min-height: 460px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 12px; background: #fff; }
    .formio-host.readonly { min-height: 120px; }
    .formio-host.hidden { display: none; }
    .builder-loading { display: flex; align-items: center; gap: 10px; color: var(--clay-text-muted); font-size: 13px; padding: 8px 0; }
    .builder-error { display: flex; align-items: center; gap: 6px; color: var(--danger-text); font-size: 13px; }
    .builder-error mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .json-label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); }
    .json-label textarea { width: 100%; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); background: var(--clay-bg-warm); color: var(--clay-text); padding: 12px; font-size: 12.5px; font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace; line-height: 1.5; resize: vertical; box-sizing: border-box; }

    mat-dialog-actions { padding: 8px 24px 16px; }
    .primary, .ghost { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .primary { background: var(--clay-primary); color: #fff; border: none; }
    .primary:disabled { opacity: .55; cursor: default; }
    .ghost { background: var(--clay-surface); color: var(--clay-text-secondary); border: 1px solid var(--clay-border); }
    .ghost:disabled { opacity: .55; cursor: default; }
    .primary mat-icon, .ghost mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* Tame the Form.io builder / preview inside its host so it blends with the app. */
    :host ::ng-deep .formio-host { font-size: 13.5px; }
    :host ::ng-deep .formio-host .formcomponents .formcomponent { font-size: 12px; padding: 6px 9px; border-radius: 7px; }
    :host ::ng-deep .formio-host .drag-container { min-height: 320px; border-radius: 8px; }
    :host ::ng-deep .formio-host .formarea { background: var(--clay-bg-warm, #f8fafc); border-radius: 8px; }
    :host ::ng-deep .formio-host .btn-primary { background-color: var(--clay-primary, #2563eb); border-color: var(--clay-primary, #2563eb); }
    :host ::ng-deep .formio-host.readonly .formio-component { margin-bottom: 16px; }
    :host ::ng-deep .formio-host.readonly label { font-size: 12.5px; font-weight: 600; color: var(--clay-text-secondary, #475569); margin-bottom: 6px; }
    :host ::ng-deep .formio-host.readonly .form-control { border: 1px solid var(--clay-border, #e2e8f0); border-radius: 9px; padding: 9px 11px; font-size: 14px; background: #fff; height: auto; }
  `],
})
export class TemplateEditorDialogComponent implements AfterViewInit, OnDestroy {
  readonly data = inject<TemplateDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<TemplateEditorDialogComponent>);
  private api = inject(TemplatesApiService);
  private snack = inject(MatSnackBar);
  private zone = inject(NgZone);

  readonly types = TEMPLATE_TYPES;
  mode: 'create' | 'edit' | 'view' = this.data.mode;
  editing: any = this.data.template ? { ...this.data.template } : { name: '', type: 'inspection' };
  schemaText = JSON.stringify(this.editing.schema || { components: [] }, null, 2);
  viewMode: 'visual' | 'json' = 'visual';
  saving = false;
  builderLoading = false;
  builderError = '';

  @ViewChild('formioHost') formioHost?: ElementRef<HTMLDivElement>;
  private instance: any = null;          // Form.io builder (editable) or form (view)
  private mountGen = 0;                   // bumped on every (re)mount/teardown; stale async builds self-destroy
  private destroyed = false;
  private static formioPromise: Promise<any> | null = null;

  get editable(): boolean { return this.mode !== 'view'; }

  ngAfterViewInit(): void {
    // Defer one tick so the dialog's content is laid out before Form.io measures it.
    setTimeout(() => this.mountHost(), 0);
  }

  ngOnDestroy(): void { this.destroyed = true; this.destroyInstance(); this.detachCss(); }

  typeLabel(t: string): string { return TEMPLATE_TYPE_LABEL[t] ?? t; }
  title(): string {
    if (this.mode === 'view') return this.editing.name || 'Template';
    return this.mode === 'edit' ? 'Edit template' : 'New template';
  }
  fieldCount(): number {
    try { return (this.parseSchema().components || []).length; } catch { return 0; }
  }

  setMode(m: 'visual' | 'json'): void {
    if (m === this.viewMode) return;
    if (m === 'json') {
      this.syncFromBuilder();
      this.destroyInstance();
      this.viewMode = 'json';
    } else {
      this.viewMode = 'visual';
      setTimeout(() => this.mountHost(), 0);
    }
  }

  /** View → Edit, in place: swap the read-only preview for the live builder.
   *  schemaText already holds the loaded schema (the read-only preview never
   *  mutates it), so there is nothing to capture first. */
  startEdit(): void {
    if (this.mode !== 'view') return;
    this.destroyInstance();
    this.mode = 'edit';
    this.viewMode = 'visual';
    setTimeout(() => this.mountHost(), 0);
  }

  save(): void {
    if (!this.editable || this.saving) return;
    if (this.viewMode === 'visual') this.syncFromBuilder();
    // Name first: the more fundamental error should win over a JSON syntax error.
    if (!this.editing.name?.trim()) { this.snack.open('Template name is required', 'Dismiss', { duration: 3000 }); return; }
    let schema: any;
    try { schema = this.parseSchema(); }
    catch { this.snack.open('Schema is not valid JSON', 'Dismiss', { duration: 4000 }); return; }

    this.saving = true;
    const body = { name: this.editing.name.trim(), type: this.editing.type, schema };
    const op = this.editing.id ? this.api.update(this.editing.id, body) : this.api.create(body);
    op.subscribe({
      next: (saved) => { this.snack.open('Template saved', 'OK', { duration: 2500 }); this.dialogRef.close(saved ?? true); },
      error: (e) => { this.saving = false; this.snack.open(e?.error?.message || 'Save failed', 'Dismiss', { duration: 4000 }); },
    });
  }

  close(): void { this.dialogRef.close(); }

  // ── Form.io host (lazy-loaded from CDN) ──────────────────────────────────
  /** Parse the JSON text into a Form.io schema, preserving ALL top-level keys
   *  (display/settings/etc.) and only normalizing `components` + defaulting
   *  `display`. Throws on invalid JSON. */
  private parseSchema(): any {
    const parsed = this.schemaText.trim() ? JSON.parse(this.schemaText) : {};
    const s = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    return { ...s, display: s.display || 'form', components: Array.isArray(s.components) ? s.components : [] };
  }

  private async mountHost(): Promise<void> {
    if (this.destroyed || !this.formioHost || this.viewMode !== 'visual') return;
    this.builderError = '';

    // Validate the JSON FIRST so a syntax error is reported as such (and the user
    // is dropped into the JSON editor to fix it) rather than being mislabeled as
    // a CDN/network failure by the catch below.
    let schema: any;
    try { schema = this.parseSchema(); }
    catch {
      this.snack.open('Schema is not valid JSON', 'Dismiss', { duration: 4000 });
      this.builderError = `Schema is not valid JSON — fix it here, then switch back to ${this.editable ? 'Visual' : 'Preview'}.`;
      this.viewMode = 'json';
      return;
    }

    this.builderLoading = true;
    this.destroyInstance();          // tear down the previous instance AND bump mountGen
    const gen = this.mountGen;       // this mount's identity
    try {
      const Formio = await this.ensureFormio();
      if (this.destroyed || gen !== this.mountGen || !this.formioHost) return;  // torn down / re-mounted while loading the lib
      this.attachCss();
      if (this.editable) {
        const builder = await Formio.builder(this.formioHost.nativeElement, schema, {});
        if (this.destroyed || gen !== this.mountGen) { try { builder.destroy?.(true); } catch { /* ignore */ } return; }
        this.instance = builder;
        builder.on('change', () => {
          if (this.instance !== builder) return;          // ignore late events from a stale builder
          this.zone.run(() => {
            const form = builder.form || builder.schema || { components: [] };
            this.schemaText = JSON.stringify(form, null, 2);
          });
        });
      } else {
        // Read-only rendered preview of the template's fields.
        const form = await Formio.createForm(this.formioHost.nativeElement, schema, { readOnly: true, noAlerts: true });
        if (this.destroyed || gen !== this.mountGen) { try { form.destroy?.(true); } catch { /* ignore */ } return; }
        this.instance = form;
      }
    } catch {
      if (this.destroyed || gen !== this.mountGen) return;
      this.builderError = this.editable
        ? 'Could not load the visual builder (network/offline). Switched to the JSON editor.'
        : 'Could not load the preview (network/offline). Switched to the JSON view.';
      this.viewMode = 'json';
    } finally {
      if (gen === this.mountGen) this.builderLoading = false;
    }
  }

  private syncFromBuilder(): void {
    // Only the editable builder carries an edited schema worth pulling back.
    if (this.editable && this.instance && (this.instance.form || this.instance.schema)) {
      this.schemaText = JSON.stringify(this.instance.form || this.instance.schema, null, 2);
    }
  }

  private destroyInstance(): void {
    this.mountGen++;                 // invalidate any in-flight mountHost() await
    try { this.instance?.off?.('change'); } catch { /* ignore */ }
    try { this.instance?.destroy?.(true); } catch { /* ignore */ }
    this.instance = null;
    if (this.formioHost) this.formioHost.nativeElement.innerHTML = '';
  }

  private ensureFormio(): Promise<any> {
    const w = window as any;
    if (w.Formio) return Promise.resolve(w.Formio);
    if (TemplateEditorDialogComponent.formioPromise) return TemplateEditorDialogComponent.formioPromise;
    TemplateEditorDialogComponent.formioPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = FORMIO_JS;
      script.async = true;
      script.onload = () => (w.Formio ? resolve(w.Formio) : reject(new Error('Formio global missing after load')));
      script.onerror = () => { TemplateEditorDialogComponent.formioPromise = null; reject(new Error('Formio CDN load failed')); };
      document.head.appendChild(script);
    });
    return TemplateEditorDialogComponent.formioPromise;
  }

  /** Bootstrap 4 (Form.io's expected base) + Form.io CSS, attached only while
   *  the dialog is open. The app's body font is pinned with an inline style so
   *  Bootstrap's reboot doesn't visibly change the rest of the shell. */
  private attachCss(): void {
    if (!document.getElementById('bootstrap-css')) {
      const prevBodyFont = getComputedStyle(document.body).fontFamily;
      const bs = document.createElement('link');
      bs.id = 'bootstrap-css';
      bs.rel = 'stylesheet';
      bs.href = BOOTSTRAP_CSS;
      document.head.appendChild(bs);
      document.body.style.fontFamily = prevBodyFont;
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
