import { Injectable, signal } from '@angular/core';

/**
 * Public controller for the shared top menu.
 *
 * Downstream shells can inject this service near their own header controls and
 * request that a registered top-menu panel open by id. The `rv-top-menu`
 * component remains the owner of rendering and close behavior.
 */
@Injectable({ providedIn: 'root' })
export class TopMenuController {
  private readonly _openPanelId = signal<string | null>(null);

  readonly openPanelId = this._openPanelId.asReadonly();

  openPanel(panelId: string): void {
    this._openPanelId.set(panelId);
  }

  closePanel(): void {
    this._openPanelId.set(null);
  }

  togglePanel(panelId: string): void {
    this._openPanelId.update((current) =>
      current === panelId ? null : panelId,
    );
  }
}
