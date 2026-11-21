// Bộ icon SVG đồng nhất (stroke 1.75, 24x24 optical grid) cho Waiting Point — không dùng emoji / ký tự Unicode.

const baseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.85,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
};

export function IconBell({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function IconBellOff({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5" />
      <path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function IconCheckCircle({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="m8.5 12.3 2.3 2.3 4.7-4.9" />
    </svg>
  );
}

export function IconAlertTriangle({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <path d="m10.29 3.86-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.71-3.14l-8-14a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function IconClock({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function IconUsers({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a3.5 3.5 0 0 1 0 6.74" />
    </svg>
  );
}

export function IconUserPlus({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="3.5" />
      <path d="M20 8v6" />
      <path d="M23 11h-6" />
    </svg>
  );
}

export function IconHistory({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function IconChevronLeft({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function IconChevronRight({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function IconX({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function IconWifiOff({ className = 'wp-ico' }) {
  return (
    <svg className={className} {...baseProps}>
      <path d="M2 2 22 22" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
      <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
      <path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" />
      <path d="M5 12.86a10 10 0 0 1 5.17-2.69" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}
