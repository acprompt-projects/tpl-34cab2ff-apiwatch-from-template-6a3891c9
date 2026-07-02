export interface HealthRule {
  type: "status" | "bodyRegex" | "latency";
  expectedStatus?: number;
  pattern?: string;
  thresholdMs?: number;
}

export interface EndpointConfig {
  id: string;
  name: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  intervalMs: number;
  timeoutMs?: number;
  healthRules: HealthRule[];
}

export interface RuleResult {
  rule: string;
  passed: boolean;
  detail?: string;
}

export interface CheckResult {
  endpointId: string;
  timestamp: string;
  statusCode: number;
  latencyMs: number;
  healthy: boolean;
  error: string;
  ruleResults: RuleResult[];
}

export interface EndpointSummary {
  config: EndpointConfig;
  totalChecks: number;
  uptimePercent: number;
  avgLatencyMs: number;
  lastCheck: CheckResult | null;
}

export class MetricsStore {
  private endpoints = new Map<string, EndpointConfig>();
  private results = new Map<string, CheckResult[]>();
  private maxHistory: number;

  constructor(maxHistory = 1000) {
    this.maxHistory = maxHistory;
  }

  registerEndpoint(cfg: EndpointConfig): void {
    this.endpoints.set(cfg.id, cfg);
    if (!this.results.has(cfg.id)) this.results.set(cfg.id, []);
  }

  unregisterEndpoint(id: string): void {
    this.endpoints.delete(id);
    this.results.delete(id);
  }

  listEndpoints(): EndpointConfig[] {
    return Array.from(this.endpoints.values());
  }

  getEndpoint(id: string): EndpointConfig | undefined {
    return this.endpoints.get(id);
  }

  record(result: CheckResult): void {
    const arr = this.results.get(result.endpointId);
    if (!arr) return;
    arr.push(result);
    if (arr.length > this.maxHistory) arr.splice(0, arr.length - this.maxHistory);
  }

  getHistory(endpointId: string, limit?: number): CheckResult[] {
    const arr = this.results.get(endpointId) ?? [];
    return limit ? arr.slice(-limit) : [...arr];
  }

  getSummary(endpointId: string): EndpointSummary | null {
    const config = this.endpoints.get(endpointId);
    if (!config) return null;
    const arr = this.results.get(endpointId) ?? [];
    const totalChecks = arr.length;
    const healthyCount = arr.filter((r) => r.healthy).length;
    const uptimePercent = totalChecks > 0 ? (healthyCount / totalChecks) * 100 : 100;
    const avgLatencyMs = totalChecks > 0 ? Math.round(arr.reduce((s, r) => s + r.latencyMs, 0) / totalChecks) : 0;
    const lastCheck = arr.length > 0 ? arr[arr.length - 1] : null;
    return { config, totalChecks, uptimePercent, avgLatencyMs, lastCheck };
  }

  listSummaries(): EndpointSummary[] {
    return Array.from(this.endpoints.keys()).map((id) => this.getSummary(id)!).filter(Boolean);
  }
}