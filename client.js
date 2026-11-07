window.__ModuleLoader__.load({
  id: 'dsh-aria2-rpc',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'aria2-rpc';
    const dictionaries = {
      zh: {
        host: 'RPC 主机', port: 'RPC 端口', timeout: '请求超时（毫秒）',
        hostHint: '当前使用 HTTP，请确保在可信网络下使用。',
        save: '保存连接设置', saving: '保存中…', saved: '连接设置已保存。',
        rejected: '保存失败或配置已在别处变更。草稿已保留；请重新打开页面核对后再保存。',
        readOnly: '配置不可用或当前连接不允许写入。',
        secret: 'RPC 密钥', configured: '已配置', missing: '未配置', unknown: '状态未知',
        secretHint: '仅写入 DSH 凭据存储，不回显原值；留空不改变。清除存储值后，环境变量等来源仍可能生效。',
        saveSecret: '保存密钥', clearSecret: '清除存储的密钥', secretSaved: '密钥操作已完成。',
        secretFailed: '凭据操作失败，请检查连接权限；已保存的设置不受影响。',
        details: '连接现有 aria2 RPC 服务，不自带 aria2，提供创建、查询、暂停、恢复、取消功能。',
        test: '测试连接', testing: '测试中…', connected: '连接成功，aria2 版本：',
        testFailed: '测试失败：', NETWORK: '无法连接，请检查主机、端口及防火墙。', TIMEOUT: '请求超时。',
        RPC_ERROR: 'RPC 拒绝请求，请检查密钥及服务配置。', HTTP_ERROR: 'HTTP 响应异常，请检查 RPC 端口。',
        INVALID_INPUT: '主机、端口或超时格式不正确。', BAD_RESPONSE: '响应不是有效的 aria2 RPC 版本信息。',
        REDIRECT: 'RPC 地址发生重定向，已拒绝。', RESPONSE_TOO_LARGE: 'RPC 响应过大。', ABORTED: '测试已取消。',
        CREDENTIAL_ERROR: '无法读取凭据。', TRANSPORT_ERROR: '无法调用 DSH 测试接口，请刷新页面重试。',
      },
      en: {
        host: 'RPC host', port: 'RPC port', timeout: 'Request timeout (ms)',
        hostHint: 'Uses HTTP; use it only on a trusted network.',
        save: 'Save connection settings', saving: 'Saving…', saved: 'Connection settings saved.',
        rejected: 'Save failed or settings changed elsewhere. Your draft was kept; reopen this page to review before saving again.',
        readOnly: 'Settings are unavailable or this connection is read-only.',
        secret: 'RPC secret', configured: 'Configured', missing: 'Not configured', unknown: 'Unknown',
        secretHint: 'Written only to DSH credentials, never read back. Blank keeps it unchanged. Environment values may still apply after removing the stored secret.',
        saveSecret: 'Save secret', clearSecret: 'Remove stored secret', secretSaved: 'Credential operation completed.',
        secretFailed: 'Credential operation failed. Check connection permissions; saved settings are unaffected.',
        details: 'Connects to an existing aria2 RPC service without bundling aria2; provides create, query, pause, resume, and cancel.',
        test: 'Test connection', testing: 'Testing…', connected: 'Connected, aria2 version: ',
        testFailed: 'Connection test failed: ', NETWORK: 'Cannot connect. Check host, port and firewall.', TIMEOUT: 'Request timed out.',
        RPC_ERROR: 'RPC rejected the request. Check the secret and service configuration.', HTTP_ERROR: 'Unexpected HTTP response. Check the RPC port.',
        INVALID_INPUT: 'Invalid host, port or timeout.', BAD_RESPONSE: 'Not a valid aria2 RPC version response.',
        REDIRECT: 'RPC redirect rejected.', RESPONSE_TOO_LARGE: 'RPC response is too large.', ABORTED: 'Test cancelled.',
        CREDENTIAL_ERROR: 'Cannot read the credential.', TRANSPORT_ERROR: 'Cannot call the DSH test endpoint. Refresh and retry.',
      },
    };
    const css = `
      .aria2-rpc-form{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6;max-width:680px;overflow-wrap:anywhere}
      .aria2-rpc-form label{display:flex;flex-direction:column;gap:8px;font-weight:500}
      .aria2-rpc-form input{box-sizing:border-box;width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-weight:400}
      .aria2-rpc-form input:focus-visible,.aria2-rpc-form button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .aria2-rpc-form input::placeholder{color:var(--dsw-alias-state-idle-primary);opacity:1}
      .aria2-rpc-form p{margin:0;color:var(--dsw-alias-label-secondary);font-weight:400}
      .aria2-rpc-form .aria2-rpc-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .aria2-rpc-form button{min-height:40px;padding:8px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
      .aria2-rpc-form button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
      .aria2-rpc-form button:disabled,.aria2-rpc-form input:disabled{opacity:.5;cursor:default}
      .aria2-rpc-form .aria2-rpc-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .aria2-rpc-form .aria2-rpc-error{color:var(--dsw-alias-state-error-primary)}
      .aria2-rpc-form .aria2-rpc-note{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:10px 12px;font-size:13px}
      .aria2-rpc-form .aria2-rpc-secret-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .aria2-rpc-form .aria2-rpc-secret-head label{display:block;font-weight:500}
      .aria2-rpc-form .aria2-rpc-status{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;line-height:1.5}
      .aria2-rpc-form .aria2-rpc-status.configured{background:#15803d;color:#fff}
      .aria2-rpc-form .aria2-rpc-status.missing{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
      .aria2-rpc-form .aria2-rpc-test.success{background:#15803d;border-color:#15803d;color:#fff}
      .aria2-rpc-form .aria2-rpc-test.failure{background:#b91c1c;border-color:#b91c1c;color:#fff}
      .aria2-rpc-form .aria2-rpc-test.success:hover:not(:disabled){background:#116932}
      .aria2-rpc-form .aria2-rpc-test.failure:hover:not(:disabled){background:#991b1b}
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
            const [testing, setTesting] = React.useState(false);
            const [testState, setTestState] = React.useState('idle');
            const testAbort = React.useRef(null);
            React.useEffect(() => () => testAbort.current?.abort(), []);
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
              setNotice(''); setTestState('idle');
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
            const testConnection = async () => {
              const current = { ...values, ...(draft ? draft.values : {}) };
              const controller = new AbortController();
              testAbort.current = controller;
              setTesting(true); setTestState('testing'); setBusy(true); setNotice(''); setFailed(false);
              try {
                const response = await fetch('./api/aria2-rpc.test', {
                  method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
                  signal: controller.signal,
                  body: JSON.stringify({ rpcHost: current.rpcHost, rpcPort: Number(current.rpcPort), rpcTimeoutMs: Number(current.rpcTimeoutMs), rpcSecretRef: current.rpcSecretRef, ...(secret ? { secret } : {}) }),
                });
                const result = await response.json();
                if (controller.signal.aborted) return;
                if (response.ok && result.ok === true && typeof result.version === 'string') { setTestState('success'); setNotice(t('connected') + result.version); }
                else {
                  const code = ['NETWORK', 'TIMEOUT', 'RPC_ERROR', 'HTTP_ERROR', 'INVALID_INPUT', 'BAD_RESPONSE', 'REDIRECT', 'RESPONSE_TOO_LARGE', 'ABORTED', 'CREDENTIAL_ERROR'].includes(result.code) ? result.code : 'TRANSPORT_ERROR';
                  setTestState('failure'); setFailed(true); setNotice(t('testFailed') + t(code));
                }
              } catch {
                if (!controller.signal.aborted) { setTestState('failure'); setFailed(true); setNotice(t('testFailed') + t('TRANSPORT_ERROR')); }
              } finally {
                if (!controller.signal.aborted) { setTesting(false); setBusy(false); }
              }
            };
            const placeholders = { rpcHost: '127.0.0.1', rpcPort: '6800', rpcTimeoutMs: '10000' };
            const field = (key, label, fallback, type, props = {}) => h('label', { key, htmlFor: `aria2-${key}` }, t(label), h('input', {
              id: `aria2-${key}`, type, placeholder: placeholders[key], value: draft && key in draft.values ? draft.values[key] : values[key] ?? fallback,
              disabled, onChange: e => edit(key, e.target.value), required: true, spellCheck: false, ...props,
            }));
            return h('div', { className: 'aria2-rpc-form' },
              h('style', null, css),
              h('p', { className: 'aria2-rpc-note' }, t('details')),
              !writable && h('p', { role: 'status' }, t('readOnly')),
              h('form', { onSubmit: save, className: 'aria2-rpc-form' },
                field('rpcHost', 'host', '127.0.0.1', 'text', { pattern: '[A-Za-z0-9][A-Za-z0-9.\\-]*' }),
                h('p', { className: 'aria2-rpc-note' }, t('hostHint')),
                h('div', { className: 'aria2-rpc-pair' }, field('rpcPort', 'port', 6800, 'number', { min: 1, max: 65535, step: 1 }), field('rpcTimeoutMs', 'timeout', 10000, 'number', { min: 1, max: 60000, step: 1 })),
                h('div', { className: 'aria2-rpc-actions' }, h('button', { type: 'submit', disabled: disabled || !draft }, t(busy ? 'saving' : 'save'))),
              ),
              h('fieldset', { disabled: disabled || !credential || !credential.writable || !!draft },
                h('div', { className: 'aria2-rpc-secret-head' },
                  h('label', { htmlFor: 'aria2-secret' }, t('secret')),
                  h('span', { className: `aria2-rpc-status ${credential && credential.configured ? 'configured' : 'missing'}` }, t(credential ? credential.configured ? 'configured' : 'missing' : 'unknown'))),
                h('input', { id: 'aria2-secret', type: 'password', autoComplete: 'new-password', placeholder: 'rpc-secret', value: secret, onChange: e => setSecret(e.target.value) }),
                h('p', { className: 'aria2-rpc-note' }, t('secretHint')),
                h('div', { className: 'aria2-rpc-actions' },
                  h('button', { type: 'button', disabled: !secret, onClick: () => writeSecret(false) }, t('saveSecret')),
                  h('button', { type: 'button', disabled: !credential || !credential.configured, onClick: () => writeSecret(true) }, t('clearSecret'))),
              ),
              h('div', { className: 'aria2-rpc-actions' }, h('button', { type: 'button', className: `aria2-rpc-test ${testState === 'success' ? 'success' : testState === 'failure' ? 'failure' : ''}`, disabled, onClick: testConnection }, t(testing ? 'testing' : 'test'))),
              notice && h('p', { role: failed ? 'alert' : 'status', className: `aria2-rpc-note${failed ? ' aria2-rpc-error' : ''}` }, notice),
            );
          }
          ready.slots.inject('plugins.bundle.config', () => ready.slots.register({ name: 'plugins.bundle.config', key: 'dsh-aria2-rpc' }, Settings));
        });
      },
    };
  },
});
