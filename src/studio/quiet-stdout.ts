/**
 * Imported first by the Studio CLI, before anything that logs: over stdio,
 * stdout carries MCP messages only, so console output (the engine's log,
 * dotenv's notices) goes to stderr instead.
 */
process.env.DOTENV_CONFIG_QUIET ??= "true";
console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
