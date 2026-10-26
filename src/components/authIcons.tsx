import type { ReactNode } from "react";

export type AuthIconName =
  | "prompt"
  | "folder"
  | "arrowRight"
  | "history"
  | "clock"
  | "copy"
  | "alertCircle"
  | "alertTriangle"
  | "infoCircle"
  | "shieldAlert"
  | "shieldGuard"
  | "shieldDot"
  | "ban";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function glyph(name: AuthIconName): ReactNode {
  switch (name) {
    case "prompt":
      return (
        <g {...STROKE} strokeWidth={2.6}>
          <path d="M6 6.5l6 5.5-6 5.5" />
          <path d="M14.5 18h5.5" />
        </g>
      );
    case "folder":
      return (
        <g {...STROKE} strokeWidth={1.6}>
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.5.7L12 7.2h6.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
          <path d="M3 10.5h18" />
        </g>
      );
    case "arrowRight":
      return (
        <g {...STROKE} strokeWidth={1.8}>
          <path d="M4 12h15" />
          <path d="M13.5 6.5L19 12l-5.5 5.5" />
        </g>
      );
    case "history":
      return (
        <g {...STROKE} strokeWidth={1.8}>
          <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
          <path d="M3.2 4.2v4.4h4.4" />
          <path d="M12 7.8V12l2.8 1.8" />
        </g>
      );
    case "clock":
      return (
        <g {...STROKE} strokeWidth={1.8}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5.2l3.2 2" />
        </g>
      );
    case "copy":
      return (
        <g {...STROKE} strokeWidth={1.7}>
          <rect x="8" y="8" width="12" height="12" rx="3" />
          <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
        </g>
      );
    case "alertCircle":
      return (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M12 6.6v6.4" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
          <circle cx="12" cy="16.9" r="1.4" fill="#fff" />
        </>
      );
    case "alertTriangle":
      return (
        <>
          <path
            d="M10.3 3.9L2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
          <path d="M12 9.6v4.4" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
          <circle cx="12" cy="17.2" r="1.2" fill="#fff" />
        </>
      );
    case "infoCircle":
      return (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M12 10.8v6" stroke="#10131a" strokeWidth={2.4} strokeLinecap="round" />
          <circle cx="12" cy="7.4" r="1.4" fill="#10131a" />
        </>
      );
    case "shieldAlert":
      return (
        <>
          <path
            d="M12 2.2l8 3v6.2c0 4.6-3.3 8.5-8 10.4-4.7-1.9-8-5.8-8-10.4V5.2z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
          <path d="M12 7.6v5" stroke="#10131a" strokeWidth={2.2} strokeLinecap="round" />
          <circle cx="12" cy="16" r="1.3" fill="#10131a" />
        </>
      );
    case "shieldGuard":
      return (
        <g {...STROKE} strokeWidth={1.7}>
          <path d="M12 3l7.5 2.8v5.7c0 4.3-3.1 7.9-7.5 9.5-4.4-1.6-7.5-5.2-7.5-9.5V5.8z" />
          <path d="M12 9.2v4.6" />
          <circle cx="12" cy="16.2" r="0.4" />
        </g>
      );
    case "shieldDot":
      return (
        <>
          <path
            d="M12 2.2l8 3v6.2c0 4.6-3.3 8.5-8 10.4-4.7-1.9-8-5.8-8-10.4V5.2z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
          <path d="M12 7.8v4.6" stroke="#0d1218" strokeWidth={2} strokeLinecap="round" />
          <circle cx="12" cy="15.8" r="1.2" fill="#0d1218" />
        </>
      );
    case "ban":
      return (
        <g {...STROKE} strokeWidth={2.4}>
          <circle cx="12" cy="12" r="9" />
          <path d="M5.8 5.8l12.4 12.4" />
        </g>
      );
  }
}

interface Props {
  name: AuthIconName;
  size?: number;
  className?: string;
}

export function AuthIcon({ name, size = 16, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {glyph(name)}
    </svg>
  );
}
