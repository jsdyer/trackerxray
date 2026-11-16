"""Assemble the static Tracker X-Ray site and its pinned domain parser."""
from base64 import b64encode
from hashlib import sha512
from io import BytesIO
from pathlib import Path
import shutil
import tarfile
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
VERSION = "7.5.4"
URL = f"https://registry.npmjs.org/tldts/-/tldts-{VERSION}.tgz"
INTEGRITY = "Rn2ABgjHZrA+jzqom5zhxA0hLohzYrIgfCPyhpTUxqsUrcsBYuab49LseR9waB9Jr8/MxdodvMHA91oRiGLO3Q=="


def main():
    with urlopen(Request(URL, headers={"User-Agent": "CoolCode Tracker X-Ray build"}), timeout=60) as response:
        payload = response.read(10 * 1024 * 1024 + 1)
    if b64encode(sha512(payload).digest()).decode() != INTEGRITY:
        raise SystemExit("The pinned tldts package did not pass verification.")
    with tarfile.open(fileobj=BytesIO(payload), mode="r:gz") as package:
        assets = {
            destination: package.extractfile(member).read()
            for member, destination in {
                "package/dist/index.esm.min.js": "tldts.mjs",
                "package/LICENSE": "TLDTS-LICENSE",
            }.items()
        }
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(ROOT / "web", DIST)
    vendor = DIST / "vendor"
    vendor.mkdir()
    for name, contents in assets.items():
        (vendor / name).write_bytes(contents)
    print(f"Built {DIST} with tldts {VERSION}.")


if __name__ == "__main__":
    main()
