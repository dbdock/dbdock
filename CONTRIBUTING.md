# Contributing to DBDock

Thanks for your interest in contributing. DBDock is an open-source database backup, restore, and migration CLI, and community contributions are welcome.

## Ways to contribute

- **Report bugs** — open an issue with reproduction steps
- **Suggest features** — start a [discussion](https://github.com/dbdock/dbdock/discussions) first for large changes
- **Improve docs** — the canonical docs live at https://dbdock.mintlify.app
- **Fix bugs or add features** — see "Development" below

## Development

### Prerequisites

- Node.js >= 18
- pnpm (preferred) or npm
- PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`) for backup/restore commands
- MongoDB running locally if you're touching migration code

### Setup

```bash
git clone https://github.com/dbdock/dbdock.git
cd dbdock
pnpm install
cp .env.example .env        # edit with your local values
cp dbdock.config.example.json dbdock.config.json
pnpm build
```

### Running the CLI locally

```bash
node dist/cli/index.js --help
# or link globally
pnpm link --global
dbdock --help
```

### Scripts

| Script | Purpose |
|---|---|
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm test` | Run unit tests |
| `pnpm test:e2e` | Run end-to-end tests |
| `pnpm lint` | Run ESLint with autofix |
| `pnpm format` | Run Prettier |

## Pull request checklist

Before opening a PR:

- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes (or any new lint issues are justified)
- [ ] New code has tests where reasonable
- [ ] Commits are descriptive and focused
- [ ] README / docs updated if user-facing behavior changed

## Commit style

We use short, conventional-ish messages:

```
feat: add --driver flag to copydb
fix: handle null password in pgpass helper
chore: bump dependencies
docs: clarify R2 setup
```

Explain *why* in the body when the change isn't obvious from the diff.

## Code style

- TypeScript strict mode
- Prefer explicit types over `any`
- Follow the existing module/file layout — one command per file in `src/cli/commands/`
- Run `pnpm format` before committing

## Reporting security issues

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
