import type { MockConnect, MockOptions } from "./mock";
import type { HostKeyPromptInfo, Ipc, PaneNode } from "./types";

export const DEMO_PASSPHRASE = "correct horse battery";

const term = (host_id: string): PaneNode => ({ type: "terminal", host_id });
const split = (a: PaneNode, b: PaneNode, dir: "H" | "V" = "H"): PaneNode => ({
  type: "split",
  dir,
  ratio: 0.5,
  a,
  b,
});

export type DemoScene = "main" | "tabs";
export const SCENE_LAYOUT = "scene";

export function demoScene(search = window.location.search): DemoScene | null {
  const scene = new URLSearchParams(search).get("scene");
  return scene === "main" || scene === "tabs" ? scene : null;
}

const sgr = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const green = sgr("1;32");
const blue = sgr("1;34");
const cyan = sgr("1;36");
const red = sgr("31");
const gray = sgr("90");
const lines = (...rows: string[]) => rows.join("\r\n");
const ps1 = (user: string, host: string, path: string, sym: "#" | "$") =>
  `${green(`${user}@${host}`)}:${blue(path)}${sym} `;
const nextPrompt = (user: string, host: string, path: string, sym: "#" | "$") => `\r\n${ps1(user, host, path, sym)}`;

const lsRow = (mode: string, links: number, size: number, sizeWidth: number, when: string, name: string) =>
  `${mode} ${String(links).padStart(3)} root root ${String(size).padStart(sizeWidth)} ${when} ${name}`;

const MAIN_WEB = (() => {
  const p = ps1("root", "web-1", "~", "#");
  const row = (m: string, l: number, s: number, w: string, n: string) => lsRow(m, l, s, 5, w, n);
  return lines(
    "Last login: Wed Aug 28 10:14:22 2024 from 203.0.113.140",
    `${p}ls -la`,
    "total 48",
    row("drwxr-xr-x", 5, 4096, "Aug 28 10:16", "."),
    row("drwxr-xr-x", 23, 4096, "Aug 28 09:12", ".."),
    row("-rw-r--r--", 1, 220, "Apr 23  2024", ".bashrc"),
    row("drwxr-xr-x", 3, 4096, "Aug 20 14:33", blue(".ssh")),
    row("drwxr-xr-x", 4, 4096, "Aug 28 09:11", blue("app")),
    row("drwxr-xr-x", 6, 4096, "Aug 25 16:21", blue("logs")),
    row("drwxr-xr-x", 3, 4096, "Aug 24 11:02", blue("scripts")),
    p,
  );
})();

const MAIN_DB = (() => {
  const row = (id: string, image: string, status: string, ports: string, name: string) =>
    `${id.padEnd(17)}${cyan(image.padEnd(16))}${green(status.padEnd(16))}${ports.padEnd(14)}${name}`;
  return lines(
    `${ps1("root", "db", "~", "#")}docker ps`,
    `${"CONTAINER ID".padEnd(17)}${"IMAGE".padEnd(16)}${"STATUS".padEnd(16)}${"PORTS".padEnd(14)}NAMES`,
    row("a3f2c1d4e5f6", "postgres:16", "Up 3 hours", "5432/tcp", "db"),
    row("b1e2f3g4h5i6", "redis:7", "Up 3 hours", "6379/tcp", "cache"),
    row("c7d8e9f0a1b2", "nginx:alpine", "Up 5 hours", "80/tcp", "proxy"),
    row("d3e4f5g6h7i8", "node:20", "Up 5 hours", "3000/tcp", "app"),
    ps1("root", "db", "~", "#"),
  );
})();

const MAIN_DEPLOY = (() => {
  const p = ps1("deploy", "deploy", "~/app", "$");
  return lines(
    `${p}git status`,
    "On branch main",
    "Your branch is up to date with 'origin/main'.",
    "",
    "Changes not staged for commit:",
    '  (use "git add <file>..." to update what will be committed)',
    '  (use "git restore <file>..." to discard changes in working directory)',
    red("      modified:   package.json"),
    red("      modified:   src/app.ts"),
    "",
    'no changes added to commit (use "git add" and/or "git commit -a")',
    p,
  );
})();

const MAIN_HTOP = (() => {
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const RED = "\x1b[31m";
  const BLUE = "\x1b[34m";
  const meter = (label: string, bars: [string, number][], text: string) => {
    const used = bars.reduce((n, [, c]) => n + c, 0);
    const body = bars.map(([color, c]) => `${color}${"|".repeat(c)}`).join("");
    const pad = " ".repeat(30 - used - text.length);
    return `${label}\x1b[1;37m[\x1b[0m${body}${pad}\x1b[90m${text}\x1b[1;37m]\x1b[0m`;
  };
  const cpu = (n: number) => `\x1b[1;36m ${n}\x1b[0m `;
  const side = (s: string) => `${" ".repeat(9)}${s}`;
  const right = [
    "\x1b[36mTasks: \x1b[1;37m102\x1b[0;36m, \x1b[1;37m287\x1b[0;36m thr, \x1b[1;37m2\x1b[0;36m run\x1b[0m",
    "\x1b[36mLoad average: \x1b[1;37m0.52 \x1b[0;36m0.58 0.59\x1b[0m",
    "\x1b[36mUptime: \x1b[1;36m14 days, 03:21:17\x1b[0m",
  ];
  const proc = (
    pid: string,
    user: string,
    pri: string,
    ni: string,
    virt: string,
    res: string,
    shr: string,
    s: string,
    pct: string,
    mem: string,
    time: string,
    cmd: string,
  ) =>
    `${pid.padStart(5)} ${user.padEnd(7)} ${pri.padStart(3)} ${ni.padStart(3)} ${virt.padStart(5)} ${res.padStart(5)} ${shr.padStart(5)} ${s} ${pct.padStart(4)} ${mem.padStart(4)} ${time.padStart(7)} ${cmd}`;
  const fkeys = [
    ["F1", "Help "],
    ["F2", "Setup "],
    ["F3", "Find "],
    ["F5", "Tree "],
    ["F6", "Sort "],
    ["F7", "Nice- "],
    ["F8", "Nice+ "],
    ["F9", "Kill "],
    ["F10", "Quit "],
  ];
  return (
    lines(
      meter(cpu(0), [[GREEN, 6], [YELLOW, 1], [RED, 2]], "12.3%") + side(right[0] ?? ""),
      meter(cpu(1), [[GREEN, 4], [YELLOW, 1]], "8.1%") + side(right[1] ?? ""),
      meter(cpu(2), [[GREEN, 5], [YELLOW, 4], [RED, 2]], "28.4%") + side(right[2] ?? ""),
      meter(cpu(3), [[GREEN, 5]], "6.7%"),
      meter("\x1b[1;36mMem\x1b[0m", [[GREEN, 17], [BLUE, 1], [YELLOW, 2]], "3.2G/7.8G"),
      meter("\x1b[1;36mSwp\x1b[0m", [[RED, 6]], "256M/2.0G"),
      `\x1b[30;42m${proc("PID", "USER", "PRI", "NI", "VIRT", "RES", "SHR", "S", "CPU%", "MEM%", "TIME+", "Command")}\x1b[K\x1b[0m`,
      `\x1b[30;46m${proc("1742", "root", "20", "0", "482M", "125M", "43200", "S", "28.4", "1.6", "2:31.12", "/usr/bin")}\x1b[K\x1b[0m`,
      proc("1834", "root", "20", "0", "312M", "84212", "32108", "S", "12.3", "1.1", "0:02.17", "nginx: m"),
      proc("2210", "deploy", "20", "0", "504M", "128M", "44320", "S", "8.1", "1.6", "0:52.03", "node  /a"),
      proc("3176", "root", "20", "0", "196M", "41232", "20088", "S", "6.7", "0.5", "0:18.24", "/usr/bin"),
      "",
    ) +
    "\r\n" +
    fkeys.map(([n, l]) => `${n}\x1b[30;46m${l}\x1b[0m`).join("")
  );
})();

const TABS_PROMPT = ps1("root", "web-1", "~", "#");

const TABS_LS = (() => {
  const row = (m: string, l: number, s: number, w: string, n: string) => lsRow(m, l, s, 4, w, n);
  return lines(
    "Last login: Thu Oct 24 10:12:31 2026 from 192.168.1.10",
    `${TABS_PROMPT}ls -la`,
    "total 32",
    row("drwx------", 4, 4096, "Oct 20 09:12", blue(".")),
    row("drwxr-xr-x", 18, 4096, "Oct 10 14:03", blue("..")),
    row("-rw-------", 1, 220, "Oct 20 09:12", ".bash_history"),
    row("-rw-r--r--", 1, 3106, "Apr 22  2024", ".bashrc"),
    row("drwx------", 2, 4096, "Oct 10 16:20", blue(".ssh")),
    row("drwxr-xr-x", 3, 4096, "Sep 18 11:04", blue("app")),
    row("drwxr-xr-x", 5, 4096, "Oct  2 15:33", blue("logs")),
    TABS_PROMPT,
  );
})();

const TABS_LOG_ERRORS: Record<number, string> = {
  12: "Failed to open listening socket",
  25: "Upstream timed out after 30s",
  37: "Connection reset by peer",
  48: "Disk quota exceeded on /var/data",
  59: "Failed to connect to Redis",
  71: "Unexpected token in config",
  83: "Certificate verification failed",
  94: "Worker crashed with signal 11",
  105: "Failed to write session cache",
  117: "Unhandled exception in job runner",
};

const TABS_LOG = (() => {
  const infos = [
    "GET /api/health 200 3ms",
    "Cache warmed (412 keys)",
    "Worker heartbeat ok",
    "Request completed in 38ms",
    "Slow query detected (820ms)",
    "Session store flushed",
  ];
  const clock = (secs: number) =>
    [Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60].map((v) => String(v).padStart(2, "0")).join(":");
  const entry = (n: number, level: string, msg: string) =>
    `${gray(String(n).padStart(3))}  Oct 24 ${clock(9 * 3600 + 12 * 60 + 1 - (124 - n) * 5)}  app[1234]:  ${level.padEnd(5)} ${msg}`;
  const head = Array.from({ length: 123 }, (_, i) => {
    const n = i + 1;
    const failure = TABS_LOG_ERRORS[n];
    if (failure !== undefined) return entry(n, "ERROR", failure);
    return entry(n, n % infos.length === 4 ? "WARN" : "INFO", infos[n % infos.length] ?? "");
  });
  const tail = [
    `${gray("124")}  Oct 24 09:12:01  app[1234]:  INFO Server started on port 3000`,
    `${gray("125")}  Oct 24 09:12:05  app[1234]:  ERROR Failed to connect to Redis`,
    `${gray("126")}  Oct 24 09:12:10  app[1234]:  INFO  Retrying in 5 seconds...`,
    `${gray("127")}  Oct 24 09:12:15  app[1234]:  INFO  Connected to Redis`,
    `${gray("128")}  Oct 24 09:13:02  app[1234]:  ERROR Unexpected token in config`,
    `${gray("129")}  Oct 24 09:13:05  app[1234]:  INFO  Using default configuration`,
  ];
  return lines(...head, ...tail, TABS_PROMPT);
})();

const TABS_STAGING = lines(
  "Last login: Thu Oct 24 08:41:02 2026 from 203.0.113.5",
  "",
  "tmux: command not found\x1b]777;tv-no-tmux\x07",
  ps1("ubuntu", "staging", "~", "$"),
);

export function sceneOptions(scene: DemoScene | null): MockOptions {
  if (scene === "main") {
    const screens: Record<string, MockConnect> = {
      "web-1": { output: MAIN_WEB, prompt: nextPrompt("root", "web-1", "~", "#") },
      db: { output: MAIN_DB, prompt: nextPrompt("root", "db", "~", "#") },
      deploy: { output: MAIN_DEPLOY, prompt: nextPrompt("deploy", "deploy", "~/app", "$") },
      "api-1": { output: MAIN_HTOP },
    };
    return { trustAll: true, settings: { font_size: 16.4 }, connect: (host) => screens[host.name] };
  }
  if (scene === "tabs") {
    return {
      trustAll: true,
      connect: (host, _tmux, nth) => {
        if (host.name === "db") return { stall: true };
        if (host.name === "staging") {
          return { output: TABS_STAGING, prompt: nextPrompt("ubuntu", "staging", "~", "$") };
        }
        if (host.name !== "web-1") return undefined;
        const prompt = `\r\n${TABS_PROMPT}`;
        return nth === 0 ? { output: TABS_LS, prompt } : { output: TABS_LOG, prompt, dropAfterMs: 1500 };
      },
    };
  }
  return {};
}

async function seedScene(ipc: Ipc, scene: DemoScene): Promise<void> {
  const laptop = await ipc.keysGenerate("laptop");
  const mk = (name: string, addr: string, user: string, tmux: string | null) =>
    ipc.hostsAdd({ name, addr, port: 22, user, key_id: laptop.id, tags: [], tmux_session: tmux });
  const withRatio = (node: PaneNode, ratio: number): PaneNode => (node.type === "split" ? { ...node, ratio } : node);
  let tabs: { title: string; root: PaneNode }[];
  if (scene === "main") {
    const web = await mk("web-1", "203.0.113.42", "root", null);
    const db = await mk("db", "10.0.1.12", "root", null);
    const dep = await mk("deploy", "10.0.1.20", "deploy", null);
    const api = await mk("api-1", "10.0.2.10", "ubuntu", null);
    tabs = [
      { title: "web-1", root: split(split(term(web.id), term(db.id)), split(term(dep.id), term(api.id)), "V") },
      { title: "db", root: term(db.id) },
      { title: "deploy", root: term(dep.id) },
      { title: "api-1", root: term(api.id) },
    ];
  } else {
    const web = await mk("web-1", "10.0.0.1", "root", "main");
    const db = await mk("db", "10.0.0.2", "admin", "main");
    const stg = await mk("staging", "10.0.1.5", "ubuntu", "main");
    const bottom = withRatio(split(split(term(db.id), term(stg.id)), term(web.id), "V"), 0.4);
    tabs = [
      { title: "web-1", root: withRatio(split(term(web.id), bottom, "V"), 0.33) },
      { title: "db", root: term(db.id) },
      { title: "staging", root: term(stg.id) },
    ];
  }
  await ipc.layoutSave({ id: crypto.randomUUID(), name: SCENE_LAYOUT, tabs });
}

/** Fills a fresh mock with the data shown in the design mockups, then locks it. */
export async function seedDemo(ipc: Ipc, scene: DemoScene | null = null): Promise<void> {
  const listeners: Array<(p: HostKeyPromptInfo) => void> = [];
  const listen = ipc.onHostKeyPrompt.bind(ipc);
  ipc.onHostKeyPrompt = async (cb) => {
    listeners.push(cb);
    return listen(cb);
  };
  await ipc.vaultCreate(DEMO_PASSPHRASE);
  if (scene !== null) {
    await seedScene(ipc, scene);
    await ipc.vaultLock();
    await applyDemoState(ipc, listeners);
    return;
  }
  const laptop = await ipc.keysGenerate("laptop");
  const deploy = await ipc.keysGenerate("deploy");
  await ipc.keysGenerate("ci-runner");
  const mk = (name: string, addr: string, user: string, key: string | null, tmux: string | null) =>
    ipc.hostsAdd({ name, addr, port: 22, user, key_id: key, tags: [], tmux_session: tmux });
  const web = await mk("web-1", "10.0.0.1", "root", laptop.id, "main");
  const db = await mk("db", "10.0.0.2", "admin", laptop.id, null);
  const dep = await mk("deploy", "10.0.0.3", "deploy", deploy.id, "main");
  await mk("api-1", "10.0.0.4", "ubuntu", laptop.id, "main");
  await mk("staging", "10.0.1.5", "ubuntu", null, null);
  const stg = (await ipc.hostsList()).find((h) => h.name === "staging")!;
  const layouts: [string, PaneNode[]][] = [
    ["prod-debug", [split(term(web.id), split(term(db.id), term(db.id), "V")), term(db.id)]],
    ["deploy", [split(term(dep.id), term(dep.id), "V")]],
    ["local", [term(stg.id)]],
    ["research", [term(web.id), term(db.id), term(stg.id)]],
  ];
  const titleOf = (root: PaneNode): string => (root.type === "terminal" ? root.host_id : titleOf(root.a));
  const names = new Map((await ipc.hostsList()).map((h) => [h.id, h.name]));
  for (const [name, roots] of layouts) {
    await ipc.layoutSave({
      id: crypto.randomUUID(),
      name,
      tabs: roots.map((root) => ({ title: names.get(titleOf(root)) ?? "tab", root })),
    });
  }
  await ipc.vaultLock();
  await applyDemoState(ipc, listeners);
}

const FP_PINNED = "SHA256:Qx8...k2A";
const FP_OFFERED = "SHA256:Zp1...9mW";

/** Initial changed-key dialog for `?demo&state=changed`. */
export function demoChangedKey() {
  if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("state") !== "changed") return null;
  return { hostId: "demo-web-1", hostName: "web-1", addrPort: "10.0.0.1:22", pinned: FP_PINNED, offered: FP_OFFERED };
}

/** Deterministic screens for design comparison: state=corrupt | throttle | trust | changed. */
async function applyDemoState(ipc: Ipc, listeners: Array<(p: HostKeyPromptInfo) => void>): Promise<void> {
  const state = new URLSearchParams(window.location.search).get("state");
  const dir = "C:\\Users\\you\\.terminal-vault";
  ipc.vaultInfo = async () => ({ dir, path: `${dir}\\vault.dat` });
  const unlock = ipc.vaultUnlock.bind(ipc);
  if (state === "corrupt") {
    await ipc.vaultBackup();
    let broken = true;
    ipc.vaultUnlock = async (passphrase) => {
      if (broken) throw new Error("vault file is corrupt: bad header");
      return unlock(passphrase);
    };
    const restore = ipc.vaultRestore.bind(ipc);
    ipc.vaultRestore = async (name) => {
      await restore(name);
      broken = false;
    };
  } else if (state === "throttle") {
    ipc.vaultUnlock = async () => {
      throw new Error("too many attempts: retry in 10s");
    };
  } else if (state === "unlocking") {
    ipc.vaultUnlock = () => new Promise<void>(() => {});
  } else if (state === "trust") {
    ipc.vaultUnlock = async (passphrase) => {
      await unlock(passphrase);
      setTimeout(() => {
        for (const [i, name] of ["web-1", "db", "deploy"].entries()) {
          const prompt = {
            prompt_id: `demo-prompt-${i}`,
            host_name: name,
            addr_port: `10.0.0.${i + 1}:22`,
            key_type: "ssh-ed25519",
            fingerprint: FP_PINNED,
          };
          listeners.forEach((cb) => cb(prompt));
        }
      }, 600);
    };
  } else if (state === "missing-host") {
    ipc.vaultUnlock = async (passphrase) => {
      await unlock(passphrase);
      const list = ipc.layoutList.bind(ipc);
      ipc.layoutList = async () =>
        (await list()).map((l) =>
          l.name === "research" ? { ...l, tabs: l.tabs.map((t, i) => (i === 2 ? { ...t, root: term("ghost-host") } : t)) } : l,
        );
    };
  }
}
