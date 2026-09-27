# Google sign-in branding

The live Google OAuth client is `829187116245-44vj1bjb4ptcnk9i142as5ijg4apl8ih.apps.googleusercontent.com` (project number `829187116245`). The existing callback is `https://dzxyhckkkrzqpwpavngn.supabase.co/auth/v1/callback`. Keep it unchanged.

Once the website release is live, open [Google Auth Platform → Branding](https://console.cloud.google.com/auth/branding?project=829187116245) using the Google account that owns this OAuth project. If the project selector does not resolve a number, select the project containing the client ID above under Clients.

| Field | Value |
| --- | --- |
| App name | Elio Cheesecakes |
| Support email | elio.cheesecakes@gmail.com, if available for the signed-in project owner |
| App homepage | https://eliocheesecakes.com/ |
| Privacy policy | https://eliocheesecakes.com/privacy.html |
| Terms of service | https://eliocheesecakes.com/terms.html |
| Authorized business domain | eliocheesecakes.com |
| Developer contact | elio.cheesecakes@gmail.com |

Use the existing `dist/assets/elio-favicon.png` if adding an app icon. It is Elio’s square PNG mark, well below Google's 1 MB limit. The larger original logo exceeds that limit.

Save the branding, verify the business domain through Google Search Console if requested, and select **Verify Branding**. When its status is **Ready to publish**, select **Publish branding**. A saved draft alone does not update the sign-in screen. Do not change OAuth redirect URLs or remove existing authorized callback domains to change the displayed name.

The connected tools cannot edit this Google Cloud configuration. Verification and publication must be completed in the project owner's dashboard. A custom Supabase authentication domain is a separate paid alternative; no paid add-on has been enabled.

Sources: [Google branding requirements](https://support.google.com/cloud/answer/15549049?hl=en), [Supabase Google sign-in guide](https://supabase.com/docs/guides/auth/social-login/auth-google).
