import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { TopMenuBarComponent } from './top-menu-bar';

describe('TopMenuBarComponent', () => {
  async function createBar(items: readonly { id: string; label: string }[]) {
    await TestBed.configureTestingModule({
      imports: [TopMenuBarComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(TopMenuBarComponent);
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    return fixture;
  }

  it('renders one button per entry', async () => {
    const fixture = await createBar([
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ]);
    const buttons = fixture.nativeElement.querySelectorAll('.rv-top-menu__item');
    expect(buttons.length).toBe(2);
  });

  it('emits the selected id on click', async () => {
    const fixture = await createBar([{ id: 'go', label: 'Go' }]);
    const emitted: string[] = [];
    fixture.componentInstance.selected.subscribe((id) => emitted.push(id));

    fixture.nativeElement.querySelector('.rv-top-menu__item').click();
    expect(emitted).toEqual(['go']);
  });
});
