"""Measure the real page load and compare two HARs recorded by Chrome."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from tempfile import TemporaryDirectory
import shutil, json
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    with TemporaryDirectory() as workspace:
        folder = Path(workspace)
        shutil.copytree(ROOT / "dist", folder / "trackerxray")
        handler = partial(SimpleHTTPRequestHandler, directory=workspace)
        with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server, sync_playwright() as p:
            Thread(target=server.serve_forever, daemon=True).start()
            browser = p.chromium.launch()
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
            expect(page.locator("#waterfall-rows svg")).not_to_have_count(0)
            expect(page.locator("#compare-request-count")).to_contain_text("paired, new or missing")
            page.locator("#compare-request-filter").select_option("all")
            page.locator("#compare-request-rows button").first.click()
            expect(page.locator("#compare-detail")).to_be_visible()
            page.locator("#compare-detail button").click()
            # A synthetic sensitive HAR is a test fixture, never a public example.
            sensitive = {"log":{"entries":[{"startedDateTime":"2026-01-01T00:00:00Z","time":12,"request":{"method":"POST","url":"https://example.ca/private-value?token=private-value","headers":[{"name":"Authorization","value":"private-value"}],"postData":{"mimeType":"text/plain","text":"private-value"}},"response":{"status":200,"content":{"size":4,"mimeType":"text/plain","text":"private-value"}},"timings":{"send":0,"wait":10,"receive":2},"_secret":"private-value"}]}}
            fixture=folder/"sensitive.har";fixture.write_text(json.dumps(sensitive))
            page.locator("#privacy summary").click()
            page.locator("#privacy-file").set_input_files(str(fixture))
            page.locator("#privacy-run").click()
            expect(page.locator("#privacy-status")).to_contain_text("Sanitized copy ready")
            with page.expect_download() as download:
                page.locator("#privacy-download").click()
            reduced=Path(download.value.path()).read_text()
            assert "private-value" not in reduced, reduced
            json.loads(reduced)
            page.locator("#privacy-paths").check()
            expect(page.locator("#privacy-download")).to_be_disabled()
            assert not errors, errors
            browser.close()
            server.shutdown()


if __name__ == "__main__":
    main()
