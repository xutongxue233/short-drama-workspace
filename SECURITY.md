# Security

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/xutongxue233/short-drama-workspace/security/advisories/new) for security issues. Include reproduction steps with synthetic data. Do not include API keys, project databases, private source material, or unredacted logs in public issues.

## Data and credentials

- Frameflow is a single-user local application. The API listens on the loopback interface and is not designed for direct internet exposure.
- Generation sends the selected source text, prompts, and reference media to the model services you configure. Local project storage does not imply offline model execution.
- Model credentials are stored in the local SQLite database without encryption. State responses and project exports omit saved API keys; protect the database and its backups as sensitive files.
- Environment files, local databases, media directories, backups, and diagnostic output must stay outside version control. Keep custom data directories outside the checkout when possible.
- Stop the service before copying the complete data directory for a backup. Project JSON exports contain media references, not the media files themselves.

If a real credential has been exposed, revoke or rotate it with its provider. Removing it from a file or Git history does not invalidate copies that may already exist.
