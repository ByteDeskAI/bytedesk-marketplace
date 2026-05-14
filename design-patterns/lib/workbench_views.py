"""HTML view for the dynamic design-pattern workbench."""

from __future__ import annotations


def app_html() -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Design Pattern Workbench</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Space+Mono:wght@700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <div class="grid-backdrop" aria-hidden="true"></div>
  <div class="shell">
    <aside class="side">
      <div class="brand">
        <span class="kicker">ByteDeskAI / v0.9.0</span>
        <h1>Pattern Workbench</h1>
        <p class="terminal-line">catalog://design-patterns/ops</p>
      </div>
      <nav class="tabs" id="kindTabs"></nav>
      <section class="panel">
        <h2>Query Controls</h2>
        <label>Domain<select id="domainFilter"></select></label>
        <label>Group<select id="groupFilter"></select></label>
        <label>Language<select id="languageFilter"></select></label>
        <label>Quality<select id="qualityFilter"></select></label>
        <label>Risk<select id="riskFilter">
          <option value="balanced">Balanced</option>
          <option value="conservative">Conservative</option>
          <option value="delivery">Fast delivery</option>
          <option value="operability">Operability</option>
        </select></label>
      </section>
      <section class="panel compact">
        <h2>Catalog Coverage</h2>
        <div id="coverage"></div>
      </section>
    </aside>
    <main class="main">
      <section class="status-strip" aria-label="Workbench status">
        <span>status: connected</span>
        <span>runtime: python/http</span>
        <span>source: markdown</span>
        <span>mode: enterprise</span>
      </section>
      <header class="hero">
        <div>
          <p class="eyebrow">Architecture Decision Console</p>
          <h2>Pattern intelligence for enterprise engineering systems.</h2>
        </div>
        <div class="stats" id="stats"></div>
      </header>
      <section class="searchbar">
        <span class="prompt">$</span>
        <input id="query" autocomplete="off" placeholder="recommend --force 'duplicate delivery repeats side effects' --language csharp">
        <button id="clearFilters" type="button">Reset</button>
      </section>
      <section class="insights" id="insights"></section>
      <section class="workspace">
        <div class="results">
          <div class="toolbar">
            <strong id="resultCount"></strong>
            <div>
              <button id="graphMode" type="button">Graph <kbd>G</kbd></button>
              <button id="compareMode" type="button">Compare <kbd>C</kbd></button>
              <button id="adrMode" type="button">ADR <kbd>A</kbd></button>
            </div>
          </div>
          <div id="cards" class="cards"></div>
        </div>
        <aside class="detail" id="detail">
          <p class="muted">selection: none</p>
        </aside>
      </section>
      <section class="studio">
        <section class="lab scenario">
          <div class="lab-head"><span>Scenario Radar</span><button id="analyzeScenario" type="button">Analyze <kbd>R</kbd></button></div>
          <textarea id="scenarioPrompt">provider selection leaks into domain code and makes tests brittle</textarea>
          <div id="recommendations" class="recommendations"></div>
        </section>
        <section class="lab scanner">
          <div class="lab-head"><span>Architecture Scan</span><button id="scanTextButton" type="button">Scan <kbd>S</kbd></button></div>
          <textarea id="scanText">public void Consume(Message message) {{ Publish(message); Retry(); }}</textarea>
          <div id="scanOutput" class="scan-output"></div>
        </section>
        <section class="lab brief">
          <div class="lab-head"><span>Implementation Brief</span><button id="makeBrief" type="button">Build <kbd>B</kbd></button></div>
          <textarea id="briefContext">Migrate a brittle branching provider selector toward a testable strategy boundary.</textarea>
          <pre id="briefOutput"></pre>
        </section>
        <section class="lab context-pack">
          <div class="lab-head"><span>Context Pack</span><button id="makeContext" type="button">Pack <kbd>P</kbd></button></div>
          <input id="contextPath" value="plugins/design-patterns/data/playbooks/event-fanout.md" aria-label="Context path">
          <textarea id="contextQuery">duplicate delivery repeats side effects</textarea>
          <pre id="contextOutput"></pre>
        </section>
        <section class="lab simulator">
          <div class="lab-head"><span>Decision Simulator</span><button id="runSimulation" type="button">Score <kbd>D</kbd></button></div>
          <textarea id="simulatePrompt">provider selection leaks into domain code</textarea>
          <pre id="simulationOutput"></pre>
        </section>
        <section class="lab migration">
          <div class="lab-head"><span>Migration Planner</span><button id="makeMigration" type="button">Plan <kbd>V</kbd></button></div>
          <input id="migrationSource" value="provider-switch-sprawl" aria-label="Migration source">
          <input id="migrationTarget" value="bridge" aria-label="Migration target">
          <pre id="migrationOutput"></pre>
        </section>
        <section class="lab graph-lab">
          <div class="lab-head"><span>Relationship Graph</span><button id="askGraph" type="button">Ask <kbd>Q</kbd></button></div>
          <textarea id="graphQuery">what mitigates naive exactly once</textarea>
          <pre id="graphAnswer"></pre>
          <svg id="graph" viewBox="0 0 900 360" role="img" aria-label="Catalog relationship graph"></svg>
        </section>
        <section class="lab matrix-lab">
          <div class="lab-head"><span>Coverage Matrix</span><button id="refreshMatrix" type="button">Matrix <kbd>M</kbd></button></div>
          <div id="matrix" class="matrix"></div>
          <textarea id="adrPrompt">duplicate delivery repeats side effects</textarea>
          <button id="makeAdr" type="button">ADR <kbd>A</kbd></button>
          <pre id="adrOutput"></pre>
        </section>
      </section>
    </main>
  </div>
  <script src="/app.js"></script>
</body>
</html>"""
