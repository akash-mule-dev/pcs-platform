import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { ModelListPage } from './model-list/model-list.page';
import { ModelViewPage } from './model-view/model-view.page';
import { ArViewPage } from './ar-view/ar-view.page';
import { NativeArPage } from './native-ar/native-ar.page';
import { QualityViewPage } from './quality-view/quality-view.page';

const routes: Routes = [
  { path: '', component: ModelListPage },
  { path: ':id/view', component: ModelViewPage },
  { path: ':id/ar', component: ArViewPage },
  { path: ':id/native-ar', component: NativeArPage },
  { path: ':id/quality', component: QualityViewPage },
];

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, SharedModule, RouterModule.forChild(routes)],
  declarations: [ModelListPage, ModelViewPage, ArViewPage, NativeArPage, QualityViewPage]
})
export class ModelViewerModule {}
