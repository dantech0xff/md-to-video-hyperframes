/** A brand kit id: a folder name of the library, never a path (the engine's rule too). */
export function isBrandId(id: unknown): id is string {
  return typeof id === "string" && /^[\w-]+$/.test(id);
}
