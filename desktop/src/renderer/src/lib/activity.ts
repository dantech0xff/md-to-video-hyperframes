import type { ActivityEntry, ActivityEvent, AgentState } from "../../../shared/types";

export interface ActivityView {
  entries: ActivityEntry[];
  state: AgentState;
}

/** Applies one event from the main process: a new or changed entry, or a new state. */
export function applyActivity(view: ActivityView, event: ActivityEvent): ActivityView {
  if (event.type === "state") return view.state === event.state ? view : { ...view, state: event.state };
  const i = view.entries.findIndex((e) => e.id === event.entry.id);
  if (i < 0) return { ...view, entries: [...view.entries, event.entry] };
  const entries = view.entries.slice();
  entries[i] = event.entry;
  return { ...view, entries };
}
