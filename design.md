# Offline Field Service — Mobile Design Plan

## Product direction

Offline Field Service is a technician-focused work-order application for completing scheduled service visits in low-connectivity environments. The interface is designed for mobile portrait use, with primary actions within thumb reach and a clear separation between assigned work, field documentation, and synchronization state. The navigation and interaction patterns follow mainstream iOS conventions: a native tab bar, large scan-friendly typography, grouped list sections, sheets for focused actions, and restrained confirmation feedback.

## Screen list

| Screen | Primary content and functionality |
| --- | --- |
| Sign in | Technician email and password, workspace context, and a clear offline availability message after prior authentication. |
| Today | Daily route summary, urgent work orders, offline/sync status, progress metrics, and a quick action to synchronize changes. |
| Work orders | Filterable work-order list segmented by status: Scheduled, In Progress, Needs Review, and Complete. Each row shows customer, time window, priority, address, and local sync state. |
| Work-order detail | Customer and site details, scope, checklist, equipment, notes, visit status controls, and a persistent action to start or complete service. |
| Field visit form | Service checklist, measurement inputs, issue recording, customer sign-off state, and incremental local saving. This form never requires network availability. |
| Conflict review | A focused comparison of local and server edits where the technician can keep local, accept server, or merge a field-level value before a retry. |
| Sync activity | Last successful synchronization, pending changes, failed mutations, conflict count, and a manual retry control. |
| Profile and settings | Technician identity, sign-out, data refresh policy, local-data status, and a concise explanation of offline behavior. |

## Key user flows

| Flow | Steps |
| --- | --- |
| Begin a service visit | Technician opens Today → taps a scheduled assignment → reviews scope → taps Start Visit → app writes status and timestamp locally → work order moves to In Progress and queues a sync mutation. |
| Complete an offline visit | Technician opens an in-progress job with no connectivity → enters checklist results and service notes → taps Complete Visit → app validates required fields locally → status changes immediately → mutation is queued for later upload. |
| Reconnect and synchronize | Connection is restored → technician opens Sync activity or taps Sync Now → app pushes queued mutations in chronological order → app pulls remote deltas since the saved cursor → local records update and the queue clears for acknowledged changes. |
| Resolve an edit conflict | Server reports a version mismatch for a queued mutation → work order is marked Needs Review → technician opens Conflict review → compares local and server values → chooses a value for each changed field → app creates a new versioned mutation and retries it. |
| Continue after restart | Technician reopens the app without a connection → cached profile, work orders, visit progress, and mutation queue load from local SQLite → all in-progress work remains actionable. |

## Data and sync vocabulary

The primary records are `Technician`, `Customer`, `ServiceSite`, `WorkOrder`, `Visit`, `ChecklistItem`, `VisitNote`, and `SyncMutation`. Every mutable business record includes a stable UUID, a monotonically incremented `version`, `updatedAt`, `updatedBy`, and a local sync state. A queued mutation includes the operation type, entity type, entity ID, payload, base version, client timestamp, retry count, and client mutation ID for idempotency.

The mobile client uses SQLite as the operational database. UI screens read only from this local store, and writes are committed locally before any network attempt. The synchronization protocol is bidirectional: outgoing mutations are submitted with their base version, while a cursor-based pull endpoint returns server updates since the client cursor. The backend uses optimistic concurrency control. When a submitted base version is stale, it returns both record versions and the changed fields rather than silently overwriting data.

## Layout and interaction guidance

Today uses a single vertical scroll with a compact top summary, a prominent next-job card, and grouped work-order rows. Work-order detail uses a clear visual hierarchy: job status and primary CTA at the top, safety-critical information before supporting data, then service tasks and notes. Field forms save each control change locally and show a subtle “Saved on this device” state. Sync state appears as an unobtrusive status pill on relevant rows rather than a blocking modal.

The primary tab bar contains **Today**, **Work Orders**, and **Sync**. Profile appears in the Today header to keep the primary tab bar focused on operational work. Screens use an 8-point spacing rhythm; actionable tap targets are at least 44 points; destructive actions require a confirmation sheet; and all status indicators are paired with text so meaning does not depend on color alone.

## Color choices

| Token | Color | Intended use |
| --- | --- | --- |
| Operations navy | `#123047` | Primary navigation, headings, and trusted operational context. |
| Signal teal | `#087E8B` | Primary actions, active controls, and successful synchronization accents. |
| Surface mist | `#F5F8FA` | Screen backgrounds and grouped list sections. |
| Card white | `#FFFFFF` | Elevated cards and forms. |
| Safety amber | `#C76B00` | Pending sync, warnings, and required attention. |
| Incident red | `#B42318` | Failed sync, critical status, and destructive actions. |
| Field green | `#197A42` | Completion and verified-success states. |
| Slate text | `#1E293B` | Core text; secondary text uses `#64748B`. |

## Scope boundary for the first version

The first version concentrates on technician assignment visibility, field visit completion, resilient local persistence, authenticated synchronization, and explicit conflict handling. Location tracking, photo uploads, barcode scanning, dispatch administration, and automatic background synchronization can be added after the core offline loop is verified.
