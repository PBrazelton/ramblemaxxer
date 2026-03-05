# Setting Up Ramblemaxxer on Your Mac

## One-time installs

1. **Install Homebrew** (package manager for Mac):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Install Node.js:**
   ```bash
   brew install node
   node --version  # should say v18 or higher
   ```

3. **Install Git** (may already be installed):
   ```bash
   git --version
   # If not installed, Mac will prompt you to install Xcode Command Line Tools
   ```

4. **Install Claude Desktop App:**
   Download from anthropic.com/claude — this is how you'll work on the code.
   Sign in with your Claude Pro account.

## Getting the project

```bash
# Ask Paul for the repo URL, then:
git clone https://github.com/PBrazelton/ramblemaxxer.git ramblemaxxer
cd ramblemaxxer
cd server && npm install && cd ..
cd client && npm install && cd ..
npm run db:init
npm run db:seed
npm run dev
```

Open http://localhost:5175 — you should see the login screen.

## Working on the code with Claude

1. Open the Claude desktop app
2. Click the **Code** tab at the top
3. When it asks for a folder, point it at your `ramblemaxxer` folder
4. Claude Code will read `CLAUDE.md` automatically and know what the project is
5. Describe what you want to change in plain English
6. Claude Code will edit the files directly — check the changes in your browser

## Saving and deploying changes

```bash
# After Claude Code makes changes you're happy with:
git add -A
git commit -m "what did you change?"
git push origin main
# Then follow DEPLOY.md to push it live
```
