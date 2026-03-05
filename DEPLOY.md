# Deploying Ramblemaxxer

## How deploys work

Push to GitHub → Railway detects it → auto-deploys within ~2 minutes. That's it.

## Making and deploying a change
```bash
# On your Mac, after making changes:
git add -A
git commit -m "describe what you changed"
git push origin main
```

Watch it deploy at railway.com → Ramblemaxxer project → Deploy Logs.

## First-time setup on a new Mac
```bash
git clone https://github.com/PBrazelton/ramblemaxxer
cd ramblemaxxer
cd server && npm install && cd ..
cd client && npm install && cd ..
npm run db:init
npm run db:seed
npm run dev
```

Open http://localhost:5173

## Environment variables (Railway dashboard)

Set these in Railway → Service → Variables:
- `NODE_ENV` = `production`
- `SESSION_SECRET` = (long random string)

## ⚠️ Database

The database lives at `server/db/ramblemaxxer.db` on the Railway server.
It is NOT in git. `git push` will never touch it.

To back it up, download it from Railway → Service → Files (or ask Paul).

## Custom domain

`ramblemaxxer.com` points to Railway via Namecheap DNS CNAME.
SSL is handled automatically by Railway.
