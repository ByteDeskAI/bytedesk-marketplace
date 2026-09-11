import assert from "node:assert/strict";
import test from "node:test";

import { NESTED_TEAM_ICON, ROLE_ICON_MAP, UNKNOWN_ROLE_ICON, roleIcon, roleVisual } from "../../topology/lib/identity.mjs";

// The approved mapping, copied from the TM-168 ticket.
const APPROVED = {
  lead: "👑",
  orchestrator: "🎼",
  reviewer: "🔍",
  observer: "👁️",
  worker: "🔧",
  implementer: "🛠️",
  designer: "🎨",
  "image-gen": "🖼️",
  researcher: "🔬",
  judge: "⚖️",
};

test("the registry is exactly the approved mapping, plus nested-team and unknown fallbacks", () => {
  assert.deepEqual({ ...ROLE_ICON_MAP }, APPROVED);
  assert.ok(Object.isFrozen(ROLE_ICON_MAP));
  for (const [role, icon] of Object.entries(APPROVED)) assert.equal(roleIcon(role), icon, role);
  assert.equal(NESTED_TEAM_ICON, "👥");
  assert.equal(UNKNOWN_ROLE_ICON, "🤖");
});

test("unknown, custom and hostile role values fall back without reaching the prototype", () => {
  const escapeLaden = "worker" + String.fromCharCode(27) + "]2;x" + String.fromCharCode(7);
  for (const role of ["custom-role", "", null, undefined, 42, "__proto__", "constructor", "toString", "Lead", escapeLaden]) {
    assert.equal(roleIcon(role), UNKNOWN_ROLE_ICON, JSON.stringify(role));
    assert.deepEqual(roleVisual({ role }), { roleIcon: UNKNOWN_ROLE_ICON, roleLabel: "Agent" }, JSON.stringify(role));
  }
});

test("effective role: nested team, then repository lead, then run role, then library role", () => {
  assert.deepEqual(roleVisual({ role: "worker", nestedTeam: true }), { roleIcon: NESTED_TEAM_ICON, roleLabel: "Nested team" });
  assert.equal(roleVisual({ repoRole: "lead", runRole: "orchestrator", role: "orchestrator" }).roleIcon, APPROVED.lead);
  assert.equal(roleVisual({ repoRole: "reviewer", runRole: "judge", role: "reviewer" }).roleIcon, APPROVED.judge);
  assert.equal(roleVisual({ runRole: null, role: "designer" }).roleIcon, APPROVED.designer);
  assert.equal(roleVisual().roleIcon, UNKNOWN_ROLE_ICON);
});

test("every icon and label is display text only: no control, escape or tmux format characters", () => {
  const values = [NESTED_TEAM_ICON, UNKNOWN_ROLE_ICON, ...Object.values(ROLE_ICON_MAP), "Nested team", "Agent"];
  for (const role of Object.keys(APPROVED)) values.push(roleVisual({ role }).roleLabel);
  for (const value of values) {
    for (const ch of value) {
      const code = ch.codePointAt(0);
      assert.ok(code >= 0x20 && code !== 0x7f && ch !== "#", `${JSON.stringify(value)} contains U+${code.toString(16)}`);
    }
  }
});
