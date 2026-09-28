# Getting Started: Install Tools

Complete checklist of tools required to develop on the LFIQ platform. Install these before starting the Setup guide.

## Tool Summary

| Tool | Purpose | Installed Via | Version Required |
|------|---------|---------------|------------------|
| Claude Code | Desktop agent & CLI | App Store / claude.com | Latest |
| GitHub CLI | Clone repos, manage PRs | Homebrew or download | 2.30+ |
| Node.js | JavaScript runtime | mise | 22.x |
| Python | Automation, scripting | mise | 3.11.x |
| npm | Package manager | Node.js included | 10.x+ |
| Wrangler | Cloudflare Workers CLI | Repo devDependency, run with `npx` | 4.x |
| Flyctl | Fly.io deployment | Homebrew | 0.2+ |
| colima | Docker daemon, required for Fly builds | Homebrew | Latest |
| mise | Version manager | Homebrew | Latest |

## Claude Code (Recommended but Optional)

Claude Code is the official Claude IDE for macOS, providing desktop agent capabilities, Cursor integration, and local file editing.

### Installation

1. Visit https://claude.com/claude-code
2. Download Claude Code for macOS
3. Move to Applications folder
4. Launch and authenticate with your claude.ai account

### Verification

```bash
# Claude Code is launchable from Spotlight (Cmd+Space, type "Claude Code")
# Or from Applications folder
```

## GitHub CLI

GitHub CLI (`gh`) is required for cloning private repos, creating pull requests, and checking CI status.

### Installation via Homebrew

```bash
brew install gh
```

### Installation via Direct Download

```bash
# Download the latest macOS release
curl -L https://github.com/cli/cli/releases/download/v2.41.0/gh_2.41.0_macOS_arm64.zip -o gh.zip
unzip gh.zip
sudo mv gh_2.41.0_macOS_arm64/bin/gh /usr/local/bin/
```

### Verification

```bash
gh --version
# Expected: gh version 2.30.0 (2023-11-14)
```

### Post-Installation

Authenticate with GitHub:
```bash
gh auth login
# Follow prompts to authorize via browser
```

## Node.js & Python via mise

**mise** is a version manager that ensures all developers use the same Node.js and Python versions. Install mise, then let it handle Node and Python.

### Installation: mise

```bash
curl https://mise.jdx.dev/install.sh | sh
export PATH="$HOME/.local/share/mise/shims:$PATH"
echo 'export PATH="$HOME/.local/share/mise/shims:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Verification

```bash
mise --version
# Expected: mise 2024.x.x
```

### Installation: Node.js 22 & Python 3.11

Once mise is installed, go to the `brick.command` checkout, which carries the `mise.toml` pin, and run:

```bash
cd /path/to/brick.command
mise install
# Reads mise.toml, installs Node 22 + Python 3.11
```

Node 22 is the floor across the fleet. Hub, Command, Keystone and Stacks declare `node >=22` in `package.json` engines, and `brick.command/.nvmrc` is `22`.

### Verification

```bash
node --version    # v22.x.x
npm --version     # 10.x.x
python --version  # Python 3.11.x
```

If versions don't match, add mise shims to PATH:
```bash
eval "$(mise activate zsh)"
# Or add to ~/.zshrc permanently
```

## npm (Included with Node.js)

npm is the JavaScript package manager. It comes with Node.js, so no separate installation needed.

### Verification

```bash
npm --version
# Expected: 10.x.x or later
```

### First-Time Setup

```bash
npm config set legacy-peer-deps true
# Allows some dependency conflicts to be ignored
```

## Wrangler (Cloudflare Workers CLI)

Every web app runs as a Cloudflare Worker. Wrangler 4 is a devDependency in each app repo, so there is no global install. Run it through `npx` from inside the app directory after `npm ci`.

### Verification

```bash
npx wrangler --version
# Expected: 4.x
```

### Post-Installation

```bash
npx wrangler login
# Browser opens, authenticate with your Cloudflare account
npx wrangler whoami
```

## Flyctl (for Fly.io)

Flyctl is the deployment tool for Fly.io, used to manage brickston-backend.

### Installation via Homebrew

```bash
brew install flyctl
```

### Installation via Direct Download

```bash
curl -L https://fly.io/install.sh | sh
export PATH="$PATH:$HOME/.fly/bin"
echo 'export PATH="$PATH:$HOME/.fly/bin"' >> ~/.zshrc
```

### Verification

```bash
flyctl version
# Expected: 0.2.x or later
```

### Post-Installation

```bash
flyctl auth login
# Browser opens, authenticate with Fly.io account
```

## colima (Docker daemon)

Fly builds run locally with `--local-only`, so a Docker daemon has to be up before any `flyctl deploy`. Docker Desktop is not what the team uses; the daemon is colima. Without it, `docker info` fails and flyctl reports the daemon missing.

### Installation

```bash
brew install colima docker
```

### Verification

```bash
colima start
docker info | head -5
```

You do not need a local Postgres. Every app connects straight to Neon, so there is no proxy to run and nothing listens on 5433.

## Text Editor / IDE (Your Choice)

While not required, a good editor makes development faster:

### Recommended Options

1. **VS Code** (free, popular)
   ```bash
   brew install visual-studio-code
   ```

2. **Cursor** (AI-powered, recommended)
   - Download from https://www.cursor.sh
   - Similar to VS Code but includes Claude integration

3. **JetBrains WebStorm** (paid, full-featured)
   ```bash
   brew install webstorm
   ```

### Extensions (for VS Code or Cursor)

- **TypeScript Vue Plugin**: for .vue files
- **Prettier**: code formatting
- **ESLint**: linting
- **GitLens**: Git history
- **Neon CLI**: Neon database connection
- **PostCSS IntelliSense**: CSS module hints

## macOS System Requirements

Ensure your macOS is up to date:
```bash
softwareupdate -a -i -R
# Installs all available updates
```

### Minimum Versions

- macOS Ventura (13.x) or later
- Xcode Command Line Tools (installed via `xcode-select --install`)

## Installation Checklist

Run through this checklist to verify all tools are installed:

```bash
# 1. GitHub CLI
gh --version

# 2. Node.js (via mise)
node --version

# 3. Python (via mise)
python --version

# 4. npm
npm --version

# 5. Wrangler (run inside an app repo after npm ci)
npx wrangler --version

# 6. Flyctl
flyctl version

# 7. colima (needed for Fly deploys)
colima version

# 8. mise
mise --version

```

All outputs should show version numbers (no "command not found" errors).

## Troubleshooting Installation

### Issue 1: "mise not found" after installation
**Fix:**
```bash
# Add to PATH
export PATH="$HOME/.local/share/mise/shims:$PATH"
source ~/.zshrc
```

### Issue 2: "gh command not found"
**Fix:**
```bash
# Verify Homebrew installation
brew list gh

# If missing, reinstall
brew install gh

# Add to PATH if needed
which gh
```

### Issue 3: "Python version is 3.10, not 3.11"
**Fix:**
```bash
# Use mise to manage Python
mise use python@3.11
python --version
```

### Issue 4: "flyctl reports the Docker daemon is missing"
**Fix:**
```bash
colima start
docker info | head -5
# Then retry the flyctl deploy
```

## Next Steps

- Run the **Setup** guide to clone the app repos and verify everything works
- Read the **Logins** guide for Cloudflare Access, Fly, and other authentication details
- Pick an app from the **Apps** section and start developing
