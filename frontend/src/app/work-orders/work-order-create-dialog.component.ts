import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectsService, Project, ProductionOrder, CreateOrder } from '../core/services/projects.service';

export interface WorkOrderCreateData {
  /** Pre-select a project (e.g. when launched from a project's Work Orders tab). */
  projectId?: string | null;
}

/**
 * Create a work order (production run) from anywhere — the single, centralised
 * creation flow used by the Work Orders dashboard. Unlike the old in-project
 * form it carries its own PROJECT picker, so an order can be raised without
 * first drilling into a project; launching it from a project simply pre-selects
 * that project. Resolves to the created ProductionOrder (or undefined on cancel).
 */
@Component({
  selector: 'app-work-order-create-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, RouterModule, MatDialogModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>New work order</h2>
    <mat-dialog-content>
      <p class="lead">Each work order is one production run (e.g. for a customer) — its own process &amp; quantity, tracked independently. Releasing it generates the per-assembly work and its stage trail.</p>

      @if (loadingProjects) {
        <div class="center"><mat-spinner diameter="28"></mat-spinner></div>
      } @else if (projects.length === 0) {
        <div class="no-projects">
          <mat-icon>folder_off</mat-icon>
          <p>You need a project first — a work order is a production run of a project's design.</p>
          <a mat-stroked-button routerLink="/projects" (click)="cancel()">Go to projects</a>
        </div>
      } @else {
        <form [formGroup]="form" class="form">
          <mat-form-field appearance="outline">
            <mat-label>Project</mat-label>
            <mat-select formControlName="projectId">
              @for (p of projects; track p.id) {
                <mat-option [value]="p.id">{{ p.name }}{{ p.projectNumber ? ' · ' + p.projectNumber : '' }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Customer</mat-label>
              <input matInput formControlName="customerName" placeholder="Optional">
            </mat-form-field>
            <mat-form-field appearance="outline" class="qty">
              <mat-label>Quantity</mat-label>
              <input matInput type="number" min="1" formControlName="quantity">
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline">
            <mat-label>Process</mat-label>
            <mat-select formControlName="processId">
              @for (p of processes; track p.id) { <mat-option [value]="p.id">{{ p.name }}</mat-option> }
            </mat-select>
          </mat-form-field>

          @if (!form.controls.processId.value) {
            <button type="button" class="std" [disabled]="busy" (click)="useStandard()">
              <mat-icon>auto_awesome</mat-icon>Use standard process (Cut → Fit → Weld → QC → Paint)
            </button>
          }

          @if (error) { <p class="err">{{ error }}</p> }
        </form>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()" [disabled]="creating">Cancel</button>
      <button mat-flat-button color="primary" [disabled]="form.invalid || creating || projects.length === 0" (click)="create()">
        {{ creating ? 'Creating…' : 'Create & release' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width: 520px; max-width: 100%; }
    .lead { color: var(--clay-text-secondary); font-size: 13px; margin: 4px 0 14px; line-height: 1.5; }
    .center { display: flex; justify-content: center; padding: 28px 0; }
    .form { display: flex; flex-direction: column; gap: 4px; }
    .form .row { display: flex; gap: 12px; }
    .form .row mat-form-field { flex: 1; }
    .form .row .qty { max-width: 130px; }
    .form mat-form-field { width: 100%; }
    .std { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; background: transparent; color: var(--clay-primary); border: 1px dashed var(--clay-primary); border-radius: var(--clay-radius-sm, 8px); padding: 7px 12px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; margin: 2px 0 4px; }
    .std mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .std:disabled { opacity: .5; cursor: default; }
    .no-projects { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 20px 0 8px; text-align: center; color: var(--clay-text-muted); }
    .no-projects mat-icon { font-size: 36px; width: 36px; height: 36px; opacity: .5; }
    .no-projects p { margin: 0; font-size: 13px; max-width: 340px; }
    .err { color: #b91c1c; font-size: .85rem; margin: 4px 0 0; }
  `],
})
export class WorkOrderCreateDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private svc = inject(ProjectsService);
  private dialogRef = inject(MatDialogRef<WorkOrderCreateDialogComponent>);
  private data = inject<WorkOrderCreateData>(MAT_DIALOG_DATA);

  projects: Project[] = [];
  processes: { id: string; name: string }[] = [];
  loadingProjects = true;
  creating = false;
  busy = false;
  error: string | null = null;

  form = this.fb.group({
    projectId: ['', Validators.required],
    customerName: [''],
    quantity: [1, [Validators.required, Validators.min(1)]],
    processId: ['', Validators.required],
  });

  ngOnInit(): void {
    const preselect = this.data?.projectId ?? null;
    this.svc.list().subscribe({
      next: (p) => {
        this.projects = [...p].sort((a, b) => a.name.localeCompare(b.name));
        this.loadingProjects = false;
        if (preselect && this.projects.some((x) => x.id === preselect)) {
          this.form.patchValue({ projectId: preselect });
        }
      },
      error: (e) => { this.loadingProjects = false; this.error = e?.error?.message || 'Could not load projects.'; },
    });
    this.svc.listProcesses().subscribe({ next: (p) => (this.processes = p), error: () => {} });
  }

  /** One click: get-or-create the org's Standard Fabrication process and select it. */
  useStandard(): void {
    this.busy = true; this.error = null;
    this.svc.ensureStandardProcess().subscribe({
      next: (p) => {
        this.busy = false;
        if (!this.processes.some((x) => x.id === p.id)) this.processes = [...this.processes, { id: p.id, name: p.name }];
        this.form.patchValue({ processId: p.id });
      },
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not create the standard process.'; },
    });
  }

  async create(): Promise<void> {
    if (this.form.invalid || this.creating) return;
    this.creating = true; this.error = null;
    const v = this.form.value;
    const body: CreateOrder = {
      processId: v.processId!,
      customerName: v.customerName?.trim() || undefined,
      quantity: Math.max(1, Number(v.quantity) || 1),
    };
    try {
      const order = await firstValueFrom(this.svc.createOrder(v.projectId!, body));
      this.dialogRef.close(order);
    } catch (e: any) {
      this.creating = false;
      this.error = e?.error?.message || 'Could not create the work order.';
    }
  }

  cancel(): void { this.dialogRef.close(); }
}
