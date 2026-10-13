# Security

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/xutongxue233/short-drama-workspace/security/advisories/new) for security issues. Include reproduction steps with synthetic data. Do not include API keys, project databases, private source material, or unredacted logs in public issues.

## Data and credentials

- Frameflow requires an authenticated account for workspace data. Project membership is checked for project reads, mutations, exports, and media downloads. Account administrators manage users, model services, Agents, and the shared skill library; they do not automatically gain access to projects they have not joined. Other accounts receive skill catalog metadata without the instruction bodies; using a skill with an Agent requires project editor access.
- Generation sends the selected source text, prompts, and reference media to the model services you configure. Local project storage does not imply offline model execution.
- Provider API keys are encrypted with AES-256-GCM before SQLite persistence. The random key is stored in the adjacent `workbench.sqlite.key` file, created with owner-only permissions on platforms that support POSIX file modes. On Windows, restrict the data directory with operating-system ACLs. This protects a database copy without its key, not a compromised host or a backup containing both. Project text and media are not encrypted.
- Existing plaintext provider rows are encrypted on upgrade. Historical migration snapshots, old databases, SQLite free pages, journals, and pre-upgrade backups can still contain prior plaintext keys. They are preserved for recovery rather than silently destroyed. Rotate previously stored provider credentials and restrict access to these files.
- Environment files, local databases, media directories, backups, and diagnostic output must stay outside version control. Keep custom data directories outside the checkout when possible.
- Stop the service before copying the complete data directory for a backup, including the `.key` file. Missing, mismatched, or tampered encryption keys cause startup to fail without replacing credentials. Restore the matching database and key together. Project JSON exports contain media references, not media files or account secrets.

## Accounts and project permissions

On first launch, create the first administrator. It takes ownership of pre-account projects; historical messages retain their legacy identity instead of being relabeled as that administrator. There is no public registration. Administrators create human or bot accounts and can disable accounts or reset passwords. Disabling, changing a password, or changing account privileges revokes existing sessions. Keep at least one active administrator.

| Project permission | Read / export / download | Group chat | Edit / run production | Manage participants |
| ------------------ | ------------------------ | ---------- | --------------------- | ------------------- |
| Owner              | Yes                      | Yes        | Yes                   | Yes                 |
| Editor             | Yes                      | Yes        | Yes                   | No                  |
| Member             | Yes                      | Yes        | No                    | No                  |
| Viewer             | Yes                      | No         | No                    | No                  |

Human/Bot identity and optional job titles, such as editor or sound designer, do not grant permissions. AI Agents are configured model workers, not login accounts. Bots use their own managed account and the same authenticated HTTP API and permissions. For a plain group message send `agentId: null`; invoking an Agent or a production command requires editor access. The server stamps message identity from the session and ignores client claims about the sender.

Passwords use salted scrypt hashes. Sessions expire after 12 hours; only their token hashes are persisted. The session cookie is HttpOnly, SameSite=Strict, and Secure for configured HTTPS deployments. Mutation requests require the session's `X-CSRF-Token`; obtain it from `/api/auth/session` after login. Login attempts are rate limited. Security activity records contain actors, actions, timestamps, and outcomes, not passwords, keys, or chat content. These bounded local logs are operational records, not tamper-proof external audit storage. See the [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [Node crypto documentation](https://nodejs.org/docs/latest-v22.x/api/crypto.html) for the underlying mechanisms.

## Access from other computers

The default remains `127.0.0.1`. For a shared installation, put a built application behind an HTTPS reverse proxy on the same host and set `WORKBENCH_ORIGIN` to its exact public origin (for example, `https://studio.example.com`). Connect the proxy to the API over loopback; direct unencrypted connections from non-loopback clients are rejected. Non-loopback binding also requires an HTTPS origin. Restrict access to the internal HTTP listener using the host firewall. Serve the browser and `/api` through the same origin; do not expose the Vite development server as the shared production service.

When that proxy overwrites `X-Forwarded-For` with the actual client address, enable `WORKBENCH_TRUST_PROXY=true` so login limits distinguish users behind the proxy. For example, an Nginx proxy on this host should set `proxy_set_header X-Forwarded-For $remote_addr;`, preserve the public `Host`, and overwrite `X-Forwarded-Host` and `X-Forwarded-Proto` with its known public host and HTTPS protocol. Forwarded addresses are trusted only from loopback connections and only when explicitly enabled with a public origin. Do not enable this if the proxy passes arbitrary client-supplied forwarding headers unchanged. Without this setting, requests through a proxy intentionally share its IP-based login limit.

Initialize locally before exposing the service, or configure a random `WORKBENCH_SETUP_TOKEN` of at least 32 characters and supply it in the setup form. An external-origin installation cannot be claimed without this token. Remove the initialization token from the environment after setup. The first-admin endpoint refuses a second initialization, including racing requests.

This remains a single-process SQLite application. It does not provide SSO, MFA, email recovery, end-to-end encryption, a dedicated bot-token lifecycle, or a distributed rate limiter. A reverse proxy and host access controls remain part of operating a shared installation.

If a real credential has been exposed, revoke or rotate it with its provider. Removing it from a file or Git history does not invalidate copies that may already exist.
