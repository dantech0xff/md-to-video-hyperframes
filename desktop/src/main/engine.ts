/**
 * The main process's handle on the engine host. Starts the utility process on
 * first use (and again after a crash), loads the engine in it, replays the
 * environment it was given, and turns requests into promises.
 */
import type { FromHost, HostEvent, HostInfo, HostMethod, HostParams, HostResult, ToHost } from "../engine/protocol";

/** The utility process as the client sees it; tests pass a fake. */
export interface HostPort {
  postMessage(message: ToHost): void;
  onMessage(listener: (message: FromHost) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export interface EngineClientOptions {
  start: () => HostPort;
  engineRoot: string;
  onEvent: (event: HostEvent) => void;
  /** the host stopped: its queued and running jobs are gone */
  onExit?: (code: number) => void;
  log?: (line: string) => void;
}

export class EngineClient {
  private port?: HostPort;
  private info?: HostInfo;
  private starting?: Promise<HostInfo>;
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly env: Record<string, string | null> = {};

  constructor(private readonly opts: EngineClientOptions) {}

  /** Starts the host and loads the engine, once. */
  ensure(): Promise<HostInfo> {
    if (this.port && this.info) return Promise.resolve(this.info);
    this.starting ??= (async () => {
      const port = this.opts.start();
      this.port = port;
      port.onMessage((m) => this.onMessage(m));
      port.onExit((code) => this.onExit(port, code));
      try {
        const info = await this.request(port, "init", { engineRoot: this.opts.engineRoot });
        if (Object.keys(this.env).length) await this.request(port, "setEnv", { env: { ...this.env } });
        this.info = info;
        return info;
      } catch (e) {
        port.kill();
        if (this.port === port) this.port = undefined;
        throw e;
      }
    })().finally(() => (this.starting = undefined));
    return this.starting;
  }

  async call<M extends HostMethod>(method: M, params: HostParams<M>): Promise<HostResult<M>> {
    await this.ensure();
    return this.request(this.port!, method, params);
  }

  /** Sets engine environment variables (null removes one); kept and replayed when the host restarts. */
  async setEnv(env: Record<string, string | null>): Promise<void> {
    Object.assign(this.env, env);
    // a start under way may have sent its copy already: send the change once the host is up
    if (this.starting) await this.starting.catch(() => undefined);
    if (this.port && this.info) await this.request(this.port, "setEnv", { env });
  }

  stop(): void {
    this.port?.kill();
  }

  private request<M extends HostMethod>(port: HostPort, method: M, params: HostParams<M>): Promise<HostResult<M>> {
    const id = ++this.seq;
    return new Promise<HostResult<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      port.postMessage({ kind: "request", id, method, params });
    });
  }

  private onMessage(m: FromHost): void {
    if (m.kind === "event") {
      this.opts.onEvent(m.event);
      return;
    }
    const waiting = this.pending.get(m.id);
    if (!waiting) return;
    this.pending.delete(m.id);
    if (m.error !== undefined) waiting.reject(new Error(m.error));
    else waiting.resolve(m.result);
  }

  private onExit(port: HostPort, code: number): void {
    if (this.port !== port) return;
    this.port = undefined;
    this.info = undefined;
    this.opts.log?.(`engine host exited with code ${code}`);
    for (const [id, waiting] of this.pending) {
      this.pending.delete(id);
      waiting.reject(new Error("Engine đã dừng giữa chừng; thử lại"));
    }
    this.opts.onExit?.(code);
  }
}
