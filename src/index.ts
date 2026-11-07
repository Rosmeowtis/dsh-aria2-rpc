import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-settings';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import type {} from '@deepseek-ai/dsh-plan-mode';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { Aria2Error, createAria2Client, validateHost } from './rpc.js';

export const name = 'aria2-rpc';
export const inject = ['tools', 'credentials', 'sandboxPolicy', 'agents'];

export const Config = z.object({
  rpcHost: z.transform(z.string(), validateHost).default('127.0.0.1').volatile(),
  rpcPort: z.natural().min(1).max(65535).default(6800).volatile(),
  rpcSecretRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).role('credential-ref').default('ARIA2_RPC_SECRET').volatile(),
  rpcTimeoutMs: z.natural().min(1).max(60000).default(10000).volatile(),
});

type Configuration = ReturnType<typeof Config>;
const gidSchema = { type: 'string', pattern: '^[0-9a-fA-F]{16}$', description: '完整的 aria2 GID。作用于当前配置的 RPC 服务，可包含该服务已有的任务。' };
const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });

export function apply(ctx: Context, config: Configuration) {
  ctx.inject(['settings'], ready => {
    ready.effect(() => ready.settings.configure({ auto: false }, ctx.fiber));
  });
  ctx.effect(() => {
    const lifetime = new AbortController();
    const disposers: (() => void)[] = [];
    const register = (definition: Omit<ToolDefinition, 'output'>) => {
      disposers.push(ctx.tools.register({
        ...definition,
        async execute(args, exec) {
          const result = await definition.execute(args, exec);
          // DSH replaces cancelled successes; retain the queryable GID as an error instead.
          if (exec.signal.aborted && result && typeof result === 'object' && 'outcome' in result && result.outcome === 'unknown_effect') {
            throw new Error(JSON.stringify(result));
          }
          return result;
        },
        timeoutMs: 65000,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        presentCall: () => ({ card: 'generic', title: definition.name, kind: definition.name === 'aria2_status' ? 'read' : 'execute' }),
      }));
    };
    const run = async (method: 'download' | 'status' | 'control', args: unknown, exec: Parameters<ToolDefinition['execute']>[1]) => {
      if (method !== 'status') {
        const agent = exec.agent && ctx.agents.get(exec.agent.id);
        const plan = agent?.ctx.get('planMode');
        if (!agent || plan?.get(agent).active || plan?.get(agent).pending === true || ctx.sandboxPolicy.resolve({ session: agent.session }).mode !== 'danger-full-access') {
          return { ok: false, error: { code: 'PERMISSION_DENIED', message: '创建和控制下载仅允许在退出计划模式后的完全访问模式执行；未发送 RPC。' } };
        }
      }
      try {
        const rpcHost = config.rpcHost.get();
        const rpcPort = config.rpcPort.get();
        const timeoutMs = config.rpcTimeoutMs.get();
        const ref = config.rpcSecretRef.get();
        const secret = (await ctx.credentials.resolve(credentialRef(ref)))?.value;
        const client = createAria2Client({ rpcHost, rpcPort, timeoutMs, secret, signal: lifetime.signal });
        // Each boundary validates unknown input again; schemas are discovery, not enforcement.
        const value = await client[method](args as never, { signal: exec.signal });
        return { ok: true, ...value };
      } catch (error) {
        return { ok: false, error: { code: error instanceof Aria2Error ? error.code : 'CONFIG_OR_CREDENTIAL_ERROR', message: error instanceof Aria2Error ? error.message : '配置或凭据不可用，请检查插件设置。' } };
      }
    };
    register({
      name: 'aria2_download',
      description: '向已有 aria2 服务提交单文件直链下载，立即返回 GID；不等待完成。文件保存在 aria2 所在机器。只有下载源明确提供校验和时才填写 checksum，哈希由 aria2 计算。创建需完全访问模式。结果未知时先用 GID 查状态，不要重复提交。',
      parameters: schema({
        url: { type: 'string', description: 'HTTP/HTTPS 文件直链，不允许内嵌用户名和密码。' },
        directory: { type: 'string', description: 'aria2 所在机器的绝对目录；省略使用其默认目录。' },
        filename: { type: 'string', description: '纯文件名，不含目录；省略由 aria2 决定。禁止覆盖和自动改名。' },
        checksum: { ...schema({
          algorithm: { type: 'string', enum: ['sha-256', 'sha-1', 'md5'] },
          digest: { type: 'string', description: '下载源提供的十六进制摘要：SHA-256 为 64 位，SHA-1 为 40 位，MD5 为 32 位。没有来源校验和时省略整个 checksum。' },
        }, ['algorithm', 'digest']) },
        proxy: { type: 'string', description: '省略继承 aria2 代理；空串直连；http://host:port 为本任务独立 HTTP 代理。不支持 SOCKS 或代理凭据。' },
      }, ['url']),
      execute: (args, exec) => run('download', args, exec),
    });
    register({
      name: 'aria2_status',
      description: '读取当前 RPC 服务中的一个任务状态、速度、文件路径和脱敏错误。不启动下载、不等待完成；complete 不单独证明曾执行哈希校验。',
      parameters: schema({ gid: gidSchema }, ['gid']),
      isConcurrencySafe: () => true,
      execute: (args, exec) => run('status', args, exec),
    });
    register({
      name: 'aria2_control',
      description: '暂停、恢复或取消当前 RPC 服务中的任务。取消保留部分文件，不关闭 aria2；恢复仅适用于暂停任务。需完全访问模式。动作被接受后可查状态确认，结果未知时不盲目重试。',
      parameters: schema({ gid: gidSchema, action: { type: 'string', enum: ['pause', 'resume', 'cancel'] } }, ['gid', 'action']),
      execute: (args, exec) => run('control', args, exec),
    });
    return () => {
      lifetime.abort();
      for (const dispose of disposers.reverse()) dispose();
    };
  });
}
