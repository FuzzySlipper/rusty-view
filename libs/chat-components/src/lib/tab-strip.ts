import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/**
 * A single tab in a tab strip: a stable id plus a display label.
 */
export interface TabEntry {
  readonly id: string;
  readonly label: string;
}

/**
 * Presentational tab strip.
 *
 * Renders a row of tab buttons and highlights the active one. Pure: tabs in
 * via {@link tabs}, active id via {@link activeId}, selections out via
 * {@link select}. Used by the Options panel and any other tabbed surface.
 */
@Component({
  selector: 'rv-tab-strip',
  templateUrl: './tab-strip.html',
  styleUrl: './tab-strip.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabStripComponent {
  /** Ordered tabs to render. */
  readonly tabs = input.required<readonly TabEntry[]>();
  /** Id of the active tab. */
  readonly activeId = input.required<string>();
  /** Emits the id of the selected tab. */
  readonly selected = output<string>();

  protected onSelect(id: string): void {
    this.selected.emit(id);
  }
}
