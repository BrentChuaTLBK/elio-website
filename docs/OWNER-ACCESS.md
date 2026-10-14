# Owner authenticator access

Owners must complete an authenticator challenge in **Team sign in** before using Admin, POS, private payment images, exports, or other privileged actions. Ordinary customer and staff roles retain their existing permissions. Supabase project administrator access is separate from an Elio owner account.

## First setup and later sign-ins

1. Open `https://eliocheesecakes.com/admin-account.html` and sign in with your existing Elio account.
2. Choose **Set up authenticator**, scan the QR code with your authenticator, and save the setup key in your password manager. The website keeps the key only in the current page; it does not save it in browser storage or logs.
3. Enter the current six-digit code and choose **Enable protection**. The server verifies the upgraded session before the website opens the dashboard.
4. Later sign-ins ask for the current authenticator code. Incorrect codes stay on the verification screen. Canceling first setup removes only that new, still-unverified factor.

Existing owner sessions that have not completed MFA lose privileged access when enforcement is deployed. They can open Team sign in to complete setup. A reserved first owner can claim the designated verified email role and enroll; that claim does not grant privileged access before verification.

## Lost authenticator

If a securely saved setup key is available, add it to a replacement authenticator and sign in normally. If it is unavailable:

1. The Supabase project administrator verifies the owner's identity through a previously established channel. An incoming email alone is insufficient.
2. The administrator lists the factors for that specific Auth user and removes the lost factor through the trusted server-side Supabase Auth Admin API, `auth.admin.mfa.deleteFactor({userId, id})`. Keep server credentials outside the website and browser. Confirm both identifiers before deletion; do not remove another owner's factor.
3. Explicitly revoke all sessions with Supabase's global sign-out operation and verify the old refresh tokens no longer work. **Do not rely on factor deletion alone:** although the reference documentation describes session logout, the live test on this project instead left sessions downgraded to AAL1 with no factor. Global sign-out is a separate required recovery step. The owner can perform it from a newly authenticated recovery session (`auth.signOut({scope:'global'})`), or the trusted administrator can use `auth.admin.signOut(userAccessToken, 'global')` without exposing that token. If there is no usable session, use the project's supported administrator session-revocation control before continuing.
4. The owner signs in again, enrolls a replacement authenticator, saves its setup key, and verifies a code. Confirm Admin and a private authorized operation work, and confirm the old session no longer does. The Elio server independently checks the current session AAL and verified factor, so even an old unexpired token claiming AAL2 loses owner privileges immediately after the reset.

A password reset does not bypass MFA. Do not change the owner role to staff, disable database checks, or share an owner session as a recovery workaround. Elio currently supports TOTP authenticators; another pre-existing second-factor type requires administrator assistance.

## Enforcement and release checks

The database requires the caller's signed `aal2` claim, matching current `auth.sessions` record, unexpired session, and verified factor belonging to the same user. Browser metadata and submitted role/AAL fields do not grant privileges. Interactive Edge functions re-check `account_access` with the user's token before invoking their service role operations. Scheduled workers retain their separate authenticated service boundary.

Deploy the sign-in UI before the MFA migration. Then deploy every Edge function importing `_shared/http.ts`. Verify a password-only owner cannot open Admin, request private proof URLs, or insert owner photos; verify a completed authenticator challenge grants authorized access. Never capture a real owner's QR code, setup key, token or password in screenshots or reports.

Automated tests cover database AAL1 denial, valid AAL2, revoked/expired/wrong-user sessions, removed/unverified factors, first-owner enrollment, customer-safe order access, photo policies, shared Edge checks and browser setup/retry/cancel/sign-out flows. Browser Auth SDK responses in the isolated tests are simulated. A hosted authenticator enrollment and administrator factor reset are separate operational checks; do not describe isolated tests as a completed production recovery drill.

References checked 2026-10-03: [Supabase TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp), [Admin factor deletion](https://supabase.com/docs/reference/javascript/auth-admin-deletefactor), [global sign-out](https://supabase.com/docs/reference/javascript/auth-signout). The live project's observed session behavior takes precedence over assuming the documented factor-deletion side effect.
