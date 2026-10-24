const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const IconSettings = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
  </svg>
);

export const IconList = () => (
  <svg {...base}>
    <circle cx="3" cy="4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="3" cy="8" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="3" cy="12" r="0.7" fill="currentColor" stroke="none" />
    <path d="M6.5 4h7M6.5 8h7M6.5 12h7" />
  </svg>
);

export const IconClose = () => (
  <svg {...base}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const IconExternal = () => (
  <svg {...base} width={12} height={12}>
    <path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9" />
  </svg>
);

export const IconBookmark = ({ filled = false }: { filled?: boolean }) => (
  <svg {...base}>
    <path d="M4.5 2.5h7v11L8 10.8 4.5 13.5z" fill={filled ? 'currentColor' : 'none'} />
  </svg>
);
