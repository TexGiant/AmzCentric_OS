# HR bot

The HR Grok bot works the leave queue and reports attendance to Zain, using the AmzCentric OS HR API.
- **It can:** read requests and attendance, approve requests that fit the leave policy, and send everything else to Zain with a reason.
- **It can't:** decline, change settings, or see anything else in the app.

Zain decides escalated requests on the **HR** page (Leave requests tab).

## Setup (once)

1. **Token.** In PowerShell:
   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) | Set-Clipboard
   ```
   Add it in Vercel as `HR_API_TOKEN` (Production) and **Redeploy**. Put the same value in the bot's secret settings on Zain's computer. Don't paste it into a chat, email or this file.
2. **Policy.** Check it in **Settings → HR**: office hours, working days, holidays, allowances and notice. The bot follows whatever is set there, because the app checks every approval against it.
3. **People.** In Settings → HR, for each person:
   - their fingerprint **Machine ID**
   - the leave they already took this year (from the old Google Sheet), so balances start right
4. **Schedule.** All times are Pakistan time.
   - **Every 2 hours, 09:00–19:00, Mon–Fri:** work the queue.
   - **11:00, Mon–Fri:** morning attendance note.
   - **19:30, Mon–Fri:** end-of-day report to Zain.
   - **1st of each month, 10:00:** monthly report to Zain.

## Work the queue

```bash
curl -s -H "Authorization: Bearer $HR_API_TOKEN" "https://os.amzcentric.com/api/hr/bot/requests?status=pending"
```

For each request:
- `policy.within_policy` is **true**: approve it.
  ```bash
  curl -s -X POST -H "Authorization: Bearer $HR_API_TOKEN" -H "Content-Type: application/json" \
    -d '{"action":"approve","note":"Within policy."}' \
    "https://os.amzcentric.com/api/hr/bot/requests/<id>"
  ```
- `policy.within_policy` is **false**: escalate it to Zain. In `note`, give the reason from `policy.problems` in one plain sentence.
  ```bash
  curl -s -X POST -H "Authorization: Bearer $HR_API_TOKEN" -H "Content-Type: application/json" \
    -d '{"action":"escalate","note":"Annual leave needs 3 days notice; asked 1 day ahead."}' \
    "https://os.amzcentric.com/api/hr/bot/requests/<id>"
  ```
- `policy.notes` says a medical note may be needed (sick leave longer than 2 days): approve, and remind the person to bring a note.

The app checks the policy again on approve. If the request no longer fits (for example, another request used the last day), approving returns `409` with `"error": "outside_policy"`, and the bot should escalate it instead. `409` with another error means someone already decided it, so skip it.

## Reports

**Day board:** `GET /api/hr/bot/day` (today) or `?date=YYYY-MM-DD`.
```bash
curl -s -H "Authorization: Bearer $HR_API_TOKEN" "https://os.amzcentric.com/api/hr/bot/day"
```
- **Totals:** office, WFH, on leave, absent, not in yet, late.
- **Requests waiting:** for HR, and for Zain.
- **Per person:** status, first in, last out, hours in, late by, leave, app time, and `flags` (things to check, e.g. "Only one punch (no punch out)", "WFH not approved (yet)", "Checked in as Office in the app, no fingerprint punch").

**Month:** `GET /api/hr/bot/month` (this month) or `?month=YYYY-MM`. Per person:
- office, WFH, leave, absent and late days
- average arrival and hours in
- app time
- leave balances (allowed / used / left)

## Messages

**11:00 attendance note** (to Zain, only if something needs attention):
```text
Attendance 11:00 — <date>
Not in yet: <names> (no punch, no check-in, no leave)
Late: <name> 09:42 (+27 min)
Waiting for you: <n> leave request(s) — HR page → Leave requests
```

**19:30 end of day** (to Zain):
```text
Today <date>: <office> office · <wfh> WFH · <leave> on leave · <absent> absent · <late> late
Flags: <name>: <flag> (one line each, skip if none)
Approved today: <name> <type> <dates> …
Escalated to you: <name> <type> <dates> — <reason> …
App time: <name> <app_time> · … (lowest first)
```

**Monthly** (1st of the month, for the month before):
```text
<Month> attendance
<name>: <office> office, <wfh> WFH, <leave> leave, <absent> absent, <late> late, avg in <avg>, app <app_time>; leave left: sick <n>, casual <n>, annual <n>
…
```

## Rules for the bot (paste into its instructions)

```text
You are AmzCentric's HR assistant. You use the AmzCentric OS HR API with the HR_API_TOKEN.
Approve a leave request only when policy.within_policy is true. Otherwise escalate it with a
one-sentence reason taken from policy.problems. Never approve anything the API refuses.
You never decline: only Zain declines, on the HR page.
Report facts from the API only: names, times and numbers exactly as returned. Never guess why
someone is late or absent, and never share one person's leave reasons or attendance with other
employees. Reports go to Zain only.
App time is time active in AmzCentric OS only; say "app time", not "work time".
If the API returns 401 or 503, tell Zain the HR token isn't working and stop. On 5xx, retry once
after 10 minutes, then tell Zain.
```
