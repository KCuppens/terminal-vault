import type { Host, HostInput } from "../ipc/types";

export interface ImportCandidate {
  input: HostInput;
  /** Already in the vault by name or by user, address and port, or repeated earlier in the file. */
  duplicate: boolean;
}

const lower = (s: string) => s.trim().toLowerCase();
const endpoint = (h: Pick<Host, "user" | "addr" | "port">) => `${lower(h.user)}@${lower(h.addr)}:${h.port}`;

export function markCandidates(found: HostInput[], existing: Host[]): ImportCandidate[] {
  const names = new Set(existing.map((h) => lower(h.name)));
  const endpoints = new Set(existing.map(endpoint));
  return found.map((input) => {
    const duplicate = names.has(lower(input.name)) || endpoints.has(endpoint(input));
    names.add(lower(input.name));
    endpoints.add(endpoint(input));
    return { input, duplicate };
  });
}

/** Indexes of everything that can be imported without clashing. */
export function defaultSelection(candidates: ImportCandidate[]): Set<number> {
  const selected = new Set<number>();
  candidates.forEach((c, i) => {
    if (!c.duplicate) selected.add(i);
  });
  return selected;
}

export function toggleSelection(selected: Set<number>, index: number): Set<number> {
  const next = new Set(selected);
  if (!next.delete(index)) next.add(index);
  return next;
}
