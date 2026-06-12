import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatStepper, MatStepperModule } from '@angular/material/stepper';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ProjectsService, Project, CreateProject, ImportResult } from '../core/services/projects.service';

@Component({
  selector: 'app-project-wizard',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatStepperModule, MatProgressBarModule,
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
              <mat-label>Process (stage routing)</mat-label>
              <mat-select formControlName="processId">
                <mat-option [value]="''">— none —</mat-option>
                @for (p of processes; track p.id) { <mat-option [value]="p.id">{{ p.name }}</mat-option> }
              </mat-select>
            </mat-form-field>
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
            <input #fileInput type="file" hidden accept=".ifc" (change)="onFile($event)">
            @if (!selectedFile) {
              <button mat-stroked-button color="primary" (click)="fileInput.click()">
                <mat-icon>upload_file</mat-icon>&nbsp;Choose IFC file
              </button>
              <p class="hint">Upload an IFC (.ifc) export from Tekla, Revit or Advance Steel — we'll extract its assemblies, subassemblies and parts into the project tree. You can also skip and add it later.</p>
            } @else {
              <div class="file">
                <mat-icon>description</mat-icon>
                <span class="fname">{{ selectedFile.name }}</span>
                <button mat-icon-button (click)="selectedFile = null" [disabled]="importing"><mat-icon>close</mat-icon></button>
              </div>
            }
            @if (importing) {
              <mat-progress-bar [mode]="uploadProgress < 100 ? 'determinate' : 'indeterminate'" [value]="uploadProgress"></mat-progress-bar>
              <p class="hint">{{ uploadProgress < 100 ? 'Uploading ' + uploadProgress + '%' : 'Extracting assembly structure…' }}</p>
            }
            @if (error) { <p class="err">{{ error }}</p> }
          </div>
          <div class="step-actions">
            <button mat-button (click)="stepper.previous()" [disabled]="importing">Back</button>
            <button mat-button (click)="skipImport()" [disabled]="importing">Skip</button>
            <button mat-flat-button color="primary" [disabled]="importing || !selectedFile" (click)="createAndImport(stepper)">
              {{ importing ? 'Working…' : 'Create & build tree' }}
            </button>
          </div>
        </mat-step>

        <mat-step>
          <ng-template matStepLabel>Review</ng-template>
          <div class="review">
            <mat-icon class="ok">check_circle</mat-icon>
            <h3>{{ created?.name }}</h3>
            @if (result) {
              <p>Imported <strong>{{ result.nodeCount }}</strong> nodes from the IFC.</p>
              <div class="counts">
                @for (c of countEntries(); track c.key) {
                  <span class="chip">{{ c.key }}: {{ c.value }}</span>
                }
              </div>
            } @else {
              <p>Project created. You can import an IFC from the project page anytime.</p>
            }
          </div>
          <div class="step-actions">
            <button mat-flat-button color="primary" (click)="finish()">Open project</button>
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
    .hint { color: #6b7280; font-size: .85rem; margin: 0; }
    .err { color: #b91c1c; font-size: .85rem; margin: 4px 0 0; }
    .file { display: flex; align-items: center; gap: 8px; background: #f3f4f6; border-radius: 8px; padding: 6px 6px 6px 12px; }
    .fname { font-weight: 600; }
    mat-progress-bar { width: 100%; }
    .review { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 0; text-align: center; }
    .review .ok { color: #059669; font-size: 44px; height: 44px; width: 44px; }
    .review h3 { margin: 0; }
    .counts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 8px; }
    .chip { padding: 3px 10px; border-radius: 999px; background: #eef2ff; color: #4338ca; font-size: .8rem; font-weight: 600; text-transform: capitalize; }
  `],
})
export class ProjectWizardComponent implements OnInit {
  private fb = inject(FormBuilder);
  private svc = inject(ProjectsService);
  private dialogRef = inject(MatDialogRef<ProjectWizardComponent>);

  form = this.fb.group({
    name: ['', Validators.required],
    projectNumber: [''],
    clientName: [''],
    description: [''],
    processId: [''],
  });

  processes: { id: string; name: string }[] = [];

  ngOnInit(): void {
    this.svc.listProcesses().subscribe({ next: (p) => (this.processes = p), error: () => {} });
  }

  selectedFile: File | null = null;
  importing = false;
  uploadProgress = 0;
  created: Project | null = null;
  result: ImportResult | null = null;
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
    if (v.processId) dto.processId = v.processId;
    return dto;
  }

  private async ensureCreated(): Promise<Project> {
    if (!this.created) this.created = await firstValueFrom(this.svc.create(this.formValue()));
    return this.created;
  }

  async createAndImport(stepper: MatStepper): Promise<void> {
    this.error = null;
    try {
      const project = await this.ensureCreated();
      if (!this.selectedFile) { stepper.next(); return; }
      this.importing = true;
      this.uploadProgress = 0;
      this.svc.importIfc(project.id, this.selectedFile).subscribe({
        next: (ev) => {
          if (ev.type === HttpEventType.UploadProgress && ev.total) {
            this.uploadProgress = Math.round((100 * ev.loaded) / ev.total);
          } else if (ev.type === HttpEventType.Response) {
            this.result = ev.body;
            this.importing = false;
            stepper.next();
          }
        },
        error: (e) => {
          this.importing = false;
          this.error = e?.error?.message || 'Import failed — the file may not be a valid IFC.';
        },
      });
    } catch (e: any) {
      this.error = e?.error?.message || 'Could not create the project.';
    }
  }

  async skipImport(): Promise<void> {
    this.error = null;
    try {
      await this.ensureCreated();
      this.finish();
    } catch (e: any) {
      this.error = e?.error?.message || 'Could not create the project.';
    }
  }

  countEntries(): { key: string; value: number }[] {
    return this.result ? Object.entries(this.result.counts).map(([key, value]) => ({ key, value })) : [];
  }

  finish(): void {
    this.dialogRef.close(this.created ?? undefined);
  }

  cancel(): void {
    this.dialogRef.close(this.created ?? undefined);
  }
}
