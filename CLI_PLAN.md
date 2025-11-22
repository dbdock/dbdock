# CLI Implementation Plan

## Overview
Transform DBDock from library-only to a developer-friendly CLI tool with clean, intuitive commands and comprehensive documentation.

## Core Implementation

### 1. CLI Architecture
- Create `src/cli/` directory structure
- Main CLI entry point with command routing
- Interactive prompts using inquirer
- Clean command interface (no verbose flags)
- Proper error handling and user feedback

### 2. Commands to Implement

#### `npx dbdock init`
- Interactive setup wizard
- Database type selection (postgres, mysql, mongodb, sqlite)
- Storage provider selection (s3, local, cloudinary)
- Connection details prompts
- Generate `dbdock.config.json`
- Optional: create `.env` template

#### `npx dbdock backup`
- Run immediate backup
- Use existing config file
- Show progress and completion status
- Return backup file location

#### `npx dbdock restore`
- List available backups
- Interactive selection
- Restore to database
- Confirmation prompts

#### `npx dbdock schedule`
- View current schedules
- Add/remove schedules
- Interactive cron expression builder

#### `npx dbdock test`
- Test database connection
- Test storage connection
- Validate configuration

### 3. Package Configuration
- Add CLI bin entry in package.json
- Set up proper executable permissions
- Ensure cross-platform compatibility

## Documentation Updates

### 4. README.md Overhaul
- Lead with CLI quick start (3 commands max to get started)
- Marketing focus: "Setup in under 60 seconds"
- Clear sections:
  - Quick Start (CLI)
  - Programmatic Usage
  - Configuration Reference
  - Storage Providers
  - Database Support
  - Advanced Features
- Remove all emojis
- Developer-friendly tone
- Real-world examples
- Troubleshooting section

### 5. New Documentation Files
- `docs/cli-reference.md` - Complete CLI command documentation
- `docs/quick-start.md` - 60-second setup guide
- `docs/configuration.md` - Enhanced from existing CONFIGURATION.md
- `docs/examples/` - Real-world use cases
- `docs/storage-providers.md` - Provider-specific guides
- `docs/database-types.md` - Database-specific setup

### 6. NPM Package Page Preparation
- Optimized package.json description
- Keywords for discoverability
- Updated homepage and repository links
- Comprehensive README for npm page

## Implementation Steps

1. Set up CLI infrastructure
   - Install dependencies (commander, inquirer, chalk, ora)
   - Create src/cli/ directory structure
   - Set up bin configuration

2. Implement init command
   - Interactive prompts
   - Config file generation
   - Validation

3. Implement backup command
   - Load configuration
   - Execute backup
   - Progress indicators

4. Implement restore command
   - List backups
   - Interactive selection
   - Restore execution

5. Implement schedule command
   - Schedule management
   - Cron builder

6. Implement test command
   - Connection validation
   - Configuration verification

7. Update all documentation
   - Rewrite README.md
   - Create new docs
   - Update existing docs
   - Add examples

8. Test CLI end-to-end
   - Test all commands
   - Test on different platforms
   - Validate documentation accuracy

9. Prepare for npm publish
   - Update version
   - Final documentation review
   - Test npm pack

## Success Metrics
- Setup requires maximum 3 commands
- No configuration file editing needed for basic setup
- Documentation is scannable and practical
- Zero emojis in documentation
- Examples work copy-paste
- CLI feels native and intuitive

## Timeline
- CLI Implementation: Complete in this session
- Documentation: Complete in this session
- Testing: Complete in this session
- Ready for npm publish: End of session
