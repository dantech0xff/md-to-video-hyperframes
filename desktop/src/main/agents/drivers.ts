/**
 * The agents Get Frames drives (design doc §4), one driver each: finding and
 * checking the program the user installed, and starting it as an ACP agent.
 * What the app then allows each of them is in policy.ts.
 */
import type { AgentId, AgentStatus } from "../../shared/types";
import type { Launch } from "./acp";
import { claudeLaunch, detectClaude } from "./claude-code";
import { codexLaunch, detectCodex } from "./codex";
import { detectDevin, devinLaunch } from "./devin";

export interface LaunchOptions {
  /** the agent's program, as detect() found it */
  program: string;
  /** the project folder */
  cwd: string;
  /** PATH for the agent and everything it runs */
  pathValue: string;
  /** a folder for the agent's own logs */
  logsDir: string;
}

export interface AgentDriver {
  /** Finds the program (`override` is the path set in Settings) and checks its version and login. */
  detect(pathValue: string, override: string): Promise<AgentStatus>;
  launch(opts: LaunchOptions): Launch;
}

export const DRIVERS: Record<AgentId, AgentDriver> = {
  "claude-code": { detect: detectClaude, launch: claudeLaunch },
  codex: { detect: detectCodex, launch: codexLaunch },
  devin: { detect: detectDevin, launch: devinLaunch },
};
