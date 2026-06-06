import { describe, expect, it, vi } from 'vitest';
import type { ServerDefinition } from '../src/config.js';
import { __testProcessRequest } from '../src/daemon/host.js';
import type { DaemonRequest } from '../src/daemon/protocol.js';
import type { Runtime } from '../src/runtime.js';

describe('daemon host request handling', () => {
  const metadata = {
    configPath: '/tmp/config.json',
    configLayers: [],
    configMtimeMs: Date.now(),
    socketPath: '/tmp/socket',
    startedAt: Date.now(),
    logPath: null,
  };
  const logContext = { enabled: false, logAllServers: false, servers: new Set<string>() };

  it('reuses pre-parsed requests without reparsing payloads', async () => {
    const parsedRequest: DaemonRequest = { id: '1', method: 'status', params: {} };
    const result = await __testProcessRequest(
      '!!!invalid-json!!!',
      {} as Runtime,
      new Map<string, ServerDefinition>(),
      new Map(),
      metadata,
      logContext,
      parsedRequest
    );

    expect(result.response.ok).toBe(true);
    expect(result.shouldShutdown).toBe(false);
  });

  it('defaults daemon callTool and listTools requests to cached auth', async () => {
    const runtime = createRuntimeDouble();
    const managedServers = createManagedServers();

    await __testProcessRequest('', runtime as unknown as Runtime, managedServers, new Map(), metadata, logContext, {
      id: 'call',
      method: 'callTool',
      params: { server: 'oauth', tool: 'ping' },
    });

    expect(runtime.callTool).toHaveBeenCalledWith('oauth', 'ping', {
      args: {},
      timeoutMs: undefined,
      disableOAuth: undefined,
    });

    await __testProcessRequest('', runtime as unknown as Runtime, managedServers, new Map(), metadata, logContext, {
      id: 'list',
      method: 'listTools',
      params: { server: 'oauth', includeSchema: true },
    });

    expect(runtime.listTools).toHaveBeenCalledWith('oauth', {
      includeSchema: true,
      autoAuthorize: undefined,
      allowCachedAuth: true,
      disableOAuth: undefined,
    });
  });

  it('keeps stdio keep-alive listTools requests reusable when callers disable auto auth', async () => {
    const runtime = createRuntimeDouble();
    const managedServers = createManagedServers();

    await __testProcessRequest('', runtime as unknown as Runtime, managedServers, new Map(), metadata, logContext, {
      id: 'list',
      method: 'listTools',
      params: { server: 'local', includeSchema: true, autoAuthorize: false, allowCachedAuth: true },
    });

    expect(runtime.listTools).toHaveBeenCalledWith('local', {
      includeSchema: true,
      autoAuthorize: undefined,
      allowCachedAuth: true,
      disableOAuth: undefined,
    });
  });

  it('preserves HTTP listTools auto-auth opt out on daemon requests', async () => {
    const runtime = createRuntimeDouble();
    const managedServers = createManagedServers();

    await __testProcessRequest('', runtime as unknown as Runtime, managedServers, new Map(), metadata, logContext, {
      id: 'list',
      method: 'listTools',
      params: { server: 'oauth', includeSchema: true, autoAuthorize: false, allowCachedAuth: true },
    });

    expect(runtime.listTools).toHaveBeenCalledWith('oauth', {
      includeSchema: true,
      autoAuthorize: false,
      allowCachedAuth: true,
      disableOAuth: undefined,
    });
  });

  it('forwards disableOAuth on daemon callTool and listTools requests', async () => {
    const runtime = createRuntimeDouble();
    const managedServers = createManagedServers();

    await __testProcessRequest('', runtime as unknown as Runtime, managedServers, new Map(), metadata, logContext, {
      id: 'call',
      method: 'callTool',
      params: { server: 'oauth', tool: 'ping', disableOAuth: true },
    });

    expect(runtime.callTool).toHaveBeenCalledWith('oauth', 'ping', {
      args: {},
      timeoutMs: undefined,
      disableOAuth: true,
    });

    await __testProcessRequest('', runtime as unknown as Runtime, managedServers, new Map(), metadata, logContext, {
      id: 'list',
      method: 'listTools',
      params: { server: 'oauth', includeSchema: true, disableOAuth: true },
    });

    expect(runtime.listTools).toHaveBeenCalledWith('oauth', {
      includeSchema: true,
      autoAuthorize: undefined,
      allowCachedAuth: true,
      disableOAuth: true,
    });
  });

  it('preserves explicit listTools cached-auth opt out on daemon requests', async () => {
    const runtime = createRuntimeDouble();
    const managedServers = createManagedServers();

    await __testProcessRequest('', runtime as unknown as Runtime, managedServers, new Map(), metadata, logContext, {
      id: 'list',
      method: 'listTools',
      params: { server: 'oauth', allowCachedAuth: false },
    });

    expect(runtime.listTools).toHaveBeenCalledWith('oauth', {
      includeSchema: undefined,
      autoAuthorize: undefined,
      allowCachedAuth: false,
      disableOAuth: undefined,
    });
  });
});

function createRuntimeDouble(): Pick<Runtime, 'callTool' | 'listTools'> {
  return {
    callTool: vi.fn().mockResolvedValue({ ok: true }),
    listTools: vi.fn().mockResolvedValue([]),
  };
}

function createManagedServers(): Map<string, ServerDefinition> {
  return new Map([
    [
      'local',
      {
        name: 'local',
        command: { kind: 'stdio', command: 'node', args: ['server.js'], cwd: '/tmp' },
        lifecycle: { mode: 'keep-alive' },
      },
    ],
    [
      'oauth',
      {
        name: 'oauth',
        command: { kind: 'http', url: new URL('https://oauth.example.com/mcp') },
        lifecycle: { mode: 'keep-alive' },
      },
    ],
  ]);
}
