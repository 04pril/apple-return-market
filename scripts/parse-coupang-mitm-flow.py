#!/usr/bin/env python3
"""Offline parser for exported mitmproxy Coupang captures.

This script reads one or more raw mitmproxy flow dumps (or ZIPs containing
one), finds successful Coupang endpoint-2333 product responses, and writes only
sanitized stock data. Request headers, cookies, authorization values,
signatures, device identifiers, and full response bodies are never copied to
the output.

With --queue, the parser joins captured responses to a queue produced by
build-coupang-app-queue.mjs and emits a stock-latest-compatible result. Queue
items that were not observed stay `unknown` rather than being guessed.

Examples:
  py scripts/parse-coupang-mitm-flow.py "TalkFile_flows (1).zip"
  py scripts/parse-coupang-mitm-flow.py batch1.zip batch2.zip --queue coupang-app-queue-iphone.json --output stock-latest-iphone.json
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
from datetime import datetime, timezone
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
                raise ValueError(f"{path}: ZIP does not contain a flow file")
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


def iso_timestamp(value: Any) -> str | None:
    try:
        if value is None:
            return None
        return datetime.fromtimestamp(float(value), timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError):
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
                    entry.get("text", "")
                    for entry in title
                    if isinstance(entry, dict) and isinstance(entry.get("text"), str)
                ).strip()
                if text:
                    return text
    return None


def canonical_url(product_id: str, item_id: str, vendor_item_id: str) -> str:
    query = urllib.parse.urlencode(
        {
            "itemId": item_id,
            "vendorItemId": vendor_item_id,
            "landingType": "USED_DETAIL",
        }
    )
    return f"https://www.coupang.com/vp/products/{product_id}?{query}"


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

    checked_at = (
        iso_timestamp(response.get("timestamp_end"))
        or iso_timestamp(response.get("timestamp_start"))
        or iso_timestamp(request.get("timestamp_end"))
        or iso_timestamp(request.get("timestamp_start"))
    )

    return {
        "schemaVersion": 1,
        "endpoint": "2333",
        "checkedAt": checked_at,
        "httpStatus": response.get("status_code"),
        "rCode": data.get("rCode"),
        "rMessage": data.get("rMessage"),
        "product": {
            "productId": str(product_id),
            "itemId": str(item_id),
            "vendorItemId": str(vendor_item_id),
            "title": product_title(data),
            "url": canonical_url(str(product_id), str(item_id), str(vendor_item_id)),
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


def load_queue(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise ValueError(f"{path}: queue JSON does not contain an items array")

    cleaned: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        product_id = str(item.get("productId", ""))
        item_id = str(item.get("itemId", ""))
        vendor_item_id = str(item.get("vendorItemId", ""))
        if not (product_id.isdigit() and item_id.isdigit() and vendor_item_id.isdigit()):
            continue
        cleaned.append({**item, "queueIndex": index})
    return cleaned


def latest_by_vendor(observations: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for observation in observations:
        vendor_item_id = str(nested(observation, "product", "vendorItemId") or "")
        if not vendor_item_id:
            continue
        current = latest.get(vendor_item_id)
        if current is None:
            latest[vendor_item_id] = observation
            continue
        current_at = str(current.get("checkedAt") or "")
        next_at = str(observation.get("checkedAt") or "")
        if not current_at or not next_at or next_at >= current_at:
            latest[vendor_item_id] = observation
    return latest


def reason_for(observation: dict[str, Any] | None) -> str:
    if observation is None:
        return "not_observed"
    state = nested(observation, "stock", "state")
    sold_out = nested(observation, "stock", "soldOut")
    if state == "available" and sold_out is False:
        return "app_exact_vendor_soldOut_false"
    if state == "sold_out" and sold_out is True:
        return "app_exact_vendor_soldOut_true"
    return "app_response_ambiguous"


def summarize(items: dict[str, dict[str, Any]]) -> dict[str, int]:
    summary = {"available": 0, "sold_out": 0, "unknown": 0}
    for item in items.values():
        status = item.get("status")
        if status in summary:
            summary[status] += 1
    return summary


def build_stock_payload(
    queue_path: Path,
    queue_items: list[dict[str, Any]],
    observations: list[dict[str, Any]],
    capture_paths: list[Path],
) -> dict[str, Any]:
    observed = latest_by_vendor(observations)
    items: dict[str, dict[str, Any]] = {}
    completed = 0
    times: list[str] = []

    for queued in queue_items:
        vendor_item_id = str(queued["vendorItemId"])
        observation = observed.get(vendor_item_id)
        if observation is not None:
            completed += 1
            if observation.get("checkedAt"):
                times.append(str(observation["checkedAt"]))

        status = str(nested(observation, "stock", "state") or "unknown") if observation else "unknown"
        if status not in {"available", "sold_out", "unknown"}:
            status = "unknown"

        product_id = str(queued["productId"])
        item_id = str(queued["itemId"])
        queue_url = str(queued.get("url") or canonical_url(product_id, item_id, vendor_item_id))
        name = str(
            (nested(observation, "product", "title") if observation else None)
            or queued.get("name")
            or f"product-{product_id}"
        )

        result = {
            "key": f"vendor:{vendor_item_id}",
            "name": name,
            "source": "coupang-ios-app-via-mitmproxy",
            "sourceIndex": queued.get("sourceIndex", queued.get("queueIndex")),
            "url": queue_url,
            "productId": product_id,
            "itemId": item_id,
            "vendorItemId": vendor_item_id,
            "condition": (
                nested(observation, "returnOffer", "offerCondition") if observation else None
            ) or queued.get("condition") or "",
            "snapshotStatus": queued.get("snapshotStatus", ""),
            "status": status,
            "reason": reason_for(observation),
            "checkedAt": observation.get("checkedAt") if observation else None,
            "httpStatus": observation.get("httpStatus") if observation else None,
            "isRetailReturnedItem": nested(observation, "returnOffer", "isRetailReturnedItem") if observation else None,
            "style": nested(observation, "returnOffer", "style") if observation else None,
            "layoutStyle": nested(observation, "returnOffer", "layoutStyle") if observation else None,
            "isAlmostOOS": nested(observation, "stock", "isAlmostOOS") if observation else None,
            "finalPrice": nested(observation, "pricing", "finalPrice") if observation else None,
            "discountRate": nested(observation, "pricing", "discountRate") if observation else None,
        }
        items[result["key"]] = result

    times.sort()
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "schemaVersion": 1,
        "source": "coupang-ios-app-via-mitmproxy",
        "queueFile": queue_path.name,
        "captureFiles": [path.name for path in capture_paths],
        "startedAt": times[0] if times else None,
        "updatedAt": times[-1] if times else now,
        "finishedAt": times[-1] if completed == len(queue_items) and times else None,
        "totalTargets": len(queue_items),
        "completedTargets": completed,
        "summary": summarize(items),
        "items": items,
        "note": "Only exact vendorItemId app responses are used. Unobserved queue items remain unknown. Auth/session request data is intentionally omitted.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Parse exported Coupang mitmproxy flows without copying auth/session data"
    )
    parser.add_argument("inputs", nargs="+", help="Raw mitmproxy flow dump(s) or ZIP(s) containing one")
    parser.add_argument("--queue", help="Optional queue JSON from build-coupang-app-queue.mjs")
    parser.add_argument("--output", default="coupang-mitm-parsed.json", help="Sanitized JSON output")
    args = parser.parse_args()

    capture_paths = [Path(value) for value in args.inputs]
    observations: list[dict[str, Any]] = []
    total_flows = 0

    for source in capture_paths:
        flows = parse_flow_dump(read_capture(source))
        total_flows += len(flows)
        observations.extend(
            item for flow in flows if (item := extract_observation(flow)) is not None
        )

    if args.queue:
        queue_path = Path(args.queue)
        queue_items = load_queue(queue_path)
        payload = build_stock_payload(queue_path, queue_items, observations, capture_paths)
        payload["flowCount"] = total_flows
        payload["matched2333Responses"] = len(observations)
    else:
        payload = {
            "schemaVersion": 1,
            "captureFiles": [path.name for path in capture_paths],
            "flowCount": total_flows,
            "matched2333Responses": len(observations),
            "items": observations,
            "note": "Sanitized output only; request headers/cookies/tokens/signatures and full response bodies are intentionally omitted.",
        }

    Path(args.output).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Saved: {args.output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
