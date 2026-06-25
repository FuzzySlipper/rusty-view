import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
} from '@angular/core';
import { AdminStore } from '@rusty-view/chat-store';

@Component({
  selector: 'rv-admin-service-panel',
  templateUrl: './admin-service-panel.html',
  styleUrl: './admin-service-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminServicePanelComponent {
  protected readonly admin = inject(AdminStore);

  readonly dismissed = output<void>();

  constructor() {
    void this.admin.refresh();
  }

  protected closePanel(): void {
    this.dismissed.emit();
  }

  protected refresh(): void {
    void this.admin.refresh();
  }

  protected reload(): void {
    void this.admin.reloadConfig();
  }
}
