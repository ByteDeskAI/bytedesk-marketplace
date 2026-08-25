import Link from "next/link";
import { site } from "@/content/site";

export default function Footer() {
  return (
    <footer className="border-t border-border-dimmer bg-bg-base">
      <div className="shell flex flex-col gap-4 py-10 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-text-tertiary">
          {site.footer.note}
        </p>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-5">
          {site.footer.links.map((link) => (
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
    </footer>
  );
}
