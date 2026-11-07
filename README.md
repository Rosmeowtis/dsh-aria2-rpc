# dsh-aria2-rpc

DSH 插件：连接**已有的 aria2 JSON-RPC 服务**（HTTP，`/jsonrpc`），为模型提供三个工具。不携带、不启动、不管理 aria2。

| 工具 | 作用 |
| --- | --- |
| `aria2_download` | 提交单文件直链下载，立即返回 GID；可选保存目录、文件名、来源提供的校验和（sha-256 / sha-1 / md5，实际计算由 aria2 执行）、任务级 HTTP 代理。 |
| `aria2_status` | 读取任务状态、进度、速度、文件路径与脱敏错误。 |
| `aria2_control` | `pause` / `resume` / `cancel`。取消保留部分文件，不关闭 aria2。 |

配置：设置 → 插件 → Aria2 RPC，可设置 `rpcHost`、`rpcPort`、密钥（凭据引用，默认 `ARIA2_RPC_SECRET`）与请求超时。无密钥时不发送 token；HTTP 不加密，远程连接请仅在可信网络或加密隧道中使用。

设置页的「测试连接」使用当前输入的主机、端口与超时调用 `aria2.getVersion`，无需先保存。密钥框中有内容时使用该临时值，否则从当前凭据引用读取；测试不保存配置、不创建任务，成功显示 aria2 版本，失败显示连通性、超时或鉴权提示。

创建与控制仅在退出计划模式后的完全访问模式执行；状态读取不受此限。结果未知的修改请求会返回可查询的 GID，不会自动重复提交。

## 开发

```sh
npm install
npm test   # 构建 + 语法检查 + 模拟 RPC 单元测试（不真实下载）
```

安装到当前 profile：DSH 的插件管理 `install_bundle`，target 为本目录绝对路径。
