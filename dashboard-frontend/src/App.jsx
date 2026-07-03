import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';
const STATUS_COLORS = { healthy: 'bg-emerald-500', degraded: 'bg-amber-500', down: 'bg-red-500' };

function useApi() {
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/endpoints`);
      const data = await res.json();
      setEndpoints(data);
    } catch (e) { console.error('Fetch error', e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchAll(); const id = setInterval(fetchAll, 30000); return () => clearInterval(id); }, [fetchAll]);
  const addEndpoint = async (url, name) => {
    await fetch(`${API_BASE}/endpoints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, name }) });
    fetchAll();
  };
  const removeEndpoint = async (id) => {
    await fetch(`${API_BASE}/endpoints/${id}`, { method: 'DELETE' });
    fetchAll();
  };
  return { endpoints, loading, addEndpoint, removeEndpoint };
}

function AddForm({ onAdd }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const submit = (e) => { e.preventDefault(); if (url && name) { onAdd(url, name); setUrl(''); setName(''); setOpen(false); } };
  if (!open) return <button onClick={() => setOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">+ Add Endpoint</button>;
  return (
    <form onSubmit={submit} className="flex gap-2 items-center flex-wrap">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="border rounded px-3 py-2 text-sm" required />
      <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/health" className="border rounded px-3 py-2 text-sm flex-1 min-w-[200px]" required />
      <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded text-sm">Save</button>
      <button type="button" onClick={() => setOpen(false)} className="text-gray-500 px-2">Cancel</button>
    </form>
  );
}

function EndpointCard({ ep, onSelect, onRemove }) {
  const pct = ep.uptimePercent != null ? ep.uptimePercent.toFixed(2) : '—';
  const avgMs = ep.avgResponseMs != null ? Math.round(ep.avgResponseMs) : '—';
  const statusDot = STATUS_COLORS[ep.status] || 'bg-gray-400';
  return (
    <div className="bg-white rounded-xl shadow-sm border p-5 hover:shadow-md transition cursor-pointer flex flex-col gap-3" onClick={() => onSelect(ep)}>
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2"><span className={`w-3 h-3 rounded-full ${statusDot}`}></span><h3 className="font-semibold text-gray-900 truncate">{ep.name}</h3></div>
        <button onClick={e => { e.stopPropagation(); onRemove(ep.id); }} className="text-gray-300 hover:text-red-500 text-lg leading-none" title="Remove">&times;</button>
      </div>
      <p className="text-xs text-gray-400 truncate">{ep.url}</p>
      <div className="flex gap-4 text-sm">
        <div><span className="text-gray-500">Uptime</span><p className="font-bold text-gray-800">{pct}%</p></div>
        <div><span className="text-gray-500">Avg RT</span><p className="font-bold text-gray-800">{avgMs} ms</p></div>
        <div><span className="text-gray-500">Status</span><p className="font-bold text-gray-800 capitalize">{ep.status || 'unknown'}</p></div>
      </div>
    </div>
  );
}

function DetailPanel({ ep, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!ep) return;
    fetch(`${API_BASE}/endpoints/${ep.id}/metrics`).then(r => r.json()).then(setData).catch(console.error);
  }, [ep]);
  if (!ep) return null;
  const chartData = (data?.responseTimes || []).map((rt, i) => ({ i: i + 1, ms: rt.responseMs, status: rt.statusCode }));
  const incidents = data?.incidents || [];
  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">{ep.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <p className="text-sm text-gray-500 mb-4">{ep.url}</p>
        <h3 className="font-semibold text-gray-700 mb-2">Response Time (last 50 checks)</h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="i" label={{ value: 'Check #', position: 'insideBottom', offset: -5 }} /><YAxis unit="ms" /><Tooltip formatter={(v, n) => [`${v} ms`, n]} /><Line type="monotone" dataKey="ms" stroke="#6366f1" strokeWidth={2} dot={false} /></LineChart>
          </ResponsiveContainer>
        ) : <p className="text-sm text-gray-400">No data yet</p>}
        <h3 className="font-semibold text-gray-700 mt-6 mb-2">Incident History</h3>
        {incidents.length > 0 ? (
          <ul className="space-y-2">{incidents.map((inc, i) => (
            <li key={i} className="border rounded-lg p-3 text-sm flex justify-between">
              <span className={`inline-block w-2 h-2 mt-1.5 rounded-full ${inc.resolved ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
              <div className="flex-1 ml-2"><p className="font-medium text-gray-800">{inc.message || 'Endpoint down'}</p><p className="text-gray-400 text-xs">{new Date(inc.startedAt).toLocaleString()} {inc.resolved ? `→ resolved ${new Date(inc.resolvedAt).toLocaleString()}` : '— ongoing'}</p></div>
            </li>
          ))}</ul>
        ) : <p className="text-sm text-gray-400">No incidents recorded</p>}
      </div>
    </div>
  );
}

export default function App() {
  const { endpoints, loading, addEndpoint, removeEndpoint } = useApi();
  const [selected, setSelected] = useState(null);
  const overallUp = endpoints.filter(e => e.status === 'healthy').length;
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><h1 className="text-xl font-bold text-gray-900">APIWatch</h1><span className="text-sm text-gray-400">{loading ? 'Loading…' : `${overallUp}/${endpoints.length} healthy`}</span></div>
          <AddForm onAdd={addEndpoint} />
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        {endpoints.length === 0 && !loading ? (
          <div className="text-center py-20 text-gray-400"><p className="text-lg">No endpoints monitored yet.</p><p className="text-sm mt-1">Click "+ Add Endpoint" to get started.</p></div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {endpoints.map(ep => <EndpointCard key={ep.id} ep={ep} onSelect={setSelected} onRemove={removeEndpoint} />)}
          </div>
        )}
      </main>
      {selected && <DetailPanel ep={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}