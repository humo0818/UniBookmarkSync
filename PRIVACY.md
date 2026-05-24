# Privacy Policy

**Last updated:** May 24, 2026

## Introduction

UniBookmarkSync is a browser extension that syncs your bookmarks across browsers. We respect your privacy and are committed to protecting it. This policy explains how the extension handles your data.

## Data Collection

**UniBookmarkSync does not collect, store, or transmit any personal data to us or any third party.**

The extension reads your browser bookmarks solely to sync them to a remote storage location that **you** configure:

- **WebDAV**: your own server (Nextcloud, ownCloud, Synology NAS, etc.)
- **Git**: your own repository on GitHub, GitLab, or a self-hosted instance

All communication occurs directly between your browser and your configured server. We do not operate any intermediary servers, analytics services, or tracking mechanisms.

## Data Stored Locally

The extension stores the following data locally in your browser using `browser.storage.local`:

| Data | Purpose |
|------|---------|
| WebDAV URL, username, password | Connecting to your WebDAV server |
| Git remote URL, branch, access token | Connecting to your Git repository |
| Sync preferences (auto-sync, conflict resolution, theme) | Remembering your settings |
| Last sync hash and timestamp | Detecting bookmark changes |
| Last bookmark tree snapshot | Computing diffs for sync |

All credentials are stored only in your local browser storage and are never sent anywhere except to your configured server.

## Data Sharing

We do not share, sell, rent, or trade any information with third parties. Your data never leaves your control — it moves only between your browser and the server you configure.

## Security

Your credentials (passwords, access tokens) are stored in your browser's local storage. We recommend using a dedicated access token with minimal scopes (`repo` for GitHub, `api` for GitLab) rather than your account password. The extension transmits data over HTTPS.

## Third-Party Services

This extension does not integrate any third-party analytics, advertising, or tracking services. It has no account system, no backend server, and no cloud database.

## Children's Privacy

This extension does not knowingly collect personal information from children under the age of 13.

## Changes to This Policy

We may update this policy from time to time. Changes will be posted on this page.

## Contact

- **GitHub**: [github.com/humo0818/UniBookmarkSync](https://github.com/humo0818/UniBookmarkSync)
- **Issues**: [github.com/humo0818/UniBookmarkSync/issues](https://github.com/humo0818/UniBookmarkSync/issues)

## Open Source

UniBookmarkSync is open source software licensed under the MIT License. You can review the complete source code at [github.com/humo0818/UniBookmarkSync](https://github.com/humo0818/UniBookmarkSync).
