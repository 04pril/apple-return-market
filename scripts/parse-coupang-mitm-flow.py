#!/usr/bin/env python3
"""Offline parser for exported mitmproxy Coupang captures.

This script reads either a raw mitmproxy flow dump or a ZIP containing one,
finds successful Coupang endpoint-2333 product responses, and writes only a
sanitized stock summary. Request headers, cookies, bearer tokens, signatures,
device identifiers, and full response bodies are never copied to the output.

Examples:
  py scripts/parse-coupang-mitm-flow.py "TalkFile_flows (1).zip"
  python scripts/parse-coupang-mitm-flow.py flows --output parsed-flow.json
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import urllib.parse
import zipfile
import zlib
from pathlib import Path
from typing import Any

HOST = "cmapi.coupang.com"
PATH_RE = re.compile(r"^/modular/v1/endpoints/2333/sdp/v2/platform/products/(?P<product_id>\d+)$")


def as_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return str(value)


def parse_tnet(data: bytes, pos: int = 0) -> tuple[Any, int]:
    colon = data.find(b":", pos)
    if colon < 0:
        raise ValueError(f"invalid tnetstring at offset {pos}: missing colon")
    length = int(data[pos:colon])
    start = colon + 1
    end = start + length
    if end >= len(data):
        raise ValueError(f"truncated tnetstring at offset {pos}")
    payload = data[start:end]
    tag = chr(data[end])
    next_pos = end + 1

    if tag in (";", ","):
        return payload, next_pos
    if tag == "#":
        return int(payload), next_pos
    if tag == "^":
        return float(payload), next_pos
    if tag == "!":
        return payload == b"true", next_pos
    if tag == "~":
        return None, next_pos
    if tag == "]":
        result = []
        inner = 0
        while inner < len(payload):
            value, inner = parse_tnet(payload, inner)
            result.append(value)
        return result, next_pos
    if tag == "}":
        result = {}
        inner = 0
        while inner < len(payload):
            key, inner = parse_tnet(payload, inner)
            value, inner = parse_tnet(payload, inner)
            result[as_text(key)] = value
        return result, next_pos
    raise ValueError(f"unsupported tnetstring tag {tag!r} at offset {end}")


def parse_flow_dump(data: bytes) -> list[dict[str, Any]]:
    flows = []
    pos = 0
    while pos < len(data):
        value, pos = parse_tnet(data, pos)
        if isinstance(value, dict):
            flows.append(value)
    return flows


def read_capture(path: Path) -> bytes:
    raw = path.read_bytes()
    if raw.startswith(b"PK\x03\x04"):
        with zipfile.ZipFile(path) as archive:
            candidates = [entry for entry in archive.infolist() if not entry.is_dir()]
            if not candidates:
                raise ValueError("ZIP does not contain a flow file")
            candidates.sort(key=lambda entry: entry.file_size, reverse=True)
            return archive.read(candidates[0])
    return raw


def headers_dict(headers: Any) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    if not isinstance(headers, list):
        return result
    for pair in headers:
        if isinstance(pair, list) and len(pair) == 2:
            result.setdefault(as_text(pair[0]).lower(), []).append(as_text(pair[1]))
    return result


def response_json(response: dict[str, Any]) -> dict[str, Any] | None:
    content = response.get("content") or b""
    if not isinstance(content, bytes):
        return None
    encoding = (headers_dict(response.get("headers")).get("content-encoding") or [""])[0].lower()
    try:
        if encoding == "gzip":
            content = gzip.decompress(content)
        elif encoding == "deflate":
            try:
                content = zlib.decompress(content)
            except zlib.error:
                content = zlib.decompress(content, -zlib.MAX_WBITS)
        elif encoding in ("", "identity"):
            pass
        else:
            return None
        value = json.loads(content.decode("utf-8"))
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def nested(obj: Any, *keys: str) -> Any:
    current = obj
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def boolish(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        value = value.strip().lower()
        if value in {"true", "1", "yes", "y"}:
            return True
        if value in {"false", "0", "no", "n"}:
            return False
    return None


def product_title(data: dict[str, Any]) -> str | None:
    page_list = nested(data, "rData", "pageList")
    if not isinstance(page_list, list):
        return None
    for page in page_list:
        if not isinstance(page, dict):
            continue
        widgets = page.get("widgetList")
        if not isinstance(widgets, list):
            continue
        for widget in widgets:
            entity = widget.get("entity") if isinstance(widget, dict) else None
            if not isinstance(entity, dict) or entity.get("viewType") != "PRODUCT_DETAIL_PRODUCT_INFO":
                continue
            title = entity.get("title")
            if isinstance(title, list):
                text = "".join(
                    entry.get("text", "") for entry in title if isinstance(entry, dict) and isinstance(entry.get("text"), str)
                ).strip()
                if text:
                    return text
    return None


def extract_observation(flow: dict[str, Any]) -> dict[str, Any] | None:
    request = flow.get("request") or {}
    response = flow.get("response") or {}
    if as_text(request.get("host", b"")) != HOST:
        return None
    raw_path = as_text(request.get("path", b""))
    split = urllib.parse.urlsplit(raw_path)
    match = PATH_RE.match(split.path)
    if not match or response.get("status_code") != 200:
        return None

    query = urllib.parse.parse_qs(split.query)
    product_id = (query.get("productId") or [match.group("product_id")])[0]
    item_id = (query.get("itemId") or [""])[0]
    vendor_item_id = (query.get("vendorItemId") or [""])[0]
    if not (product_id and item_id and vendor_item_id):
        return None

    data = response_json(response)
    if not data:
        return None

    mandatory = nested(
        data,
        "rData",
        "properties",
        "pageSession",
        "logging",
        "bypass",
        "exposureSchema",
        "mandatory",
    )
    if not isinstance(mandatory, dict):
        return None

    exact_vendor = str(mandatory.get("vendorItemId", "")) == str(vendor_item_id)
    returned = boolish(mandatory.get("isRetailReturnedItem"))
    style = mandatory.get("style")
    layout_style = mandatory.get("layoutStyle")
    used = returned is True or str(style or "").upper() == "USED" or str(layout_style or "").upper() == "USED"
    sold_out = boolish(mandatory.get("soldOut"))

    if exact_vendor and used and sold_out is True:
        state = "sold_out"
    elif exact_vendor and used and sold_out is False:
        state = "available"
    else:
        state = "unknown"

    return {
        "schemaVersion": 1,
        "endpoint": "2333",
        "httpStatus": response.get("status_code"),
        "rCode": data.get("rCode"),
        "rMessage": data.get("rMessage"),
        "product": {
            "productId": str(product_id),
            "itemId": str(item_id),
            "vendorItemId": str(vendor_item_id),
            "title": product_title(data),
        },
        "returnOffer": {
            "exactVendorFound": exact_vendor,
            "isRetailReturnedItem": returned,
            "style": style,
            "layoutStyle": layout_style,
            "offerCondition": mandatory.get("offerCondition"),
        },
        "stock": {
            "soldOut": sold_out,
            "isAlmostOOS": boolish(mandatory.get("isAlmostOOS")),
            "state": state,
        },
        "pricing": {
            "finalPrice": mandatory.get("finalPrice"),
            "discountRate": mandatory.get("discountRate"),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse exported Coupang mitmproxy flows without copying auth/session data")
    parser.add_argument("input", help="Raw mitmproxy flow dump or ZIP containing one")
    parser.add_argument("--output", default="coupang-mitm-parsed.json", help="Sanitized JSON output")
    args = parser.parse_args()

    source = Path(args.input)
    flows = parse_flow_dump(read_capture(source))
    observations = [item for flow in flows if (item := extract_observation(flow)) is not None]
    payload = {
        "schemaVersion": 1,
        "sourceFile": source.name,
        "flowCount": len(flows),
        "matched2333Responses": len(observations),
        "items": observations,
        "note": "Sanitized output only; request headers/cookies/tokens/signatures and full response bodies are intentionally omitted.",
    }
    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Saved: {args.output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
