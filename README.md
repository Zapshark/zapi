[![Latest @zapshark/zapi NPM Release](https://github.com/Zapshark/zapi/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/Zapshark/zapi/actions/workflows/npm-publish.yml)

# ZAPI Framework (Node.js) — `@zapshark/zapi`

A lightweight, batteries‑included Node.js framework for building scalable APIs and realtime apps.
ZAPI wraps Express, Mongoose, Redis and a tiny event bus into a cohesive runtime with **auto‑registered services/controllers**, safe database fallbacks, cluster‑aware monitoring, and optional admin backend.

---

## ✨ Highlights

- **BaseLifecycle** with `init/start/stop`, structured logging, and **auto‑registration** into the service/controller registries.
- **Express router** that accepts a pure JSON/JS route definition array and optional global pre/post stages.
- **Mongoose manager** with `registerModel`/`useModel` and a **safe model proxy** that avoids throwing while Mongo is down.
- **Redis cache** helper with `get/set/delPath` used pervasively in example services.
- **Events & Monitoring**: EventServer, system/WS/Redis adapters, metrics ingestion, heartbeats, route introspection.
- **Optional Backend Admin** mounted at `/_zapi` guarded by an API key header.
- **WebSocket server + MessageBus** with Redis fan‑out (when Redis is up).
- **Job Queue** (in‑memory with optional Redis integration) + controller façade.

> ZAPI is designed to **keep your app booting even when infra is shaky**, and to be ADHD/Autistic‑friendly: small building blocks, short APIs, and clear milestones.

---

## 📦 Install

```bash
npm install @zapshark/zapi
# or
pnpm add @zapshark/zapi
```

---

## 🚀 Quick Start (5 tiny steps)

> Minimal mental load: do one step at a time.

1) **Create app config** `app/config/app.js`

```js
module.exports = {
  env: process.env.NODE_ENV || 'development',
  zapi: {
    serverName: process.env.ZAPI_SERVER_NAME || 'zapiAppServer',
    monitoring: { enable: true, leaderOnly: true },
    apiBackend: {
      enabled: true,
      basePath: '/_zapi',
      headerName: 'x-zapi-backend-key',
      apiKeyHash: process.env.ZAPI_BACKEND_SECRET // pbkdf2$310000$<base64salt>$<base64hash>
    }
  },
  express: { enable: true, port: 3000, workers: 2, trustProxy: true },
  mongo: { uri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/myapp', options: {} },
  redis: { url: process.env.REDIS_URL, keyPrefix: 'myapp:' },
  websocket: { enable: true, port: 8081, workers: 2, prefix: 'ws' }
};
```

2) **Bootstrap** `app/bootstrap.js`

```js
'use strict';
module.exports = async function bootstrap({ cache, config }) {
  // Services/controllers auto‑register on construction via BaseLifecycle
  new (require('./services/ExampleService'))({ cache, config });
  new (require('./controllers/ExampleController'))();
};
```

3) **Routes** `app/routes.js`

```js
const { resolveController } = require('@zapshark/zapi');
const Example = { controller: 'ExampleController', action: 'hello' };

module.exports = [
  { path: '/api/hello', method: 'get', owner: Example }
];
```

4) **Service/Controller**

```js
// services/ExampleService.js
const { BaseLifecycle } = require('@zapshark/zapi');
class ExampleService extends BaseLifecycle {
  static artifactName = 'ExampleService';
  static artifactKind  = 'service';
  constructor({ cache, config } = {}) {
    super({ name: ExampleService.artifactName, kind: ExampleService.artifactKind });
    this.cache = cache; this.config = config;
  }
  async hello(name) { return { message: `Hello, ${name}` }; }
}
module.exports = ExampleService;

// controllers/ExampleController.js
const { BaseLifecycle, resolveService } = require('@zapshark/zapi');
class ExampleController extends BaseLifecycle {
  static artifactName = 'ExampleController';
  static artifactKind  = 'controller';
  hello = async (req) => {
    const svc = resolveService('ExampleService');
    return svc.hello(req.query.name || 'world');
  }
}
module.exports = ExampleController;
```

5) **Start your app**

```js
// index.js (your host app)
const { bootstrap } = require('@zapshark/zapi');
bootstrap();
```

---

## 🗂️ App layout (convention)

```
app/
  config/app.js          # required
  bootstrap.js           # optional; construct your services/controllers here
  routes.js              # required; defines HTTP routes
  middleware/_global.js  # optional; { pre:[], post:[] }
  models/*.js            # your Mongoose models
  controllers/*.js
  services/*.js
```

---

## 🧩 BaseLifecycle (auto‑registration)

- Extend `BaseLifecycle` in any **service** or **controller**.
- Set `static artifactName` and `static artifactKind` (`'service'` or `'controller'`).  
- Instances auto‑register into the global registries; replace/keep behavior can be controlled with `ifAlready`.

Key abilities:
- Hooks: `init()`, `start()`, `stop()` (override as needed)
- Logger: `this.log.info/debug/warn/error(...)`
- Infra guards: `this.requireMongo`, `this.requireRedis`, `this.requireInfra({ mongo, redis, message })`
- Event helper: `await this.emitZapi('sys:ready', payload)`

Example (service above) shows how simple it is.


---

## 🔎 Registries (resolve & set)

ZAPI provides tiny registries so you can wire things without import cycles:

```js
const { setService, resolveService } = require('@zapshark/zapi');
const { setController, resolveController } = require('@zapshark/zapi');
```

- Services/controllers are added automatically when you construct classes extending `BaseLifecycle`.
- You can still `setService('Name', instance)` or `setController('Name', instance)` manually when needed.
- Anywhere in your app (routes, other services), use `resolveService('Name')`/`resolveController('Name')` to fetch instances.

---

## 🗺️ Routing

Define routes as plain objects:

```js
module.exports = [
  { path: '/api/ping', method: 'get', handler: () => ({ ok: true }) },
  { path: '/api/notes', method: 'get', owner: { controller: 'NoteController', action: 'list' } }
];
```

Global stages (non‑mutating logging/metrics) can be added from `middleware/_global.js`:

```js
module.exports = {
  pre:  [ (req,res,next) => { /* before */ next(); } ],
  post: [ (req,res,next) => { /* after res */ next(); } ]
};
```

A helper can expose a route index:

```js
const { withRouteIndex } = require('@zapshark/zapi');
module.exports = withRouteIndex(require('./myRoutes'), { path: '/_routes' });
```

---

## 🗃️ Models & Mongoose (safe by default)

Register a model once at startup and always access it via **useModel**:

```js
// models/Note.js
const { registerModel } = require('@zapshark/zapi');
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  title: String, body: String, tags: [String], archived: { type: Boolean, default: false }
}, { timestamps: true });
module.exports = registerModel('Note', schema);
```

Usage from a service:

```js
const { useModel } = require('@zapshark/zapi');
const Note = useModel('Note');
const docs = await Note.find({ archived: false }).lean();
```

> If Mongo is down during boot or runtime, `Note.find()` returns an empty array (reads) and writes resolve to `null`. This lets your app stay up and degrade gracefully until Mongo recovers.

Utilities:
- `startMongoConnector(config)` — non‑blocking connector with backoff.
- `registerModel(name, schema)` — registers real model and returns a **safe proxy**.
- `useModel(name)` — always returns the **safe proxy**.
- `disconnectMongo()`

---

## 🧠 Cache (Redis)

Create a cache and use it inside services; the example below mirrors the built‑in NoteService pattern:

```js
class NoteService extends BaseLifecycle {
  constructor({ cache, config }) { super({ name: 'NoteService', kind: 'service' }); this.cache = cache; }
  async list({ tag } = {}) {
    const key = `notes:list:${tag || 'all'}:active`;
    const hit = await this.cache.get(key); if (hit) return hit;
    const Note = useModel('Note');
    const items = await Note.find(tag ? { tags: tag, archived:false } : { archived:false }).sort({ createdAt: -1 }).lean();
    await this.cache.set(key, items, 60);
    return items;
  }
  async create({ title, body = '', tags = [] }) {
    const Note = useModel('Note');
    const doc = await Note.create({ title, body, tags });
    await this.cache.delPath('notes:list:');
    return doc.toJSON();
  }
}
```

> Cache API (as used): `get(key)`, `set(key, value, ttlSeconds)`, `delPath(prefix)`.

Create a cache manually if you need one outside of the boot flow:

```js
const { createCache } = require('@zapshark/zapi');
const cache = await createCache(config);
```

---

## 🔐 Backend Admin (`/_zapi`)

Enable the optional backend and guard it with a **PBKDF2‑hashed** key:

```js
zapi: {
  apiBackend: {
    enabled: true,
    basePath: '/_zapi',
    headerName: 'x-zapi-backend-key',
    apiKeyHash: process.env.ZAPI_BACKEND_SECRET // pbkdf2$310000$<base64salt>$<base64hash>
  }
}
```

Send the raw key in the configured header when calling `/_zapi` routes. Store only the hash in config/env.

---

## 📡 Events, Metrics & Monitoring

- **EventServer** with adapters: Local, Redis (fan‑out), WebSocket (broadcast zapi:* to clients).
- **System events**: `zapi:sys:*` (boot, routes attached, http ready, heartbeats, metrics flush, etc.).
- **MonitoringService** (core) can log events with heartbeat throttling; enable/disable via config.
- **MetricsIngestor** aggregates counters and publishes periodic `zapi:sys:metrics:flush` events.

You can subscribe/publish from services via the EventServer resolved from the registry.

---

## 🛰️ WebSockets & MessageBus

- Start WS server via config; the framework will expose a `BusService` (message bus) you can publish to.
- You can create per‑user rooms or group rooms and publish messages/events from routes and services.

Example (route handler idea):

```js
const { resolveService } = require('@zapshark/zapi');
const bus = resolveService('BusService');
await bus.publish(`room:user:u_${userId}`, { userId, message, ts: Date.now() });
```

---

## 🧵 Job Queue (optional, tiny)

- Declare jobs in `app/jobQueueRoutes.js` (array or factory).
- Enqueue from anywhere via the `JobQueueController` façade.

```js
// app/jobQueueRoutes.js
module.exports = ({ resolveService }) => ([
  { name: 'Demo:Sleep',
    execute: async (payload) => { await new Promise(r => setTimeout(r, payload.ms || 1000)); }
  }
]);
```

```js
// enqueue
const { resolveController } = require('@zapshark/zapi');
const jobQueue = resolveController('JobQueueController');
const jobId = await jobQueue.enqueue('Demo:Sleep', { ms: 1500 });
```

Config (`zapi.jobqueue`):
```json
{
  "throttlecount": 100,
  "throttletime": 1,
  "useredis": true,
  "jobworkerinstances": 1,
  "broadcast": true,
  "leaderOnly": true
}
```

---

## ⚙️ Configuration Cheatsheet

- **express**: `{ enable, port, workers, trustProxy }`
- **mongo**: `{ uri, options }`
- **redis**: `{ url | host/port/password/db, keyPrefix }`
- **websocket**: `{ enable, port, workers, prefix, heartbeatIntervalMs }`
- **zapi.monitoring**: `{ enable, leaderOnly, printHeartbeats, heartbeatWindowMs, appLogger:{ enable,file,flushEveryMs,maxBuffer } }`
- **zapi.apiBackend**: `{ enabled, basePath, headerName, apiKeyHash, keyMinLength }`
- **zapi.health.require**: `{ mongo, redis }`
- **zapi.jobqueue**: `{ throttlecount, throttletime, useredis, jobworkerinstances, broadcast, leaderOnly }`

---

## 🧪 Error envelopes

- Success responses are returned directly (or with your custom `shapeResponse`).
- Errors are wrapped with a consistent shape using your configured `shapeKey` (defaults to `ok: false`).

---

## 🧭 Tiny Milestones / Checklist

- [ ] Boot with `bootstrap()` and a single route (`/api/ping`).
- [ ] Add one service + controller extending `BaseLifecycle`.
- [ ] Register one model with `registerModel` and fetch it via `useModel`.
- [ ] Add cache reads/writes in the service.
- [ ] Toggle Backend Admin and hit `/_zapi/ping` with the header key.
- [ ] Enable Monitoring and watch `zapi:*` logs.
- [ ] Add one WS room and publish a message from a route.
- [ ] Add one Job and enqueue it via the controller façade.

---

## 📄 License

Please see the full license in `LICENSE`. All dependencies are MIT or similarly permissive. See respective repos for details on their licenses. All dependencies used by ZAPI are actively maintained and widely adopted in the open source community.

MIT License

Copyright (c) 2025 Zapshark Technologies LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


