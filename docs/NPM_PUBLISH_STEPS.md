# DBDock - npm Publishing Steps

## ✅ Pre-Publish Checklist

Your package is **ready to publish**! Just update a few details:

### 1. Update package.json

```bash
nano package.json
```

Change these fields:
- `"author"`: Your name and email
- `"repository.url"`: Your GitHub repository URL
- `"bugs.url"`: Your GitHub issues URL
- `"homepage"`: Your GitHub repo homepage

Example:
```json
{
  "author": "John Doe <john@example.com>",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/johndoe/dbdock.git"
  },
  "bugs": {
    "url": "https://github.com/johndoe/dbdock/issues"
  },
  "homepage": "https://github.com/johndoe/dbdock#readme"
}
```

### 2. Verify Build

```bash
pnpm run build
```

Should output:
```
✓ Build successful
```

---

## 🚀 Publishing to npm

### Step 1: Create npm Account (if needed)

Visit: https://www.npmjs.com/signup

Or via CLI:
```bash
npm adduser
```

### Step 2: Login

```bash
npm login
```

Enter:
- Username
- Password
- Email
- 2FA code (if enabled)

Verify:
```bash
npm whoami
```

### Step 3: Test Package Locally (Optional but Recommended)

```bash
# Create tarball
npm pack

# Shows: dbdock-1.0.0.tgz (137 KB)

# Test in another directory
mkdir /tmp/test-dbdock
cd /tmp/test-dbdock
npm init -y
npm install /path/to/dbdock/dbdock-1.0.0.tgz

# Test import
node -e "const {BackupService, AppModule} = require('dbdock'); console.log('✅ Import works!');"
```

### Step 4: Publish!

```bash
cd /path/to/dbdock
npm publish
```

**Output:**
```
+ dbdock@1.0.0
```

**Done!** 🎉 Your package is live at:
```
https://www.npmjs.com/package/dbdock
```

### Step 5: Verify Publication

```bash
# View package info
npm view dbdock

# Install from npm
npm install dbdock

# Check version
npm view dbdock version
```

---

## 📦 Package Contents

Your published package includes:

✅ **Compiled Code** (dist/)
- All TypeScript compiled to JavaScript
- Type definitions (.d.ts files)
- Source maps for debugging

✅ **Documentation**
- README.md
- CONFIGURATION.md
- USAGE.md
- WAL_SETUP.md

✅ **Config Example**
- dbdock.config.example.json

✅ **License**
- LICENSE (MIT)

❌ **NOT Included** (excluded via .npmignore):
- Source code (src/)
- Tests (test/)
- Development config (.env, .vscode, etc.)

**Package Size:** 137 KB compressed, 619 KB unpacked

---

## 🔄 Publishing Updates

After making changes:

```bash
# 1. Build
pnpm run build

# 2. Bump version (choose one)
npm version patch   # 1.0.0 → 1.0.1 (bug fixes)
npm version minor   # 1.0.0 → 1.1.0 (new features)
npm version major   # 1.0.0 → 2.0.0 (breaking changes)

# 3. Publish
npm publish

# 4. Push to git (with tags)
git push && git push --tags
```

**One-liner:**
```bash
pnpm run build && npm version patch && npm publish && git push --follow-tags
```

---

## 🎯 Common Scenarios

### Scenario 1: Package Name Taken

If `dbdock` is already taken on npm:

**Option A: Use scoped package**
```json
{
  "name": "@yourscope/dbdock"
}
```

```bash
npm publish --access public
```

**Option B: Choose different name**
```json
{
  "name": "pg-dbdock"
}
```

### Scenario 2: Publish Beta Version

```bash
npm version 1.1.0-beta.0
npm publish --tag beta
```

Users install with:
```bash
npm install dbdock@beta
```

### Scenario 3: Update Documentation Only

```bash
# Documentation is in the package, so:
npm version patch  # 1.0.0 → 1.0.1
npm publish
```

---

## 🐛 Troubleshooting

### Error: 403 Forbidden

**Cause:** Not logged in or no permission

**Fix:**
```bash
npm logout
npm login
npm whoami  # verify
npm publish
```

### Error: Package name already exists

**Fix:** Use scoped package or different name (see above)

### Error: ENEEDAUTH

**Cause:** Not authenticated

**Fix:**
```bash
npm login
```

### Error: Files missing from package

**Cause:** .npmignore excluding too much

**Fix:** Check what's included:
```bash
npm pack --dry-run
```

---

## 📊 After Publishing

### Update GitHub

1. **Add npm badges to README:**

```markdown
[![npm version](https://img.shields.io/npm/v/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![npm downloads](https://img.shields.io/npm/dm/dbdock.svg)](https://www.npmjs.com/package/dbdock)
```

2. **Create GitHub Release:**

```bash
# Push tags
git push --tags

# Or create release on GitHub UI
# https://github.com/YOUR-USERNAME/dbdock/releases/new
# Tag: v1.0.0
# Title: DBDock v1.0.0 - Initial Release
```

3. **Tweet about it** (optional):

```
🚀 Just published DBDock v1.0.0 to npm!

Enterprise-grade PostgreSQL backup & restore with:
✅ Encryption & Compression
✅ Point-in-Time Recovery
✅ S3/R2 Support

npm install dbdock

#PostgreSQL #NodeJS #NestJS
```

---

## 🎉 Success!

Your package is now available to the world:

```bash
npm install dbdock
```

Users can import it:

```typescript
import { BackupService, AppModule } from 'dbdock';
```

**Package Page:**
https://www.npmjs.com/package/dbdock

**Next Steps:**
- Monitor downloads: https://npm-stat.com/charts.html?package=dbdock
- Respond to issues: GitHub Issues
- Keep package updated
- Write blog post about it

---

## 📚 Resources

- [npm Documentation](https://docs.npmjs.com/)
- [Semantic Versioning](https://semver.org/)
- [npm Package Best Practices](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)

---

**Congratulations on publishing DBDock!** 🎉

Need help? Check [PUBLISHING.md](PUBLISHING.md) for more detailed information.
