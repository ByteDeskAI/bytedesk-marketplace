/**
 * Site content for __APP_NAME__.
 *
 * All copy lives here as typed constants — colocated content, no CMS. The
 * components in src/components and src/app render this; they never inline
 * marketing prose of their own. Replace every value below with real content;
 * the shapes are the contract, the strings are placeholders.
 */

export interface NavLink {
  readonly label: string;
  readonly href: string;
}

export interface CTA {
  readonly label: string;
  readonly href: string;
}

export interface Highlight {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface SiteContent {
  /** Display name, used in chrome and metadata. */
  readonly name: string;
  /** Product accent slug — must match data-bd-product in layout.tsx. */
  readonly productSlug: string;
  readonly tagline: string;
  readonly description: string;
  readonly url: string;
  readonly nav: readonly NavLink[];
  readonly hero: {
    readonly eyebrow: string;
    readonly headline: string;
    readonly subhead: string;
    readonly primaryCta: CTA;
    readonly secondaryCta: CTA;
  };
  readonly highlights: readonly Highlight[];
  readonly footer: {
    readonly note: string;
    readonly links: readonly NavLink[];
  };
}

export const site: SiteContent = {
  name: "__APP_NAME__",
  productSlug: "__ACCENT__",
  tagline: "A ByteDesk site, wrapped in the family design system.",
  description:
    "Replace this description with what __APP_NAME__ actually does, in one honest sentence. It is used for metadata and for the hero subhead fallback.",
  url: "https://example.com",
  nav: [
    { label: "Overview", href: "/" },
    { label: "Docs", href: "/docs" },
  ],
  hero: {
    eyebrow: "__SLUG__",
    headline: "State what this does, in plain words.",
    subhead:
      "One or two sentences that say what the reader gets and what it costs them to start. No vague AI language, no claims you cannot show.",
    primaryCta: { label: "Get started", href: "/docs" },
    secondaryCta: { label: "Read the source", href: "https://github.com/ByteDeskAI" },
  },
  highlights: [
    {
      id: "first",
      title: "Say something true",
      body: "Each highlight names a concrete capability and what it produces. Delete this array and write the real ones.",
    },
    {
      id: "second",
      title: "Show the artifact",
      body: "Prefer a real command, a real screen, or a real output over an adjective.",
    },
    {
      id: "third",
      title: "Stay honest about maturity",
      body: "Version and status labels are system metadata, not marketing. Say v0.x when it is v0.x.",
    },
  ],
  footer: {
    note: "Part of the ByteDesk suite.",
    links: [
      { label: "ByteDesk", href: "https://www.bytedesk.ai" },
      { label: "GitHub", href: "https://github.com/ByteDeskAI" },
    ],
  },
};
