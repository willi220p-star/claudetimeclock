// The one place brand hex values live in a component (§15). scripts/icons.mjs mirrors this mark.
export function DgkLogo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      role="img"
      aria-label="DGK Business Consultancy"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
    >
      <circle cx="32" cy="32" r="29" fill="none" stroke="#0ec5b0" strokeWidth="4" />
      <text x="32" y="39.5" textAnchor="middle" fontSize="20" fontWeight="700" fontFamily="Inter, Arial, Helvetica, sans-serif">
        <tspan fill="#0ec5b0">D</tspan>
        <tspan fill="#ff7614" fontFamily="Georgia, 'Times New Roman', serif">G</tspan>
        <tspan fill="#02693e">K</tspan>
      </text>
    </svg>
  );
}
