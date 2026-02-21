import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { WorkOrderListPage } from './work-order-list/work-order-list.page';
import { WorkOrderDetailPage } from './work-order-detail/work-order-detail.page';

const routes: Routes = [
  { path: '', component: WorkOrderListPage },
  { path: ':id', component: WorkOrderDetailPage }
];

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, SharedModule, RouterModule.forChild(routes)],
  declarations: [WorkOrderListPage, WorkOrderDetailPage]
})
export class WorkOrdersModule {}
