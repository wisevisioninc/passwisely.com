#!/usr/bin/env python3
"""Upload a PassWisely release to Alibaba Cloud OSS without storing secrets."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import http.client
import mimetypes
import os
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from email.utils import formatdate


INSTALLERS = (
    "PassWisely-macOS-arm64.dmg",
    "PassWisely-macOS-x64.dmg",
    "PassWisely-Windows-x64.exe",
)


def load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.removeprefix("export ").split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("'\""))


def upload(
    source: Path,
    key: str,
    bucket: str,
    endpoint: str,
    access_key_id: str,
    access_key_secret: str,
) -> None:
    content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
    date = formatdate(usegmt=True)
    resource = f"/{bucket}/{key}"
    canonical_headers = "x-oss-forbid-overwrite:true\nx-oss-object-acl:public-read\n"
    string_to_sign = f"PUT\n\n{content_type}\n{date}\n{canonical_headers}{resource}"
    signature = base64.b64encode(
        hmac.new(
            access_key_secret.encode(),
            string_to_sign.encode(),
            hashlib.sha1,
        ).digest()
    ).decode()

    host = f"{bucket}.{endpoint}"
    connection = http.client.HTTPSConnection(host, timeout=180)
    connection.putrequest(
        "PUT",
        f"/{quote(key, safe='/')}",
        skip_host=True,
        skip_accept_encoding=True,
    )
    connection.putheader("Host", host)
    connection.putheader("Date", date)
    connection.putheader("Content-Type", content_type)
    connection.putheader("Content-Length", str(source.stat().st_size))
    connection.putheader("x-oss-object-acl", "public-read")
    connection.putheader("x-oss-forbid-overwrite", "true")
    connection.putheader("Authorization", f"OSS {access_key_id}:{signature}")
    connection.endheaders()
    with source.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            connection.send(chunk)
    response = connection.getresponse()
    detail = response.read().decode("utf-8", errors="replace")
    connection.close()
    if response.status not in (200, 201):
        raise RuntimeError(
            f"OSS upload failed for {key}: HTTP {response.status} {detail[:500]}"
        )


def verify_public(source: Path, key: str, bucket: str, endpoint: str) -> None:
    url = f"https://{bucket}.{endpoint}/{quote(key, safe='/')}"
    request = Request(url, method="HEAD")
    with urlopen(request, timeout=30) as response:
        remote_size = int(response.headers.get("Content-Length", "-1"))
        if response.status != 200 or remote_size != source.stat().st_size:
            raise RuntimeError(
                f"OSS verification failed for {key}: HTTP {response.status}, "
                f"expected {source.stat().st_size} bytes, received {remote_size}"
            )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--bucket", default="passwisely-releases-prod")
    parser.add_argument("--endpoint", default="oss-cn-beijing.aliyuncs.com")
    args = parser.parse_args()

    load_env(args.env_file.expanduser())
    access_key_id = os.environ.get("ALIYUN_ACCESS_KEY_ID", "").strip()
    access_key_secret = os.environ.get("ALIYUN_ACCESS_KEY_SECRET", "").strip()
    if not access_key_id or not access_key_secret:
        raise SystemExit("ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET are required.")

    for filename in INSTALLERS:
        source = args.release_dir / filename
        if not source.is_file():
            raise SystemExit(f"Missing installer: {source}")
        key = f"releases/v{args.version}/{filename}"
        upload(
            source,
            key,
            args.bucket,
            args.endpoint,
            access_key_id,
            access_key_secret,
        )
        verify_public(source, key, args.bucket, args.endpoint)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        print(f"uploaded={key} bytes={source.stat().st_size} sha256={digest}")


if __name__ == "__main__":
    main()
