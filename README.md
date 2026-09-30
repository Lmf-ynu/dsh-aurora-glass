# dsh-aurora-glass · 极光玻璃

Aurora Glass — 一个**原创**的 DeepSeek Harness Web UI 背景美化插件（未复用 / 未下载任何第三方外观插件的代码）：

- 缓慢漂移的**极光背景**（多套预设配色 / 自定义远程图片 / 本地上传，≤4 MB 存为 data URL）；
- **柔和玻璃面板**：把界面原本的不透明设计令牌（`--dsw-alias-*`）叠加为轻量 alpha 合成玻璃，不用 backdrop-filter、没有实时模糊管线，流式输出时不会整屏重绘；
- 深 / 浅色主题自动跟随（利用原生 `data-ds-dark-theme` 属性）；
- 独立设置页（Settings → 极光玻璃）：实时预览、压暗强度、玻璃通透度、恢复默认；
- 设置通过插件自身的**可编辑配置项**（`Config` 里的 `.volatile()` 字段）持久化，面板上的改动写入 profile 的 Cordis patch；插件卸载/停用即完全还原。

本包适配 **dsh 0.2.x**（开发与验证基于 `0.2.0-rc.2`）：客户端通过 `ctx.configForms` 读写自身条目的设置表单，设置页注册到 `settings.section` slot 并跟随 Host 实际服务的命名空间。0.1.x 上的 `ctx.settingsScope` 接口已不存在，因此 0.1.x 请使用 `dsh-aurora-glass@0.1.0`。

---

## 安装

在**不含空格**的目录中打开你的终端（若你之前遇到过路径被拆分的问题，见下文“备选安装方式”），然后：

```sh
# 1) 把本目录作为本地插件装进 web profile
dsh plugin --profile web add D:\Users\李\Desktop\dsh-ui

# 2) 重启 dsh web
# （重启后打开左下角设置 → “极光玻璃”）
```

`dsh plugin add` 会把本包写入 profile 的依赖并追加到 `dsh.profile.bundles`（本包的 `cordis.patch.yml` 会作为最后一层 patch 生效，挂载 `aurora-glass` 这一行）。插件挂载的**条目 id 就是 `aurora-glass`**——设置面板按这个 id 定位配置，所以 `cordis.patch.yml` 里的 `id:` 不能改。

### 备选安装方式（目录带空格 / 中文路径出问题时）

```sh
# 打一个 tgz，放到无空格的临时目录再安装
npm pack --pack-destination C:\temp
dsh plugin --profile web add C:\temp\dsh-aurora-glass-0.2.0.tgz
```

### 使用

1. 重启后打开 **设置（左下角）→ 极光玻璃**；
2. 打开“启用美化背景”开关，立刻可见背景与玻璃面板；
3. 点选预设、上传壁纸、拖动“压暗背景 / 玻璃通透度”，全部实时预览、自动保存；
4. 想恢复原样：关掉开关，或在设置页点“恢复默认设置”。

## 卸载

```sh
dsh plugin --profile web remove dsh-aurora-glass
# 重启 dsh web
```

本插件不修改任何 DSH 自带文件：背景层、样式与令牌覆盖都只存在于插件运行时，移除后界面回到默认外观。

## 验证 / 开发

没有构建步骤——`lib/client.js` 是直接给 Web 加载器消费的产物（`window.__ModuleLoader__.load` 格式），`lib/index.js` 是宿主插件。包内自带无网络依赖的冒烟测试：

```sh
pnpm run check   # 语法检查两个 half
pnpm run smoke   # 用桩上下文驱动 client apply()，校验注册与持久化契约
```

仓库结构：

```
package.json        dsh.bundle.patch + dsh.client（platform/immediately/inject）+ dsh.engines 清单
cordis.patch.yml    把自己的 Loader 行插入 profile（id 必须是 aurora-glass）
lib/index.js        宿主 half：声明 volatile 配置字段，并认领自带设置页（关掉自动生成表单）
lib/client.js       浏览器 half：背景层 + 玻璃令牌覆盖 + 设置页
tools/smoke-test.cjs 离线冒烟测试（开发用，不随包发布）
```

## 安全与隐私

- **远程图片**由浏览器直接加载：访问该图片服务时会暴露 DSH 用户的 IP；
- **本地图片**以 data URL 存在 profile 的 Cordis patch 里，不会被上传到任何第三方服务（注意配置文件体积与 4 MB 上限）；
- 在共享机器上避免使用敏感图片，并遵循你所配置的 settings 提供方的访问控制。

## License

MIT
