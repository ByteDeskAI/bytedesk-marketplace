import { delimiter, extname, isAbsolute, join } from "node:path";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { ExecutableResolverStrategy } from "./contracts.mjs";
import { runFile } from "../util.mjs";

async function canonicalExecutable(path) {
  try {
    await access(path, constants.X_OK);
    return await realpath(path);
  } catch { return null; }
}

export class LinuxExecutableResolver extends ExecutableResolverStrategy {
  constructor({ runner = runFile } = {}) {
    super();
    this.runner = runner;
  }

  async findAll(command) {
    const { stdout } = await this.runner("/usr/bin/which", ["-a", command], { timeoutMs: 5_000 });
    return [...new Set(stdout.split("\n").map((value) => value.trim()).filter(Boolean))];
  }
}

export class WindowsExecutableResolver extends ExecutableResolverStrategy {
  constructor({ env = process.env, runner = runFile } = {}) {
    super();
    this.env = env;
    this.runner = runner;
  }

  async findAll(command) {
    if (isAbsolute(command)) {
      const resolved = await canonicalExecutable(command);
      return resolved ? [resolved] : [];
    }
    const names = extname(command)
      ? [command]
      : (this.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((extension) => `${command}${extension.toLowerCase()}`);
    const direct = [];
    for (const directory of (this.env.PATH || "").split(delimiter).filter(Boolean)) {
      for (const name of names) {
        const resolved = await canonicalExecutable(join(directory, name));
        if (resolved && !direct.includes(resolved)) direct.push(resolved);
      }
    }
    if (direct.length > 0) return direct;
    try {
      const { stdout } = await this.runner("where.exe", [command], { timeoutMs: 5_000 });
      return [...new Set(stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
    } catch { return []; }
  }
}
