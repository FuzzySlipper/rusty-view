# Tooltips

Rusty View exposes a reusable tooltip primitive from
`@rusty-view/chat-components`:

```html
<button type="button" rvTooltip="Open settings">Settings</button>
```

Use `rvTooltip` for short supplemental hints on controls that already have an
accessible name. Do not put required instructions, validation errors, or state
that a user must know only in a tooltip; use visible text or an alert/status
region for that.

## API

```html
<button
  type="button"
  rvTooltip="Toggle transcript search"
  rvTooltipPlacement="bottom"
>
  Search
</button>
```

Inputs:

- `rvTooltip`: hint text.
- `rvTooltipPlacement`: `top`, `bottom`, `left`, or `right` (`top` default).
- `rvTooltipShowDelay`: milliseconds before opening (`350` default).
- `rvTooltipHideDelay`: milliseconds before closing (`80` default).
- `rvTooltipDisabled`: disables the tooltip without changing the host control.

Tooltips open on mouse hover and keyboard focus, set `aria-describedby` while
visible, and close on pointer leave, focus loss, or Escape.

## Disabled Controls

Native disabled controls do not fire pointer or focus events. Put the tooltip on
a focusable wrapper when explaining a disabled action:

```html
<span tabindex="0" rvTooltip="Select a profile before sending">
  <button type="button" disabled>Send</button>
</span>
```

The wrapper must not replace the disabled control's visible state. It only gives
keyboard and pointer users a consistent place to discover the supplemental hint.

## Styling

The tooltip panel uses Rusty View design tokens for color, border, elevation,
typography, radius, and z-index. Apps using the directive must include Angular
CDK overlay positioning styles once in their global style list:

```json
"styles": [
  "node_modules/@angular/cdk/overlay-prebuilt.css",
  "libs/design-tokens/src/styles/tokens.css",
  "apps/my-app/src/styles.css"
]
```

Downstream apps should theme by overriding `--rv-*` tokens rather than reaching
into tooltip internals.

## Native Title Attributes

Avoid scattered native `title` attributes on app controls. Native titles are not
consistent across pointer, keyboard, touch, and assistive-technology usage. Use
`rvTooltip` for app chrome and compact controls; reserve `title` for plain DOM
escapes where the Angular directive cannot be used.
