# App icon

`icon.svg` is the source for the Relay II app icon. The About screen and favicon reference it directly.
It combines the selected Relay II silhouette with a blue-violet rounded tile, lavender and white
raised faces, and soft shadows. The SVG has a 512 × 512 viewBox and a transparent outer canvas.
All artwork, lighting, and shadows remain vector SVG elements; there are no embedded raster images.

The sidebar uses `icon-mark.svg`, the same silhouette with no tile or shadows. The icon and wordmark
are white in dark mode and black in light mode; the light theme recolours the SVG image with CSS.
A colour-inheriting version is in `design/brand/relay-ii/mark.svg`.

The desktop window and Linux package use `icon.png`. The tray uses `tray.png`
and `tray-unread.png`, with matching `@2x` assets for high-density displays.
These are generated from the same SVG; the unread variant adds a pale badge with an indigo outline.
The badge is positioned relative to the SVG viewBox.

After editing the SVG, regenerate the PNGs from the repository root with
Python 3 and librsvg's `rsvg-convert` installed:

```sh
python scripts/icon.py
```

Use `--renderer /path/to/rsvg-convert` if the converter is not on `PATH`.

`LICENSE` is a verbatim copy of the repository-root license so desktop packages include it. Keep the copies identical.
