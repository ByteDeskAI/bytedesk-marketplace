#!/usr/bin/env python3
"""Generate a static HTML catalog site from the Markdown-backed plugin data."""

from __future__ import annotations

import html
import json
import shutil
import sys
from pathlib import Path


PLUGIN = Path(__file__).resolve().parents[1]
SITE = PLUGIN / "site"
sys.path.insert(0, str(PLUGIN / "lib"))

from pattern_catalog import (  # noqa: E402
    load_frameworks,
    load_language_profiles,
    load_patterns,
    load_playbooks,
    load_recipes,
    load_scorecards,
    load_smells,
    load_snippets,
)


STYLE = """
:root{--bg:#0d1117;--panel:#151c27;--panel-2:#0a0f16;--ink:#e6edf3;--muted:#8b949e;--line:#303846;--line-strong:#657183;--accent:#00d9ff;--accent-2:#ff6b35;--gain:#7ee787}
*{box-sizing:border-box}
html{background:var(--bg);color-scheme:dark}
body{font-family:"Inter Tight",sans-serif;margin:0;background:radial-gradient(circle at 72% 0,rgba(0,217,255,.15),transparent 34rem),linear-gradient(180deg,#0d1117,#080c12);color:var(--ink)}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.28;background-image:linear-gradient(rgba(230,237,243,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(230,237,243,.06) 1px,transparent 1px);background-size:32px 32px}
header{position:relative;border-bottom:1px solid var(--line-strong);background:linear-gradient(135deg,rgba(0,217,255,.1),rgba(21,28,39,.92));padding:34px 38px}
header h1{font-family:"Space Mono",monospace;text-transform:uppercase;letter-spacing:-.07em;font-size:clamp(38px,5vw,78px);line-height:.92;margin:0}
header p{font-family:"JetBrains Mono",monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:12px}
main{max-width:1280px;margin:0 auto;padding:28px}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline;text-decoration-color:var(--accent-2)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.card{background:linear-gradient(180deg,rgba(21,28,39,.96),rgba(10,15,22,.98));border:1px solid var(--line);padding:16px;min-height:160px}
.card:hover{border-color:var(--accent)}
.card h3{font-family:"Space Mono",monospace;letter-spacing:-.05em;line-height:1.05}
.meta{color:var(--muted);font:11px "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.08em}
.pill{display:inline-block;background:#070b10;border:1px solid var(--line);padding:3px 8px;margin:2px;font:11px "JetBrains Mono",monospace;color:#c9d1d9}
pre{white-space:pre-wrap;background:#060a0f;color:#f8fafc;padding:16px;border:1px solid var(--line);overflow:auto}
input{width:100%;box-sizing:border-box;font:15px "JetBrains Mono",monospace;padding:14px;border:1px solid var(--line-strong);background:#060a0f;color:var(--ink);margin:18px 0;border-radius:0}
input:focus-visible{outline:2px solid var(--accent-2);outline-offset:2px}
section{margin:30px 0}.section-list li{margin:7px 0;color:#c9d1d9;line-height:1.45}h2{font-family:"JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.08em;font-size:14px;color:var(--accent);border-bottom:1px solid var(--line);padding-bottom:10px}
"""


def esc(value: object) -> str:
    return html.escape(str(value))


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def layout(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Space+Mono:wght@700&display=swap" rel="stylesheet">
  <style>{STYLE}</style>
</head>
<body>
  <header>
    <h1>{esc(title)}</h1>
    <p>Source-neutral design pattern guidance for architecture decisions, smells, playbooks, recipes, and implementation packs.</p>
  </header>
  <main>
    {body}
  </main>
</body>
</html>
"""


def list_items(items: list[str]) -> str:
    if not items:
        return ""
    return "<ul class='section-list'>" + "".join(f"<li>{esc(item)}</li>" for item in items) + "</ul>"


def entry_page(entry: dict) -> str:
    bits = [
        f"<p class='meta'>{esc(entry.get('kind'))} / {esc(entry.get('domain'))} / {esc(entry.get('category'))}</p>",
    ]
    for key in ("intent", "symptom", "whyItMatters", "goal", "outputContract"):
        if entry.get(key):
            bits.append(f"<section><h2>{esc(key)}</h2><p>{esc(entry[key])}</p></section>")
    for key, label in (
        ("whenToUse", "When To Use"),
        ("avoidWhen", "Avoid When"),
        ("forces", "Forces"),
        ("tradeoffNotes", "Tradeoffs"),
        ("failureModeNotes", "Failure Modes"),
        ("testing", "Testing"),
        ("observability", "Observability"),
        ("implementationNotes", "Implementation Notes"),
        ("bestFor", "Best For"),
        ("patternMapping", "Pattern Mapping"),
        ("testingGuidance", "Testing Guidance"),
        ("operationalGuidance", "Operational Guidance"),
        ("patternSet", "Pattern Set"),
        ("implementationSteps", "Implementation Steps"),
        ("verification", "Verification"),
        ("patternResponses", "Pattern Responses"),
        ("checks", "Checks"),
        ("preconditions", "Preconditions"),
        ("steps", "Steps"),
        ("tests", "Tests"),
        ("rollback", "Rollback"),
        ("criteriaNotes", "Criteria"),
        ("antiPatterns", "Anti-Patterns"),
        ("use", "Use"),
    ):
        if entry.get(key):
            bits.append(f"<section><h2>{label}</h2>{list_items(entry[key])}</section>")
    if entry.get("example"):
        bits.append(f"<section><h2>Example</h2><pre>{esc(entry['example'])}</pre></section>")
    for key in ("patterns", "smells", "qualityAttributes", "criteria"):
        if entry.get(key):
            bits.append("<p>" + "".join(f"<span class='pill'>{esc(item)}</span>" for item in entry[key]) + "</p>")
    return layout(entry["name"], "\n".join(bits))


def card(entry: dict, folder: str) -> str:
    summary = entry.get("intent") or entry.get("symptom") or entry.get("goal") or ""
    return f"""<article class="card" data-search="{esc(entry['slug'] + ' ' + entry['name'] + ' ' + summary)}">
  <h3><a href="{folder}/{entry['slug']}.html">{esc(entry['name'])}</a></h3>
  <p class="meta">{esc(entry.get('kind'))} / {esc(entry.get('domain'))}</p>
  <p>{esc(summary)}</p>
</article>"""


def generate() -> None:
    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir()
    collections = {
        "patterns": load_patterns(),
        "playbooks": load_playbooks(),
        "smells": load_smells(),
        "frameworks": load_frameworks(),
        "recipes": load_recipes(),
        "scorecards": load_scorecards(),
        "snippets": load_snippets(),
    }
    languages = load_language_profiles()
    search_index = []
    for folder, entries in collections.items():
        for entry in entries:
            write(SITE / folder / f"{entry['slug']}.html", entry_page(entry))
            search_index.append(
                {
                    "slug": entry["slug"],
                    "name": entry["name"],
                    "kind": entry.get("kind"),
                    "domain": entry.get("domain"),
                    "url": f"{folder}/{entry['slug']}.html",
                    "summary": entry.get("intent") or entry.get("symptom") or entry.get("goal") or "",
                }
            )
    for slug, language in languages.items():
        entry = {"slug": slug, "name": language["displayName"], "kind": "language", "domain": "language", **language}
        write(SITE / "languages" / f"{slug}.html", entry_page(entry))
        search_index.append({"slug": slug, "name": language["displayName"], "kind": "language", "domain": "language", "url": f"languages/{slug}.html", "summary": ""})
    sections = []
    for folder, entries in collections.items():
        sections.append(f"<section><h2>{folder.title()}</h2><div class='grid'>{''.join(card(entry, folder) for entry in entries)}</div></section>")
    sections.append(
        "<section><h2>Languages</h2><div class='grid'>"
        + "".join(
            f"<article class='card' data-search='{esc(slug + ' ' + item['displayName'])}'><h3><a href='languages/{slug}.html'>{esc(item['displayName'])}</a></h3></article>"
            for slug, item in languages.items()
        )
        + "</div></section>"
    )
    script = """
<script>
const input=document.getElementById('search');
input.addEventListener('input',()=>{
  const q=input.value.toLowerCase();
  document.querySelectorAll('[data-search]').forEach(card=>{
    card.style.display=card.dataset.search.toLowerCase().includes(q)?'block':'none';
  });
});
</script>
"""
    index_body = "<input id='search' placeholder='Search patterns, playbooks, smells, frameworks, recipes, snippets, and languages'>" + "\n".join(sections) + script
    write(SITE / "index.html", layout("Design Pattern Reference Catalog", index_body))
    write(SITE / "search-index.json", json.dumps(search_index, indent=2, sort_keys=True))
    print(f"Generated static site at {SITE}")


if __name__ == "__main__":
    generate()
