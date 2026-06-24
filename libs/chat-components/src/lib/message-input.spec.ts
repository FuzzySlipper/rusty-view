import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { MessageInputComponent } from './message-input';

describe('MessageInputComponent', () => {
  const mockCommands = [
    { name: 'new', description: 'Create a new session' },
    { name: 'status', description: 'Show session status', args_schema: { detailed: 'boolean' } },
    { name: 'help', description: 'Show help' },
    { name: 'reload-mcp', description: 'Reload MCP tools' },
    { name: 'reset', description: 'Reset session state' },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  describe('Command filtering', () => {
    it('should return empty array when text does not start with /', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      // Simulate typing without /
      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = 'hello';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component['filteredCommands']()).toEqual([]);
    });

    it('should return all commands when only / is typed', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component['filteredCommands']()).toHaveLength(5);
    });

    it('should filter commands by prefix', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/re';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component['filteredCommands']()).toHaveLength(2); // reload-mcp, reset
      expect(component['filteredCommands']().map(c => c.name)).toContain('reload-mcp');
      expect(component['filteredCommands']().map(c => c.name)).toContain('reset');
    });

    it('should be case-insensitive', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/NEW';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component['filteredCommands']()).toHaveLength(1);
      expect(component['filteredCommands']()[0]?.name).toBe('new');
    });

    it('should limit results to 10 commands', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      const manyCommands = Array.from({ length: 15 }, (_, i) => ({
        name: `cmd${i}`,
        description: `Command ${i}`,
      }));
      fixture.componentRef.setInput('commands', manyCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component['filteredCommands']()).toHaveLength(10);
    });
  });

  describe('Hint menu state', () => {
    it('should open hint menu when text starts with /', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.rv-input__hints')).toBeTruthy();
    });

    it('should close hint menu when text no longer starts with /', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.rv-input__hints')).toBeTruthy();

      textarea.value = 'hello';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.rv-input__hints')).toBeFalsy();
    });

    it('should close hint menu when no commands match', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/xyz';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.rv-input__hints')).toBeFalsy();
    });
  });

  describe('Keyboard navigation', () => {
    it('should navigate down through hints', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component['hintIndex']()).toBe(0);

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      fixture.detectChanges();
      expect(component['hintIndex']()).toBe(1);

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      fixture.detectChanges();
      expect(component['hintIndex']()).toBe(2);
    });

    it('should navigate up through hints', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      component['hintIndex'].set(2);

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();
      expect(component['hintIndex']()).toBe(1);
    });

    it('should wrap around when navigating past last item', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      component['hintIndex'].set(mockCommands.length - 1);

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      fixture.detectChanges();
      expect(component['hintIndex']()).toBe(0);
    });

    it('should wrap around when navigating before first item', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component['hintIndex']()).toBe(0);

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();
      expect(component['hintIndex']()).toBe(mockCommands.length - 1);
    });

    it('should close hint menu on Escape', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component['hintOpen']()).toBe(true);

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(component['hintOpen']()).toBe(false);
    });
  });

  describe('Hint acceptance', () => {
    it('should insert command name on Enter', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/sta';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();

      expect(component['text']()).toBe('/status ');
      expect(component['hintOpen']()).toBe(false);
    });

    it('should insert command name on Tab', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/new';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
      fixture.detectChanges();

      expect(component['text']()).toBe('/new ');
      expect(component['hintOpen']()).toBe(false);
    });

    it('should insert command name on click', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const hints = fixture.nativeElement.querySelectorAll('.rv-input__hint');
      hints[1].click();
      fixture.detectChanges();

      expect(component['text']()).toBe('/status ');
      expect(component['hintOpen']()).toBe(false);
    });
  });

  describe('Submit behavior', () => {
    it('should not submit when hint menu is open and Enter is pressed', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      const sendSpy = vi.fn();
      component.send.subscribe(sendSpy);
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/new';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();

      expect(sendSpy).not.toHaveBeenCalled();
      expect(component['text']()).toBe('/new ');
    });

    it('should submit when hint menu is closed and Enter is pressed', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      const sendSpy = vi.fn();
      component.send.subscribe(sendSpy);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = 'hello world';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();

      expect(sendSpy).toHaveBeenCalledWith('hello world');
    });
  });

  describe('Accessibility', () => {
    it('should have combobox role on textarea', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      expect(textarea.getAttribute('role')).toBe('combobox');
      expect(textarea.getAttribute('aria-autocomplete')).toBe('list');
    });

    it('should have listbox role on hints container', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const hints = fixture.nativeElement.querySelector('.rv-input__hints');
      expect(hints.getAttribute('role')).toBe('listbox');
    });

    it('should have option role on hint items', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const hints = fixture.nativeElement.querySelectorAll('.rv-input__hint');
      hints.forEach((hint: Element) => {
        expect(hint.getAttribute('role')).toBe('option');
      });
    });

    it('should mark active hint with aria-selected', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const hints = fixture.nativeElement.querySelectorAll('.rv-input__hint');
      expect(hints[0].getAttribute('aria-selected')).toBe('true');
      expect(hints[1].getAttribute('aria-selected')).toBe('false');
    });
  });

  describe('Command history navigation', () => {
    const history = ['/new', '/status', '/help'];

    it('should not navigate when history is empty', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', []);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();

      expect(component['text']()).toBe('');
      expect(component['historyIndex']()).toBeNull();
    });

    it('should enter history mode on ArrowUp and show newest command', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();

      expect(component['text']()).toBe('/new');
      expect(component['historyIndex']()).toBe(0);
    });

    it('should navigate to older command on subsequent ArrowUp', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();

      expect(component['text']()).toBe('/status');
      expect(component['historyIndex']()).toBe(1);
    });

    it('should clamp at oldest command on ArrowUp', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      // Navigate all the way to oldest.
      for (let i = 0; i < history.length; i++) {
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      }
      fixture.detectChanges();

      expect(component['text']()).toBe('/help');
      // One more Up should stay at oldest.
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();
      expect(component['text']()).toBe('/help');
    });

    it('should navigate forward on ArrowDown', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      // Go up to oldest.
      for (let i = 0; i < history.length; i++) {
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      }
      // Come back down one.
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      fixture.detectChanges();

      expect(component['text']()).toBe('/status');
      expect(component['historyIndex']()).toBe(1);
    });

    it('should exit history mode and restore draft on ArrowDown past newest', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      // Type a draft.
      textarea.value = '/draft';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // Enter history.
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();
      expect(component['text']()).toBe('/new');

      // Exit past newest.
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      fixture.detectChanges();
      expect(component['text']()).toBe('/draft');
      expect(component['historyIndex']()).toBeNull();
    });

    it('should preserve unsent draft when navigating history', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = '/draft text';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // Enter history.
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();
      expect(component['text']()).toBe('/new');

      // Exit history by navigating past newest.
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      fixture.detectChanges();
      expect(component['text']()).toBe('/draft text');
    });

    it('should exit history mode on typing', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();
      expect(component['historyIndex']()).toBe(0);

      // Simulate typing.
      textarea.value = '/ty';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(component['historyIndex']()).toBeNull();
    });

    it('should not navigate history when typing a normal message', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.value = 'hello world';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();

      // Text should not change (history nav didn't fire for normal text).
      expect(component['text']()).toBe('hello world');
      expect(component['historyIndex']()).toBeNull();
    });

    it('should navigate history from empty text on ArrowUp', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();

      expect(component['text']()).toBe('/new');
    });

    it('should prioritize hint navigation over history when hints are open', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commands', mockCommands);
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      // '/re' matches 'reload-mcp' and 'reset' — two hints.
      textarea.value = '/re';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // Hints are open — ArrowUp should navigate hints, not history.
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();

      expect(component['hintIndex']()).toBeGreaterThan(0);
      expect(component['historyIndex']()).toBeNull();
      // Text should still be /re (hint nav doesn't change text).
      expect(component['text']()).toBe('/re');
    });

    it('should reset history mode on submit', () => {
      const fixture = TestBed.createComponent(MessageInputComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('commandHistory', history);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      fixture.detectChanges();
      expect(component['historyIndex']()).not.toBeNull();

      component['submit']();
      fixture.detectChanges();
      expect(component['historyIndex']()).toBeNull();
    });
  });
});
