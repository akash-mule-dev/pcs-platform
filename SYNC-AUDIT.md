# PCS Platform — Web ↔ Mobile ↔ Backend Sync Audit

**Date:** 2026-06-06
**Scope:** Feature-by-feature verification that the Angular web portal and the React Native (Expo) operator app stay in sync with each other through the NestJS backend — both for the **data contract** (same endpoints, same field names, same response shapes) and for **real-time** propagation of changes.

This document is the audit. The fixes that follow from it are tracked in `SYNC-FIXES.md` and implemented in the codebase.

---

## 1. How sync works today (architecture)

Both clients talk to one backend (`http://localhost:3000/api` locally; `https://pcsapi.spadebloom.com/api` in prod) over:

- **REST** for all reads/writes.
- **Socket.IO** for real-time push.

**Response envelope** (verified live against the running API on `:3000`):

```
non-list:  { "data": <payload> }
list:      { "data": [ ...items ], "meta": { page, limit, itemCount, pageCount, ... } }
```

The payload array is always at `body.data` (paginated responses add `body.meta`). There is **no** `{success,...}` outer wrapper and **no** double-nesting.

- **Web** strips `body.data` in a `response.interceptor`; components then read the array.
- **Mobile** strips `body.data` in `unwrap()`, returning the array directly.
- ✅ Both clients read the envelope correctly. (An earlier draft of this audit over-read it as double-nested; live testing corrected that — see **S1**.)

**Real-time.** The backend gateway (`websocket/events.gateway.ts`) defines 8 server→client events, but only some are ever emitted, and the two clients listen to different subsets:

| Event | Backend actually emits it? | Web listens? | Mobile listens? |
|-------|:--:|:--:|:--:|
| `time-entry-update` | ✅ on clock in/out | ✅ Work-Order **detail** only | ❌ |
| `stage-update` | ✅ on clock in/out | ✅ Work-Order **detail** only | ❌ |
| `dashboard-refresh` | ✅ on clock in/out + shift summary | ❌ (dashboard polls every 30 s) | ❌ |
| `notification` | ✅ | ✅ (global) | ❌ |
| `unread-count-update` | ✅ | ✅ (global) | ❌ |
| `work-order-update` | ❌ **method exists but never called** | ❌ | ❌ |
| `quality-alert` | ❌ never called | ❌ | ❌ |
| `alert` | ❌ never called | ❌ | ❌ |
| `coordination:progress` | ✅ | ✅ | n/a (no mobile coordination) |

**Bottom line on real-time:** mobile receives **nothing** live. Web is live only on the Work-Order detail page and for notifications; its dashboard and live time-tracking view use polling (30 s / 10 s). Work-order and quality changes are broadcast to **no one** because the backend never calls those emit methods.

---

## 2. Feature-by-feature sync matrix

Legend — **Contract**: do web & mobile hit the same backend endpoints with matching field names? **Real-time**: does a change made on one client appear on the other without a manual refresh?

| Feature | Web uses | Mobile uses | Contract | Real-time | Verdict |
|---|---|---|:--:|:--:|---|
| **Auth / login** | `POST /auth/login`, `GET /auth/profile`, `GET /auth/permissions` | same (`/auth/login`, `/auth/profile`, `/auth/permissions`) | ✅ match | n/a | **In sync** |
| **Dashboard** | `GET /dashboard/summary`, `/dashboard/live-status` (poll 30 s) | `GET /time-tracking/active` + `/time-tracking/history` (operator view) | ✅ valid (different views by role, by design) | ⚠️ web polls; mobile manual-only | **Partial** — neither is push-updated; mobile never auto-updates |
| **Work Orders** | list/detail/create/status/assign/stage-status | list, detail, stage-status (operator subset) | ✅ match | ❌ list not live on either; backend emits nothing for WOs | **Out of sync (real-time)** |
| **Time Tracking** ⭐ | `clock-in`, `clock-out`, `active`, `history` | same four endpoints | ✅ match | ⚠️ web detail live; live view polls 10 s; **mobile not live** | **Out of sync (real-time)** |
| **Products** | full CRUD + model upload | — (not in mobile) | ✅ | n/a | **In sync** (web-only by design) |
| **Processes / Stages** | list/detail/create/reorder | — | ✅ | n/a | **In sync** (web-only) |
| **Lines / Stations** | full CRUD | — (read indirectly) | ✅ | n/a | **In sync** (web-only) |
| **Users** | list/create/update/delete | — | ⚠️ verify `mobileNo`/`employeeId` required on create (**S5**) | n/a | **Web-only**; check create payload |
| **Quality / 3D Models** | models list, quality-data CRUD, 3D/AR viewer | models list, `quality-data/by-model`, 3D/AR/VR viewer | ✅ match; same `/models/:id/file` URLs | ❌ `quality-alert` never emitted | **In sync (data)**; no live quality alerts |
| **Reports / Analytics** | `dashboard/oee`, `operator-performance`, `stage-analytics`, `export` | — | ✅ | n/a | **In sync** (web-only) |
| **Notifications** | `GET /notifications`, unread-count, read, read-all + sockets | ❌ **none** (no notifications UI/socket) | ❌ mobile absent | ❌ mobile not live | **Out of sync** — mobile has no notifications at all |
| **Coordination** | packages, drawings, zip/file upload + `coordination:progress` | — | ✅ | ✅ web live | **In sync** (web-only) |
| **Audit log** | `GET /audit` | — | ✅ | n/a | **In sync** (web-only) |

The web app is the **management surface** (full CRUD + analytics); the mobile app is the **operator surface** (work orders, time tracking, 3D/AR). That asymmetry is by design — "in sync" does **not** mean feature parity. It means: for the features both clients share (**Auth, Work Orders, Time Tracking, Quality/Models**), they must use the same contract and reflect each other's changes. Those shared features are where the real issues are.

---

## 3. Issues found (prioritized)

### S1 — Mobile list unwrapping · **NOT A BUG (verified live) · hardening only**
The first draft suspected a double-nested page (`body.data.data`) that mobile would mishandle. **Live testing disproved it:** `/work-orders` returns `{data:[20], meta}` and `/time-tracking/active` returns `{data:[]}` — the array is at `body.data`, which mobile's `unwrap()` already returns correctly. Mobile lists were **not** broken.
**Action taken (optional hardening):** added `api.getList<T>()` which returns an array whether the payload is an array, a `{data}`, or a `{data,meta}` page. Harmless and future-proof, but not fixing an active defect.

### S2 — Mobile has no real-time at all · **CRITICAL · sync**
`socket.io-client` is not even a dependency. No screen receives `time-entry-update`, `stage-update`, or `dashboard-refresh`. An operator's clock-in on web won't show on mobile (and vice-versa) until a manual pull-to-refresh.
**Fix:** add a mobile socket service + a `useSocketEvent` hook, and wire Timer, Dashboard, Work-Order list & detail to refetch on the relevant events.

### S3 — Mobile API URL hardcoded to production · **HIGH · sync / testability**
`mobile/src/config/environment.ts` points **both** `development` and `production` at `https://pcsapi.spadebloom.com/api`. While web runs against `localhost:3000`, mobile cannot point at the same local backend, so the two clients literally talk to different servers during development.
**Fix:** make the base URL configurable via `EXPO_PUBLIC_API_URL` (fall back to a LAN IP for dev), documented in the device test script.

### S4 — Backend never broadcasts work-order / quality changes · **HIGH · sync**
`emitWorkOrderUpdate`, `emitQualityAlert`, `emitAlert` are defined on the gateway but **never called**. So no client can be real-time for work-order status changes or quality events — the events are dead.
**Fix:** call `emitWorkOrderUpdate(...)` from `work-orders.service` on create / status change / stage-status change / assign (and wire web + mobile listeners to it).

### S5 — Web dashboard & lists ignore events the backend already emits · **MEDIUM · sync**
The web dashboard polls every 30 s instead of listening to `dashboard-refresh`; the work-order list/board never refreshes on change. After S4 adds WO broadcasts, web should consume them too so both clients update together.
**Fix:** subscribe the web dashboard to `dashboard-refresh` and the work-order list to `work-order-update`/`stage-update`.

### S6 — Mobile time-tracking history query params · **LOW · contract**
Backend history filters on `page`, `limit`, `userId`, `startDate`, `endDate`. Mobile passes a loose `params` bag (e.g. `date`) the backend ignores. Harmless today but drifts.
**Fix:** align mobile history params to the backend names.

### S7 — Line-ending churn (297 phantom-modified files) · **LOW · hygiene**
Working tree is CRLF while git stores LF, so `git status` shows 297 files "modified" with zero real content change. This obscures real diffs and risks noisy commits.
**Fix:** add a `.gitattributes` enforcing LF and renormalize.

### Observational — error envelope
Auth failures return a flat `{statusCode, message, timestamp, path}` (not the `{success, error}` shape documented). Both clients currently read `.message`, so messages display correctly; no action required, but worth standardizing later.

---

## 4. Shared-feature real-time target state (after fixes)

| Action | Should appear live on… | Via event |
|---|---|---|
| Operator clocks in/out (web or mobile) | Web dashboard, web live view, **mobile** dashboard & timer | `time-entry-update`, `stage-update`, `dashboard-refresh` |
| Work-order status / stage status changes | Web list & detail, **mobile** work-order list & detail | `work-order-update`, `stage-update` |
| New notification | Web bell, (optional) mobile | `notification`, `unread-count-update` |

---

*Generated as part of the production-readiness + sync pass on 2026-06-06.*
