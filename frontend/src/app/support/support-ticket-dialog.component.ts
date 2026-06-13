import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SupportApiService, SupportMeta } from './support.service';

/**
 * Reusable "Contact support" modal — opened from the global toolbar Help button
 * and from the Support page. Captures the current URL/app version as context so
 * platform staff can see where the issue happened.
 */
@Component({
  selector: 'app-support-ticket-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule],
  template: `
    <div class="dialog-shell">
      <div class="dialog-header has-icon">
        <div class="header-icon tone-blue"><mat-icon>support_agent</mat-icon></div>
        <div class="header-text">
          <h2>Contact support</h2>
          <p class="dialog-subtitle">Tell us what's happening and we'll get back to you.</p>
        </div>
      </div>

      <div class="dialog-body">
        <form #f="ngForm">
          <mat-form-field appearance="outline" class="full">
            <mat-label>Subject</mat-label>
            <input matInput [(ngModel)]="form.subject" name="subject" required maxlength="200" #subject="ngModel"
                   placeholder="Short summary of the issue">
            @if (subject.invalid && submitted) { <mat-error>Subject is required</mat-error> }
          </mat-form-field>

          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Category</mat-label>
              <mat-select [(ngModel)]="form.category" name="category">
                @for (c of meta?.categories || []; track c.value) { <mat-option [value]="c.value">{{ c.label }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Priority</mat-label>
              <mat-select [(ngModel)]="form.priority" name="priority">
                @for (p of meta?.priorities || []; track p.value) { <mat-option [value]="p.value">{{ p.label }}</mat-option> }
              </mat-select>
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="full">
            <mat-label>Description</mat-label>
            <textarea matInput [(ngModel)]="form.description" name="description" required rows="6" #description="ngModel"
                      placeholder="What did you expect, and what happened? Steps to reproduce help us a lot."></textarea>
            @if (description.invalid && submitted) { <mat-error>Please describe the issue</mat-error> }
          </mat-form-field>
          <p class="ctx">This page ({{ contextUrl }}) is attached automatically.</p>
        </form>
      </div>

      <div class="dialog-footer">
        <button type="button" class="btn-ghost" (click)="ref.close()">Cancel</button>
        <button type="button" class="btn-primary" [disabled]="busy" (click)="submit()">Send ticket</button>
      </div>
    </div>
  `,
  styles: [`
    .dialog-shell { min-width: min(560px, 92vw); }
    form { display: flex; flex-direction: column; }
    .full { width: 100%; }
    .row { display: flex; gap: 12px; } .row mat-form-field { flex: 1; }
    .ctx { margin: 2px 0 0; font-size: 12px; color: var(--clay-text-muted, #64748b); }
  `],
})
export class SupportTicketDialogComponent implements OnInit {
  @ViewChild('f') f!: NgForm;
  meta: SupportMeta | null = null;
  submitted = false;
  busy = false;
  contextUrl = '';
  form = { subject: '', description: '', category: 'question', priority: 'normal' };

  constructor(
    public ref: MatDialogRef<SupportTicketDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { contextUrl?: string } | null,
    private api: SupportApiService,
    private snack: MatSnackBar,
  ) {
    this.contextUrl = data?.contextUrl || (typeof window !== 'undefined' ? window.location.pathname : '');
  }

  ngOnInit(): void {
    this.api.meta().subscribe({ next: (m) => (this.meta = m), error: () => {} });
  }

  submit(): void {
    this.submitted = true;
    if (!this.form.subject || !this.form.description) return;
    this.busy = true;
    this.api.create({
      subject: this.form.subject, description: this.form.description,
      category: this.form.category, priority: this.form.priority, contextUrl: this.contextUrl,
    }).subscribe({
      next: (t) => { this.busy = false; this.snack.open(`Ticket ${t.number} created — we'll be in touch`, 'OK', { duration: 4000 }); this.ref.close(t); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Could not create ticket', 'Dismiss', { duration: 5000 }); },
    });
  }
}
