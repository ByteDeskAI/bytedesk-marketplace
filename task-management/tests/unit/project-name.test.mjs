/**
 * The project a board belongs to.
 *
 * Every board called itself "task-management" — the plugin's name, the same on every board, which
 * tells you nothing. With two open, the header and the browser tab were identical and the only way
 * to tell them apart was the port in the URL.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { paths, projectName } from "../../lib/paths.mjs";

const name = (root) => projectName(paths(root));

describe("projectName", () => {
  it("titlecases the repo directory", () => {
    assert.equal(name("/home/x/GitHub/bytedesk-persona"), "Bytedesk Persona");
  });

  it("treats underscores, dots and spaces as separators too", () => {
    assert.equal(name("/tmp/my_cool.app"), "My Cool App");
  });

  it("leaves a word that is already mixed case alone", () => {
    // `myApp` is how someone wrote it; "Myapp" would be a worse name than the one they chose.
    assert.equal(name("/tmp/myApp-server"), "myApp Server");
  });

  it("falls back to the plugin's own name when there is no root", () => {
    // Titlecased like any other, because it is rendered as a heading — "Task Management" reads as
    // a name where "task-management" reads as a slug that failed to resolve.
    assert.equal(projectName({ root: null }), "Task Management");
  });
});
