import Link from "next/link";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link href="/" className={`brand ${inverse ? "brand-inverse" : ""}`} aria-label="LUFT, inicio">
      <svg viewBox="0 0 42 42" aria-hidden="true"><path d="M8 7h10v19c0 5 3 8 8 8h9v-9h-8V7h-9v18c0 6 3 10 9 10H8V7Z" /></svg>
      <span>LUFT</span>
    </Link>
  );
}
