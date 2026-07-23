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
  private readonly _panelTargetId = signal<string | null>(null);

  readonly openPanelId = this._openPanelId.asReadonly();
  readonly panelTargetId = this._panelTargetId.asReadonly();

  openPanel(panelId: string, targetId: string | null = null): void {
    this._panelTargetId.set(targetId);
    this._openPanelId.set(panelId);
  }

  closePanel(): void {
    this._openPanelId.set(null);
    this._panelTargetId.set(null);
  }

  togglePanel(panelId: string): void {
    if (this._openPanelId() === panelId) {
      this.closePanel();
      return;
    }
    this.openPanel(panelId);
  }
}
