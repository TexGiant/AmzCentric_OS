import { removeHolidayAction } from "@/app/hr-actions";
import { HolidayForm, PersonForm, PolicyForm, PunchUploadForm } from "@/components/hr-forms";
import { NotReady } from "@/components/hr-views";
import { PendingButton } from "@/components/settings-forms";
import { Card, CardHeader, PageHeader, Pill, buttonClass } from "@/components/ui";
import { requirePerm } from "@/lib/access";
import { addDays, shortDate } from "@/lib/dates";
import { isDemoMode } from "@/lib/env";
import { hrContext, listPeople, type HrCtx } from "@/lib/hr/service";
import { HrNotReady } from "@/lib/hr/store";

export const metadata = { title: "HR settings" };

export default async function HrSettingsPage() {
  await requirePerm("hr.manage");
  let ctx: HrCtx;
  try {
    ctx = await hrContext();
  } catch (e) {
    if (e instanceof HrNotReady) return (<><PageHeader eyebrow="Settings" title="HR" /><NotReady /></>);
    throw e;
  }
  const [people, deviceUsers, recent] = await Promise.all([listPeople(ctx), ctx.store.listDeviceUsers(), ctx.store.listPunches(addDays(ctx.today, -6), ctx.today)]);
  const lastPunch = recent.map((p) => `${p.date} ${p.time.slice(0, 5)}`).sort().at(-1) ?? null;
  const year = ctx.today.slice(0, 4);
  const mapped = new Set(people.map((p) => p.deviceUserId).filter(Boolean));
  const unmatched = deviceUsers.filter((d) => !mapped.has(d.deviceUserId));
  const bridgeReady = !!process.env.ATTENDANCE_TOKEN;
  const botReady = !!process.env.HR_API_TOKEN;

  return (
    <>
      <PageHeader eyebrow="Settings" title="HR" subtitle="Leave policy, office hours, holidays, and who is tracked. Leave decisions happen on the HR page." />

      <Card>
        <CardHeader title="Policy" sub="The HR bot approves a request on its own only when it fits these rules. Anything else comes to you." />
        <PolicyForm policy={ctx.policy} />
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="People"
          sub={`Machine ID = the user number on the fingerprint machine. "Taken before the app" = leave already used in ${year} from the old sheet, so balances start right. Untick Track for people whose attendance and app time shouldn't be recorded (admins are off by default).`}
        />
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li key={p.email}>
              <PersonForm
                email={p.email}
                name={p.name}
                displayName={p.displayName}
                deviceUserId={p.deviceUserId}
                tracked={p.tracked}
                opening={p.opening}
                deviceUsers={deviceUsers.map((d) => ({ id: d.deviceUserId, name: d.name }))}
                year={year}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Fingerprint machine" sub="Office punches reach the app from the bridge script on an office PC, or by uploading the machine's USB export." />
        <div className="flex flex-wrap gap-x-8 gap-y-2 px-6 pt-5 text-sm">
          <div>
            Bridge token (<code>ATTENDANCE_TOKEN</code>): {bridgeReady ? <Pill tone="good" dot>set</Pill> : <Pill tone="warn" dot>not set in Vercel</Pill>}
          </div>
          <div>
            Last punch received (7 days): <b className="text-ink">{lastPunch ?? "none"}</b>
          </div>
          <div>
            HR bot token (<code>HR_API_TOKEN</code>): {botReady ? <Pill tone="good" dot>set</Pill> : <Pill tone="warn" dot>not set in Vercel</Pill>}
          </div>
        </div>
        {unmatched.length > 0 && (
          <p className="mx-6 mt-3 rounded-lg bg-gold-100 px-3 py-2 text-xs font-semibold text-gold-800">
            On the machine but not matched to anyone: {unmatched.map((d) => `${d.deviceUserId}${d.name ? ` (${d.name})` : ""}`).join(", ")}. Put the number in that person&apos;s Machine ID above.
          </p>
        )}
        <PunchUploadForm />
      </Card>

      <Card className="mt-4">
        <CardHeader title="Holidays" sub="No one is expected in, and leave over a holiday doesn't use any days." />
        <HolidayForm />
        <ul className="divide-y divide-line border-t border-line">
          {ctx.holidays.filter((h) => h.day >= `${year}-01-01`).map((h) => (
            <li key={h.day} className="flex items-center gap-3 px-6 py-2.5 text-sm">
              <span className="w-28 font-semibold text-ink tabular">{shortDate(h.day)} {h.day.slice(0, 4)}</span>
              <span className="flex-1 text-ink-2">{h.name}</span>
              <form action={removeHolidayAction}>
                <input type="hidden" name="day" value={h.day} />
                <PendingButton pendingText="Removing…" className={buttonClass.danger}>
                  Remove
                </PendingButton>
              </form>
            </li>
          ))}
          {!ctx.holidays.some((h) => h.day >= `${year}-01-01`) && <li className="px-6 py-4 text-sm text-muted">No holidays added for {year}.</li>}
        </ul>
      </Card>
      {isDemoMode() && <p className="mt-3 text-xs text-muted">Demo mode: changes last until the server restarts.</p>}
    </>
  );
}
