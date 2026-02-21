import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { TimerPage } from './timer/timer.page';
import { HistoryPage } from './history/history.page';

const routes: Routes = [
  { path: '', component: TimerPage },
  { path: 'history', component: HistoryPage }
];

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, SharedModule, RouterModule.forChild(routes)],
  declarations: [TimerPage, HistoryPage]
})
export class TimeTrackingModule {}
