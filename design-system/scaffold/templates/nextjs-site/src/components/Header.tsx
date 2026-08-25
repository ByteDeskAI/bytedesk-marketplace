import Link from "next/link";
import { site } from "@/content/site";

/**
 * Family chrome — the wrapper around this site's content.
 *
 * Every colour here is a --bd-* reference or a token-backed Tailwind utility
 * from the design-system theme adapter. If you find yourself typing a hex
 * code, the token you want already exists.
 */
export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border-dimmer bg-bg-base/90 backdrop-blur-sm">
      <div className="shell flex h-16 items-center justify-between gap-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-text-primary"
          aria-label={`${site.name} home`}
        >
          {/* The mark carries product identity, so it reads --bd-accent. */}
          <span
            aria-hidden
            className="size-2.5 rounded-full"
            style={{ backgroundColor: "var(--bd-accent)" }}
          />
          <span className="font-display text-base font-semibold tracking-tight">
            {site.name}
          </span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-6">
          {site.nav.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-body-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
