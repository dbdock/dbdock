# Quick Publish Guide - TL;DR

**5 minutes to publish DBDock to npm**

## Prerequisites ✅

```bash
# 1. Have npm account
npm adduser

# 2. Update package.json
# - Change author name/email
# - Update repository URL
```

## Publish Steps 🚀

### Step 1: Update Package Info

Edit `package.json`:
```json
{
  "author": "Your Name <your.email@example.com>",
  "repository": {
    "url": "git+https://github.com/YOUR-USERNAME/dbdock.git"
  }
}
```

### Step 2: Build

```bash
pnpm run build
```

### Step 3: Test Pack (Optional)

```bash
npm pack --dry-run
```

Verify output includes:
- ✅ `dist/` folder
- ✅ `README.md`
- ✅ `LICENSE`
- ❌ NOT `src/`, `test/`, `.env`

### Step 4: Login to npm

```bash
npm login
npm whoami  # verify
```

### Step 5: Publish!

```bash
npm publish
```

**Done!** Your package is live at:
`https://www.npmjs.com/package/dbdock`

## Update & Re-publish

```bash
# 1. Make changes
# 2. Build
pnpm run build

# 3. Version bump
npm version patch  # 1.0.0 → 1.0.1

# 4. Publish
npm publish

# 5. Push to git
git push && git push --tags
```

## One-Liner

```bash
pnpm run build && npm version patch && npm publish && git push --follow-tags
```

## Test Installation

```bash
mkdir /tmp/test && cd /tmp/test
npm init -y
npm install dbdock
node -e "const {BackupService} = require('dbdock'); console.log('✅ Works!')"
```

## Common Issues

**Package name taken?**
```bash
# Use scoped package
{
  "name": "@yourscope/dbdock"
}
npm publish --access public
```

**403 Error?**
```bash
npm login
npm whoami
```

**Files missing?**
```bash
npm pack --dry-run
# Check .npmignore
```

## Full Guide

See [PUBLISHING.md](PUBLISHING.md) for complete details.

---

**That's it!** 🎉 Your package is now on npm!

```bash
npm install dbdock
```
