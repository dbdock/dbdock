# Publishing DBDock to npm

Complete guide to publish DBDock as an npm package.

## Prerequisites

- Node.js 18+
- npm account (https://www.npmjs.com/signup)
- Git repository
- Package built successfully

## Step 1: Create npm Account

If you don't have an npm account:

```bash
# Create account on npmjs.com
# https://www.npmjs.com/signup

# Or via CLI
npm adduser
```

## Step 2: Update Package Information

### 2.1 Update package.json

Already done! But verify these fields:

```json
{
  "name": "dbdock",
  "version": "1.0.0",
  "description": "Enterprise-grade PostgreSQL backup & restore...",
  "author": "Your Name <your.email@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/yourusername/dbdock.git"
  }
}
```

**Action Items:**
- [ ] Update `author` with your name and email
- [ ] Update `repository.url` with your GitHub URL
- [ ] Update `bugs.url` with your issues URL
- [ ] Update `homepage` with your repo URL

### 2.2 Choose Package Name

Check if `dbdock` is available:

```bash
npm search dbdock
```

If taken, consider alternatives:
- `@yourscope/dbdock`
- `pg-dbdock`
- `dbdock-postgres`

## Step 3: Prepare for Publication

### 3.1 Build the Package

```bash
# Clean and build
pnpm run build

# Verify dist/ folder is created
ls -la dist/
```

### 3.2 Test Locally

```bash
# Create a test project
mkdir /tmp/dbdock-test
cd /tmp/dbdock-test
npm init -y

# Link your package
cd /path/to/dbdock
npm link

cd /tmp/dbdock-test
npm link dbdock

# Test import
node -e "const { BackupService } = require('dbdock'); console.log('✅ Import works!');"
```

### 3.3 Check Package Contents

```bash
# Dry run - see what will be published
npm pack --dry-run

# This shows all files that will be included
# Verify:
# ✅ dist/ folder is included
# ✅ README.md is included
# ✅ LICENSE is included
# ✅ Documentation files included
# ❌ src/ folder NOT included
# ❌ test/ folder NOT included
# ❌ .env files NOT included
```

### 3.4 Test Pack

```bash
# Create a tarball
npm pack

# This creates: dbdock-1.0.0.tgz
# Extract and inspect
tar -xzf dbdock-1.0.0.tgz
cd package/
ls -la

# Should see:
# dist/
# README.md
# LICENSE
# CONFIGURATION.md
# USAGE.md
# WAL_SETUP.md
# dbdock.config.example.json
# package.json
```

## Step 4: Version Management

### Semantic Versioning

- **Major (1.0.0)**: Breaking changes
- **Minor (1.1.0)**: New features, backward compatible
- **Patch (1.0.1)**: Bug fixes

### Update Version

```bash
# Patch version (1.0.0 → 1.0.1)
npm version patch

# Minor version (1.0.0 → 1.1.0)
npm version minor

# Major version (1.0.0 → 2.0.0)
npm version major

# This automatically:
# 1. Updates package.json
# 2. Creates a git commit
# 3. Creates a git tag
```

## Step 5: Publish to npm

### 5.1 Login to npm

```bash
npm login

# Enter:
# - Username
# - Password
# - Email
# - 2FA code (if enabled)

# Verify login
npm whoami
```

### 5.2 Publish (First Time)

```bash
# Publish version 1.0.0
npm publish

# ✅ Success! Package is now live at:
# https://www.npmjs.com/package/dbdock
```

### 5.3 Publish Updates

```bash
# 1. Make changes
# 2. Build
pnpm run build

# 3. Update version
npm version patch  # or minor/major

# 4. Publish
npm publish

# 5. Push to git
git push && git push --tags
```

## Step 6: Post-Publication

### 6.1 Verify Publication

```bash
# Check on npm
npm view dbdock

# Install in a fresh project
mkdir /tmp/test-install
cd /tmp/test-install
npm init -y
npm install dbdock

# Test it works
node -e "const { BackupService } = require('dbdock'); console.log('✅ Works!');"
```

### 6.2 Update README Badges

Add npm badges to README.md:

```markdown
[![npm version](https://img.shields.io/npm/v/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![npm downloads](https://img.shields.io/npm/dm/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![license](https://img.shields.io/npm/l/dbdock.svg)](https://github.com/yourusername/dbdock/blob/main/LICENSE)
```

### 6.3 Create GitHub Release

```bash
# Push tags
git push --tags

# Create release on GitHub
# Go to: https://github.com/yourusername/dbdock/releases/new
# - Tag: v1.0.0
# - Title: DBDock v1.0.0
# - Description: Initial release with backup, PITR, encryption
```

## Common Issues & Solutions

### Issue: Package name already taken

**Solution:** Use a scoped package

```bash
# Update package.json
{
  "name": "@yourscope/dbdock"
}

# Publish scoped package
npm publish --access public
```

### Issue: 403 Forbidden

**Solution:** Login or check package name

```bash
npm logout
npm login
npm whoami
```

### Issue: Files missing from package

**Solution:** Check .npmignore and package.json files array

```bash
# See what will be published
npm pack --dry-run
```

### Issue: Build errors before publish

**Solution:** Fix TypeScript errors

```bash
pnpm run build
# Fix any errors
# Retry publish
```

## Publishing Workflow

### Development Workflow

```bash
# 1. Work on feature
git checkout -b feature/new-feature
# ... code ...

# 2. Commit
git add .
git commit -m "feat: add new feature"

# 3. Merge to main
git checkout main
git merge feature/new-feature

# 4. Build and test
pnpm run build
pnpm test

# 5. Version bump
npm version minor  # 1.0.0 → 1.1.0

# 6. Publish
npm publish

# 7. Push to git
git push && git push --tags

# 8. Create GitHub release (optional)
```

### Hotfix Workflow

```bash
# 1. Checkout main
git checkout main

# 2. Fix bug
# ... code ...

# 3. Build and test
pnpm run build
pnpm test

# 4. Patch version
npm version patch  # 1.0.0 → 1.0.1

# 5. Publish
npm publish

# 6. Push
git push && git push --tags
```

## Beta/Alpha Releases

### Publish Beta Version

```bash
# Update version to beta
npm version 1.1.0-beta.0

# Publish with beta tag
npm publish --tag beta

# Users install with:
npm install dbdock@beta
```

### Publish Alpha Version

```bash
npm version 1.2.0-alpha.0
npm publish --tag alpha

# Install:
npm install dbdock@alpha
```

### Promote Beta to Stable

```bash
# Remove beta suffix
npm version 1.1.0

# Publish as latest
npm publish

# Update latest tag
npm dist-tag add dbdock@1.1.0 latest
```

## Automation with GitHub Actions

Create `.github/workflows/publish.yml`:

```yaml
name: Publish to npm

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: 18
          registry-url: 'https://registry.npmjs.org'

      - uses: pnpm/action-setup@v2
        with:
          version: 8

      - run: pnpm install
      - run: pnpm run build
      - run: pnpm test

      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Setup:**
1. Get npm token: https://www.npmjs.com/settings/YOUR-USERNAME/tokens
2. Add to GitHub Secrets: NPM_TOKEN
3. Create GitHub release → Auto-publish to npm

## Checklist Before Publishing

- [ ] All tests pass (`pnpm test`)
- [ ] Build succeeds (`pnpm run build`)
- [ ] README.md is complete
- [ ] LICENSE file exists
- [ ] package.json metadata is correct
- [ ] .npmignore excludes dev files
- [ ] Docs are up to date
- [ ] Version number is correct
- [ ] Git tag matches version
- [ ] Changelog updated (if applicable)

## Quick Publish Commands

```bash
# Full publish workflow
pnpm run build && \
npm version patch && \
npm publish && \
git push && git push --tags

# Or create a script in package.json:
{
  "scripts": {
    "release:patch": "npm run build && npm version patch && npm publish && git push --follow-tags",
    "release:minor": "npm run build && npm version minor && npm publish && git push --follow-tags",
    "release:major": "npm run build && npm version major && npm publish && git push --follow-tags"
  }
}

# Then:
pnpm run release:patch
```

## Resources

- npm Documentation: https://docs.npmjs.com/
- Semantic Versioning: https://semver.org/
- npm Package Best Practices: https://docs.npmjs.com/packages-and-modules
- GitHub Packages: https://docs.github.com/en/packages

## Support

If you encounter issues:
1. Check npm status: https://status.npmjs.org/
2. Check npm docs: https://docs.npmjs.com/
3. npm support: https://www.npmjs.com/support

---

**Ready to publish?** Follow the steps above and your package will be live on npm! 🚀
