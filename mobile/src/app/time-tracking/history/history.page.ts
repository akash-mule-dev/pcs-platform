import { Component, OnInit } from '@angular/core';
import { TimeTrackingService, TimeEntry } from '../../core/services/time-tracking.service';

interface DayGroup {
  date: string;
  entries: TimeEntry[];
}

@Component({
  selector: 'app-history',
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
  standalone: false
})
export class HistoryPage implements OnInit {
  groups: DayGroup[] = [];

  constructor(private timeService: TimeTrackingService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.timeService.getHistory().subscribe(entries => {
      const map = new Map<string, TimeEntry[]>();
      for (const e of entries) {
        const day = e.startTime.slice(0, 10);
        if (!map.has(day)) map.set(day, []);
        map.get(day)!.push(e);
      }
      this.groups = Array.from(map.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, ents]) => ({ date, entries: ents }));
    });
  }

  variance(entry: TimeEntry): { label: string; color: string } {
    const target = entry.workOrderStage?.stage?.targetTimeSeconds;
    const actual = entry.durationSeconds;
    if (!target || !actual) return { label: '', color: 'medium' };
    const pct = Math.round(((actual - target) / target) * 100);
    if (pct <= -10) return { label: `${pct}% ⚡`, color: 'success' };
    if (pct <= 10) return { label: `${pct > 0 ? '+' : ''}${pct}%`, color: 'primary' };
    return { label: `+${pct}% ⚠️`, color: 'danger' };
  }
}
