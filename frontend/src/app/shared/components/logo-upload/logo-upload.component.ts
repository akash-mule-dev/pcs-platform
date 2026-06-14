import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

/**
 * Reusable, self-contained logo picker: click or drag-and-drop an image, see an
 * instant preview, change or remove it. It does NOT talk to the API — it emits
 * the chosen `File` (and shows a local preview) so the parent decides when to
 * upload (immediately on a settings page, or deferred until an org is created).
 */
@Component({
  selector: 'app-logo-upload',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="logo-upload">
      <div
        class="dropzone"
        [class.has-image]="displayUrl"
        [class.dragging]="dragging"
        [class.disabled]="disabled || busy"
        (click)="!disabled && !busy && pick()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
      >
        @if (displayUrl) {
          <img [src]="displayUrl" alt="Logo preview" class="preview" />
          @if (!disabled) {
            <div class="overlay">
              <button type="button" class="ov-btn" (click)="$event.stopPropagation(); pick()" [disabled]="busy">
                <mat-icon>photo_camera</mat-icon> Change
              </button>
              <button type="button" class="ov-btn danger" (click)="$event.stopPropagation(); clear()" [disabled]="busy">
                <mat-icon>delete</mat-icon> Remove
              </button>
            </div>
          }
        } @else {
          <div class="empty">
            <mat-icon class="big">add_photo_alternate</mat-icon>
            <div class="prompt">Click or drag an image to upload</div>
            <div class="hint">PNG, JPG, WebP or SVG · max 5 MB</div>
          </div>
        }

        @if (busy) {
          <div class="busy"><mat-icon class="spin">progress_activity</mat-icon></div>
        }
      </div>

      <input #fileInput type="file" class="hidden-input"
             [accept]="accept" (change)="onFileChange($event)" />

      @if (error) { <div class="err"><mat-icon>error_outline</mat-icon> {{ error }}</div> }
    </div>
  `,
  styles: [`
    .logo-upload { display: inline-flex; flex-direction: column; gap: 8px; }
    .dropzone {
      position: relative; width: 140px; height: 140px; border-radius: 14px;
      border: 2px dashed var(--clay-border, #cbd5e1); background: var(--clay-bg, #f8fafc);
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      overflow: hidden; transition: border-color .15s, background .15s, box-shadow .15s;
    }
    .dropzone:hover:not(.disabled) { border-color: var(--clay-primary, #2563eb); background: var(--clay-primary-soft, #eff6ff); }
    .dropzone.dragging { border-color: var(--clay-primary, #2563eb); background: var(--clay-primary-soft, #eff6ff); box-shadow: 0 0 0 4px rgba(37,99,235,.12); }
    .dropzone.has-image { border-style: solid; background: #fff; cursor: default; }
    .dropzone.disabled { cursor: default; opacity: .7; }
    .preview { width: 100%; height: 100%; object-fit: contain; padding: 8px; box-sizing: border-box; }
    .empty { text-align: center; color: var(--clay-text-muted, #64748b); padding: 8px; pointer-events: none; }
    .empty .big { font-size: 34px; width: 34px; height: 34px; color: var(--clay-primary, #2563eb); }
    .prompt { font-size: 12px; margin-top: 6px; font-weight: 500; color: var(--clay-text, #334155); }
    .hint { font-size: 10px; margin-top: 2px; }
    .overlay {
      position: absolute; inset: 0; display: flex; flex-direction: column; gap: 6px;
      align-items: center; justify-content: center; background: rgba(15,23,42,.55);
      opacity: 0; transition: opacity .15s;
    }
    .dropzone.has-image:hover .overlay { opacity: 1; }
    .ov-btn {
      display: inline-flex; align-items: center; gap: 4px; border: 0; cursor: pointer;
      background: #fff; color: #0f172a; font-size: 12px; font-weight: 600;
      padding: 5px 10px; border-radius: 7px;
    }
    .ov-btn:hover { background: #f1f5f9; }
    .ov-btn.danger { color: #b91c1c; }
    .ov-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ov-btn:disabled { opacity: .6; cursor: default; }
    .busy { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.6); }
    .hidden-input { display: none; }
    .err { display: flex; align-items: center; gap: 4px; color: #b91c1c; font-size: 12px; max-width: 220px; }
    .err mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .spin { animation: lu-spin 1s linear infinite; color: var(--clay-primary, #2563eb); }
    @keyframes lu-spin { to { transform: rotate(360deg); } }
  `],
})
export class LogoUploadComponent implements OnDestroy {
  /** Existing logo URL (e.g. an authed object URL fetched by the parent). */
  @Input() currentUrl: string | null = null;
  @Input() disabled = false;
  @Input() busy = false;

  @Output() selected = new EventEmitter<File>();
  @Output() cleared = new EventEmitter<void>();

  @ViewChild('fileInput') private fileInput!: ElementRef<HTMLInputElement>;

  private static readonly ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  private static readonly MAX_BYTES = 5 * 1024 * 1024;
  readonly accept = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml';

  /** Local preview for a freshly picked file (revoked on replace). */
  private localUrl: string | null = null;
  dragging = false;
  error = '';

  get displayUrl(): string | null { return this.localUrl ?? this.currentUrl; }

  pick(): void {
    this.fileInput?.nativeElement.click();
  }

  onFileChange(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (file) this.accept_(file);
  }

  onDragOver(ev: DragEvent): void {
    if (this.disabled || this.busy) return;
    ev.preventDefault();
    this.dragging = true;
  }

  onDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging = false;
  }

  onDrop(ev: DragEvent): void {
    if (this.disabled || this.busy) return;
    ev.preventDefault();
    this.dragging = false;
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.accept_(file);
  }

  private accept_(file: File): void {
    this.error = '';
    if (!LogoUploadComponent.ALLOWED.includes(file.type)) {
      this.error = 'Please choose a PNG, JPG, WebP or SVG image.';
      return;
    }
    if (file.size > LogoUploadComponent.MAX_BYTES) {
      this.error = 'Image is larger than 5 MB.';
      return;
    }
    this.setLocalPreview(file);
    this.selected.emit(file);
  }

  private setLocalPreview(file: File): void {
    if (this.localUrl) URL.revokeObjectURL(this.localUrl);
    this.localUrl = URL.createObjectURL(file);
  }

  clear(): void {
    this.error = '';
    if (this.localUrl) { URL.revokeObjectURL(this.localUrl); this.localUrl = null; }
    this.cleared.emit();
  }

  /** Called by the parent after a successful upload to drop the transient preview. */
  resetLocal(): void {
    if (this.localUrl) { URL.revokeObjectURL(this.localUrl); this.localUrl = null; }
  }

  ngOnDestroy(): void {
    if (this.localUrl) URL.revokeObjectURL(this.localUrl);
  }
}
