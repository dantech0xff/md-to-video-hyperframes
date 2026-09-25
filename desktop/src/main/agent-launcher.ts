/**
 * Starts an ACP adapter with Electron's Node: `<app> agent-launcher.js <entry>`
 * with ELECTRON_RUN_AS_NODE=1. That variable is only needed to start this
 * process; removing it here keeps it out of everything the agent starts (its
 * shell commands, an Electron app it opens).
 */
import { pathToFileURL } from "node:url";

delete process.env.ELECTRON_RUN_AS_NODE;
const entry = process.argv[2];
if (!entry) {
  console.error("usage: agent-launcher <adapter entry script> [args…]");
  process.exit(2);
}
// the adapter sees itself as the script that was started
process.argv.splice(1, 2, entry);
await import(pathToFileURL(entry).href);
