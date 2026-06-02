# 管理中心与 CLIProxyAPI 更新逻辑对齐说明

## 背景

`CLIProxyAPI` 后端已经具备“检查最新版本”的能力：

1. 管理接口暴露 `/v0/management/latest-version`
2. 服务端通过 GitHub Releases 查询最新版本
3. 管理接口响应头持续返回当前服务端版本与构建时间

`Cli-Proxy-API-Management-Center` 原本已经有基础的“检查更新”按钮，但逻辑相对分散：

- 页面内直接解析后端返回字段
- 页面内直接做版本比较
- 只弹通知，不在界面上保留检查结果
- 缺少“查看发布页”的直接入口
- 在切换服务器或连接状态变化时，旧检查结果可能残留

本次改动的目标，就是把管理中心的前端行为与 `CLIProxyAPI` 的后端更新逻辑做一致化对齐。

---

## 对齐目标

本次对齐后，管理中心需要具备以下能力：

1. 统一识别后端返回的最新版本字段
2. 统一进行版本比较
3. 在系统页展示：
   - 当前 CLI Proxy API 版本
   - 最新版本
   - 更新状态
   - 最近检查时间
   - 发布页链接
4. 在切换连接目标后清空旧检查结果
5. 避免异步请求竞态导致旧服务器的检查结果覆盖新服务器状态

---

## 后端现有逻辑（CLIProxyAPI）

### 1. 当前服务端版本来源

`CLIProxyAPI` 的管理接口响应头会返回：

- `X-CPA-VERSION`
- `X-CPA-BUILD-DATE`

管理中心通过这些头部拿到当前服务端版本与构建时间。

### 2. 最新版本检查接口

后端管理接口：

- `GET /v0/management/latest-version`

典型返回：

```json
{
  "latest-version": "v7.1.37"
}
```

后端本质上是通过 GitHub Releases 获取最新版本标签，再返回给前端。

---

## 前端本次对齐内容

### 1. 版本响应类型统一

新增了版本检查相关类型，避免页面直接操作松散的 `Record<string, unknown>`。

涉及文件：

- `src/types/api.ts`

新增类型：

- `LatestVersionApiPayload`
- `LatestVersionResponse`

这样做的目的：

- 页面不再直接关心后端字段长什么样
- 字段兼容逻辑集中在一处
- 后续如果后端字段扩展，更容易维护

---

### 2. 抽离版本工具函数

新增：

- `src/utils/version.ts`

包含以下职责：

#### `parseVersionSegments()`
把版本号拆成数字段，例如：

- `v7.1.37` → `[7, 1, 37]`
- `7.1.37` → `[7, 1, 37]`

#### `compareVersions()`
对两个版本号做比较，返回：

- `1`：最新版本更高
- `0`：相同
- `-1`：当前版本更高
- `null`：无法比较

#### `normalizeLatestVersionResponse()`
统一兼容后端字段：

- `latest-version`
- `latest_version`
- `latest`

最终输出统一字段：

```ts
{
  latestVersion: string | null,
  raw: payload
}
```

#### `buildReleaseUrl()`
根据版本号构造 GitHub 发布页链接：

- 有版本：跳到指定 tag
- 无版本：跳到 latest release 页面

---

### 3. 版本 API 服务层统一

文件：

- `src/services/api/version.ts`

原来页面自己拿原始返回结构去解析。

现在改为：

- API 层请求 `/latest-version`
- 服务层统一做 normalize
- 页面只消费 `LatestVersionResponse`

这让页面逻辑更轻，也减少字段兼容代码散落在页面里的情况。

---

### 4. 系统页展示升级结果

文件：

- `src/pages/SystemPage.tsx`
- `src/pages/SystemPage.module.scss`

本次系统页新增了以下展示能力：

#### 版本卡片中新增展示

- 当前服务端版本
- 最新版本
- 检查状态
- 最近检查时间
- 发布页链接

#### 状态类型

前端引入了统一状态：

- `idle`
- `loading`
- `update-available`
- `latest`
- `not-comparable`
- `error`

对应界面会展示不同的状态文案与视觉样式。

#### 状态展示效果

- 未检查：提示点击检查更新
- 检查中：显示加载态
- 有新版本：显示可更新状态，并提供发布页链接
- 已是最新：显示成功状态
- 无法比较：提示未获取到服务器版本号
- 失败：展示失败信息

---

## 竞态与状态污染处理

这是本次对齐里最重要的一部分。

### 问题 1：切换服务器后旧结果残留

如果用户先连接服务器 A 并检查更新，再切到服务器 B：

- 当前版本已经变成 B
- 但上一次检查的“最新版本 / 状态 / 检查时间”仍可能停留在 A 的结果

这会误导用户。

### 解决方案

在以下字段变化时，重置版本检查状态：

- `auth.apiBase`
- `auth.connectionStatus`
- `auth.serverVersion`

也就是：

- 切换目标服务器时清空
- 重新连接时清空
- 当前服务端版本变化时清空

---

### 问题 2：异步请求竞态覆盖

场景：

1. 用户在服务器 A 上点“检查更新”
2. 请求还没回来时切换到服务器 B
3. A 的请求后返回
4. 如果不做保护，A 的检查结果会写进 B 的页面状态

### 解决方案

系统页加入了两层保护：

#### 1）请求递增 ID

使用 `versionCheckRequestId` 标记当前有效请求。

每次发起新请求或连接环境变化时，都会让旧请求失效。

#### 2）连接上下文范围校验

使用：

```ts
${auth.apiBase}::${auth.connectionStatus}::${auth.serverVersion ?? ''}
```

作为当前版本检查作用域。

请求发起时记录一份作用域快照；响应返回时再比对：

- 如果请求 ID 已失效，丢弃结果
- 如果当前作用域已变化，丢弃结果

因此旧服务器返回不会再污染新服务器的显示结果。

---

## 多语言文案同步

本次同步新增了“发布页链接”文案，涉及：

- `src/i18n/locales/zh-CN.json`
- `src/i18n/locales/en.json`
- `src/i18n/locales/zh-TW.json`
- `src/i18n/locales/ru.json`

新增 key：

- `system_info.version_release_link`

这样界面在所有当前支持语言下都能完整展示更新入口。

---

## 本次实际改动文件

### 业务逻辑

- `src/pages/SystemPage.tsx`
- `src/services/api/version.ts`
- `src/types/api.ts`
- `src/utils/version.ts`

### 样式

- `src/pages/SystemPage.module.scss`

### 多语言

- `src/i18n/locales/zh-CN.json`
- `src/i18n/locales/en.json`
- `src/i18n/locales/zh-TW.json`
- `src/i18n/locales/ru.json`

---

## 验证项

本次改动后应重点验证以下场景：

### 基础功能

1. 系统页点击“检查更新”后能正常调用：
   - `/v0/management/latest-version`
2. 能正确显示当前服务端版本
3. 能正确显示最新版本
4. 有新版本时展示“查看发布页”链接
5. 已是最新版本时状态正确

### 边界场景

1. 当前服务端版本为空时，显示“无法比较”
2. `/latest-version` 接口失败时，显示错误状态
3. 后端返回空版本时，显示错误状态
4. 切换到不同服务器后，旧检查结果会清空
5. 检查请求尚未返回时切换连接，不会出现旧结果覆盖新状态

---

## 当前结论

本次对齐实现的是：

- **前端版本检查逻辑与 CLIProxyAPI 后端现有能力的对齐**
- **不是服务端自动升级能力**

也就是说，本次实现聚焦于：

1. 正确拿到当前版本
2. 正确拿到最新版本
3. 正确做比较
4. 正确展示状态
5. 正确规避连接切换与异步竞态问题

如果后续要继续扩展成“真正的一键升级流程”，下一步建议是由 `CLIProxyAPI` 后端新增：

- 升级任务接口
- 升级状态查询接口
- 升级日志接口

然后管理中心再在这个版本检查面板基础上扩展“执行升级”操作。
