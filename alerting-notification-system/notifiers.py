import json
import logging
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class WebhookConfig:
    url: str
    webhook_type: str = "generic"  # "slack", "discord", "generic"
    headers: dict = field(default_factory=dict)
    enabled: bool = True


def _build_slack_payload(event, result) -> dict:
    color = {"critical": "danger", "warning": "warning", "info": "good"}.get(
        event.severity, "warning"
    )
    return {
        "attachments": [{
            "color": color,
            "title": f"API Alert: {event.rule_type}",
            "text": event.message,
            "fields": [
                {"title": "Endpoint", "value": result.url, "short": True},
                {"title": "Status", "value": result.status, "short": True},
                {"title": "Latency", "value": f"{result.latency_ms:.0f}ms", "short": True},
                {"title": "Severity", "value": event.severity.upper(), "short": True},
            ],
            "ts": int(event.timestamp),
        }]
    }


def _build_discord_payload(event, result) -> dict:
    color = {"critical": 15158332, "warning": 16776960, "info": 3447003}.get(
        event.severity, 16776960
    )
    return {
        "embeds": [{
            "title": f"API Alert: {event.rule_type}",
            "description": event.message,
            "color": color,
            "fields": [
                {"name": "Endpoint", "value": result.url, "inline": True},
                {"name": "Status", "value": result.status, "inline": True},
                {"name": "Latency", "value": f"{result.latency_ms:.0f}ms", "inline": True},
                {"name": "Severity", "value": event.severity.upper(), "inline": True},
            ],
            "timestamp": _iso_timestamp(event.timestamp),
        }]
    }


def _build_generic_payload(event, result) -> dict:
    return {
        "event_id": event.event_id,
        "endpoint_id": event.endpoint_id,
        "rule_id": event.rule_id,
        "rule_type": event.rule_type,
        "severity": event.severity,
        "message": event.message,
        "timestamp": event.timestamp,
        "url": result.url,
        "status": result.status,
        "latency_ms": result.latency_ms,
    }


def _iso_timestamp(ts: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


_BUILDERS = {
    "slack": _build_slack_payload,
    "discord": _build_discord_payload,
    "generic": _build_generic_payload,
}


class Notifier:
    def __init__(self):
        self.webhooks: list[WebhookConfig] = []

    def add_webhook(self, config: WebhookConfig):
        self.webhooks.append(config)

    def remove_webhook(self, url: str):
        self.webhooks = [w for w in self.webhooks if w.url != url]

    def send(self, event, result) -> list[dict]:
        outcomes = []
        for wh in self.webhooks:
            if not wh.enabled:
                continue
            builder = _BUILDERS.get(wh.webhook_type, _build_generic_payload)
            payload = builder(event, result)
            ok = self._post(wh, payload)
            outcomes.append({"webhook": wh.url, "type": wh.webhook_type, "success": ok})
        return outcomes

    def _post(self, wh: WebhookConfig, payload: dict) -> bool:
        body = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        headers.update(wh.headers)
        req = urllib.request.Request(wh.url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                logger.info("Webhook %s responded %d", wh.webhook_type, resp.status)
                return 200 <= resp.status < 300
        except urllib.error.URLError as exc:
            logger.error("Webhook %s failed: %s", wh.webhook_type, exc)
            return False
        except Exception as exc:
            logger.error("Webhook %s unexpected error: %s", wh.webhook_type, exc)
            return False