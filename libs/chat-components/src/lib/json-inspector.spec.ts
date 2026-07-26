import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { JsonInspectorComponent } from './json-inspector';

describe('JsonInspectorComponent', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--rv-font-technical');
  });

  it('uses the configurable technical font role for diagnostics', async () => {
    document.documentElement.style.setProperty(
      '--rv-font-technical',
      'Arial, sans-serif',
    );
    await TestBed.configureTestingModule({
      imports: [JsonInspectorComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(JsonInspectorComponent);
    fixture.componentRef.setInput('data', { status: 'ready' });
    fixture.detectChanges();

    const inspector = fixture.nativeElement.querySelector(
      '[data-testid="json-inspector"]',
    ) as HTMLElement;
    expect(inspector).not.toBeNull();
    expect(getComputedStyle(inspector).fontFamily).toBe(
      'var(--rv-font-technical)',
    );
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--rv-font-technical')
        .trim(),
    ).toBe('Arial, sans-serif');

    document.documentElement.style.setProperty(
      '--rv-font-technical',
      'Georgia, serif',
    );
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--rv-font-technical')
        .trim(),
    ).toBe('Georgia, serif');
    expect(getComputedStyle(inspector).fontFamily).toBe(
      'var(--rv-font-technical)',
    );
  });
});
