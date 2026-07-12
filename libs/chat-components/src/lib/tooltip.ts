import {
  booleanAttribute,
  Directive,
  ElementRef,
  HostListener,
  inject,
  Input,
  NgZone,
  numberAttribute,
  Renderer2,
  type OnDestroy,
} from '@angular/core';
import {
  Overlay,
  type ConnectedPosition,
  type OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';

import { TooltipPanelComponent } from './tooltip-panel';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

let nextTooltipId = 0;

/**
 * Token-styled tooltip for compact controls.
 *
 * Use visible labels/help text for required information. Tooltips are for short
 * supplemental hints on already accessible controls. Disabled native controls
 * do not emit pointer/focus events; wrap them in a focusable element and put
 * `rvTooltip` on the wrapper when a disabled-state hint is needed.
 */
@Directive({
  selector: '[rvTooltip]',
  standalone: true,
})
export class TooltipDirective implements OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly overlay = inject(Overlay);
  private readonly renderer = inject(Renderer2);
  private readonly zone = inject(NgZone);

  private readonly tooltipId = `rv-tooltip-${++nextTooltipId}`;
  private overlayRef: OverlayRef | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private hasPointerHover = false;
  private hasFocus = false;

  @Input('rvTooltip') text: string | null | undefined = '';
  @Input() rvTooltipPlacement: TooltipPlacement = 'top';
  @Input({ transform: numberAttribute }) rvTooltipShowDelay = 350;
  @Input({ transform: numberAttribute }) rvTooltipHideDelay = 80;
  @Input({ transform: booleanAttribute }) rvTooltipDisabled = false;

  ngOnDestroy(): void {
    this.clearTimers();
    this.detach();
  }

  @HostListener('mouseenter')
  protected onMouseEnter(): void {
    this.hasPointerHover = true;
    this.scheduleShow();
  }

  @HostListener('mouseleave')
  protected onMouseLeave(): void {
    this.hasPointerHover = false;
    this.scheduleHide();
  }

  @HostListener('focusin')
  protected onFocusIn(): void {
    this.hasFocus = true;
    this.scheduleShow();
  }

  @HostListener('focusout')
  protected onFocusOut(): void {
    this.hasFocus = false;
    this.scheduleHide();
  }

  @HostListener('keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    if (this.overlayRef?.hasAttached() !== true) return;
    event.preventDefault();
    event.stopPropagation();
    this.hideNow();
  }

  private scheduleShow(): void {
    if (!this.canShow()) return;
    this.clearHideTimer();
    if (this.overlayRef?.hasAttached() === true) return;
    this.clearShowTimer();
    const delay = Math.max(0, this.rvTooltipShowDelay);
    if (delay === 0) {
      this.showNow();
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.showTimer = setTimeout(() => {
        this.zone.run(() => this.showNow());
      }, delay);
    });
  }

  private scheduleHide(): void {
    this.clearShowTimer();
    if (this.hasPointerHover || this.hasFocus) return;
    this.clearHideTimer();
    const delay = Math.max(0, this.rvTooltipHideDelay);
    if (delay === 0) {
      this.hideNow();
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.hideTimer = setTimeout(() => {
        this.zone.run(() => this.hideNow());
      }, delay);
    });
  }

  private showNow(): void {
    if (!this.canShow()) return;
    const text = this.normalizedText();
    const overlayRef = this.ensureOverlay();
    if (!overlayRef.hasAttached()) {
      const portal = new ComponentPortal(TooltipPanelComponent);
      const componentRef = overlayRef.attach(portal);
      componentRef.setInput('id', this.tooltipId);
      componentRef.setInput('text', text);
    }
    this.renderer.setAttribute(
      this.element.nativeElement,
      'aria-describedby',
      this.tooltipId,
    );
  }

  private hideNow(): void {
    this.clearTimers();
    this.detach();
  }

  private detach(): void {
    this.overlayRef?.detach();
    this.renderer.removeAttribute(
      this.element.nativeElement,
      'aria-describedby',
    );
  }

  private ensureOverlay(): OverlayRef {
    if (this.overlayRef !== null) return this.overlayRef;
    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(this.element)
      .withFlexibleDimensions(false)
      .withPush(true)
      .withViewportMargin(8)
      .withPositions(positionsFor(this.rvTooltipPlacement));
    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      panelClass: 'rv-tooltip-overlay',
    });
    return this.overlayRef;
  }

  private canShow(): boolean {
    return !this.rvTooltipDisabled && this.normalizedText().length > 0;
  }

  private normalizedText(): string {
    return typeof this.text === 'string' ? this.text.trim() : '';
  }

  private clearTimers(): void {
    this.clearShowTimer();
    this.clearHideTimer();
  }

  private clearShowTimer(): void {
    if (this.showTimer === null) return;
    clearTimeout(this.showTimer);
    this.showTimer = null;
  }

  private clearHideTimer(): void {
    if (this.hideTimer === null) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}

function positionsFor(placement: TooltipPlacement): ConnectedPosition[] {
  const top: ConnectedPosition = {
    originX: 'center',
    originY: 'top',
    overlayX: 'center',
    overlayY: 'bottom',
    offsetY: -6,
  };
  const bottom: ConnectedPosition = {
    originX: 'center',
    originY: 'bottom',
    overlayX: 'center',
    overlayY: 'top',
    offsetY: 6,
  };
  const left: ConnectedPosition = {
    originX: 'start',
    originY: 'center',
    overlayX: 'end',
    overlayY: 'center',
    offsetX: -6,
  };
  const right: ConnectedPosition = {
    originX: 'end',
    originY: 'center',
    overlayX: 'start',
    overlayY: 'center',
    offsetX: 6,
  };

  switch (placement) {
    case 'bottom':
      return [bottom, top, right, left];
    case 'left':
      return [left, right, top, bottom];
    case 'right':
      return [right, left, top, bottom];
    case 'top':
      return [top, bottom, right, left];
  }
}
