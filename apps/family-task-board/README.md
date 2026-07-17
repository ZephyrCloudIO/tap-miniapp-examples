# Family Task Board

A working consumer miniapp example for coordinating chores, activities, stars, and family rewards.

## Run locally

```sh
pnpm install
pnpm --filter @tap-examples/family-task-board dev
```

The browser preview starts empty and persists records in local storage. The packaged surface starts empty and persists records exclusively through the TAP SDK storage capability.

## Verify

```sh
pnpm --filter @tap-examples/family-task-board test
pnpm --filter @tap-examples/family-task-board typecheck
pnpm --filter @tap-examples/family-task-board build
```
