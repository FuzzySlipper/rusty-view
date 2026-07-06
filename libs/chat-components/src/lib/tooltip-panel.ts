import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'rv-tooltip-panel',
  templateUrl: './tooltip-panel.html',
  styleUrl: './tooltip-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TooltipPanelComponent {
  readonly id = input.required<string>();
  readonly text = input.required<string>();
}
