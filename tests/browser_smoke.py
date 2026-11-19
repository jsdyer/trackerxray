"""Measure the real page load and compare two HARs recorded by Chrome."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from tempfile import TemporaryDirectory
import shutil
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    with TemporaryDirectory() as workspace:
        folder = Path(workspace)
        shutil.copytree(ROOT / "dist", folder / "trackerxray")
        handler = partial(SimpleHTTPRequestHandler, directory=workspace)
        with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server, sync_playwright() as p:
            Thread(target=server.serve_forever, daemon=True).start()
            browser = p.chromium.launch(channel="chrome")
            url = f"http://127.0.0.1:{server.server_port}/trackerxray/"
            for side in ("before", "after"):
                context = browser.new_context(record_har_path=str(folder / (side + ".har")))
                capture = context.new_page()
                capture.goto(url, wait_until="networkidle")
                if side == "after":
                    capture.reload(wait_until="networkidle")
                context.close()
            page = browser.new_page(viewport={"width": 390, "height": 844})
            errors = []
            page.on("pageerror", lambda message: errors.append(str(message)))
            page.goto(url, wait_until="networkidle")
            page.locator("#measure").click()
            page.get_by_text("This page’s measured load", exact=True).wait_for()
            rows = page.locator("#requests tr").count()
            assert rows >= 4, rows
            assert "same-origin requests" in page.locator("#status").inner_text()
            print(f"Current-page Resource Timing returned {rows} locally served entries")
            page.locator("#open").set_input_files(str(folder / "before.har"))
            page.get_by_text("before.har", exact=True).wait_for()
            page.locator("#comparison summary").first.click()
            page.locator("#compare-before").set_input_files(str(folder / "before.har"))
            expect(page.locator("#compare-before-label")).to_contain_text("recorded requests")
            page.locator("#compare-after").set_input_files(str(folder / "after.har"))
            expect(page.locator("#compare-status")).to_contain_text("Comparison ready")
            assert "127.0.0.1" in page.locator("#comparison").inner_text()
            assert not errors, errors
            browser.close()
            server.shutdown()


if __name__ == "__main__":
    main()
