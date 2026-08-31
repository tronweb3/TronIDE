# 创建组织级 GitHub App

本文用于由 `tronweb3` 组织创建 TronIDE 的 GitHub App。先完成
[`DENO_PROJECT_SETUP.md`](./DENO_PROJECT_SETUP.md) 的“创建组织和 App”步骤，取得
Deno 生产地址。

## 1. 准备信息

```text
DENO_ORG_SLUG=<Deno 组织 slug>
DENO_APP_SLUG=tronide-gh-oauth
BFF_ORIGIN=https://tronide-gh-oauth.<DENO_ORG_SLUG>.deno.net
CALLBACK_URL=<BFF_ORIGIN>/callback
```

`CALLBACK_URL` 必须与 Deno 的 `REDIRECT_URI` **完全一致**。

## 2. 创建 App

使用具备组织 App 管理权限的账号进入：

`GitHub → Your organizations → tronweb3 → Settings → Developer settings → GitHub Apps → New GitHub App`

按下表填写：

| 配置项                                                 | 值                                                  |
| ------------------------------------------------------ | --------------------------------------------------- |
| GitHub App name                                        | `TronIDE`；若重名，使用组织认可的唯一名称           |
| Description                                            | `Connect TronIDE to GitHub repositories and Gists.` |
| Homepage URL                                           | `https://tronide.io`                                |
| Callback URL                                           | `<BFF_ORIGIN>/callback`                             |
| Expire user authorization tokens                       | 开启                                                |
| Request user authorization (OAuth) during installation | 关闭                                                |
| Enable Device Flow                                     | 关闭                                                |
| Setup URL                                              | 留空                                                |
| Webhook / Active                                       | 关闭                                                |
| Where can this GitHub App be installed?                | `Any account`                                       |

只配置以下权限，其余保持 `No access`：

| 权限分类                 | 权限     | 级别             |
| ------------------------ | -------- | ---------------- |
| Repository permissions   | Contents | `Read and write` |
| Account permissions      | Gists    | `Read and write` |
| Organization permissions | 全部     | `No access`      |

点击 **Create GitHub App**。

## 3. 生成并交付凭据

在 App 设置页：

1. 复制 **Client ID**，对应 `GITHUB_APP_CLIENT_ID`。不要误用 App ID。
2. 点击 **Generate a new client secret**，对应
   `GITHUB_APP_CLIENT_SECRET`。
3. 从 `https://github.com/apps/<slug>` 记录 `<slug>`，对应
   `GITHUB_APP_SLUG`。
4. 将三项通过公司密码管理工具交给 Deno 管理员；不要写入仓库、聊天或工单。
5. 本方案不使用 App 私钥，不需要生成 private key。

## 4. 配置完成后的验收

完成 Deno 部署后，用测试账号验证：

- 授权页的 App 所有者显示 `tronweb3`，不再显示个人所有者。
- 连接请求会携带 `prompt=select_account`；在 GitHub 支持该提示的场景中显示账号
  选择流程。
- 安装 App 时可以选择测试仓库；未选择的私有仓库不可访问。
- Gist 新建、读取和更新正常。
- App 的 General 页面中，Callback URL 与 Deno 的 `REDIRECT_URI` 完全一致。

> 授权与安装是两个步骤：授权让 TronIDE 代表当前用户操作；安装决定 App
> 可以访问哪些仓库。

## 官方参考

- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Generating a user access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
