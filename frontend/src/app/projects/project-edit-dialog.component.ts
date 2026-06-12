import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ProjectsService, Project, CreateProject } from '../core/services/projects.service';

export interface ProjectEditData {
  project: Project;
}

/**
 * Edit an existing project's details — including attaching/changing the
 * fabrication Process (stage routing). Opened as a Material dialog from the
 * project detail page; resolves to the updated Project (or undefined on cancel).
 */
@Component({
  selector: 'app-project-edit-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatDialogModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>Edit project</h2>
    <mat-dialog-content>
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
          <mat-hint>The routing new work orders follow. Changing it doesn't alter work orders already generated.</mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <textarea matInput rows="2" formControlName="description"></textarea>
        </mat-form-field>
        @if (error) { <p class="err">{{ error }}</p> }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()" [disabled]="saving">Cancel</button>
      <button mat-flat-button color="primary" [disabled]="form.invalid || saving" (click)="save()">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width: 520px; max-width: 100%; }
    .form { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; }
    .form .row { display: flex; gap: 12px; }
    .form .row mat-form-field { flex: 1; }
    .form mat-form-field { width: 100%; }
    .err { color: #b91c1c; font-size: .85rem; margin: 4px 0 0; }
  `],
})
export class ProjectEditDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private svc = inject(ProjectsService);
  private dialogRef = inject(MatDialogRef<ProjectEditDialogComponent>);
  private data = inject<ProjectEditData>(MAT_DIALOG_DATA);

  processes: { id: string; name: string }[] = [];
  saving = false;
  error: string | null = null;

  form = this.fb.group({
    name: ['', Validators.required],
    projectNumber: [''],
    clientName: [''],
    processId: [''],
    description: [''],
  });

  ngOnInit(): void {
    const p = this.data.project;
    this.form.patchValue({
      name: p.name,
      projectNumber: p.projectNumber ?? '',
      clientName: p.clientName ?? '',
      processId: p.processId ?? '',
      description: p.description ?? '',
    });
    this.svc.listProcesses().subscribe({ next: (ps) => (this.processes = ps), error: () => {} });
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving) return;
    this.saving = true;
    this.error = null;
    const v = this.form.value;
    // Empty optional fields are sent as null so they're cleared on the server
    // (the API treats null as "unset"; '' would fail UUID/date validation).
    const dto: Partial<CreateProject> = {
      name: (v.name ?? '').trim(),
      projectNumber: v.projectNumber?.trim() || null,
      clientName: v.clientName?.trim() || null,
      processId: v.processId || null,
      description: v.description?.trim() || null,
    };
    try {
      const updated = await firstValueFrom(this.svc.update(this.data.project.id, dto));
      this.dialogRef.close(updated);
    } catch (e: any) {
      this.saving = false;
      this.error = e?.error?.message || 'Could not save the project.';
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
