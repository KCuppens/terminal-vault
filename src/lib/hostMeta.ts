import type { Host, KeyInfo } from "../ipc/types";

export function hostAddress(host: Pick<Host, "user" | "addr" | "port">): string {
  return `${host.user}@${host.addr}:${host.port}`;
}

/**
 * The tmux session a pane actually opens. `override` undefined means the host default,
 * an empty string means a plain shell, any other value names the session. Null is a plain shell.
 */
export function effectiveTmux(host: Pick<Host, "tmux_session"> | undefined, override: string | undefined): string | null {
  const chosen = override === undefined ? (host?.tmux_session ?? null) : override;
  return chosen === null || chosen === "" ? null : chosen;
}

export function keyName(host: Pick<Host, "key_id">, keys: KeyInfo[]): string | null {
  if (host.key_id === null) return null;
  return keys.find((k) => k.id === host.key_id)?.name ?? null;
}

/** Second line of a host row: key and tmux state. */
export function hostDetail(host: Host, keys: KeyInfo[]): string {
  const name = keyName(host, keys);
  if (name === null) return "no key assigned";
  return `key: ${name} · ${host.tmux_session ? `tmux: ${host.tmux_session}` : "plain shell"}`;
}

export function hostsUsingKey(keyId: string, hosts: Host[]): Host[] {
  return hosts.filter((h) => h.key_id === keyId);
}
