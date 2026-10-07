export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="var(--bg)"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22.5 9.5L14 5L5.5 9.5L14 14L22.5 18.5L14 23L5.5 18.5" fill="none" />
      <circle cx="22.5" cy="9.5" r="2.4" />
      <circle cx="14" cy="5" r="2.4" />
      <circle cx="5.5" cy="9.5" r="2.4" />
      <circle cx="14" cy="14" r="2.4" />
      <circle cx="22.5" cy="18.5" r="2.4" />
      <circle cx="14" cy="23" r="2.4" />
      <circle cx="5.5" cy="18.5" r="2.4" />
    </svg>
  )
}
