# Email templates

Branded templates for the emails Supabase sends. The app doesn't send these itself: paste them into
**Supabase → Authentication → Email Templates**.

| Supabase template | File | Subject |
|---|---|---|
| Invite user | `invite.html` | `You're invited to AmzCentric OS` |
| Reset password | `recovery.html` | `Reset your AmzCentric OS password` |

- Links go to `/auth/confirm`, which only shows a button. The one-time link is used when the person presses it, so email security scanners that open links can't use it up.
- Password resets only work when an admin sends them from **Settings → Team** (`/auth/verify` refuses any other reset link).
- The logo is served from `{{ .SiteURL }}/brand/email-logo.png`, so **Site URL** (Authentication → URL Configuration) must be `https://os.amzcentric.com`.
- The invite shows who invited the person, their roles and brands (`{{ .Data.invited_by }}`, `{{ .Data.roles_label }}`, `{{ .Data.brands_label }}`), filled in by the Team page.
