// TM-491 / TM-461: import this FIRST in a test file so a bare `node --test <file>` behaves like
// `npm run test:unit`. Without the harness preloads the transport defaults to NATS and the managed
// services are on, so the file dials the operator's live NATS (or runs `services ensure` against the
// operator's services) and the cached connection then holds the process open after the last test.
// Module imports run once per process, so loading this under the harness preloads too is a no-op.
import "./tmux-preflight.mjs";
import "../unit/register-file-transport.mjs";
import { after } from "node:test";
import { closeLiveTransports } from "../../topology/lib/orch-transport.mjs";

// Whatever transport a test did open (AO_TRANSPORT=nats set by the caller) is closed by the fixture,
// not left for a forced exit.
after(closeLiveTransports);
