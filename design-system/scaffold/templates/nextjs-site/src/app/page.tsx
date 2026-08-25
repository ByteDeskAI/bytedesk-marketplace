import Link from "next/link";
import { site } from "@/content/site";

/**
 * Starter home page. It reads src/content/site.ts and renders the family
 * band rhythm: hero band, highlights band. Replace the content, keep the
 * token discipline — no literal colours, no restated design values.
 */
export default function Home() {
  return (
    <>
      <section className="band">
        <div className="shell">
          <span className="accent-chip">{site.hero.eyebrow}</span>
          <h1 className="mt-6 max-w-3xl text-h1 font-semibold leading-tight tracking-tight text-text-primary">
            {site.hero.headline}
          </h1>
          <p className="mt-5 max-w-2xl text-body-lg text-text-secondary">
            {site.hero.subhead}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={site.hero.primaryCta.href} className="button-primary">
              {site.hero.primaryCta.label}
            </Link>
            <Link href={site.hero.secondaryCta.href} className="button-ghost">
              {site.hero.secondaryCta.label}
            </Link>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="shell">
          <h2 className="text-h3 font-semibold tracking-tight text-text-primary">
            What it does
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {site.highlights.map((highlight) => (
              <li key={highlight.id} className="surface-card">
                <h3 className="text-body font-semibold text-text-primary">
                  {highlight.title}
                </h3>
                <p className="mt-2 text-body-sm text-text-secondary">
                  {highlight.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
