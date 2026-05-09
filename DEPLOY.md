# 🚀 部署上线指南（小白版）

把你的牧羊人测评站发到公网，让任何人都能通过 https://xxx.onrender.com 访问。

整个流程分 3 个阶段，**全程免费、不需要信用卡**：

```
本地代码  ──①──→  GitHub 仓库  ──②──→  Render 网站
          推送              一键部署
```

---

## ① 准备：安装 Git 与注册 GitHub

### 1.1 装 Git（用来把代码推送到 GitHub）

1. 打开 https://git-scm.com/download/win
2. 下载 64-bit Git for Windows Setup，一路点 **Next** 安装即可
3. 安装完后**关闭再重新打开 VS Code**（让它认识 Git）
4. 在 VS Code 终端输入：
   ```bash
   git --version
   ```
   能显示 `git version 2.x.x` 就成功了

### 1.2 注册 GitHub 账号

1. 打开 https://github.com/signup
2. 填邮箱、密码、用户名（用户名将出现在仓库地址里，慎选）
3. 验证邮箱

### 1.3 配置 Git 身份（首次使用必做）

在 VS Code 终端里运行（把里面的内容换成你自己的）：

```bash
git config --global user.name "你的GitHub用户名"
git config --global user.email "你注册GitHub用的邮箱"
```

---

## ② 推送代码到 GitHub

### 2.1 在 GitHub 上新建一个空仓库

1. 登录 GitHub，右上角 **+ → New repository**
2. **Repository name**：`muyangren-cctest`
3. **Public**（必须公开，Render 免费层只能拉公开仓库）
4. **不要**勾选 "Add a README file"、`.gitignore`、license（我们本地已经有了）
5. 点击 **Create repository**
6. 创建后页面会显示一段类似这样的命令，**先别关，下一步要用**：
   ```
   git remote add origin https://github.com/你的用户名/muyangren-cctest.git
   ```

### 2.2 在本地把代码推上去

在 VS Code 终端里（确保当前目录是 `muyangren-cctest`），按顺序执行：

```bash
# 1. 初始化 git 仓库
git init

# 2. 把所有文件加入暂存区
git add .

# 3. 第一次提交
git commit -m "初始提交：牧羊人测评站 v1"

# 4. 把分支重命名为 main（GitHub 默认分支名）
git branch -M main

# 5. 关联到刚才创建的 GitHub 仓库（替换成你自己的地址）
git remote add origin https://github.com/你的用户名/muyangren-cctest.git

# 6. 推送
git push -u origin main
```

第一次 `git push` 时浏览器会弹窗让你登录 GitHub，登录授权即可。

完成后刷新 GitHub 仓库页，你应该能看到所有文件。

---

## ③ 在 Render 一键部署

### 3.1 注册 Render

1. 打开 https://render.com
2. 点 **Get Started**，选 **Sign in with GitHub**（用 GitHub 账号登录最方便）
3. 授权 Render 访问你的 GitHub

### 3.2 创建 Web Service

1. 登录后点页面上的 **+ New** → **Web Service**
2. 找到你的 `muyangren-cctest` 仓库，点 **Connect**
3. 填写以下设置：

   | 字段 | 填什么 |
   |------|--------|
   | **Name** | `muyangren-cctest` （会成为你的网址前缀） |
   | **Region** | `Singapore` （离中国近） |
   | **Branch** | `main` |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install` （或留空，因为我们没依赖） |
   | **Start Command** | `node server.js` |
   | **Instance Type** | **Free** |

4. 滚到底部点 **Create Web Service**

### 3.3 等待部署

- Render 会拉取代码、安装依赖、启动服务
- 大约 1–3 分钟，看到日志里 `🐑 牧羊人测评站启动成功！监听端口 ...` 就成了
- 顶部会显示你的网址，类似 `https://muyangren-cctest-xxxx.onrender.com`

---

## ④ 上线后须知

### 免费层的注意事项
- **冷启动**：超过 15 分钟无访问，服务会休眠。下次访问需要等 30 秒左右唤醒
- **每月 750 小时**：一个服务全年开着也只用约 720 小时，足够
- **流量**：100GB/月，对个人工具足够

### 后续更新代码

修改本地文件后，只需 3 行命令就能自动重新部署：

```bash
git add .
git commit -m "修改了xxx"
git push
```

Render 会监听到 `main` 分支变化，自动重新构建上线。

### 自定义域名（可选）

如果你买了域名（比如 `muyangren.com`）：
1. 在 Render 服务页面 **Settings** → **Custom Domains** → **Add Custom Domain**
2. 按提示在你的域名 DNS 处添加 CNAME 记录
3. 等 Render 自动签发免费 HTTPS 证书

---

## ⑤ 部署常见问题

### Q: `git push` 提示要密码但输不进
GitHub 不再支持密码推送，需要用 **Personal Access Token**：
1. GitHub 头像 → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. **Generate new token (classic)**，勾选 `repo`，生成后复制
3. 推送时用户名填 GitHub 用户名，**密码粘贴这个 token**

### Q: Render 显示 `Build failed`
点开日志看具体错误。最常见的是端口问题——确认 `server.js` 里是 `process.env.PORT || 3000`（我们已经改过了）。

### Q: 别人访问页面，但点检测一直转圈
打开浏览器 F12 → Network，看 `/api/check` 请求的状态码：
- 502/503 → 后端崩了，看 Render 日志
- 200 但很慢 → 正常，因为要真实调用上游 API
- 0/CORS 错误 → 不应该出现，因为前后端同域

### Q: 我的 API Key 在 Render 服务器内存里安全吗？
- Render 是国际正规云服务商，本身可信
- 但**任何用户在你网站输入的 Key 都会经过你的服务器**
- 如果你只想自己用，建议给网站加个登录密码（后续可以做）

---

部署完成后，把网址发给朋友试试吧！🐑
