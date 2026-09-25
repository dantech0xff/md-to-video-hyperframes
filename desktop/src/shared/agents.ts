/** The agents Get Frames drives (design doc §4), as the screens and messages name them. */
import type { AgentId, AgentStatus, Settings } from "./types";

export interface AgentInfo {
  id: AgentId;
  name: string;
  /** the maker's install guide */
  installUrl: string;
  /** what to run in a terminal to log in */
  loginCommand: string;
  /** the program the user installs, and its key in Settings.paths */
  program: keyof Settings["paths"] & ("claude" | "codex" | "devin");
}

export const AGENTS: Record<AgentId, AgentInfo> = {
  "claude-code": { id: "claude-code", name: "Claude Code", installUrl: "https://docs.claude.com/en/docs/claude-code/setup", loginCommand: "claude", program: "claude" },
  codex: { id: "codex", name: "Codex", installUrl: "https://developers.openai.com/codex/cli", loginCommand: "codex login", program: "codex" },
  devin: { id: "devin", name: "Devin", installUrl: "https://docs.devin.ai/cli", loginCommand: "devin auth login", program: "devin" },
};

export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && Object.hasOwn(AGENTS, value);
}

/** An agent not found (yet): its name, where to get it and how to log in. */
export function agentStatus(id: AgentId): AgentStatus {
  const { name, installUrl, loginCommand } = AGENTS[id];
  return { id, name, installed: false, loggedIn: null, installUrl, loginCommand };
}
