#!/usr/bin/env python3
"""Generate PassWisely application and web icons from the approved logo."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "assets" / "branding" / "passwisely-logo.png"
PNG_SIZES = (16, 24, 32, 48, 64, 128, 192, 256, 512, 1024)


def resize(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def make_master(source_path: Path) -> Image.Image:
    source = Image.open(source_path).convert("RGBA")
    source = ImageOps.fit(
        source,
        (1024, 1024),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )

    # Keep the logo's white face/background so it remains legible in dark mode,
    # while using transparent corners for a native desktop app-icon silhouette.
    scale = 4
    mask = Image.new("L", (1024 * scale, 1024 * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, 1024 * scale - 1, 1024 * scale - 1),
        radius=224 * scale,
        fill=255,
    )
    mask = mask.resize((1024, 1024), Image.Resampling.LANCZOS)
    source.putalpha(mask)
    return source


def write_pngs(master: Image.Image) -> None:
    png_dir = ROOT / "assets" / "icons" / "png"
    png_dir.mkdir(parents=True, exist_ok=True)
    for size in PNG_SIZES:
        resize(master, size).save(
            png_dir / f"icon-{size}x{size}.png", optimize=True
        )


def write_ico(master: Image.Image, output: Path, sizes: tuple[int, ...]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    master.save(
        output,
        format="ICO",
        sizes=[(size, size) for size in sizes],
        bitmap_format="png",
    )


def write_icns(master: Image.Image) -> None:
    output = ROOT / "assets" / "icons" / "mac" / "icon.icns"
    output.parent.mkdir(parents=True, exist_ok=True)
    master.save(
        output,
        format="ICNS",
        append_images=[resize(master, size) for size in (16, 32, 64, 128, 256, 512)],
    )


def write_web_assets(master: Image.Image) -> None:
    for public_dir in (ROOT / "public", ROOT / "renderer" / "public"):
        public_dir.mkdir(parents=True, exist_ok=True)
        resize(master, 192).save(public_dir / "logo192.png", optimize=True)
        resize(master, 512).save(public_dir / "logo512.png", optimize=True)
        write_ico(master, public_dir / "favicon.ico", (16, 24, 32, 48))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", nargs="?", type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()

    master = make_master(args.source)
    write_pngs(master)
    write_ico(
        master,
        ROOT / "assets" / "icons" / "win" / "icon.ico",
        (16, 24, 32, 48, 64, 128, 256),
    )
    write_icns(master)
    write_web_assets(master)


if __name__ == "__main__":
    main()
