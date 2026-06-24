import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { TabStripComponent } from './tab-strip';

describe('TabStripComponent', () => {
  async function createStrip(
    tabs: readonly { id: string; label: string }[],
    activeId: string,
  ) {
    await TestBed.configureTestingModule({
      imports: [TabStripComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(TabStripComponent);
    fixture.componentRef.setInput('tabs', tabs);
    fixture.componentRef.setInput('activeId', activeId);
    fixture.detectChanges();
    return fixture;
  }

  it('marks the active tab', async () => {
    const fixture = await createStrip(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      'b',
    );
    const active: HTMLElement = fixture.nativeElement.querySelector(
      '.rv-tab-strip__tab--active',
    );
    expect(active?.textContent?.trim()).toBe('B');
  });

  it('emits the selected tab id on click', async () => {
    const fixture = await createStrip(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      'a',
    );
    const emitted: string[] = [];
    fixture.componentInstance.selected.subscribe((id) => emitted.push(id));

    const tabs = fixture.nativeElement.querySelectorAll('.rv-tab-strip__tab');
    tabs[1].click();
    expect(emitted).toEqual(['b']);
  });
});
