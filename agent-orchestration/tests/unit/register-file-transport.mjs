// The product default is NATS. This preload keeps the existing unit suite on the
// file double unless a test passes its own transport or sets AO_TRANSPORT itself.
if (!process.env.AO_TRANSPORT) process.env.AO_TRANSPORT = 'file';
