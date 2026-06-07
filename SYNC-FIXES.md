# PCS Platform — Sync Fixes (web ↔ mobile ↔ backend)

**Date:** 2026-06-06
**Companion to:** `SYNC-AUDIT.md` (the audit these fixes resolve).

This pass made the operator mobile app a real-time, contract-correct peer of the web
portal against the same backend. Below is what changed, why, and exactly how to verify
it on your machine.

> **Note on verification:** these edits were written to your real files (the running
> code on disk). I could not run the type-checks/builds from my sandbox — its shell
> sees a stale, partially-synced mirror of edited files — so the build/test commands
> below need to be run on your machine, where the files are complete and correct.

---

## 1. What changed, by issue

### S2 + S4 — Real-time sync (the headline fix)
Mobile had **no** WebSocket client and the backend **never broadcast** work-order changes.

**Backend** — `backend/src/work-orders/work-orders.service.ts`
- Injected the existing `EventsGateway` (same pattern `alerts`/`notifications` use; the gateway is `@Global`).
- Now emits on every mutation:
  - `create` → `work-order-update` + `dashboard-refresh`
  - `update` → `work-order-update`
  - `updateStatus` → `work-order-update` + `dashboard-refresh`
  - `updateStageStatus` → `stage-update` + `work-order-update`
  - `assign` → `work-order-update`
  - `batchAssignLine` → `work-order-update`

**Mobile** — new real-time layer
- `src/services/socket.service.ts` *(new)* — Socket.IO client; connects to `apiUrl` minus `/api`, joins the user room, auto-reconnects, and re-attaches listeners on connect.
- `src/hooks/useSocketEvent.ts` *(new)* — `useSocketEvent` / `useSocketEvents` hooks so a screen refetches when an event fires.
- `src/context/AuthContext.tsx` — connects the socket on login/restored session, disconnects on logout.
- Wired live refresh into screens:
  - `DashboardScreen` ← `time-entry-update`, `stage-update`, `dashboard-refresh`
  - `TimerScreen` ← `time-entry-update`, `stage-update`, `dashboard-refresh`
  - `WorkOrderListScreen` ← `work-order-update`, `stage-update`
  - `WorkOrderDetailScreen` ← `work-order-update`, `stage-update`, `time-entry-update`
- `package.json` — added `socket.io-client ^4.8.1` (matches backend Socket.IO 4.8.x). **Run `npm install`.**

**Web** — `frontend/src/app/core/services/realtime.service.ts` *(new)*, one shared multiplexed socket.
- `dashboard.component.ts` now live-refreshes on `dashboard-refresh` / `time-entry-update` / `stage-update` / `work-order-update` (30 s poll kept as a fallback).
- `work-order-list/work-order-list.component.ts` now live-refreshes on `work-order-update` / `stage-update`.

### S1 — Mobile list unwrapping (hardening; not an active bug)
Live testing showed the API returns the array at `body.data` (e.g. `/work-orders` → `{data:[…], meta}`), which mobile's `unwrap()` already returns correctly — so lists were **not** broken. Kept a small defensive improvement anyway:
- `src/services/api.service.ts` — added `getList<T>()` that returns an array whether the payload is an array, `{data}`, or `{data,meta}`.
- `work-order.service.ts`, `time-tracking.service.ts`, `ModelListScreen` use it. Harmless and future-proof.

### S3 — Mobile pointed at production even in dev
`src/config/environment.ts` now reads `EXPO_PUBLIC_API_URL` (falls back to `localhost` in dev, hosted API in prod), so the app and the web portal can share one backend. **This is required to test the two clients against your local backend** (see §3).

### S7 — Line-ending churn (297 phantom-modified files)
Added `.gitattributes` (LF normalization). Apply once:
```
git add --renormalize .
git commit -m "Normalize line endings to LF"
```

*(S5/S6 from the audit are addressed by the web realtime wiring and the mobile service params respectively; S6 is benign.)*

---

## 2. Verify the builds (run on your machine)

```bash
# Backend — expect no errors
cd backend && npm run build

# Frontend — expect a successful production build
cd frontend && npm run build

# Mobile — install the new dep, then type-check
cd mobile && npm install && npx tsc --noEmit
```

If the backend/frontend dev servers were started with watch (`nest start --watch`, `ng serve`), they will hot-reload these changes; otherwise restart them.

---

## 3. Test real-time sync end to end (web ↔ mobile)

**Point both clients at the same backend.** Web already uses `http://localhost:3000/api`. Start mobile against your machine's LAN IP:
```bash
cd mobile
EXPO_PUBLIC_API_URL=http://<YOUR-LAN-IP>:3000/api npx expo start
#   Android emulator: http://10.0.2.2:3000/api   iOS simulator: http://localhost:3000/api
```
Make sure the backend CORS/host allows the device; the API must be reachable from the phone (same Wi-Fi).

**Test A — clock-in propagation**
1. Open the web **Dashboard** and **Time Tracking → Live** in a browser.
2. On the mobile **Timer** screen, clock into a stage.
3. ✅ Web dashboard active-count and live view update **without refresh**; mobile dashboard/timer reflect it too.
4. Clock out on mobile → both sides update live.

**Test B — work-order status propagation**
1. Open the web **Work Orders** list and the mobile **Work Orders** list side by side.
2. On web, change a work order's status (or a stage's status).
3. ✅ The mobile list/detail updates live (and vice-versa).

**Test C — paginated lists populate on mobile**
1. On mobile, open **Work Orders**, **Time Tracking → History**, and **Models**.
2. ✅ Each list shows data.

---

## 4. Mobile device smoke test (no automation needed)

| # | Step | Expect |
|---|------|--------|
| 1 | Launch app, log in | Lands on dashboard; no crash |
| 2 | Pull-to-refresh dashboard | Today's stats load |
| 3 | Work Orders tab | List populated (not empty) |
| 4 | Open a work order | Stages render |
| 5 | Timer → clock in to a stage | Timer starts; web dashboard updates live |
| 6 | Clock out | History updates; web updates live |
| 7 | Models tab | Models list populated; 3D/AR viewer opens |
| 8 | Toggle airplane mode briefly | Offline banner shows; socket reconnects after |

A Maestro flow already exists at `mobile/maestro/` — extend it with steps 5–6 once the device test passes manually.

---

## 5. Files changed

**Backend:** `work-orders/work-orders.service.ts`
**Frontend (new):** `core/services/realtime.service.ts` · **(edited):** `dashboard/dashboard.component.ts`, `work-orders/work-order-list/work-order-list.component.ts`
**Mobile (new):** `services/socket.service.ts`, `hooks/useSocketEvent.ts` · **(edited):** `config/environment.ts`, `services/api.service.ts`, `services/work-order.service.ts`, `services/time-tracking.service.ts`, `context/AuthContext.tsx`, `screens/dashboard/DashboardScreen.tsx`, `screens/time-tracking/TimerScreen.tsx`, `screens/work-orders/WorkOrderListScreen.tsx`, `screens/work-orders/WorkOrderDetailScreen.tsx`, `screens/model-viewer/ModelListScreen.tsx`, `package.json`
**Root (new):** `.gitattributes`, `SYNC-AUDIT.md`, `SYNC-FIXES.md`
