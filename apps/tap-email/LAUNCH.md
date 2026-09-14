# TAP Email launch runbook

This runbook covers the first production launch of the TAP Email miniapp and
its Cloudflare coordinator. Stop the rollout when a required check is not
green; mailbox coverage must fail closed rather than imply that a partial sync
is complete.

## 1. External prerequisites

### Google OAuth

- Enable the Gmail API in the production Google Cloud project.
- Create a Web application OAuth client with this exact redirect URI:
  `https://tap-email-coordinator.theaiplatform.app/v1/oauth/google/callback`.
- Configure `openid`, `email`, and
  `https://www.googleapis.com/auth/gmail.modify` on the consent screen.
- Keep the app restricted to approved test users until Google's restricted
  scope verification is complete.

### TAP platform

- Serve the session-introspection endpoint configured in
  `apps/tap-email-coordinator/wrangler.jsonc`.
- Verify it accepts the audience `tap_pkg_examples_tap_email_0001` and grants
  `tap-email.view` or `tap-email.manage` as requested. Production fails closed
  when introspection is unavailable or returns a mismatched audience/action.
- Confirm the host allows the exact external-network resource
  `https://tap-email-coordinator.theaiplatform.app` declared by the package.

### GitHub and Cloudflare

Create the GitHub environment `tap-email-coordinator-production` and add these
environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- `ATTACHMENT_STAGING_ENCRYPTION_KEY`

The Cloudflare token must be scoped to the target account and be able to deploy
Workers, manage D1, R2, and Queues, and bind the production custom domain. The
two encryption keys must be distinct 32-byte values encoded as unpadded
base64url. Never print them or store them in repository variables.

## 2. Release gates

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm --filter @tap-examples/tap-email-coordinator release:check
pnpm --filter @tap-examples/tap-email build
```

The final command assembles and verifies the installable package at
`apps/tap-email/.tap-package`.

## 3. Deploy the coordinator

Merge the reviewed pull request to `main`, or manually run **Deploy TAP Email
Coordinator** in GitHub Actions. The workflow:

1. validates the six environment secrets without printing their values;
2. repeats the Worker release gates;
3. creates the named production D1 database on the first run;
4. applies D1 migrations before routing new code;
5. uploads the four Worker runtime secrets and deploys the production Worker;
6. waits for semantic success from `/health` and `/ready`.

Wrangler provisions the named R2 bucket and Queues from the checked-in
production environment. Treat a failed readiness probe as a failed deployment,
even when the upload step succeeded.

## 4. Production smoke test

Use an approved test mailbox before expanding access:

- Connect Google and complete the OAuth callback without exposing a provider
  token to the miniapp.
- Confirm the newest inbox page appears first and older pages continue to
  backfill until coverage is complete.
- Connect a second Google account and verify unified and account-specific views
  remain isolated.
- Open rich mail, load a remote image under the chosen privacy setting, and
  download/export an attachment through the host picker.
- Archive, star, mark read, label, remind, save a draft, reply, and send. Verify
  each operation reaches a terminal receipt and that uncertain sends offer
  reconciliation rather than blind retry.
- Schedule and cancel a test send. Confirm no recipient receives an unexpected
  duplicate.
- Verify Chloe actions, workflows, and activity summaries expose only the
  explicitly selected or content-free context promised by their receipts.

## 5. Publish and widen access

After the production smoke test is green, publish the already verified package:

```bash
pnpm --filter @tap-examples/tap-email run publish --from .tap-package
```

Start with an internal cohort. Watch Worker errors, queue failures/dead letters,
readiness, sync coverage, OAuth reconnects, send receipts, and attachment-stage
cleanup before allowing additional users.

## Rollback

- Stop or pause the miniapp rollout first so new sessions do not enter a known
  bad coordinator state.
- Roll back the Worker to a known compatible version with Cloudflare's version
  history or `wrangler rollback --env production`.
- Do not reverse D1 migrations ad hoc. Wrangler captures migration backups;
  choose a data-restoration plan based on the incident and the compatibility of
  the prior Worker.
- Keep uncertain send receipts and staged attachments intact for explicit
  reconciliation. Never turn a rollback into an automatic resend.
