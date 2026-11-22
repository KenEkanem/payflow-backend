import type { Storage } from "./store/types.ts";

export interface ActivePlanSubscriber {
  plan_id: number;
  subscriber: string;
  status: string;
}

/** Keep the distinct active subscriber projection in step with mandate state. */
export async function updateActivePlanSubscriber(
  storage: Storage,
  before: ActivePlanSubscriber | undefined,
  after: ActivePlanSubscriber | undefined,
): Promise<void> {
  const wasActive = before?.status === "Active";
  const isActive = after?.status === "Active";
  const sameSubscriber = before?.plan_id === after?.plan_id && before?.subscriber === after?.subscriber;
  if (sameSubscriber && wasActive === isActive) return;

  if (wasActive && before) {
    const membership = await storage.get<{ mandate_count: number }>(
      `UPDATE plan_active_subscribers
          SET mandate_count = mandate_count - 1
        WHERE plan_id = ? AND subscriber = ?
      RETURNING mandate_count`,
      [before.plan_id, before.subscriber],
    );
    if (membership?.mandate_count === 0) {
      const removed = await storage.get<{ plan_id: number }>(
        `DELETE FROM plan_active_subscribers
          WHERE plan_id = ? AND subscriber = ? AND mandate_count = 0
        RETURNING plan_id`,
        [before.plan_id, before.subscriber],
      );
      if (removed) {
        await storage.run(
          "UPDATE plan_subscriber_counts SET active_subscribers = active_subscribers - 1 WHERE plan_id = ?",
          [before.plan_id],
        );
      }
    }
  }

  if (isActive && after) {
    const membership = await storage.get<{ mandate_count: number }>(
      `INSERT INTO plan_active_subscribers (plan_id, subscriber, mandate_count) VALUES (?, ?, 1)
       ON CONFLICT(plan_id, subscriber) DO UPDATE
         SET mandate_count = plan_active_subscribers.mandate_count + 1
       RETURNING mandate_count`,
      [after.plan_id, after.subscriber],
    );
    if (membership?.mandate_count === 1) {
      await storage.run(
        `INSERT INTO plan_subscriber_counts (plan_id, active_subscribers) VALUES (?, 1)
         ON CONFLICT(plan_id) DO UPDATE SET active_subscribers = active_subscribers + 1`,
        [after.plan_id],
      );
    }
  }
}
