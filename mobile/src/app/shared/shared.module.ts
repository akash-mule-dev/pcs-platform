import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { DurationPipe } from './pipes/duration.pipe';
import { StatusBadgeComponent } from './components/status-badge/status-badge.component';

@NgModule({
  declarations: [DurationPipe, StatusBadgeComponent],
  imports: [CommonModule, IonicModule],
  exports: [DurationPipe, StatusBadgeComponent]
})
export class SharedModule {}
