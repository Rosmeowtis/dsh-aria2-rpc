window.__ModuleLoader__.load({
  id: 'dsh-aria2-rpc',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'aria2-rpc';
    const dictionaries = {
      zh: {
        host: 'RPC 主机', port: 'RPC 端口', timeout: '请求超时（毫秒）', ref: '密钥凭据引用',
        hostHint: 'DNS 主机名或 IPv4，不含协议、端口和路径。支持远程 aria2；当前使用 HTTP，请仅在可信网络或加密隧道中连接。',
        refHint: '默认 ARIA2_RPC_SECRET。修改引用并保存后，再为该引用配置密钥。',
        save: '保存连接设置', saving: '保存中…', saved: '连接设置已保存。',
        rejected: '保存失败或配置已在别处变更。草稿已保留；请重新打开页面核对后再保存。',
        readOnly: '配置不可用或当前连接不允许写入。',
        secret: 'RPC 密钥', configured: '已配置', missing: '未配置', unknown: '状态未知',
        secretHint: '仅写入 DSH 凭据存储，不回显原值；留空不改变。清除存储值后，环境变量等来源仍可能生效。',
        saveSecret: '保存密钥', clearSecret: '清除存储的密钥', secretSaved: '密钥操作已完成。',
        secretFailed: '凭据操作失败，请检查连接权限；已保存的设置不受影响。',
        details: '下载由已有 aria2 执行；目录属于 aria2 所在机器。仅在下载源提供校验和时传入，实际哈希由 aria2 计算。取消任务不会删除文件。',
        unsetHint: '未设置密钥时不发送 token。建议为 RPC 配置密钥；HTTP 不加密密钥或下载地址。',
      },
      en: {
        host: 'RPC host', port: 'RPC port', timeout: 'Request timeout (ms)', ref: 'Secret credential reference',
        hostHint: 'DNS name or IPv4 without scheme, port or path. Remote aria2 is supported. HTTP is not encrypted: use a trusted network or encrypted tunnel.',
        refHint: 'Default: ARIA2_RPC_SECRET. Save a changed reference before configuring its secret.',
        save: 'Save connection settings', saving: 'Saving…', saved: 'Connection settings saved.',
        rejected: 'Save failed or settings changed elsewhere. Your draft was kept; reopen this page to review before saving again.',
        readOnly: 'Settings are unavailable or this connection is read-only.',
        secret: 'RPC secret', configured: 'Configured', missing: 'Not configured', unknown: 'Unknown',
        secretHint: 'Written only to DSH credentials, never read back. Blank keeps it unchanged. Environment values may still apply after removing the stored secret.',
        saveSecret: 'Save secret', clearSecret: 'Remove stored secret', secretSaved: 'Credential operation completed.',
        secretFailed: 'Credential operation failed. Check connection permissions; saved settings are unaffected.',
        details: 'Your existing aria2 performs downloads. Directories belong to its machine. Supply a checksum only when the source provides one; aria2 computes the hash. Cancelling never deletes files.',
        unsetHint: 'No token is sent when no secret is configured. A secret is recommended; HTTP does not encrypt it or the download URL.',
      },
    };
    const css = `
      .aria2-rpc-form{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6;max-width:680px;overflow-wrap:anywhere}
      .aria2-rpc-form label{display:flex;flex-direction:column;gap:8px;font-weight:500}
      .aria2-rpc-form input{box-sizing:border-box;width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-weight:400}
      .aria2-rpc-form input:focus-visible,.aria2-rpc-form button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .aria2-rpc-form p{margin:0;color:var(--dsw-alias-label-secondary);font-weight:400}
      .aria2-rpc-form .aria2-rpc-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .aria2-rpc-form button{min-height:40px;padding:8px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
      .aria2-rpc-form button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
      .aria2-rpc-form button:disabled,.aria2-rpc-form input:disabled{opacity:.5;cursor:default}
      .aria2-rpc-form .aria2-rpc-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .aria2-rpc-form .aria2-rpc-error{color:var(--dsw-alias-state-error-primary)}
      .aria2-rpc-form fieldset{margin:0;padding:16px 0 0;border:0;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:12px;min-width:0}
      @media(max-width:520px){.aria2-rpc-form .aria2-rpc-pair{grid-template-columns:1fr}}
    `;
    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials'],
      apply(ctx) {
        for (const [lang, dictionary] of Object.entries(dictionaries)) ctx.effect(() => ctx.locale.register(NS, lang, dictionary));
        const t = ctx.locale.bind(NS);
        ctx.inject(['configForms'], ready => {
          const form = ready.configForms.get('aria2-rpc');
          function Settings() {
            React.useSyncExternalStore(fn => ctx.locale.subscribe(fn), () => ctx.locale.getSnapshot());
            const state = React.useSyncExternalStore(fn => form.subscribe(fn), () => form.getSnapshot());
            const [draft, setDraft] = React.useState(null);
            const [busy, setBusy] = React.useState(false);
            const [notice, setNotice] = React.useState('');
            const [failed, setFailed] = React.useState(false);
            const [secret, setSecret] = React.useState('');
            const [credential, setCredential] = React.useState(null);
            const values = state.value || {};
            const ref = values.rpcSecretRef || 'ARIA2_RPC_SECRET';
            const writable = state.status === 'ready' && state.writable;
            const disabled = busy || !writable;
            const remote = () => ctx.remote.credentials;
            const refreshCredential = async () => {
              const result = await remote().describe([ref]);
              if (!result.ok) throw new Error('credential unavailable');
              return result.value[ref];
            };
            React.useEffect(() => {
              let active = true;
              setCredential(null);
              setSecret('');
              refreshCredential().then(value => { if (active) setCredential(value); }).catch(() => {});
              return () => { active = false; };
            }, [ref]);
            const edit = (key, value) => {
              setDraft(old => ({ revision: old ? old.revision : state.revision, values: { ...(old ? old.values : {}), [key]: value } }));
              setNotice('');
            };
            const save = async event => {
              event.preventDefault();
              if (!draft) return;
              setBusy(true); setNotice(''); setFailed(false);
              try {
                const ops = Object.entries(draft.values).map(([key, value]) => ({ op: 'set', path: [key], value: key === 'rpcPort' || key === 'rpcTimeoutMs' ? Number(value) : value }));
                if (!await form.mutate(ops, draft.revision)) throw new Error('settings refused');
                setDraft(null); setNotice(t('saved'));
              } catch { setFailed(true); setNotice(t('rejected')); }
              finally { setBusy(false); }
            };
            const writeSecret = async clear => {
              setBusy(true); setNotice(''); setFailed(false);
              try {
                const result = clear ? await remote().unset(ref) : await remote().set(ref, secret);
                if (!result.ok) throw new Error('credential refused');
                setSecret('');
                setCredential(await refreshCredential());
                setNotice(t('secretSaved'));
              } catch { setFailed(true); setNotice(t('secretFailed')); }
              finally { setBusy(false); }
            };
            const field = (key, label, fallback, type, props = {}) => h('label', { key, htmlFor: `aria2-${key}` }, t(label), h('input', {
              id: `aria2-${key}`, type, value: draft && key in draft.values ? draft.values[key] : values[key] ?? fallback,
              disabled, onChange: e => edit(key, e.target.value), required: true, spellCheck: false, ...props,
            }));
            return h('div', { className: 'aria2-rpc-form' },
              h('style', null, css),
              h('p', null, t('details')),
              !writable && h('p', { role: 'status' }, t('readOnly')),
              h('form', { onSubmit: save, className: 'aria2-rpc-form' },
                field('rpcHost', 'host', '127.0.0.1', 'text', { pattern: '[A-Za-z0-9][A-Za-z0-9.\\-]*' }),
                h('p', null, t('hostHint')),
                h('div', { className: 'aria2-rpc-pair' }, field('rpcPort', 'port', 6800, 'number', { min: 1, max: 65535, step: 1 }), field('rpcTimeoutMs', 'timeout', 10000, 'number', { min: 1, max: 60000, step: 1 })),
                field('rpcSecretRef', 'ref', 'ARIA2_RPC_SECRET', 'text', { pattern: '[A-Za-z_][A-Za-z0-9_]*' }),
                h('p', null, t('refHint')),
                h('div', { className: 'aria2-rpc-actions' }, h('button', { type: 'submit', disabled: disabled || !draft }, t(busy ? 'saving' : 'save'))),
              ),
              h('fieldset', { disabled: disabled || !credential || !credential.writable || !!draft },
                h('label', { htmlFor: 'aria2-secret' }, `${t('secret')} · ${ref} · ${t(credential ? credential.configured ? 'configured' : 'missing' : 'unknown')}`,
                  h('input', { id: 'aria2-secret', type: 'password', autoComplete: 'new-password', value: secret, onChange: e => setSecret(e.target.value) })),
                h('p', null, t('secretHint')),
                h('div', { className: 'aria2-rpc-actions' },
                  h('button', { type: 'button', disabled: !secret, onClick: () => writeSecret(false) }, t('saveSecret')),
                  h('button', { type: 'button', disabled: !credential || !credential.configured, onClick: () => writeSecret(true) }, t('clearSecret'))),
              ),
              h('p', null, t('unsetHint')),
              notice && h('p', { role: failed ? 'alert' : 'status', className: failed ? 'aria2-rpc-error' : '' }, notice),
            );
          }
          ready.slots.inject('plugins.bundle.config', () => ready.slots.register({ name: 'plugins.bundle.config', key: 'dsh-aria2-rpc' }, Settings));
        });
      },
    };
  },
});
