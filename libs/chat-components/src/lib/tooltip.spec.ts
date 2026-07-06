import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';

import { TooltipDirective } from './tooltip';

@Component({
  imports: [TooltipDirective],
  template: `
    <button
      type="button"
      data-testid="host"
      rvTooltip="Open settings"
      rvTooltipShowDelay="0"
      rvTooltipHideDelay="0"
    >
      Settings
    </button>

    <button
      type="button"
      data-testid="disabled-by-input"
      rvTooltip="Hidden hint"
      rvTooltipShowDelay="0"
      [rvTooltipDisabled]="true"
    >
      Disabled input
    </button>

    <span
      data-testid="disabled-wrapper"
      tabindex="0"
      rvTooltip="Connect a profile first"
      rvTooltipShowDelay="0"
      rvTooltipHideDelay="0"
    >
      <button type="button" disabled>Run</button>
    </span>
  `,
})
class TooltipHostComponent {}

describe('TooltipDirective', () => {
  let overlayContainer: OverlayContainer;
  let overlayElement: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TooltipHostComponent],
    }).compileComponents();
    overlayContainer = TestBed.inject(OverlayContainer);
    overlayElement = overlayContainer.getContainerElement();
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();
    TestBed.resetTestingModule();
  });

  it('shows on hover and wires aria-describedby while visible', () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector(
      '[data-testid="host"]',
    ) as HTMLElement;

    host.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    const describedBy = host.getAttribute('aria-describedby');
    expect(describedBy).toMatch(/^rv-tooltip-/);
    expect(overlayElement.textContent).toContain('Open settings');
    expect(overlayElement.querySelector(`#${describedBy}`)).not.toBeNull();

    host.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();

    expect(host.hasAttribute('aria-describedby')).toBe(false);
    expect(overlayElement.textContent).not.toContain('Open settings');
  });

  it('shows on keyboard focus and hides on Escape', () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector(
      '[data-testid="host"]',
    ) as HTMLElement;

    host.dispatchEvent(new FocusEvent('focusin'));
    fixture.detectChanges();
    expect(overlayElement.textContent).toContain('Open settings');

    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(host.hasAttribute('aria-describedby')).toBe(false);
    expect(overlayElement.textContent).not.toContain('Open settings');
  });

  it('does not show when disabled by input', () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector(
      '[data-testid="disabled-by-input"]',
    ) as HTMLElement;

    host.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    expect(host.hasAttribute('aria-describedby')).toBe(false);
    expect(overlayElement.textContent).not.toContain('Hidden hint');
  });

  it('supports disabled native controls through a focusable wrapper', () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    fixture.detectChanges();
    const wrapper = fixture.nativeElement.querySelector(
      '[data-testid="disabled-wrapper"]',
    ) as HTMLElement;

    wrapper.dispatchEvent(new FocusEvent('focusin'));
    fixture.detectChanges();

    expect(wrapper.getAttribute('aria-describedby')).toMatch(/^rv-tooltip-/);
    expect(overlayElement.textContent).toContain('Connect a profile first');
  });
});
