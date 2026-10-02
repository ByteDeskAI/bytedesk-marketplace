// The product default is NATS. This preload keeps the existing unit suite on the
// file double unless a test passes its own transport or sets AO_TRANSPORT itself.
if (!process.env.AO_TRANSPORT) process.env.AO_TRANSPORT = 'file';
// TM-272: the managed services (process-compose plus an OS registration) are the product default.
// The unit suite keeps the pre-services launchers unless a test opts in, so no test can register a
// real systemd unit, LaunchAgent or scheduled task, or download a binary, by accident.
if (!process.env.AGENT_ORCHESTRATION_SERVICES) process.env.AGENT_ORCHESTRATION_SERVICES = '0';
