import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatStepperModule } from '@angular/material/stepper';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ProjectsService, Project, CreateProject } from '../core/services/projects.service';

@Component({
  selector: 'app-project-wizard',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatStepperModule, MatProgressBarModule,
  ],
  template: `
    <h2 mat-dialog-title>New project</h2>
    <mat-dialog-content>
      <mat-stepper #stepper [linear]="false" animationDuration="0">
        <mat-step [completed]="form.valid">
          <ng-template matStepLabel>Details</ng-template>
          <form [formGroup]="form" class="form">
            <mat-form-field appearance="outline">
              <mat-label>Project name</mat-label>
              <input matInput formControlName="name" required>
            </mat-form-field>
            <div class="row">
              <mat-form-field appearance="outline">
                <mat-label>Job number</mat-label>
                <input matInput formControlName="projectNumber">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Client</mat-label>
                <input matInput formControlName="clientName">
              </mat-form-field>
            </div>
            <mat-form-field appearance="outline">
              <mat-label>Description</mat-label>
              <textarea matInput rows="2" formControlName="description"></textarea>
            </mat-form-field>
          </form>
          <div class="step-actions">
            <button mat-button (click)="cancel()">Cancel</button>
            <button mat-flat-button color="primary" [disabled]="form.invalid" (click)="stepper.next()">Next</button>
          </div>
        </mat-step>

        <mat-step>
          <ng-template matStepLabel>Upload model</ng-template>
          <div class="upload">
            <input #fileInput type="file" hidden accept=".ifc,.zip,.step,.stp,.iges,.igs,.glb,.gltf,.obj,.stl,.dae,.fbx,.3ds,.ply" (change)="onFile($event)">
            @if (!selectedFile) {
              <button mat-stroked-button color="primary" (click)="fileInput.click()">
                <mat-icon>upload_file</mat-icon>&nbsp;Choose model or package
              </button>
              <p class="hint">Supported: <strong>IFC</strong>, <strong>ZIP packages</strong> (model + PDF shop drawings — drawings auto-attach to piece marks), <strong>STEP/IGES</strong> and mesh formats (GLB, OBJ, STL). You can also skip and add files later.</p>
            } @else {
              <div class="file">
                <mat-icon>description</mat-icon>
                <span class="fname">{{ selectedFile.name }}</span>
                <button mat-icon-button (click)="selectedFile = null" [disabled]="importing"><mat-icon>close</mat-icon></button>
              </div>
            }
            @if (importing) {
              <mat-progress-bar mode="determinate" [value]="uploadProgress"></mat-progress-bar>
              <p class="hint">Uploading… {{ uploadProgress }}% — processing continues in the background once stored</p>
            }
            @if (error) { <p class="err">{{ error }}</p> }
          </div>
          <div class="step-actions">
            <button mat-button (click)="stepper.previous()" [disabled]="importing">Back</button>
            <button mat-button (click)="skipImport()" [disabled]="importing">Skip</button>
            <button mat-flat-button color="primary" [disabled]="importing || !selectedFile" (click)="createAndImport()">
              {{ importing ? 'Working…' : 'Create & build tree' }}
            </button>
          </div>
        </mat-step>
      </mat-stepper>
    </mat-dialog-content>
  `,
  styles: [`
    mat-dialog-content { min-width: 520px; max-width: 100%; }
    .form { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; }
    .form .row { display: flex; gap: 12px; }
    .form .row mat-form-field { flex: 1; }
    .form mat-form-field { width: 100%; }
    .step-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .upload { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; padding: 16px 0; }
    .hint { color: var(--clay-text-muted); font-size: .85rem; margin: 0; }
    .err { color: var(--error-text); font-size: .85rem; margin: 4px 0 0; }
    .file { display: flex; align-items: center; gap: 8px; background: var(--clay-surface-hover); color: var(--clay-text); border: 1px solid var(--clay-border); border-radius: 8px; padding: 6px 6px 6px 12px; }
    .fname { font-weight: 600; }
    mat-progress-bar { width: 100%; }
  `],
})
export class ProjectWizardComponent {
  private fb = inject(FormBuilder);
  private svc = inject(ProjectsService);
  private router = inject(Router);
  private dialogRef = inject(MatDialogRef<ProjectWizardComponent>);

  form = this.fb.group({
    name: ['', Validators.required],
    projectNumber: [''],
    clientName: [''],
    description: [''],
  });

  selectedFile: File | null = null;
  importing = false;
  uploadProgress = 0;
  created: Project | null = null;
  error: string | null = null;

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files && input.files.length ? input.files[0] : null;
  }

  private formValue(): CreateProject {
    const v = this.form.value;
    const dto: CreateProject = { name: (v.name ?? '').trim() };
    if (v.projectNumber) dto.projectNumber = v.projectNumber;
    if (v.clientName) dto.clientName = v.clientName;
    if (v.description) dto.description = v.description;
    return dto;
  }

  private async ensureCreated(): Promise<Project> {
    if (!this.created) this.created = await firstValueFrom(this.svc.create(this.formValue()));
    return this.created;
  }

  /** Create the project + upload a package, then jump to the live Package Monitor. */
  async createAndImport(): Promise<void> {
    this.error = null;
    if (!this.selectedFile) return; // guarded: the button is disabled without a file
    try {
      const project = await this.ensureCreated();
      this.importing = true;
      this.uploadProgress = 0;
      this.svc.importIfc(project.id, this.selectedFile).subscribe({
        next: (ev) => {
          if (ev.type === HttpEventType.UploadProgress && ev.total) {
            this.uploadProgress = Math.round((100 * ev.loaded) / ev.total);
          } else if (ev.type === HttpEventType.Response) {
            this.importing = false;
            // The package is stored and queued — take the user straight to the
            // Package Monitor so they see their upload live in the pipeline
            // (queue position, stage, %) alongside everything else processing.
            this.dialogRef.close({ ...(this.created as Project), navigated: true });
            this.router.navigate(['/package-monitor']);
          }
        },
        error: (e) => {
          this.importing = false;
          this.error = e?.error?.message || 'Upload failed — the file could not be stored.';
        },
      });
    } catch (e: any) {
      this.error = e?.error?.message || 'Could not create the project.';
    }
  }

  /** Create the project with no package, then return to the project list. */
  async skipImport(): Promise<void> {
    this.error = null;
    try {
      const project = await this.ensureCreated();
      this.dialogRef.close({ ...project, navigated: true });
      this.router.navigate(['/projects']);
    } catch (e: any) {
      this.error = e?.error?.message || 'Could not create the project.';
    }
  }

  cancel(): void {
    this.dialogRef.close(this.created ?? undefined);
  }
}
