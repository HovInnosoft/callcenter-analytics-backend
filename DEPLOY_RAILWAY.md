# Deploy Backend + MongoDB on Railway

This guide deploys the backend to Railway and ensures Railway has the same users/data as local.

## 1) Create Railway services

1. Create a new Railway project.
2. Add a **MongoDB** service (Railway template/plugin).
3. Add a **Backend** service from this `backend` repo.

## 2) Backend service settings

Set these variables in Railway Backend service:

- `MONGO_URI=${{MongoDB.MONGO_URL}}`
- `JWT_SECRET=<strong-random-secret>`
- `CORS_ORIGIN=<your-frontend-domain>` (for example `https://callcenter-analytics-frontend.up.railway.app`)
- `UPLOAD_DIR=uploads`
- `PORT` is provided by Railway automatically.

Start command:

- `npm run start`

## 3) Initialize users and health dataset on Railway

In Railway backend service shell, run:

```bash
npm run bootstrap:health
```

This does:

1. `npm run seed` -> creates users (admin/exec/sup/qa/agents, etc.)
2. `npm run import:health` -> replaces interactions with Armenian health-insurance dataset

## 4) Make Railway DB exactly match local DB (optional, exact clone)

If you need exact parity (same IDs/timestamps as local), copy DB with Mongo tools:

```bash
# local machine
mongodump --uri="mongodb://localhost:27017/omnichannel_mvp" --archive=omni.gz --gzip

# restore into Railway Mongo
mongorestore --uri="<RAILWAY_MONGO_URL>" --archive=omni.gz --gzip --drop
```

Notes:

- Install tools if needed: `mongodb-database-tools` (`mongodump`, `mongorestore`).
- `--drop` overwrites existing collections in Railway.

## 5) Verify

Check:

- `GET /health` returns `{ "ok": true }`
- Login works with seeded users (for example `admin@example.com / admin1234`)
- Home/Search show expected interaction counts and sentiment drivers
