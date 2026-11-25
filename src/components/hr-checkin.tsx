import { Building2, House, LogOut } from "lucide-react";
import { checkInAction, checkOutAction } from "@/app/hr-actions";
import { ActivityTracker } from "@/components/hr-forms";
import { PendingButton } from "@/components/settings-forms";
import { buttonClass, cn } from "@/components/ui";
import { HrNotReady } from "@/lib/hr/store";
import { attendance, findPerson, hrContext, personBalances } from "@/lib/hr/service";
import { can, type Access } from "@/lib/rbac";

/**
 * Top of every page for tracked teammates: the morning check-in prompt (until they check in,
 * punch the fingerprint machine, or are off), a "working from home · check out" bar, and the
 * app-time tracker. Renders nothing for untracked people or before migration 0009 runs.
 */
export async function HrBar({ access }: { access: Access }) {
  if (!can(access, "hr.self")) return null;
  try {
    const ctx = await hrContext();
    const p = await findPerson(ctx, access.email);
    if (!p?.tracked) return null;
    const [row] = await attendance(ctx, ctx.today, ctx.today, [p]);
    const tracker = <ActivityTracker idleMinutes={ctx.policy.idleMinutes} />;
    const ci = row.checkIn;

    if (ci?.mode === "wfh" && !ci.checkedOutAt) {
      return (
        <>
          {tracker}
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-ink-2">
            <House className="size-4 text-info" strokeWidth={1.75} />
            <span>
              Working from home since <b className="text-ink">{row.result.firstIn}</b>
            </span>
            <form action={checkOutAction} className="ml-auto">
              <PendingButton pendingText="Checking out…" className={cn(buttonClass.secondary, buttonClass.small)}>
                <LogOut />
                Check out
              </PendingButton>
            </form>
          </div>
        </>
      );
    }
    if (ci || row.result.status !== "not_in_yet") return tracker;

    const b = await personBalances(ctx, p);
    const first = p.name.split(" ")[0];
    return (
      <>
        {tracker}
        <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-brand/40 bg-brand-soft px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-ink">Good {Number(ctx.nowTime.slice(0, 2)) < 12 ? "morning" : "day"}, {first}. Check in for today.</div>
            <div className="mt-0.5 text-xs text-muted">
              At the office? Your fingerprint punch counts too. Working from home uses one of your {b.wfh.allowed} WFH days this month ({b.wfh.left} left).
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={checkInAction}>
              <input type="hidden" name="mode" value="office" />
              <PendingButton pendingText="Checking in…" className={buttonClass.primary}>
                <Building2 />
                I&apos;m at the office
              </PendingButton>
            </form>
            <form action={checkInAction}>
              <input type="hidden" name="mode" value="wfh" />
              <PendingButton pendingText="Checking in…" className={buttonClass.secondary}>
                <House />
                Working from home
              </PendingButton>
            </form>
          </div>
        </div>
      </>
    );
  } catch (e) {
    // Never break the app over HR: before migration 0009, or if HR data can't be read, show nothing.
    if (!(e instanceof HrNotReady)) console.error("HR bar failed", e);
    return null;
  }
}
