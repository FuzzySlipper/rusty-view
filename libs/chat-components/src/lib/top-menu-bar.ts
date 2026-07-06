import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { TooltipDirective } from './tooltip';

/**
 * A single entry in a top menu bar: a stable id plus a display label. The
 * container (chat-shell) maps selection ids to concrete actions/panels.
 */
export interface TopMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly tooltip?: string;
}

/**
 * Presentational top menu bar.
 *
 * Renders a horizontal row of labelled menu buttons. Pure: data in via
 * {@link items}, selections out via {@link select}. No service injection, no
 * store access, no domain logic. The container decides what each id does.
 */
@Component({
  selector: 'rv-top-menu-bar',
  imports: [TooltipDirective],
  templateUrl: './top-menu-bar.html',
  styleUrl: './top-menu-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopMenuBarComponent {
  /** Ordered menu entries to render. */
  readonly items = input.required<readonly TopMenuEntry[]>();
  /** Emits the id of the clicked entry. */
  readonly selected = output<string>();

  protected onSelect(id: string): void {
    this.selected.emit(id);
  }
}
