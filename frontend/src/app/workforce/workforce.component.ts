import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { WorkforceApiService } from './workforce.service';

@Component({
  selector: 'app-workforce',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <div class="page-shell">
      <div class="page-header"><div>
        <h1 class="page-title">Workforce</h1>
        <p class="page-subtitle">Skills, certifications and shifts</p>
      </div></div>

      <div class="panel">
        <h3>Certify an employee</h3>
        <div class="form-row">
          <mat-form-field appearance="outline" class="grow"><mat-label>Employee</mat-label>
            <mat-select [(ngModel)]="assign.userId" (selectionChange)="loadUserSkills()">
              @for (u of users; track u.id) { <mat-option [value]="u.id">{{ u.firstName }} {{ u.lastName }}</mat-option> }
            </mat-select></mat-form-field>
          <mat-form-field appearance="outline" class="grow"><mat-label>Skill</mat-label>
            <mat-select [(ngModel)]="assign.skillId">
              @for (s of skills; track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
            </mat-select></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Level</mat-label><input matInput [(ngModel)]="assign.level" placeholder="certified"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Expires</mat-label><input matInput type="date" [(ngModel)]="assign.expiresAt"></mat-form-field>
          <button mat-raised-button color="primary" [disabled]="!assign.userId || !assign.skillId" (click)="doAssign()">Certify</button>
        </div>
        @if (userSkills.length) {
          <div class="chips">@for (es of userSkills; track es.id) {
            <span class="chip" [class.expired]="isExpired(es)">{{ es.skill?.name }}@if (es.expiresAt) { · exp {{ es.expiresAt | date:'mediumDate' }} }</span>
          }</div>
        }
      </div>

      <div class="grid2">
        <div class="panel">
          <h3>Skills <button mat-button color="primary" (click)="showSkill=!showSkill"><mat-icon>add</mat-icon></button></h3>
          @if (showSkill) {
            <div class="form-row">
              <mat-form-field appearance="outline"><mat-label>Code</mat-label><input matInput [(ngModel)]="newSkill.code"></mat-form-field>
              <mat-form-field appearance="outline" class="grow"><mat-label>Name</mat-label><input matInput [(ngModel)]="newSkill.name"></mat-form-field>
              <button mat-raised-button color="primary" [disabled]="!newSkill.code||!newSkill.name" (click)="saveSkill()">Add</button>
            </div>
          }
          @for (s of skills; track s.id) { <div class="li">{{ s.code }} — {{ s.name }}</div> }
          @if (!skills.length) { <p class="empty">No skills defined.</p> }
        </div>

        <div class="panel">
          <h3>Shifts <button mat-button color="primary" (click)="showShift=!showShift"><mat-icon>add</mat-icon></button></h3>
          @if (showShift) {
            <div class="form-row">
              <mat-form-field appearance="outline" class="grow"><mat-label>Name</mat-label><input matInput [(ngModel)]="newShift.name"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Start</mat-label><input matInput [(ngModel)]="newShift.startTime" placeholder="06:00"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>End</mat-label><input matInput [(ngModel)]="newShift.endTime" placeholder="14:00"></mat-form-field>
              <button mat-raised-button color="primary" [disabled]="!newShift.name" (click)="saveShift()">Add</button>
            </div>
          }
          @for (s of shifts; track s.id) { <div class="li">{{ s.name }} ({{ s.startTime }}–{{ s.endTime }})</div> }
          @if (!shifts.length) { <p class="empty">No shifts defined.</p> }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-shell { padding:24px; } .page-header { margin-bottom:16px; } .page-title { margin:0; font-size:22px; }
    .page-subtitle { margin:2px 0 0; color: var(--clay-text-muted,#64748b); font-size:13px; }
    .panel { background: var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:16px; margin-bottom:16px; }
    .panel h3 { margin:0 0 12px; font-size:15px; } .form-row { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
    .form-row mat-form-field { min-width:130px; } .grow { flex:1; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; } @media (max-width:800px){ .grid2 { grid-template-columns:1fr; } }
    .li { padding:6px 0; border-top:1px solid var(--clay-border,#eee); }
    .chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; } .chip { background:#dbeafe; padding:3px 10px; border-radius:12px; font-size:12px; } .chip.expired { background:#fca5a5; }
    .empty { color: var(--clay-text-muted,#64748b); padding:8px 0; }
  `],
})
export class WorkforceComponent implements OnInit {
  skills: any[] = [];
  shifts: any[] = [];
  users: any[] = [];
  userSkills: any[] = [];
  assign: any = { userId: '', skillId: '', level: 'certified', expiresAt: '' };
  newSkill: any = { code: '', name: '' };
  newShift: any = { name: '', startTime: '', endTime: '' };
  showSkill = false;
  showShift = false;

  constructor(private api: WorkforceApiService, private snack: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  private arr(d: any): any[] { return Array.isArray(d) ? d : (d?.data || []); }

  load(): void {
    forkJoin({ skills: this.api.listSkills(), shifts: this.api.listShifts(), users: this.api.listUsers() }).subscribe({
      next: ({ skills, shifts, users }) => { this.skills = this.arr(skills); this.shifts = this.arr(shifts); this.users = this.arr(users); },
      error: () => {},
    });
  }

  isExpired(es: any): boolean { return es.expiresAt && new Date(es.expiresAt).getTime() < Date.now(); }

  loadUserSkills(): void {
    if (!this.assign.userId) return;
    this.api.userSkills(this.assign.userId).subscribe({ next: (d) => this.userSkills = this.arr(d), error: () => this.userSkills = [] });
  }

  doAssign(): void {
    this.api.assignSkill(this.assign).subscribe({
      next: () => { this.snack.open('Certification recorded', 'OK', { duration: 2000 }); this.loadUserSkills(); },
      error: (e) => this.snack.open(e?.error?.message || 'Failed', 'Dismiss', { duration: 4000 }),
    });
  }

  saveSkill(): void {
    this.api.createSkill(this.newSkill).subscribe({
      next: () => { this.snack.open('Skill added', 'OK', { duration: 2000 }); this.showSkill = false; this.newSkill = { code: '', name: '' }; this.load(); },
      error: (e) => this.snack.open(e?.error?.message || 'Failed', 'Dismiss', { duration: 4000 }),
    });
  }

  saveShift(): void {
    this.api.createShift(this.newShift).subscribe({
      next: () => { this.snack.open('Shift added', 'OK', { duration: 2000 }); this.showShift = false; this.newShift = { name: '', startTime: '', endTime: '' }; this.load(); },
      error: (e) => this.snack.open(e?.error?.message || 'Failed', 'Dismiss', { duration: 4000 }),
    });
  }
}
