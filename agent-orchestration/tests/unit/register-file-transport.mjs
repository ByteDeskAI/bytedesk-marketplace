// The product default is NATS. This preload keeps the existing unit suite on the
// file double unless a test passes its own transport or sets AO_TRANSPORT itself.
if (!process.env.AO_TRANSPORT) process.env.AO_TRANSPORT = 'file';
// TM-272/TM-298: the managed-services opt-out lives in tests/helpers/tmux-preflight.mjs, which both
// the unit and the contract suites load.
