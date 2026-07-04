import sqlite3
import json
import time
import logging
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional
from notifiers import Notifier

logger = logging.getLogger(__name__)


class AlertRuleType(Enum):
    CONSECUTIVE_FAILURES = "consecutive_failures"
    LATENCY_SPIKE = "latency_spike"
    STATUS_CHANGE = "status_change"


class AlertSeverity(Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class AlertRule:
    rule_id: str
    endpoint_id: str
    rule_type: AlertRuleType
    threshold: int  # count for failures, ms for latency, ignored for status_change
    severity: AlertSeverity = AlertSeverity.WARNING
    enabled: bool = True
   cooldown_seconds: int = 300


@dataclass
class HealthResult:
    endpoint_id: str
    url: str
    status: str  # "up" or "down"
    status_code: Optional[int]
    latency_ms: float
    timestamp: float
    error: Optional[str] = None


@dataclass
class AlertEvent:
    event_id: Optional[int]
    endpoint_id: str
    rule_id: str
    rule_type: str
    severity: str
    message: str
    timestamp: float
    acknowledged: bool = False


class AlertEngine:
    def __init__(self, db_path: str = "alert_history.db"):
        self.db_path = db_path
        self.rules: dict[str, AlertRule] = {}
        self._state: dict[str, dict] = {}  # endpoint_id -> tracking state
        self._last_alert: dict[str, float] = {}  # "endpoint:rule" -> last alert ts
        self.notifier = Notifier()
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS alert_history (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    endpoint_id TEXT NOT NULL,
                    rule_id TEXT NOT NULL,
                    rule_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    message TEXT NOT NULL,
                    timestamp REAL NOT NULL,
                    acknowledged INTEGER NOT NULL DEFAULT 0
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_endpoint ON alert_history(endpoint_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_timestamp ON alert_history(timestamp)"
            )

    def add_rule(self, rule: AlertRule):
        self.rules[rule.rule_id] = rule
        if rule.endpoint_id not in self._state:
            self._state[rule.endpoint_id] = {
                "consecutive_failures": 0,
                "last_status": None,
            }

    def remove_rule(self, rule_id: str):
        self.rules.pop(rule_id, None)

    def evaluate(self, result: HealthResult):
        ep_rules = [r for r in self.rules.values()
                    if r.enabled and r.endpoint_id == result.endpoint_id]
        if not ep_rules:
            return
        state = self._state.setdefault(result.endpoint_id, {
            "consecutive_failures": 0, "last_status": None
        })
        for rule in ep_rules:
            triggered, message = self._check_rule(rule, result, state)
            cooldown_key = f"{result.endpoint_id}:{rule.rule_id}"
            if triggered:
                now = time.time()
                last = self._last_alert.get(cooldown_key, 0)
                if now - last < rule.cooldown_seconds:
                    continue
                self._last_alert[cooldown_key] = now
                event = AlertEvent(
                    event_id=None,
                    endpoint_id=result.endpoint_id,
                    rule_id=rule.rule_id,
                    rule_type=rule.rule_type.value,
                    severity=rule.severity.value,
                    message=message,
                    timestamp=now,
                )
                self._persist(event)
                self.notifier.send(event, result)
                logger.info("Alert fired: %s", message)
        # Update state
        if result.status == "down":
            state["consecutive_failures"] += 1
        else:
            state["consecutive_failures"] = 0
        state["last_status"] = result.status

    def _check_rule(self, rule: AlertRule, result: HealthResult,
                    state: dict) -> tuple[bool, str]:
        if rule.rule_type == AlertRuleType.CONSECUTIVE_FAILURES:
            count = state["consecutive_failures"] + (1 if result.status == "down" else 0)
            if count >= rule.threshold:
                return True, (
                    f"[{rule.severity.value.upper()}] {result.endpoint_id} down "
                    f"{count} consecutive times (threshold: {rule.threshold})"
                )
        elif rule.rule_type == AlertRuleType.LATENCY_SPIKE:
            if result.latency_ms > rule.threshold:
                return True, (
                    f"[{rule.severity.value.upper()}] {result.endpoint_id} latency "
                    f"{result.latency_ms:.0f}ms exceeds {rule.threshold}ms"
                )
        elif rule.rule_type == AlertRuleType.STATUS_CHANGE:
            prev = state.get("last_status")
            if prev and prev != result.status:
                return True, (
                    f"[{rule.severity.value.upper()}] {result.endpoint_id} status "
                    f"changed: {prev} -> {result.status}"
                )
        return False, ""

    def _persist(self, event: AlertEvent):
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.execute(
                "INSERT INTO alert_history (endpoint_id,rule_id,rule_type,severity,"
                "message,timestamp,acknowledged) VALUES (?,?,?,?,?,?,?)",
                (event.endpoint_id, event.rule_id, event.rule_type,
                 event.severity, event.message, event.timestamp,
                 int(event.acknowledged)),
            )
            event.event_id = cur.lastrowid

    def get_history(self, endpoint_id: str = None, limit: int = 50,
                    offset: int = 0) -> list[dict]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            if endpoint_id:
                rows = conn.execute(
                    "SELECT * FROM alert_history WHERE endpoint_id=? "
                    "ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                    (endpoint_id, limit, offset),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM alert_history ORDER BY timestamp DESC "
                    "LIMIT ? OFFSET ?", (limit, offset),
                ).fetchall()
            return [dict(r) for r in rows]

    def acknowledge(self, event_id: int) -> bool:
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.execute(
                "UPDATE alert_history SET acknowledged=1 WHERE event_id=?",
                (event_id,),
            )
            return cur.rowcount > 0