import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const BASE_ENV = {
  TEAMCITY_URL: 'https://tc.example.com',
  TEAMCITY_TOKEN: 't0ken',
};

describe('loadConfig transport', () => {
  it('defaults to http', () => {
    expect(loadConfig({ ...BASE_ENV }).transport).toBe('http');
  });

  it('accepts MCP_TRANSPORT=stdio', () => {
    expect(loadConfig({ ...BASE_ENV, MCP_TRANSPORT: 'stdio' }).transport).toBe('stdio');
  });

  it('rejects per-request auth on the stdio transport', () => {
    expect(() =>
      loadConfig({ ...BASE_ENV, MCP_TRANSPORT: 'stdio', TEAMCITY_PER_REQUEST_AUTH: 'true' }),
    ).toThrow(/HTTP transport/);
  });

  it('requires MCP_AUTH_TOKEN for non-loopback HTTP binds', () => {
    expect(() => loadConfig({ ...BASE_ENV, HOST: '0.0.0.0' })).toThrow(/MCP_AUTH_TOKEN/);
    expect(loadConfig({ ...BASE_ENV, HOST: '0.0.0.0', MCP_AUTH_TOKEN: 'x' }).host).toBe('0.0.0.0');
  });

  it('ignores bind-address rules in stdio mode', () => {
    expect(loadConfig({ ...BASE_ENV, MCP_TRANSPORT: 'stdio', HOST: '0.0.0.0' }).transport).toBe('stdio');
  });

  it('requires some credential', () => {
    expect(() => loadConfig({ TEAMCITY_URL: 'https://tc.example.com' })).toThrow(/TEAMCITY_TOKEN/);
  });

  it('selects basic auth when username+password are set', () => {
    const c = loadConfig({
      TEAMCITY_URL: 'https://tc.example.com',
      TEAMCITY_USERNAME: 'u',
      TEAMCITY_PASSWORD: 'p',
    });
    expect(c.auth.kind).toBe('basic');
  });
});
