"""Export desktop PNGs from resources/icon.svg. Requires librsvg's rsvg-convert."""
import argparse
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renderer', default='rsvg-convert', help='Path to rsvg-convert')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / 'apps/desktop/resources'
    source = (root / 'icon.svg').read_bytes()
    unread = ET.fromstring(source)
    x, y, width, height = map(float, unread.attrib['viewBox'].split())
    size = min(width, height)
    # Keep the badge proportional to the artwork's viewBox. Explicit colours
    # also allow the source SVG to contain gradient and filter definitions.
    ET.SubElement(unread, '{http://www.w3.org/2000/svg}circle', {
        'cx': str(x + width * 103 / 128),
        'cy': str(y + height * 25 / 128),
        'r': str(size * 17 / 128),
        'fill': '#f5f7ff',
        'stroke': '#484bd3', 'stroke-width': str(size * 6 / 128),
    })
    for name, size, svg in [
        ('icon.png', 512, source),
        ('tray.png', 24, source),
        ('tray@2x.png', 48, source),
        ('tray-unread.png', 24, ET.tostring(unread)),
        ('tray-unread@2x.png', 48, ET.tostring(unread)),
    ]:
        subprocess.run([
            args.renderer, '--width', str(size), '--height', str(size),
            '--output', str(root / name),
        ], input=svg, check=True)


if __name__ == '__main__':
    main()
