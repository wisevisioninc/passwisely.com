#!/usr/bin/env python3
"""Upload a PassWisely release to Alibaba Cloud OSS without storing secrets."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import http.client
import mimetypes
import json
import re
import os
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from email.utils import formatdate


INSTALLERS = {
    "mac-arm64": "PassWisely-macOS-arm64.dmg",
    "mac-x64": "PassWisely-macOS-x64.dmg",
    "windows-x64": "PassWisely-Windows-x64.exe",
}


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
) -> bool:
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
    response.read(4096)  # Authentication error bodies are not safe to print.
    connection.close()
    if response.status not in (200, 201, 409):
        raise RuntimeError(
            f"OSS upload failed for {key}: HTTP {response.status}"
        )
    # A conflict is only provisionally reusable: main verifies the public bytes
    # against the local digest before accepting it or emitting a receipt.
    return response.status != 409


def sha256_file(source: Path) -> str:
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def verify_public(source: Path, key: str, bucket: str, endpoint: str, digest: str) -> str:
    url = f"https://{bucket}.{endpoint}/{quote(key, safe='/')}"
    expected = source.stat().st_size
    with urlopen(Request(url, method="HEAD"), timeout=30) as response:
        if response.status != 200 or int(response.headers.get("Content-Length", "-1")) != expected:
            raise RuntimeError(f"OSS size verification failed for {key}.")
    actual, received = hashlib.sha256(), 0
    with urlopen(url, timeout=180) as response:
        if response.status != 200:
            raise RuntimeError(f"OSS public verification failed for {key}.")
        while chunk := response.read(8 * 1024 * 1024):
            received += len(chunk)
            if received > expected:
                raise RuntimeError(f"OSS public verification exceeded expected size for {key}.")
            actual.update(chunk)
    if received != expected or actual.hexdigest() != digest:
        raise RuntimeError(f"OSS public digest verification failed for {key}.")
    return url


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--bucket", default="passwisely-releases-prod")
    parser.add_argument("--endpoint", default="oss-cn-beijing.aliyuncs.com")
    parser.add_argument("--platform", action="append", choices=tuple(INSTALLERS))
    parser.add_argument("--manifest-out", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        raise SystemExit("Version must be major.minor.patch.")
    platforms = args.platform or list(INSTALLERS)
    if len(set(platforms)) != len(platforms):
        raise SystemExit("Duplicate platform selection.")
    if args.manifest_out and args.manifest_out.exists():
        raise SystemExit("Manifest output already exists.")
    sources = [(platform, args.release_dir / INSTALLERS[platform]) for platform in platforms]
    for _, source in sources:
        if not source.is_file():
            raise SystemExit(f"Missing installer: {source}")

    load_env(args.env_file.expanduser())
    access_key_id = os.environ.get("ALIYUN_ACCESS_KEY_ID", "").strip()
    access_key_secret = os.environ.get("ALIYUN_ACCESS_KEY_SECRET", "").strip()
    if not access_key_id or not access_key_secret:
        raise SystemExit("ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET are required.")

    artifacts = []
    for platform, source in sources:
        key = f"releases/v{args.version}/{source.name}"
        before, digest = source.stat(), sha256_file(source)
        created = upload(source, key, args.bucket, args.endpoint, access_key_id, access_key_secret)
        after = source.stat()
        if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
            raise RuntimeError(f"Installer changed during upload: {source}")
        url = verify_public(source, key, args.bucket, args.endpoint, digest)
        artifacts.append({"platform": platform, "filename": source.name, "url": url,
                          "sha256": digest, "bytes": after.st_size, "publicSha256Verified": True, "created": created})
        print(f"verified={key} created={created} bytes={after.st_size} sha256={digest}")
    if args.manifest_out:
        with args.manifest_out.open("x", encoding="utf-8") as stream:
            json.dump({"version": args.version, "artifacts": artifacts}, stream, indent=2)
            stream.write("\n")



if __name__ == "__main__":
    main()
