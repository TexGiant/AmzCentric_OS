import { subscribeStream } from "@/app/settings-actions";
import { PendingButton } from "@/components/settings-forms";
import { Pill, buttonClass, cn } from "@/components/ui";
import type { AdsAccount } from "@/lib/amazon/ads";
import { AdsApiError } from "@/lib/amazon/ads";
import { isLive, listStreamSubscriptions, type StreamDataset, type StreamSubscription } from "@/lib/amazon/stream";

export type Destinations = Record<StreamDataset, string | null>;

export const AD_TYPES = [
  { key: "SP", label: "Sponsored Products", datasets: ["sp-traffic", "sp-conversion"] },
  { key: "SB", label: "Sponsored Brands", datasets: ["sb-traffic", "sb-conversion"] },
  { key: "SD", label: "Sponsored Display", datasets: ["sd-traffic", "sd-conversion"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; datasets: readonly StreamDataset[] }>;

/** One profile's Stream subscription status per ad type, with a Subscribe button for anything missing. */
export async function StreamStatusCells({
  account,
  profileId,
  destinations,
}: {
  account: AdsAccount;
  profileId: string;
  destinations: Destinations;
}) {
  let subs: StreamSubscription[] = [];
  try {
    subs = await listStreamSubscriptions(account, profileId);
  } catch (err) {
    const msg = err instanceof AdsApiError ? `${err.status}: ${err.body.slice(0, 160)}` : String(err).slice(0, 160);
    return (
      <td className="px-4 py-3 text-xs font-semibold text-bad" colSpan={AD_TYPES.length + 1}>
        Couldn&apos;t check subscriptions ({msg})
      </td>
    );
  }

  let missing = 0;
  const cells = AD_TYPES.map((t) => {
    const configured = t.datasets.filter((d) => destinations[d]);
    if (configured.length === 0) return <span className="text-xs text-faint">No queue</span>;
    const states = configured.map((d) => {
      const mine = subs.find((s) => s.dataSetId === d && s.destinationArn === destinations[d] && isLive(s));
      if (!mine) missing++;
      return { d, status: mine ? (mine.status ?? "ACTIVE").toUpperCase() : null };
    });
    const detail = states.map((s) => `${s.d}: ${s.status ?? "not subscribed"}`).join(" · ");
    const live = states.filter((s) => s.status);
    if (live.length === 0)
      return (
        <span title={detail}>
          <Pill tone="bad" dot>
            Not subscribed
          </Pill>
        </span>
      );
    const allActive = live.length === states.length && live.every((s) => s.status === "ACTIVE");
    const incomplete = live.length < states.length || configured.length < t.datasets.length;
    return (
      <span title={detail}>
        <Pill tone={allActive && !incomplete ? "good" : "warn"} dot>
          {allActive ? (incomplete ? "Partial" : "Active") : "Pending"}
        </Pill>
      </span>
    );
  });

  return (
    <>
      {cells.map((c, i) => (
        <td key={AD_TYPES[i].key} className="px-4 py-3">
          {c}
        </td>
      ))}
      <td className="py-3 pr-6 pl-4 text-right">
        {missing > 0 && (
          <form action={subscribeStream}>
            <input type="hidden" name="profile_id" value={profileId} />
            <PendingButton pendingText="Subscribing…" className={cn(buttonClass.primary, buttonClass.small)}>
              Subscribe
            </PendingButton>
          </form>
        )}
      </td>
    </>
  );
}
