/** TM_NATS_CREDS against a server that only admits operator-signed users (real nsc credentials). */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeCreds, startServer } from "./nats-helpers.mjs";
import { NatsBackend } from "../../lib/storage/nats-backend.mjs";
import "../../lib/storage/types.mjs";
import { encode } from "../../lib/storage/registry.mjs";

let srv, creds;
before(async () => {
  creds = makeCreds();
  srv = await startServer({ args: ["-c", creds.conf] });
});
after(async () => {
  await srv.cleanup();
  creds.cleanup();
});

const env = (id) => encode("tm/task", { id, title: "t" });
const refuse = async (file) => {
  const b = new NatsBackend({ repo: "c1", url: srv.url, creds: file });
  const info = await b.info();
  return { info, b };
};

describe("TM_NATS_CREDS", () => {
  it("a valid creds file connects and can write, via the env var path too", async () => {
    process.env.TM_NATS_CREDS = creds.good;
    const b = new NatsBackend({ repo: "c1", url: srv.url });
    const info = await b.info();
    delete process.env.TM_NATS_CREDS;
    console.log("good creds:", JSON.stringify(info));
    assert.equal(info.offline, false);
    assert.ok((await b.create("tm/task", "TM-1", env("TM-1"))).rev >= 1);
    await b.close();
  });

  it("no creds at all is refused by the server (print refusal)", async () => {
    const b = new NatsBackend({ repo: "c1", url: srv.url });
    const info = await b.info();
    console.log("no creds:", JSON.stringify(info));
    assert.equal(info.offline, true);
    assert.match(info.why, /authorization|authentication|Authorization|credentials/i);
  });

  it("an expired credential is refused (print refusal)", async () => {
    const { info } = await refuse(creds.expired);
    console.log("expired creds:", JSON.stringify(info));
    assert.equal(info.offline, true);
    assert.match(info.why, /refused the credentials/);
    assert.equal(info.authRefused, true);
  });

  it("a credential from a different operator is refused (print refusal)", async () => {
    const { info } = await refuse(creds.stranger);
    console.log("wrong-operator creds:", JSON.stringify(info));
    assert.equal(info.offline, true);
    assert.match(info.why, /authorization|authentication/i);
  });

  it("a write with refused credentials fails loudly; it is not queued as if the server were merely offline", async () => {
    const b = new NatsBackend({ repo: "c1", url: srv.url, creds: creds.expired, cacheDir: `${creds.work}/cache` });
    await assert.rejects(b.put("tm/task", "TM-2", env("TM-2")), (e) => {
      console.log("write with refused creds:", e.message);
      return /refused the credentials/.test(e.message);
    });
    assert.equal(b.queue().length, 0);
  });
});
