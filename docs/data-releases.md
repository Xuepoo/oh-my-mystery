# Public Database Releases

Open My Mystery publishes public, versioned SQLite snapshots at:

- Latest manifest: `https://cdn.xuepoo.xyz/omm/database/latest/manifest.json`
- Release index: `https://cdn.xuepoo.xyz/omm/database/index.json`

Each immutable release contains `omm.sqlite.zst`, `manifest.json`, and `sha256.txt` under `omm/database/releases/<version>/`. The manifest includes the source revision, generation time, compressed size, SHA-256 checksum, schema marker, and table row counts.

These files are public snapshots and are not the live Cloudflare D1 database. Consumers should verify the SHA-256 checksum before opening a downloaded snapshot. Immutable releases are retained by their versioned keys; the `latest` manifest is a short-cache pointer and can be rolled back by publishing a previous manifest to that key.

To publish the current local snapshot after running the integrity checks:

```sh
bun scripts/publish-database-release.ts
```

The script requires the authenticated Wrangler CLI and the existing `cdn-xuepoo-xyz` R2 bucket. It does not read or write secrets.
