# Project TODO

- [x] Define shared field-service domain types and conflict-resolution contracts
- [x] Add SQLite local persistence for work orders, visits, and sync mutations
- [x] Build technician sign-in and session restoration flows
- [x] Build Today, Work Orders, Work-order Detail, Visit Form, Sync Activity, and Profile screens
- [x] Implement local-first service visit updates and queued mutations
- [x] Connect queued mobile mutations to authenticated push and pull synchronization procedures
- [x] Implement PostgreSQL schema and authenticated Node.js API procedures
- [x] Implement push/pull synchronization, idempotency, and optimistic concurrency conflicts
- [ ] Configure the PostgreSQL connection for the production synchronization backend
- [x] Validate the synchronization API contract and conflict outcomes without external database credentials
- [x] Build a technician-facing conflict resolution flow
- [ ] Add deterministic tests for local queue and conflict-resolution logic
- [x] Generate a custom field-service application icon and update mobile branding configuration
- [x] Validate type checks and core offline/synchronization flows
- [ ] Publish the completed FieldOps project to a private GitHub repository
