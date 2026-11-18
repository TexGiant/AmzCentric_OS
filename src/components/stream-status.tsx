import { subscribeStream } from "@/app/settings-actions";
import { PendingButton } from "@/components/settings-forms";
import { Pill, buttonClass, cn } from "@/components/ui";
import type { AdsAccount } from "@/lib/amazon/ads";
import { AdsApiError } from "@/lib/amazon/ads";
import { isLive, listStreamSubscriptions, STREAM_DATASETS, type StreamSubscription } from "@/lib/amazon/stream";

type Destinations = Record<(typeof STREAM_DATASETS)[number], string | null>;

/** One profile's Stream subscription status (sp-traffic + sp-conversion) with a Subscribe button. */
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
      <td className="px-4 py-3 text-xs font-semibold text-bad" colSpan={3}>
        Couldn&apos;t check subscriptions ({msg})
      </td>
    );
  }

  let missing = 0;
  const cells = STREAM_DATASETS.map((dataset) => {
    const arn = destinations[dataset];
    const mine = subs.find((s) => s.dataSetId === dataset && s.destinationArn === arn && isLive(s));
    const elsewhere = subs.find((s) => s.dataSetId === dataset && s.destinationArn !== arn && isLive(s));
    if (!arn) return <Pill key={dataset}>No queue set</Pill>;
    if (mine) {
      const status = (mine.status ?? "ACTIVE").toUpperCase();
      return (
        <Pill key={dataset} tone={status === "ACTIVE" ? "good" : "warn"} dot>
          {status === "ACTIVE" ? "Active" : status.replaceAll("_", " ").toLowerCase()}
        </Pill>
      );
    }
    missing++;
    return elsewhere ? (
      <Pill key={dataset} tone="warn" dot>
        Other queue
      </Pill>
    ) : (
      <Pill key={dataset} tone="bad" dot>
        Not subscribed
      </Pill>
    );
  });

  return (
    <>
      <td className="px-4 py-3">{cells[0]}</td>
      <td className="px-4 py-3">{cells[1]}</td>
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
