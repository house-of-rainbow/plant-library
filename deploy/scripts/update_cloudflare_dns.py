#!/usr/bin/env python3
"""Manage Cloudflare TXT + CNAME records required for ACA custom domains.

Mirrors the pattern used across the estate: for each custom domain it upserts
  * a TXT record  `asuid.<domain>`  = the Container App custom-domain
    verification id (proves domain ownership to Azure), and
  * a CNAME record `<domain>`       -> the Container App default FQDN
    (proxied=false so Cloudflare's orange-cloud doesn't break ACA validation).

Records are upserted (created or updated in place) so re-runs are idempotent.
Requires the CLOUDFLARE_API_TOKEN environment variable (a scoped API token).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List

API_BASE = "https://api.cloudflare.com/client/v4"


def load_deployments(path: str) -> List[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except OSError as exc:
        raise RuntimeError(f"Unable to read deployment file {path}: {exc}") from exc

    deployments = data.get("appDeployments")
    if not isinstance(deployments, list):
        raise RuntimeError("Deployment file must contain an 'appDeployments' array.")
    return deployments


def load_app_fqdn_map(raw_json: str) -> Dict[str, str]:
    try:
        payload = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Unable to parse app FQDN JSON payload.") from exc

    if not isinstance(payload, list):
        raise RuntimeError("App FQDN payload must be an array of objects.")

    mapping: Dict[str, str] = {}
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        custom_domain = str(entry.get("customDomain") or "").strip().lower()
        if not custom_domain:
            continue
        default_fqdn = str(entry.get("defaultFqdn") or "").strip()
        if not default_fqdn:
            raise RuntimeError(f"Deployment output is missing default FQDN for {custom_domain}.")
        mapping[custom_domain] = default_fqdn

    if not mapping:
        raise RuntimeError("App FQDN payload did not contain any custom domains.")

    return mapping


def iter_targets(
    deployments: Iterable[Dict[str, Any]],
    app_fqdn_map: Dict[str, str],
) -> Iterable[Dict[str, str]]:
    for entry in deployments:
        dns_name = str(entry.get("dnsName") or "").strip().lower()
        if not dns_name:
            continue
        zone_name = str(entry.get("cloudflareZoneName") or "").strip()
        zone_id = str(entry.get("cloudflareZoneId") or "").strip()
        if not zone_name or not zone_id:
            raise RuntimeError(
                f"Deployment entry for {dns_name or '[missing]'} is missing Cloudflare zone info."
            )

        default_fqdn = app_fqdn_map.get(dns_name)
        if not default_fqdn:
            raise RuntimeError(
                f"Container App deployment output did not include an FQDN for {dns_name}."
            )

        yield {
            "fqdn": dns_name,
            "txt_record_fqdn": f"asuid.{dns_name}",
            "zone_name": zone_name,
            "zone_id": zone_id,
            "default_fqdn": default_fqdn,
        }


def cloudflare_request(
    method: str,
    url: str,
    token: str,
    payload: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(request) as response:  # noqa: S310 - explicit endpoint
            raw = response.read()
    except urllib.error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Cloudflare API {method} {url} failed: {exc.code} {message}") from exc

    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Unable to parse Cloudflare API response as JSON") from exc

    return decoded


def find_existing_record(
    zone_id: str,
    record_fqdn: str,
    record_type: str,
    token: str,
) -> Dict[str, Any] | None:
    params = urllib.parse.urlencode({"type": record_type, "name": record_fqdn})
    url = f"{API_BASE}/zones/{zone_id}/dns_records?{params}"
    response = cloudflare_request("GET", url, token)
    if not response.get("success"):
        raise RuntimeError(f"Cloudflare API error: {response.get('errors')}")

    for record in response.get("result", []):
        if record.get("name", "").lower() == record_fqdn.lower():
            return record
    return None


def upsert_dns_record(
    *,
    token: str,
    zone_id: str,
    record_type: str,
    name: str,
    content: str,
    ttl_seconds: int,
    comment: str,
    proxied: bool | None = None,
) -> None:
    payload: Dict[str, Any] = {
        "type": record_type,
        "name": name,
        "content": content,
        "ttl": ttl_seconds,
        "comment": comment,
    }

    if proxied is not None:
        payload["proxied"] = proxied

    existing = find_existing_record(zone_id, name, record_type, token)
    if existing:
        record_id = existing.get("id")
        if not record_id:
            raise RuntimeError("Existing record missing identifier; cannot update.")
        url = f"{API_BASE}/zones/{zone_id}/dns_records/{record_id}"
        action = "PUT"
    else:
        url = f"{API_BASE}/zones/{zone_id}/dns_records"
        action = "POST"

    response = cloudflare_request(action, url, token, payload)
    if not response.get("success"):
        raise RuntimeError(f"Cloudflare API error: {response.get('errors')}")

    verb = "Updated" if existing else "Created"
    print(f"{verb} {record_type} {name} -> {content}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Manage Cloudflare TXT and CNAME records required for ACA custom domains."
    )
    parser.add_argument(
        "--app-deployments-file",
        required=True,
        help="Path to a JSON file that contains an 'appDeployments' array "
        "(each entry: dnsName, cloudflareZoneName, cloudflareZoneId).",
    )
    parser.add_argument(
        "--verification-token",
        required=True,
        help="Container App custom-domain verification id (asuid TXT content).",
    )
    parser.add_argument(
        "--app-fqdns-json",
        required=True,
        help="JSON array mapping custom domains to their Container App default FQDN, "
        'e.g. [{"customDomain":"plants.example.com","defaultFqdn":"app.xyz.azurecontainerapps.io"}]',
    )
    parser.add_argument(
        "--ttl-seconds",
        type=int,
        default=300,
        help="TTL for created records.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        raise RuntimeError("CLOUDFLARE_API_TOKEN environment variable is required.")

    app_fqdn_map = load_app_fqdn_map(args.app_fqdns_json)
    deployments = load_deployments(args.app_deployments_file)
    targets = list(iter_targets(deployments, app_fqdn_map))
    if not targets:
        print("No DNS targets discovered; nothing to do.")
        return

    for target in targets:
        upsert_dns_record(
            token=token,
            zone_id=target["zone_id"],
            record_type="TXT",
            name=target["txt_record_fqdn"],
            content=args.verification_token,
            ttl_seconds=args.ttl_seconds,
            comment=f"ACA verification TXT for {target['fqdn']}",
        )

        upsert_dns_record(
            token=token,
            zone_id=target["zone_id"],
            record_type="CNAME",
            name=target["fqdn"],
            content=target["default_fqdn"],
            ttl_seconds=args.ttl_seconds,
            proxied=False,
            comment=f"ACA ingress for {target['fqdn']}",
        )


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
