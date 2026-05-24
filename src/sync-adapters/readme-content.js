// README.md template — pushed to repos on first sync
export default `# UniBookmarkSync

> Cross-browser bookmark sync via WebDAV & Git — 通过 WebDAV 和 Git 跨浏览器同步书签

---

## 📁 Directory Structure

\`\`\`
bookmarks.json         ← synced bookmark database
  ├── bookmark_bar     ← 书签栏 (Bookmarks Bar)
  │   ├── Folder/      ← 书签文件夹
  │   │   └── Site     ← 书签
  │   └── Site         ← 独立书签
  ├── other            ← 其他书签 (Other Bookmarks)
  └── mobile           ← 移动书签 (Mobile Bookmarks)
\`\`\`

---

## 📖 How to Use · 使用说明

### Install & Sync · 安装与同步

| Step | EN | ZH |
|------|----|----|
| 1 | Install UniBookmarkSync in Chrome / Edge / Firefox / Safari | 在浏览器中安装 UniBookmarkSync 扩展 |
| 2 | Open extension popup, switch to **Git** tab | 打开扩展弹窗，切换到 **Git** 标签 |
| 3 | Go to Settings, fill in this repo URL | 前往设置，填入此仓库地址 |
| 4 | Enter your **Personal Access Token** | 输入你的 **个人访问令牌** |
| 5 | Click **Sync Now** | 点击 **立即同步** |

### Auto-Sync · 自动同步

| EN | ZH |
|----|----|
| Turn ON **Auto-sync** in the popup — changes sync automatically | 在弹窗中开启 **自动同步** — 书签变化自动推送 |
| Turn OFF to manually write branch & description | 关闭后可手动输入分支和描述信息 |

### Version History & Rollback · 版本历史与回滚

| EN | ZH |
|----|----|
| Settings → Git → **Version History** to browse past snapshots | 设置 → Git → **版本历史** 查看历史快照 |
| Select a commit → **Rollback to this** to restore | 选择提交 → **回滚到此版本** 恢复书签 |

### Token Setup · 令牌配置

| Provider | Path | Scope |
|----------|------|-------|
| **GitHub** | Settings → Developer settings → Tokens (classic) | \`repo\` (private) / \`public_repo\` |
| **GitLab** | Settings → Access Tokens | \`api\` |

### Restore on New Browser · 新浏览器恢复

| EN | ZH |
|----|----|
| Install UniBookmarkSync | 安装扩展 |
| Configure with this repo URL + token | 配置仓库地址和令牌 |
| Settings → Git → Version History → Rollback | 设置 → Git → 版本历史 → 回滚 |

---

*Synced by [UniBookmarkSync](https://github.com)*
`;
