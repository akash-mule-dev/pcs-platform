import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NcrApiService } from './ncr.service';

const STATUSES = ['open', 'investigation', 'disposition', 'closed', 'cancelled'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const DISPOSITIONS = ['rework', 'scrap', 'use_as_is', 'return_to_supplier', 'regrade'];
const CAPA_TYPES = ['corrective', 'preventive'];
const CAPA_STATUSES = ['open', 'in_progress', 'verified', 'closed'];

@Component({
  selector: 'app-ncr',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Non-Conformance (NCR / CAPA)</h1>
          <p class="page-subtitle">Raise, investigate, disposition and drive corrective actions</p>
        </div>
        <button mat-raised-button color="primary" (click)="showAdd = !showAdd">
          <mat-icon>add</mat-icon> New NCR
        </button>
      </div>

      @if (showAdd) {
        <div class="panel">
          <h3>Raise an NCR</h3>
          <div class="form-row">
            <mat-form-field appearance="outline" class="grow"><mat-label>Title</mat-label>
              <input matInput [(ngModel)]="newNcr.title"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Severity</mat-label>
              <mat-select [(ngModel)]="newNcr.severity">
                @for (s of severities; track s) { <mat-option [value]="s">{{ s }}</mat-option> }
              </mat-select></mat-form-field>
          </div>
          <mat-form-field appearance="outline" class="full"><mat-label>Description</mat-label>
            <textarea matInput rows="2" [(ngModel)]="newNcr.description"></textarea></mat-form-field>
          <div class="panel-actions">
            <button mat-button (click)="showAdd = false">Cancel</button>
            <button mat-raised-button color="primary" [disabled]="!newNcr.title" (click)="saveNcr()">Raise</button>
          </div>
        </div>
      }

      @if (loading) {
        <div class="center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        <table mat-table [dataSource]="ncrs" class="mat-elevation-z1 full">
          <ng-container matColumnDef="number"><th mat-header-cell *matHeaderCellDef>Number</th>
            <td mat-cell *matCellDef="let n">{{ n.number }}</td></ng-container>
          <ng-container matColumnDef="title"><th mat-header-cell *matHeaderCellDef>Title</th>
            <td mat-cell *matCellDef="let n">{{ n.title }}</td></ng-container>
          <ng-container matColumnDef="severity"><th mat-header-cell *matHeaderCellDef>Severity</th>
            <td mat-cell *matCellDef="let n"><span class="chip sev-{{n.severity}}">{{ n.severity }}</span></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let n">{{ n.status }}</td></ng-container>
          <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let n"><button mat-button color="primary" (click)="openDetail(n)">Open</button></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
        @if (ncrs.length === 0) { <p class="empty">No NCRs raised yet.</p> }
      }

      @if (selected) {
        <div class="panel detail">
          <div class="detail-head">
            <h3>{{ selected.number }} — {{ selected.title }}</h3>
            <button mat-icon-button (click)="selected = null"><mat-icon>close</mat-icon></button>
          </div>
          <div class="form-row">
            <mat-form-field appearance="outline"><mat-label>Status</mat-label>
              <mat-select [(ngModel)]="edit.status">
                @for (s of statuses; track s) { <mat-option [value]="s">{{ s }}</mat-option> }
              </mat-select></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Disposition</mat-label>
              <mat-select [(ngModel)]="edit.disposition">
                @for (d of dispositions; track d) { <mat-option [value]="d">{{ d }}</mat-option> }
              </mat-select></mat-form-field>
            <mat-form-field appearance="outline" class="grow"><mat-label>Disposition note</mat-label>
              <input matInput [(ngModel)]="edit.dispositionNote"></mat-form-field>
            <button mat-raised-button color="primary" (click)="saveDetail()">Save</button>
          </div>

          <h4>Corrective / Preventive Actions
            <button mat-button color="primary" (click)="showAddCapa = !showAddCapa"><mat-icon>add</mat-icon> Add</button>
          </h4>
          @if (showAddCapa) {
            <div class="form-row">
              <mat-form-field appearance="outline" class="grow"><mat-label>Title</mat-label>
                <input matInput [(ngModel)]="newCapa.title"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Type</mat-label>
                <mat-select [(ngModel)]="newCapa.type">
                  @for (t of capaTypes; track t) { <mat-option [value]="t">{{ t }}</mat-option> }
                </mat-select></mat-form-field>
              <button mat-raised-button color="primary" [disabled]="!newCapa.title" (click)="saveCapa()">Add</button>
            </div>
          }
          @for (c of capas; track c.id) {
            <div class="capa-row">
              <span class="grow">{{ c.title }} <em>({{ c.type }})</em></span>
              <mat-form-field appearance="outline" class="status-sel">
                <mat-select [(ngModel)]="c.status" (selectionChange)="updateCapaStatus(c)">
                  @for (s of capaStatuses; track s) { <mat-option [value]="s">{{ s }}</mat-option> }
                </mat-select></mat-form-field>
            </div>
          }
          @if (capas.length === 0) { <p class="empty">No actions yet.</p> }
        </div>
      }
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .page-title { margin: 0; font-size: 22px; }
    .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .panel h3 { margin: 0 0 12px; font-size: 15px; }
    .detail-head { display: flex; justify-content: space-between; align-items: center; }
    .form-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .form-row mat-form-field { min-width: 150px; }
    .grow { flex: 1; }
    .full { width: 100%; }
    .panel-actions { display: flex; justify-content: flex-end; gap: 8px; }
    table.full { width: 100%; }
    .chip { padding: 2px 8px; border-radius: 10px; font-size: 12px; text-transform: capitalize; }
    .sev-low { background: #e2e8f0; } .sev-medium { background: #fde68a; } .sev-high { background: #fdba74; } .sev-critical { background: #fca5a5; }
    .capa-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; border-top: 1px solid var(--clay-border, #eee); }
    .status-sel { width: 150px; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; color: var(--clay-text-muted, #64748b); padding: 16px; }
  `],
})
export class NcrComponent implements OnInit {
  readonly statuses = STATUSES;
  readonly severities = SEVERITIES;
  readonly dispositions = DISPOSITIONS;
  readonly capaTypes = CAPA_TYPES;
  readonly capaStatuses = CAPA_STATUSES;
  columns = ['number', 'title', 'severity', 'status', 'actions'];

  loading = true;
  ncrs: any[] = [];
  showAdd = false;
  newNcr: any = { title: '', description: '', severity: 'medium' };

  selected: any = null;
  edit: any = { status: 'open', disposition: null, dispositionNote: '' };
  capas: any[] = [];
  showAddCapa = false;
  newCapa: any = { title: '', type: 'corrective' };

  constructor(private api: NcrApiService, private snack: MatSnackBar) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.api.listNcr().subscribe({
      next: (data) => { this.ncrs = Array.isArray(data) ? data : (data?.data || []); this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  saveNcr(): void {
    this.api.createNcr(this.newNcr).subscribe({
      next: () => {
        this.snack.open('NCR raised', 'OK', { duration: 2500 });
        this.showAdd = false; this.newNcr = { title: '', description: '', severity: 'medium' }; this.load();
      },
      error: (e) => this.snack.open(e?.error?.message || 'Failed to raise NCR', 'Dismiss', { duration: 4000 }),
    });
  }

  openDetail(n: any): void {
    this.selected = n;
    this.edit = { status: n.status, disposition: n.disposition || null, dispositionNote: n.dispositionNote || '' };
    this.showAddCapa = false;
    this.loadCapas();
  }

  loadCapas(): void {
    if (!this.selected) return;
    this.api.listCapa(this.selected.id).subscribe({
      next: (data) => { this.capas = Array.isArray(data) ? data : (data?.data || []); },
      error: () => { this.capas = []; },
    });
  }

  saveDetail(): void {
    this.api.updateNcr(this.selected.id, this.edit).subscribe({
      next: () => { this.snack.open('NCR updated', 'OK', { duration: 2500 }); this.load(); },
      error: (e) => this.snack.open(e?.error?.message || 'Update failed', 'Dismiss', { duration: 4000 }),
    });
  }

  saveCapa(): void {
    this.api.createCapa({ ncrId: this.selected.id, ...this.newCapa }).subscribe({
      next: () => { this.snack.open('Action added', 'OK', { duration: 2000 }); this.showAddCapa = false; this.newCapa = { title: '', type: 'corrective' }; this.loadCapas(); },
      error: (e) => this.snack.open(e?.error?.message || 'Failed to add action', 'Dismiss', { duration: 4000 }),
    });
  }

  updateCapaStatus(c: any): void {
    this.api.updateCapa(c.id, { status: c.status }).subscribe({
      next: () => this.snack.open('Action updated', 'OK', { duration: 1500 }),
      error: (e) => this.snack.open(e?.error?.message || 'Update failed', 'Dismiss', { duration: 4000 }),
    });
  }
}
