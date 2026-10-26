interface BadgeProps {
  size?: number;
  className?: string;
}

export function WarnBadge({ size = 18, className }: BadgeProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3 L22 20.5 H2 Z" fill="currentColor" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M12 9.5v5" stroke="var(--badge-ink, #1a1306)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="17.6" r="1.25" fill="var(--badge-ink, #1a1306)" />
    </svg>
  );
}

export function InfoBadge({ size = 18, className }: BadgeProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M12 11v5.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="7.6" r="1.3" fill="#fff" />
    </svg>
  );
}

export function AlertBadge({ size = 18, className }: BadgeProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M12 6.5v6.2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="16.9" r="1.35" fill="#fff" />
    </svg>
  );
}
