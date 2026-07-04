const express = require('express');
const cors = require('cors');
const { getDb, initSchema } = require('./db');

initSchema();
const app = express();
app.use(cors());
app.use(express.json());

// --- Endpoints CRUD ---
app.get('/api/endpoints', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM endpoints ORDER BY created_at DESC').all();
  rows.forEach(r => { r.enabled = !!r.enabled; r.headers = JSON.parse(r.headers); });
  res.json(rows);
});

app.get('/api/endpoints/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM endpoints WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  row.enabled = !!row.enabled; row.headers = JSON.parse(row.headers);
  res.json(row);
});

app.post('/api/endpoints', (req, res) => {
  const { name, url, method, headers, body, interval_sec, timeout_ms, expected_status, enabled } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  const stmt = getDb().prepare(
    `INSERT INTO endpoints (name,url,method,headers,body,interval_sec,timeout_ms,expected_status,enabled)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const info = stmt.run(name, url, method || 'GET', JSON.stringify(headers || {}), body || null,
    interval_sec || 60, timeout_ms || 5000, expected_status || 200, enabled !== false ? 1 : 0);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/endpoints/:id', (req, res) => {
  const e = getDb().prepare('SELECT id FROM endpoints WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  const { name, url, method, headers, body, interval_sec, timeout_ms, expected_status, enabled } = req.body;
  getDb().prepare(
    `UPDATE endpoints SET name=COALESCE(?,name), url=COALESCE(?,url), method=COALESCE(?,method),
     headers=COALESCE(?,headers), body=COALESCE(?,body), interval_sec=COALESCE(?,interval_sec),
     timeout_ms=COALESCE(?,timeout_ms), expected_status=COALESCE(?,expected_status),
     enabled=COALESCE(?,enabled), updated_at=datetime('now') WHERE id=?`
  ).run(name||null, url||null, method||null, headers?JSON.stringify(headers):null,
    body||null, interval_sec||null, timeout_ms||null, expected_status||null,
    enabled !== undefined ? (enabled?1:0) : null, req.params.id);
  res.json({ updated: true });
});

app.delete('/api/endpoints/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM endpoints WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// --- Checks / Metrics ---
app.post('/api/checks', (req, res) => {
  const { endpoint_id, status_code, response_time_ms, is_up, error_message } = req.body;
  if (!endpoint_id || is_up === undefined) return res.status(400).json({ error: 'endpoint_id and is_up required' });
  const info = getDb().prepare(
    `INSERT INTO checks (endpoint_id, status_code, response_time_ms, is_up, error_message)
     VALUES (?,?,?,?,?)`
  ).run(endpoint_id, status_code || null, response_time_ms || null, is_up ? 1 : 0, error_message || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.get('/api/endpoints/:id/checks', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  const since = req.query.since || null;
  let rows;
  if (since) {
    rows = getDb().prepare('SELECT * FROM checks WHERE endpoint_id=? AND checked_at>=? ORDER BY checked_at DESC LIMIT ?')
      .all(req.params.id, since, limit);
  } else {
    rows = getDb().prepare('SELECT * FROM checks WHERE endpoint_id=? ORDER BY checked_at DESC LIMIT ?')
      .all(req.params.id, limit);
  }
  rows.forEach(r => r.is_up = !!r.is_up);
  res.json(rows);
});

app.get('/api/endpoints/:id/metrics', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const row = getDb().prepare(`
    SELECT COUNT(*) as total_checks,
           SUM(is_up) as up_count,
           AVG(CASE WHEN is_up THEN response_time_ms END) as avg_response_ms,
           MAX(CASE WHEN is_up THEN response_time_ms END) as max_response_ms,
           MIN(CASE WHEN is_up THEN response_time_ms END) as min_response_ms
    FROM checks WHERE endpoint_id=? AND checked_at >= datetime('now', ?||' hours')
  `).get(req.params.id, -hours);
  row.up_count = row.up_count || 0;
  row.availability_pct = row.total_checks ? +(row.up_count / row.total_checks * 100).toFixed(2) : null;
  row.avg_response_ms = row.avg_response_ms ? +row.avg_response_ms.toFixed(2) : null;
  res.json(row);
});

// --- Alerts ---
app.post('/api/alerts', (req, res) => {
  const { endpoint_id, alert_type, message } = req.body;
  if (!endpoint_id || !alert_type || !message) return res.status(400).json({ error: 'endpoint_id, alert_type, message required' });
  const info = getDb().prepare('INSERT INTO alerts (endpoint_id, alert_type, message) VALUES (?,?,?)')
    .run(endpoint_id, alert_type, message);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.get('/api/alerts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const unack = req.query.unacknowledged === '1';
  const stmt = unack
    ? 'SELECT a.*, e.name as endpoint_name FROM alerts a JOIN endpoints e ON a.endpoint_id=e.id WHERE a.acknowledged=0 ORDER BY a.created_at DESC LIMIT ?'
    : 'SELECT a.*, e.name as endpoint_name FROM alerts a JOIN endpoints e ON a.endpoint_id=e.id ORDER BY a.created_at DESC LIMIT ?';
  const rows = getDb().prepare(stmt).all(limit);
  rows.forEach(r => r.acknowledged = !!r.acknowledged);
  res.json(rows);
});

app.get('/api/endpoints/:id/alerts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const rows = getDb().prepare('SELECT * FROM alerts WHERE endpoint_id=? ORDER BY created_at DESC LIMIT ?')
    .all(req.params.id, limit);
  rows.forEach(r => r.acknowledged = !!r.acknowledged);
  res.json(rows);
});

app.patch('/api/alerts/:id/ack', (req, res) => {
  const info = getDb().prepare('UPDATE alerts SET acknowledged=1 WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ acknowledged: true });
});

// --- Overview ---
app.get('/api/overview', (req, res) => {
  const endpoints = getDb().prepare('SELECT id, name, url, enabled FROM endpoints').all();
  const stats = getDb().prepare(`
    SELECT endpoint_id,
           SUM(is_up) as up_count,
           COUNT(*) as total,
           AVG(CASE WHEN is_up THEN response_time_ms END) as avg_rt
    FROM checks WHERE checked_at >= datetime('now', '-1 hour')
    GROUP BY endpoint_id
  `).all();
  const map = {};
  stats.forEach(s => { map[s.endpoint_id] = s; });
  const unackAlerts = getDb().prepare('SELECT COUNT(*) as cnt FROM alerts WHERE acknowledged=0').get().cnt;
  endpoints.forEach(ep => {
    const s = map[ep.id] || {};
    ep.recent_availability = s.total ? +((s.up_count / s.total) * 100).toFixed(2) : null;
    ep.recent_avg_rt = s.avg_rt ? +s.avg_rt.toFixed(2) : null;
  });
  res.json({ endpoints, unacknowledged_alerts: unackAlerts });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));

module.exports = app;