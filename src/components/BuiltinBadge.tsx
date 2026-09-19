/**
 * Small pill marking a specialty as shipped with the app rather than user-authored. It sits beside
 * names that truncate, so it never shrinks — the name gives up the space instead.
 */
export function BuiltinBadge() {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
    >
      Built-in
    </span>
  );
}
