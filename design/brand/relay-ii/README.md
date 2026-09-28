# Relay II

Selected logo: Relay II. This directory contains the retained brand artwork and exports.

- `mark.svg`: original single-colour mark with a transparent background; uses `currentColor`.
- `icon-1024.png`: 1024 × 1024 app icon with transparency outside the rounded tile.
- `preview.svg` / `preview.png`: presentation on a pale lavender background.

The editable app icon source is `apps/desktop/resources/icon.svg` at the repository root.
It uses SVG paths, gradients and shadows, with the original Relay II silhouette preserved.
The desktop icon, sidebar mark, favicon, About image and tray assets use this selected direction.

Regenerate desktop and tray PNGs with `python scripts/icon.py`. Regenerate the large export with:

```sh
rsvg-convert --width 1024 --height 1024 apps/desktop/resources/icon.svg -o design/brand/relay-ii/icon-1024.png
```
