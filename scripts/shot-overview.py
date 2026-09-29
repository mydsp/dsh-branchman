"""Rasterise the overview SVG into a PNG (Chromium at 2x) for visual review.

Usage:
    node scripts/preview-overview.mjs sample docs/_preview.svg
    python scripts/shot-overview.py

Paths are derived from this file's location, so it works from any cwd.
"""
import os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "test", ".tmp", "preview.svg")
DST = os.path.join(ROOT, "docs", "overview-preview.png")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 960, "height": 520}, device_scale_factor=2)
    page.goto("file:///" + SRC.replace("\\", "/"))
    page.screenshot(path=DST)
    print("wrote", DST)
    browser.close()
