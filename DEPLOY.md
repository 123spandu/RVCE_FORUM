# Deploying RVCE Connect

## Option A — Public demo tunnel (already usable while your PC runs)

If `npm start` is running on port 3000:

```bash
npx localtunnel --port 3000
```

Share the printed `https://….loca.lt` URL. First visit may show a LocalTunnel click-through page — click Continue.

This is **temporary** (stops when your PC / tunnel stops).

---

## Option B — Docker (app + MySQL) on this machine

```bash
# Uses .env for JWT/VAPID when present
docker compose up -d --build
```

- App: http://localhost:3000 (or `PORT` from env, e.g. 3080)
- MySQL: host port **3307** → container 3306

Stop:

```bash
docker compose down
```

---

## Option C — Render (cloud)

1. Open [Render Dashboard](https://dashboard.render.com) → New → Blueprint  
2. Connect repo `123spandu/RVCE_FORUM`  
3. Use `render.yaml` in the repo  
4. Provision a **MySQL** database (Render Postgres won’t work — this app needs MySQL)  
   - e.g. [Aiven](https://aiven.io), [PlanetScale](https://planetscale.com), or any MySQL host  
5. Set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and VAPID keys in the Render service env  
6. Deploy — health check: `/api/health`

---

## Option D — Railway (cloud)

1. https://railway.app → New Project → Deploy from GitHub → `RVCE_FORUM`  
2. Add a **MySQL** plugin  
3. Map env vars: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, VAPID_*  
4. Start command: `node server.js`

---

## Production checklist

- [ ] Strong `JWT_SECRET` and admin password  
- [ ] HTTPS (required for Web Push / install on phones)  
- [ ] Set VAPID keys  
- [ ] Persist `/uploads` volume  
- [ ] Do not commit `.env`
