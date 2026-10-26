import { shortcutKeys, type ShortcutAction } from "../lib/shortcuts";
import { Icon, type IconName } from "./ui";

export type PanelId = "hosts" | "keys" | "layouts";

interface Props {
  panel: PanelId | null;
  settingsOpen: boolean;
  onPanel(id: PanelId): void;
  onSettings(): void;
}

interface RailItem {
  id: PanelId;
  label: string;
  icon: IconName;
  action: ShortcutAction;
}

const ITEMS: RailItem[] = [
  { id: "hosts", label: "Hosts", icon: "rack", action: "openHosts" },
  { id: "keys", label: "Keys", icon: "key", action: "openKeys" },
  { id: "layouts", label: "Layouts", icon: "grid", action: "openLayouts" },
];

export function Rail({ panel, settingsOpen, onPanel, onSettings }: Props) {
  return (
    <nav className="rail" aria-label="Main">
      <div className="rail-group">
        {ITEMS.map((item) => {
          const active = !settingsOpen && panel === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={active ? "rail-btn active" : "rail-btn"}
              aria-label={item.label}
              aria-pressed={active}
              title={`${item.label} (${shortcutKeys(item.action).join("+")})`}
              onClick={() => onPanel(item.id)}
            >
              <Icon name={item.icon} size={26} />
            </button>
          );
        })}
      </div>
      <div className="rail-group">
        <button
          type="button"
          className={settingsOpen ? "rail-btn active" : "rail-btn"}
          aria-label="Settings"
          aria-pressed={settingsOpen}
          title={`Settings (${shortcutKeys("settings").join("+")})`}
          onClick={onSettings}
        >
          <Icon name="gear" size={26} />
        </button>
      </div>
    </nav>
  );
}
