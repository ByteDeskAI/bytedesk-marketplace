// Shared by topology-prompt-modes.test.mjs (its golden test): a fixture using every PLAIN-STRING
// prompt shape that existed before add/replace modes (TM-296), composed against a fixed agent.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../../topology/lib/config.mjs";
import { composePrompt } from "../../../topology/lib/prompts.mjs";
import { writeJson } from "../../../topology/lib/util.mjs";

export async function composeGolden(root, role) {
  const plugin = join(root, "plugin"), xdg = join(root, "xdg"), gdir = join(xdg, "agent-orchestration");
  const consumer = join(root, "consumer"), rdir = join(consumer, ".bytedesk", "agent-orchestration");
  const dir = join(rdir, "agents", "gold0001");
  const files = {
    [join(plugin, "t.md")]: "TEMPLATE {{task}}\n", [join(plugin, "c.md")]: "DEFAULT COMMON\n",
    [join(plugin, "cr.md")]: "DEFAULT COMMON REVIEWER\n", [join(plugin, "r.md")]: "DEFAULT ROLE\n",
    [join(gdir, "c.md")]: "  GLOBAL COMMON  \n\n", [join(gdir, "r.md")]: "GLOBAL ROLE\n",
    [join(rdir, "c.md")]: "REPO COMMON\n", [join(rdir, "r.md")]: "REPO ROLE\n", [join(dir, "own.md")]: "OWN FILE {{task}}\n",
  };
  for (const [path, text] of Object.entries(files)) { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, text); }
  await writeJson(join(plugin, "config.defaults.json"), { templates: { t: { role, prompt: "./t.md" } },
    prompts: { common: "./c.md", common_by_role: { reviewer: "./cr.md" }, roles: { [role]: "./r.md" } } });
  await writeJson(join(gdir, "config.json"), { prompts: { common: "./c.md", roles: { [role]: "./r.md" } } });
  await writeJson(join(rdir, "config.json"), { prompts: { common: "./c.md", roles: { [role]: "./r.md" } } });
  const loaded = await loadConfig({ consumer, home: join(root, "home"), pluginRoot: plugin, env: { XDG_CONFIG_HOME: xdg } });
  const agent = { id: "gold0001", full_name: "Gold Den", title: "Golden Worker", role, instructions: "INLINE OWN",
    instructions_file: "own.md", _prompt_vars: { task: "TM-1" } };
  const composed = await composePrompt({ agent, consumer, dir, loaded, templateName: "t" });
  return { ...composed, text: composed.text.split(root).join("<ROOT>") };
}
