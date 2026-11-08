# @rosmeowtis/dsh-aria2-rpc

DSH 插件：连接**已有的 aria2 JSON-RPC 服务**（HTTP，`/jsonrpc`），为模型提供四个工具。不携带、不启动、不管理 aria2。

| 工具 | 作用 |
| --- | --- |
| `aria2_download` | 提交单文件直链下载，立即返回 GID；可选保存目录、文件名、来源提供的校验和（sha-256 / sha-1 / md5，实际计算由 aria2 执行）、任务级 HTTP 代理。 |
| `aria2_status` | 读取任务状态、进度、速度、文件路径与脱敏错误。 |
| `aria2_list` | 列出 active / waiting / stopped 或全部任务；只读，支持 limit/offset。 |
| `aria2_control` | `pause` / `resume` / `cancel`。取消保留部分文件，不关闭 aria2。 |

> 工具定义的上下文占用： ~400 token。

配置：设置 → 插件 → Aria2 RPC，可设置 `rpcHost`、`rpcPort`、密钥与请求超时；密钥固定使用凭据 `ARIA2_RPC_SECRET`，无密钥时不发送；HTTP 不加密，远程连接请仅在可信网络或加密隧道中使用。

设置页的「测试连接」使用当前输入的主机、端口与超时调用 `aria2.getVersion`，无需先保存。密钥框中有内容时使用该临时值，否则从当前凭据引用读取；测试不保存配置、不创建任务，成功显示 aria2 版本，失败显示连通性、超时或鉴权提示。

下载完成或失败时，插件通过 aria2 的 WebSocket 通知向发起会话推送一条消息。只跟踪本进程内由 `aria2_download` 创建的任务；插件重载后，重载前创建的任务不再推送。

创建与控制仅在退出计划模式后的完全访问模式执行；状态读取不受此限。结果未知的修改请求会返回可查询的 GID，不会自动重复提交。

## 安装

以 `web` 预设举例。装完必须重启该 profile（`dsh web`）：bundle 层在启动时组装。

npm 渠道（版本受控）：

```sh
dsh plugin --profile web add @rosmeowtis/dsh-aria2-rpc
dsh web
```

GitHub 渠道（跟仓库 HEAD，用于先于发布验证）：

```sh
dsh plugin --profile web add github:Rosmeowtis/dsh-aria2-rpc
```

git 依赖靠 `prepare` 脚本在安装时构建，而 pnpm 默认拦截构建脚本：首次安装会失败并打印一个 `allowBuilds` key，把它写进该 profile 的 `pnpm-workspace.yaml` 后重跑同一条命令。

本地开发：`npm run build` 后在本目录执行 `dsh plugin --profile web add .`。

## 开发

```sh
npm install
npm test   # 构建 + 语法检查 + 模拟 RPC 单元测试（不真实下载）
```
