import http from "http";
import https from "https";
import { URL } from "url";
import { MetricsStore, CheckResult, EndpointConfig, HealthRule } from "./store";

export class MonitorEngine {
  private timers = new Map<string, NodeJS.Timeout>();
  private store: MetricsStore;
  private running = false;

  constructor(store: MetricsStore) {
    this.store = store;
  }

  async addEndpoint(config: EndpointConfig): Promise<void> {
    this.store.registerEndpoint(config);
    if (this.running) this.schedule(config);
  }

  removeEndpoint(id: string): void {
    const t = this.timers.get(id);
    if (t) { clearInterval(t); this.timers.delete(id); }
    this.store.unregisterEndpoint(id);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const cfg of this.store.listEndpoints()) this.schedule(cfg);
  }

  stop(): void {
    this.running = false;
    for (const [id, t] of this.timers) { clearInterval(t); this.timers.delete(id); }
  }

  private schedule(cfg: EndpointConfig): void {
    if (this.timers.has(cfg.id)) clearInterval(this.timers.get(cfg.id)!);
    const run = () => this.performCheck(cfg).catch(() => {});
    run();
    this.timers.set(cfg.id, setInterval(run, cfg.intervalMs));
  }

  private async performCheck(cfg: EndpointConfig): Promise<void> {
    const start = Date.now();
    let statusCode = 0;
    let body = "";
    let error = "";
    try {
      const resp = await this.httpRequest(cfg);
      statusCode = resp.statusCode;
      body = resp.body;
    } catch (e: any) {
      error = e.message || "request failed";
    }
    const latencyMs = Date.now() - start;
    const ruleResults = this.evaluateRules(cfg.healthRules, statusCode, body, latencyMs);
    const healthy = error === "" && ruleResults.every((r) => r.passed);
    const result: CheckResult = {
      endpointId: cfg.id,
      timestamp: new Date().toISOString(),
      statusCode,
      latencyMs,
      healthy,
      error,
      ruleResults,
    };
    this.store.record(result);
  }

  private evaluateRules(rules: HealthRule[], status: number, body: string, latency: number): { rule: string; passed: boolean; detail?: string }[] {
    return rules.map((rule) => {
      switch (rule.type) {
        case "status": {
          const expected = rule.expectedStatus ?? 200;
          const passed = status === expected;
          return { rule: `status:${expected}`, passed, detail: `got ${status}` };
        }
        case "bodyRegex": {
          const re = new RegExp(rule.pattern!);
          const passed = re.test(body);
          return { rule: `bodyRegex:${rule.pattern}`, passed, detail: passed ? "matched" : "no match" };
        }
        case "latency": {
          const threshold = rule.thresholdMs ?? 5000;
          const passed = latency <= threshold;
          return { rule: `latency<=${threshold}ms`, passed, detail: `${latency}ms` };
        }
        default:
          return { rule: `unknown:${rule.type}`, passed: true, detail: "skipped" };
      }
    });
  }

  private httpRequest(cfg: EndpointConfig): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(cfg.url);
      const mod = url.protocol === "https:" ? https : http;
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: cfg.method || "GET",
        headers: { "User-Agent": "api-watch/1.0", ...cfg.headers },
        timeout: cfg.timeoutMs || 10000,
      };
      const req = mod.request(options, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer | string) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      if (cfg.body) req.write(cfg.body);
      req.end();
    });
  }
}