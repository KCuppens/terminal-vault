export interface HostKeyChange {
  addrPort: string;
  pinned: string;
  offered: string;
}

/** Matches `changed_message` in src-tauri/src/sessions.rs; keep the two in step. */
const CHANGED = /host key for (.+?) changed \(on record (.+?), presented (.+?)\)/;

export function parseHostKeyChange(message: string): HostKeyChange | null {
  const match = CHANGED.exec(message);
  if (!match) return null;
  return { addrPort: match[1]!, pinned: match[2]!, offered: match[3]! };
}

/** Shortens `SHA256:Qx8f...k2A` for display; the full value stays available for copying. */
export function shortFingerprint(fp: string, head = 14, tail = 4): string {
  return fp.length <= head + tail + 3 ? fp : `${fp.slice(0, head)}...${fp.slice(-tail)}`;
}
