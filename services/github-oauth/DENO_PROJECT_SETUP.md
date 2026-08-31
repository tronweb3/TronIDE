# 创建组织级 Deno Deploy App

本文用于在新 Deno Deploy 平台创建 TronIDE GitHub BFF。不要再创建个人
Deploy Classic 项目；生产 App、环境变量和 Deno KV 都应归团队组织所有。

## 1. 创建组织和 App

1. 登录 [Deno Deploy Console](https://console.deno.com)。
2. 创建或选择团队组织，建议名称 `tronweb3`；记录实际的组织 slug。
3. 在本机将 Deno 升级到支持 `deno deploy` 的当前稳定版，然后从 GitLab
   主仓创建 App：

   ```sh
   deno upgrade
   cd services/github-oauth
   deno deploy create \
     --org <DENO_ORG_SLUG> \
     --app tronide-gh-oauth \
     --source local \
     --runtime-mode dynamic \
     --entrypoint main.ts \
     --region global
   ```

4. 确认创建结果归属团队组织，而不是个人账号。
5. 记录生产地址：

   ```text
   https://tronide-gh-oauth.<DENO_ORG_SLUG>.deno.net
   ```

> 若使用 GitHub 自动部署，选择 `tronweb3/TronIDE`，App directory 填
> `services/github-oauth`，Runtime 选 `Dynamic`，Entrypoint 填 `main.ts`。
> GitLab 主仓的改动同步到公开 GitHub 后，才会触发该自动部署。

取得生产地址后，按
[`GITHUB_APP_SETUP.md`](./GITHUB_APP_SETUP.md) 创建 GitHub App，再回到下一步。

## 2. 创建并绑定 Deno KV

1. 在组织的 **Databases** 页面点击 **Provision Database**。
2. Engine 选择 **Deno KV**，slug 建议 `tronide-github-auth`。
3. 创建后点击 **Assign**，绑定到 `tronide-gh-oauth` App。
4. 等待状态变为 **Connected**。

代码使用 `Deno.openKv()`，绑定成功后不需要额外的 KV URL 或密钥。

## 3. 配置环境变量

进入 App 的 **Settings → Environment Variables**。以下变量至少应用于
**Production**；测试分支需要完整 OAuth 时，也应用于 **Development**。

| 变量                       | 值                                                       | 类型     |
| -------------------------- | -------------------------------------------------------- | -------- |
| `GITHUB_AUTH_PROVIDER`     | `github_app`                                             | 普通变量 |
| `GITHUB_APP_CLIENT_ID`     | GitHub App 的 Client ID                                  | 普通变量 |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App 的 Client secret                              | Secret   |
| `GITHUB_APP_SLUG`          | `github.com/apps/` 后的 slug                             | 普通变量 |
| `SESSION_ENCRYPTION_KEY`   | 32 字节随机值的 Base64                                   | Secret   |
| `REDIRECT_URI`             | `https://<APP>.<ORG>.deno.net/callback`                  | 普通变量 |
| `ALLOWED_ORIGINS`          | `https://test.tronide.allsandlab.com,https://tronide.io` | 普通变量 |

生成 `SESSION_ENCRYPTION_KEY`：

```sh
openssl rand -base64 32
```

可选变量保持默认即可：`SESSION_TTL_SECONDS=28800`、
`OAUTH_RATE_LIMIT=10`、`API_RATE_LIMIT=120`、
`GIT_PUBLIC_RATE_LIMIT=30`、`GIT_AUTH_RATE_LIMIT=120`。

不要配置或提交 `GITHUB_SCOPE`；GitHub App 使用权限而不是 OAuth scopes。

## 4. 部署

从主仓部署当前版本：

```sh
cd services/github-oauth
deno task test
deno task check
DENO_DEPLOY_ORG=<DENO_ORG_SLUG> deno task deploy
```

若 App 已关联 GitHub，也可以在 Console 点击 **Deploy Default Branch**。GitLab
的 TronIDE 流水线不会自动部署此 Deno App。

## 5. 验证

```sh
export BFF_ORIGIN="https://tronide-gh-oauth.<DENO_ORG_SLUG>.deno.net"

curl -fsS "$BFF_ORIGIN/health"
curl -fsS \
  -H 'Origin: https://test.tronide.allsandlab.com' \
  "$BFF_ORIGIN/capabilities"
```

预期结果：

- `/health` 包含 `mode=bff-v1; provider=github_app`。
- `/capabilities` 包含 `authMode: bff-v1`、
  `githubTokenInBrowser: false`、`authProvider: github_app`，且
  `githubAppSlug` 正确。
- Console 日志无 KV、凭据或回调地址错误。

最后在 TronIDE 测试环境构建变量中设置（末尾不要加 `/`）：

```text
TRONIDE_GITHUB_BFF_ORIGIN=https://tronide-gh-oauth.<DENO_ORG_SLUG>.deno.net
```

按“Deno BFF 先上线、TronIDE 前端后切换”的顺序发布。回滚时只需将该构建变量
切回旧 BFF；不要把 GitHub token 退回浏览器。

## 官方参考

- [Deno Deploy applications](https://docs.deno.com/deploy/reference/apps/)
- [Deno Deploy build configuration](https://docs.deno.com/deploy/reference/builds/)
- [Deno KV databases](https://docs.deno.com/deploy/reference/deno_kv/)
- [Environment variables and contexts](https://docs.deno.com/deploy/reference/env_vars_and_contexts/)
- [`deno deploy` CLI](https://docs.deno.com/runtime/reference/cli/deploy/)
