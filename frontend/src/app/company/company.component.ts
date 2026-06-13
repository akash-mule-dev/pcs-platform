import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Company, CompanyApiService, CompanyProfile } from './company.service';
import { PermissionsService } from '../core/services/permissions.service';

@Component({
  selector: 'app-company',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Company</h1>
          <p class="page-subtitle">Your organization's profile and contact details.</p>
        </div>
        @if (canManage && company && !editing) {
          <button mat-raised-button color="primary" (click)="startEdit()"><mat-icon>edit</mat-icon> Edit</button>
        }
      </div>

      @if (company) {
        <div class="panel">
          <div class="ident">
            <div class="logo">{{ initials(company.name) }}</div>
            <div>
              <div class="org-name">{{ company.name }}</div>
              <div class="org-slug"><code>{{ company.slug }}</code> · since {{ company.createdAt | date:'mediumDate' }}</div>
            </div>
          </div>

          @if (!editing) {
            <div class="grid">
              <div class="row"><span class="k">Description</span><span class="v">{{ company.description || '—' }}</span></div>
              <div class="row"><span class="k">Legal name</span><span class="v">{{ company.profile.legalName || '—' }}</span></div>
              <div class="row"><span class="k">Contact email</span><span class="v">{{ company.profile.contactEmail || '—' }}</span></div>
              <div class="row"><span class="k">Phone</span><span class="v">{{ company.profile.phone || '—' }}</span></div>
              <div class="row"><span class="k">Website</span><span class="v">{{ company.profile.website || '—' }}</span></div>
              <div class="row"><span class="k">Tax / Reg. ID</span><span class="v">{{ company.profile.taxId || '—' }}</span></div>
              <div class="row"><span class="k">Address</span><span class="v">{{ address() || '—' }}</span></div>
            </div>
          } @else {
            <div class="form">
              <div class="frow">
                <mat-form-field appearance="outline" class="grow"><mat-label>Company name</mat-label>
                  <input matInput [(ngModel)]="form.name"></mat-form-field>
                <mat-form-field appearance="outline" class="grow"><mat-label>Legal name</mat-label>
                  <input matInput [(ngModel)]="form.profile.legalName"></mat-form-field>
              </div>
              <mat-form-field appearance="outline" class="full"><mat-label>Description</mat-label>
                <textarea matInput rows="2" [(ngModel)]="form.description"></textarea></mat-form-field>
              <div class="frow">
                <mat-form-field appearance="outline" class="grow"><mat-label>Contact email</mat-label>
                  <input matInput type="email" [(ngModel)]="form.profile.contactEmail"></mat-form-field>
                <mat-form-field appearance="outline" class="grow"><mat-label>Phone</mat-label>
                  <input matInput [(ngModel)]="form.profile.phone"></mat-form-field>
                <mat-form-field appearance="outline" class="grow"><mat-label>Website</mat-label>
                  <input matInput [(ngModel)]="form.profile.website"></mat-form-field>
              </div>
              <div class="frow">
                <mat-form-field appearance="outline" class="grow"><mat-label>Address line 1</mat-label>
                  <input matInput [(ngModel)]="form.profile.addressLine1"></mat-form-field>
                <mat-form-field appearance="outline" class="grow"><mat-label>Address line 2</mat-label>
                  <input matInput [(ngModel)]="form.profile.addressLine2"></mat-form-field>
              </div>
              <div class="frow">
                <mat-form-field appearance="outline" class="grow"><mat-label>City</mat-label>
                  <input matInput [(ngModel)]="form.profile.city"></mat-form-field>
                <mat-form-field appearance="outline" class="grow"><mat-label>State / Province</mat-label>
                  <input matInput [(ngModel)]="form.profile.state"></mat-form-field>
                <mat-form-field appearance="outline" class="grow"><mat-label>Postal code</mat-label>
                  <input matInput [(ngModel)]="form.profile.postalCode"></mat-form-field>
                <mat-form-field appearance="outline" class="grow"><mat-label>Country</mat-label>
                  <input matInput [(ngModel)]="form.profile.country"></mat-form-field>
              </div>
              <div class="frow">
                <mat-form-field appearance="outline" class="grow"><mat-label>Tax / Registration ID</mat-label>
                  <input matInput [(ngModel)]="form.profile.taxId"></mat-form-field>
              </div>
              <div class="actions">
                <button mat-button (click)="cancel()">Cancel</button>
                <button mat-raised-button color="primary" [disabled]="!form.name || busy" (click)="save()">Save changes</button>
              </div>
            </div>
          }
        </div>
      } @else if (loaded) {
        <p class="empty">Company details are unavailable.</p>
      }
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; max-width: 920px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .page-title { margin: 0; font-size: 22px; }
    .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 20px; }
    .ident { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
    .logo { width: 52px; height: 52px; border-radius: 12px; background: var(--clay-primary-soft, #eff6ff); color: var(--clay-primary, #2563eb); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; }
    .org-name { font-size: 18px; font-weight: 600; }
    .org-slug { font-size: 12px; color: var(--clay-text-muted, #64748b); margin-top: 2px; }
    .grid { display: grid; gap: 2px; }
    .row { display: grid; grid-template-columns: 180px 1fr; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--clay-border, #f1f5f9); }
    .row:last-child { border-bottom: 0; }
    .k { color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .v { font-size: 14px; }
    .form { display: flex; flex-direction: column; }
    .frow { display: flex; gap: 12px; flex-wrap: wrap; } .grow { flex: 1; min-width: 200px; } .full { width: 100%; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    .empty { color: var(--clay-text-muted, #64748b); }
    code { background: var(--clay-bg, #f1f5f9); padding: 1px 6px; border-radius: 4px; }
  `],
})
export class CompanyComponent implements OnInit {
  company: Company | null = null;
  loaded = false;
  editing = false;
  busy = false;
  canManage = false;
  form: { name: string; description: string; profile: CompanyProfile } = { name: '', description: '', profile: {} };

  constructor(private api: CompanyApiService, private permissions: PermissionsService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.canManage = this.permissions.can('company.manage');
    this.api.get().subscribe({
      next: (c) => { this.company = c; this.loaded = true; },
      error: () => (this.loaded = true),
    });
  }

  initials(name: string): string {
    return (name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  }

  address(): string {
    const p = this.company?.profile ?? {};
    return [p.addressLine1, p.addressLine2, p.city, p.state, p.postalCode, p.country].filter(Boolean).join(', ');
  }

  startEdit(): void {
    if (!this.company) return;
    this.form = {
      name: this.company.name,
      description: this.company.description ?? '',
      profile: { ...(this.company.profile ?? {}) },
    };
    this.editing = true;
  }

  cancel(): void { this.editing = false; }

  save(): void {
    this.busy = true;
    this.api.update({ name: this.form.name, description: this.form.description, profile: this.form.profile }).subscribe({
      next: (c) => { this.busy = false; this.editing = false; this.company = c; this.snack.open('Company updated', 'OK', { duration: 2500 }); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Update failed', 'Dismiss', { duration: 5000 }); },
    });
  }
}
