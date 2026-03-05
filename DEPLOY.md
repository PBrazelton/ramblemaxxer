# Deploying Ramblemaxxer to ramblemaxxer.com

## First-time setup (do this once)

### On your Mac, make sure you have:
- Git installed: `git --version` (if not, install Xcode Command Line Tools)
- SSH access to Namecheap: see Paul for credentials

### On the server (SSH in first):
```bash
ssh username@ramblemaxxer.com
cd ~/
git clone https://github.com/PBrazelton/ramblemaxxer.git ramblemaxxer
cd ramblemaxxer
cd server && npm install --production && cd ..
cd client && npm install && npm run build && cd ..
node server/db/init.js
node server/db/seed.js
```

### Set up environment variables in cPanel:
1. Log into cPanel → Software → Setup Node.js App
2. Create new app:
   - Node.js version: 18+
   - Application mode: Production
   - Application root: /home/USERNAME/ramblemaxxer
   - Application URL: ramblemaxxer.com
   - Application startup file: app.js
3. Add environment variables:
   - NODE_ENV = production
   - SESSION_SECRET = (generate a random string — ask Paul or use: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - APP_URL = https://ramblemaxxer.com
4. Click Save, then Start

---

## Deploying an update (do this every time)

### On your Mac:
```bash
cd ~/path/to/ramblemaxxer

# If you made changes locally and want to deploy them:
git add -A
git commit -m "describe what you changed"
git push origin main
```

### On the server:
```bash
ssh username@ramblemaxxer.com
cd ~/ramblemaxxer
git pull origin main

# If you changed any client code:
cd client && npm run build && cd ..

# Restart the app:
# Go to cPanel → Node.js Apps → click Restart next to ramblemaxxer
```

That's it. The site will be live within a few seconds of restart.

---

## Protecting the database

The database lives at `server/db/ramblemaxxer.db`.
This file is NOT in git (on purpose — it contains real user data).
**Never delete this file.** `git pull` will never touch it.

To back it up:
```bash
# On the server:
cp ~/ramblemaxxer/server/db/ramblemaxxer.db ~/backups/ramblemaxxer-$(date +%Y%m%d).db
```

Set a reminder to do this monthly, or ask Paul to automate it.

---

## Troubleshooting

**Site is down / showing an error:**
- Check cPanel → Node.js Apps → is the app Running?
- Check cPanel → Errors for the error log

**My changes aren't showing up:**
- Did you rebuild the client? `cd client && npm run build`
- Did you restart the app in cPanel?

**Database got wiped somehow:**
- Restore from your backup: `cp ~/backups/ramblemaxxer-YYYYMMDD.db ~/ramblemaxxer/server/db/ramblemaxxer.db`
- Restart the app
