import Link from 'next/link';
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Licyo, accueil">
      <span className="brand-mark" aria-hidden>
        l.
      </span>
      <span>
        licyo<span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
