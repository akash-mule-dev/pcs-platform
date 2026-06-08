import { Component, ElementRef, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiService } from '../../core/services/api.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DurationPipe } from '../../shared/pipes/duration.pipe';

interface StageDraft {
  _uid: number;
  name: string;
  targetTimeSeconds: number;
  description: string;
  showDescription: boolean;
}

@Component({
  selector: 'app-process-form',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatTooltipModule, DragDropModule, DurationPipe,
  ],
  template: `
    <div class="proc-dialog">
      <!-- ===== Header (pinned) ===== -->
      <div class="proc-header">
        <div class="header-icon">
          <mat-icon>account_tree</mat-icon>
        </div>
        <div class="header-text">
          <h2>{{ data ? 'Edit' : 'New' }} Process</h2>
          <p class="proc-subtitle">{{ data ? 'Update process details' : 'Define a manufacturing workflow and its stage sequence' }}</p>
        </div>
      </div>

      <!-- ===== Body (the only scroll region) ===== -->
      <div class="proc-body" #bodyEl>
        <!-- Details -->
        <section class="form-section">
          <span class="section-label">Process details</span>
          <div class="form-row">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Name</mat-label>
              <input matInput [(ngModel)]="form.name" required maxlength="255" placeholder="e.g. Assembly Line A">
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Product</mat-label>
              <mat-select [(ngModel)]="form.productId" required>
                @for (p of products; track p.id) {
                  <mat-option [value]="p.id">{{ p.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>

          @if (data) {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Version</mat-label>
              <input matInput type="number" [(ngModel)]="form.version" min="1">
            </mat-form-field>
          } @else {
            <p class="hint-text">
              <mat-icon class="inline-ico">info</mat-icon>
              Version is assigned automatically — the first process for a product becomes v1.
            </p>
          }
        </section>

        <!-- Stages builder (create only) -->
        @if (!data) {
          <section class="stages-section">
            <div class="stages-header">
              <div class="stages-title">
                <span class="section-label">Stages</span>
                <span class="count-pill">{{ stages.length }}</span>
              </div>
              <button type="button" class="btn-outline" (click)="addStage()">
                <mat-icon>add</mat-icon> Add Stage
              </button>
            </div>

            @if (stages.length === 0) {
              <button type="button" class="stages-empty" (click)="addStage()">
                <mat-icon>layers</mat-icon>
                <span class="empty-title">No stages yet</span>
                <span class="empty-sub">Add the first stage to define the manufacturing sequence — or create the process without stages and add them later.</span>
              </button>
            } @else {
              <p class="hint-text reorder-hint">
                <mat-icon class="inline-ico">swap_vert</mat-icon>
                Drag the handle to reorder — top to bottom is the manufacturing sequence.
              </p>

              <div class="stage-list" cdkDropList (cdkDropListDropped)="drop($event)">
                @for (stage of stages; track stage._uid; let i = $index; let first = $first; let last = $last) {
                  <div class="stage-card" cdkDrag>
                    <div class="stage-card-head">
                      <span class="stage-num">{{ i + 1 }}</span>
                      <div class="head-controls">
                        <button type="button" class="icon-btn" (click)="moveStage(i, -1)" [disabled]="first" matTooltip="Move up">
                          <mat-icon>keyboard_arrow_up</mat-icon>
                        </button>
                        <button type="button" class="icon-btn" (click)="moveStage(i, 1)" [disabled]="last" matTooltip="Move down">
                          <mat-icon>keyboard_arrow_down</mat-icon>
                        </button>
                        <button type="button" class="stage-grip" cdkDragHandle matTooltip="Drag to reorder">
                          <mat-icon>drag_indicator</mat-icon>
                        </button>
                        <button type="button" class="icon-btn icon-btn-danger" (click)="removeStage(i)" matTooltip="Remove stage">
                          <mat-icon>close</mat-icon>
                        </button>
                      </div>
                    </div>

                    <div class="stage-fields">
                      <mat-form-field appearance="outline" class="stage-name-field">
                        <mat-label>Stage Name</mat-label>
                        <input matInput [(ngModel)]="stage.name" [ngModelOptions]="{ standalone: true }" required maxlength="255" placeholder="e.g. Welding">
                        <mat-error>Name is required</mat-error>
                      </mat-form-field>

                      <mat-form-field appearance="outline" class="stage-time-field">
                        <mat-label>Target</mat-label>
                        <input matInput type="number" [(ngModel)]="stage.targetTimeSeconds" [ngModelOptions]="{ standalone: true }" min="0" step="1">
                        <span matTextSuffix>sec</span>
                      </mat-form-field>
                    </div>

                    @if (stage.targetTimeSeconds != null && stage.targetTimeSeconds <= 0) {
                      <p class="warn-hint">
                        <mat-icon class="inline-ico">warning</mat-icon>
                        Target time should be greater than 0.
                      </p>
                    }

                    @if (stage.showDescription) {
                      <mat-form-field appearance="outline" class="full-width desc-field">
                        <mat-label>Description</mat-label>
                        <textarea matInput rows="2" [(ngModel)]="stage.description" [ngModelOptions]="{ standalone: true }" placeholder="Optional notes about this stage"></textarea>
                      </mat-form-field>
                    } @else {
                      <button type="button" class="btn-text" (click)="stage.showDescription = true">
                        <mat-icon>notes</mat-icon> Add description
                      </button>
                    }

                    <!-- Drag preview -->
                    <div *cdkDragPreview class="stage-card stage-drag-preview">
                      <div class="stage-card-head">
                        <span class="stage-num">{{ i + 1 }}</span>
                        <span class="preview-name">{{ stage.name || 'Untitled stage' }}</span>
                      </div>
                    </div>
                  </div>
                }

                <button type="button" class="add-stage-row" (click)="addStage()">
                  <mat-icon>add</mat-icon> Add another stage
                </button>
              </div>
            }
          </section>
        }
      </div>

      <!-- ===== Footer (pinned) ===== -->
      <div class="proc-footer">
        @if (!data) {
          <div class="footer-summary">
            <mat-icon>layers</mat-icon>
            <span><strong>{{ stages.length }}</strong> stage{{ stages.length === 1 ? '' : 's' }}</span>
            <span class="dot">·</span>
            <span class="mono">{{ totalTargetSeconds | duration }} total</span>
          </div>
        }
        <div class="footer-actions">
          <button type="button" class="btn-ghost" (click)="dialogRef.close()">Cancel</button>
          <button type="button" class="btn-primary" (click)="save()" [disabled]="!form.name || !form.productId || saving">
            {{ saving ? 'Saving…' : (data ? 'Save Changes' : 'Create Process') }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    /* ===== Shell: bounded flex column so the footer never scrolls off-screen ===== */
    .proc-dialog {
      display: flex; flex-direction: column;
      max-height: 86vh;
      border-radius: var(--clay-radius-lg);
      overflow: hidden;
    }

    /* ===== Header (pinned) ===== */
    .proc-header {
      flex: 0 0 auto;
      display: flex; align-items: center; gap: 14px;
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--clay-border);
    }
    .header-icon {
      width: 44px; height: 44px; border-radius: var(--clay-radius-sm);
      background: var(--kpi-purple-bg); color: var(--kpi-purple-fg);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .header-icon mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .header-text h2 {
      margin: 0; font-size: 18px; font-weight: 700; line-height: 1.25;
      color: var(--clay-text); letter-spacing: -0.01em;
      font-family: 'Space Grotesk', 'Inter', sans-serif;
    }
    .proc-subtitle { margin: 2px 0 0; font-size: 12px; color: var(--clay-text-muted); }

    /* ===== Body (sole scroller) ===== */
    .proc-body {
      flex: 1 1 auto; min-height: 0; overflow-y: auto;
      display: flex; flex-direction: column; gap: 20px;
      padding: 18px 24px;
    }

    /* .section-label inherited from global styles.scss */

    .hint-text {
      display: flex; align-items: center; gap: 6px;
      color: var(--clay-text-muted); font-size: 12px; margin: 0;
    }
    .inline-ico { font-size: 15px; width: 15px; height: 15px; flex-shrink: 0; }

    /* ===== Stages ===== */
    .stages-section {
      padding-top: 18px;
      border-top: 1px solid var(--clay-border);
    }
    .stages-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px;
    }
    .stages-title { display: flex; align-items: center; gap: 8px; }
    .stages-title .section-label { margin-bottom: 0; }
    .count-pill {
      min-width: 22px; height: 22px; padding: 0 7px; border-radius: 11px;
      background: var(--clay-bg-warm); color: var(--clay-text-secondary);
      font-family: 'Space Grotesk', monospace; font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .reorder-hint { margin-bottom: 12px; }

    /* Empty state — clickable */
    .stages-empty {
      width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 24px 20px; text-align: center; cursor: pointer;
      background: var(--clay-bg-warm); border: 1px dashed var(--clay-border);
      border-radius: var(--clay-radius-sm); transition: all var(--clay-transition);
      font-family: inherit; color: var(--clay-text-muted);
    }
    .stages-empty:hover { border-color: var(--clay-primary); background: var(--clay-surface-hover); }
    .stages-empty > mat-icon { font-size: 26px; width: 26px; height: 26px; opacity: 0.6; margin-bottom: 4px; }
    .empty-title { font-size: 13px; font-weight: 600; color: var(--clay-text-secondary); }
    .empty-sub { font-size: 12px; max-width: 360px; line-height: 1.4; }

    /* Stage list / cards */
    .stage-list { display: flex; flex-direction: column; gap: 10px; }
    .stage-card {
      background: var(--clay-surface);
      border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius-sm);
      padding: 12px 14px;
      transition: border-color var(--clay-transition), box-shadow var(--clay-transition);
    }
    .stage-card:hover { border-color: var(--clay-primary-light); }

    .stage-card-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 10px;
    }
    .stage-num {
      width: 24px; height: 24px; border-radius: 50%;
      background: var(--clay-primary); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; flex-shrink: 0;
      font-family: 'Space Grotesk', sans-serif;
    }
    .head-controls { display: flex; align-items: center; gap: 2px; }
    .stage-grip {
      width: 30px; height: 30px; border: none; background: transparent;
      border-radius: var(--clay-radius-xs); cursor: grab;
      display: flex; align-items: center; justify-content: center;
      color: var(--clay-text-muted); transition: all 0.15s;
    }
    .stage-grip:hover { background: var(--clay-bg-warm); color: var(--clay-text); }
    .stage-grip:active { cursor: grabbing; }
    .stage-grip mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .head-controls .icon-btn:not(.icon-btn-danger):hover:not(:disabled) {
      background: var(--clay-surface-hover); color: var(--clay-text);
    }
    .icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .icon-btn:disabled:hover { background: transparent; color: var(--clay-text-muted); }

    .stage-fields { display: flex; gap: 12px; align-items: flex-start; }
    .stage-name-field { flex: 1 1 auto; }
    .stage-time-field { flex: 0 0 128px; }

    .warn-hint {
      display: flex; align-items: center; gap: 6px;
      margin: 0 0 4px; font-size: 12px; color: var(--warning);
    }

    .desc-field { margin-top: 2px; }

    .btn-text {
      display: inline-flex; align-items: center; gap: 4px;
      background: transparent; border: none; cursor: pointer;
      color: var(--clay-primary); font-family: inherit;
      font-size: 12px; font-weight: 600; padding: 2px 0;
    }
    .btn-text:hover { text-decoration: underline; }
    .btn-text mat-icon { font-size: 15px; width: 15px; height: 15px; }

    .add-stage-row {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; padding: 10px; cursor: pointer; font-family: inherit;
      background: transparent; color: var(--clay-text-secondary);
      border: 1px dashed var(--clay-border); border-radius: var(--clay-radius-sm);
      font-size: 13px; font-weight: 600; transition: all var(--clay-transition);
    }
    .add-stage-row:hover { border-color: var(--clay-primary); color: var(--clay-primary); background: var(--clay-surface-hover); }
    .add-stage-row mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* Drag feedback */
    .cdk-drag-placeholder { opacity: 0.25; }
    .cdk-drag-animating { transition: transform 250ms cubic-bezier(0, 0, 0.2, 1); }
    .stage-drag-preview {
      padding: 12px 14px; min-width: 240px;
      box-shadow: var(--clay-shadow-hover) !important;
      border: 1px solid var(--clay-primary) !important;
    }
    .stage-drag-preview .stage-card-head { margin-bottom: 0; gap: 10px; }
    .preview-name { font-size: 13px; font-weight: 600; color: var(--clay-text); }

    /* ===== Footer (pinned) ===== */
    .proc-footer {
      flex: 0 0 auto;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 14px 24px;
      border-top: 1px solid var(--clay-border);
      background: var(--clay-surface);
    }
    .footer-summary {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: var(--clay-text-muted);
    }
    .footer-summary mat-icon { font-size: 16px; width: 16px; height: 16px; opacity: 0.7; }
    .footer-summary strong { color: var(--clay-text-secondary); }
    .footer-summary .dot { opacity: 0.5; }
    .footer-summary .mono { font-family: 'Space Grotesk', monospace; font-weight: 600; color: var(--clay-text-secondary); }
    .footer-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

    /* ===== Responsive ===== */
    @media (max-width: 560px) {
      .form-row { flex-wrap: wrap; }
      .form-row > .full-width { flex: 1 1 100%; }
      .stage-fields { flex-wrap: wrap; }
      .stage-name-field, .stage-time-field { flex: 1 1 100%; }
      .footer-summary { display: none; }
    }
  `]
})
export class ProcessFormComponent implements OnInit {
  form: any = { name: '', productId: '', version: 1 };
  products: any[] = [];
  stages: StageDraft[] = [];
  saving = false;
  private _seq = 0;

  constructor(
    public dialogRef: MatDialogRef<ProcessFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private api: ApiService,
    private snackBar: MatSnackBar,
    private el: ElementRef<HTMLElement>,
  ) {
    if (data) {
      this.form = { name: data.name, productId: data.product?.id || data.productId, version: data.version || 1 };
    }
  }

  ngOnInit(): void {
    this.api.getList<any>('/products').subscribe(list => {
      this.products = list;
    });
  }

  get totalTargetSeconds(): number {
    return this.stages.reduce((sum, s) => sum + (Number(s.targetTimeSeconds) || 0), 0);
  }

  addStage(): void {
    this.stages.push({ _uid: ++this._seq, name: '', targetTimeSeconds: 600, description: '', showDescription: false });
    // Focus & scroll the new stage's name field into view once rendered.
    setTimeout(() => {
      const inputs = this.el.nativeElement.querySelectorAll<HTMLInputElement>('.stage-name-field input');
      const last = inputs[inputs.length - 1];
      last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      last?.focus();
    });
  }

  removeStage(index: number): void {
    this.stages.splice(index, 1);
  }

  moveStage(index: number, dir: -1 | 1): void {
    const target = index + dir;
    if (target < 0 || target >= this.stages.length) return;
    moveItemInArray(this.stages, index, target);
  }

  drop(event: CdkDragDrop<StageDraft[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.stages, event.previousIndex, event.currentIndex);
  }

  save(): void {
    this.saving = true;
    const body: any = { name: this.form.name.trim(), productId: this.form.productId };
    if (this.data) {
      body.version = this.form.version;
    } else {
      const validStages = this.stages
        .filter(s => s.name.trim())
        .map(s => {
          const stage: any = { name: s.name.trim(), targetTimeSeconds: Number(s.targetTimeSeconds) || 0 };
          if (s.description?.trim()) stage.description = s.description.trim();
          return stage;
        });
      if (validStages.length > 0) {
        body.stages = validStages;
      }
    }
    const obs = this.data
      ? this.api.patch(`/processes/${this.data.id}`, body)
      : this.api.post('/processes', body);
    obs.subscribe({
      next: () => {
        this.snackBar.open(`Process ${this.data ? 'updated' : 'created'}`, 'Close', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: (err: any) => {
        this.saving = false;
        const msg = err?.error?.message || 'Failed to save process';
        this.snackBar.open(msg, 'Close', { duration: 5000 });
      }
    });
  }
}
