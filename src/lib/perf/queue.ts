/**
 * The buffer between a measurement and the network (ADR-0072).
 *
 * The whole reason telemetry is allowed near a navigation is that it costs
 * nothing at the moment of the navigation: a number is pushed onto an array,
 * and the array is sent later, in one request, never while anybody is waiting.
 *
 * BOUNDED, ON PURPOSE
 *
 * If delivery fails — a flaky mobile connection, a tab that has been asleep —
 * the queue does not grow until the tab runs out of memory. It keeps the most
 * recent samples and drops the oldest, because a run that lost its first
 * minute is still a useful run, and one that crashed the browser is not.
 *
 * NO RETRY. A failed flush puts nothing back. Retrying over a bad connection
 * is how a telemetry client becomes the performance problem it was measuring,
 * and the next flush carries whatever has accumulated since anyway.
 */
import type { Sample } from "./navigation.ts";

/** Sent as one request. Small enough to be cheap, large enough to be rare. */
export const BATCH_SIZE = 10;

/** Ten batches. Beyond this the oldest samples are dropped. */
export const MAX_QUEUED = 100;

export type Queue = {
  /** Oldest first. */
  samples: Sample[];
  /** How many were dropped because the queue was full. */
  dropped: number;
};

export function emptyQueue(): Queue {
  return { samples: [], dropped: 0 };
}

/** Adds one sample, dropping the oldest if the queue is full. */
export function enqueue(queue: Queue, sample: Sample): Queue {
  const samples = [...queue.samples, sample];
  if (samples.length <= MAX_QUEUED) return { samples, dropped: queue.dropped };
  const overflow = samples.length - MAX_QUEUED;
  return { samples: samples.slice(overflow), dropped: queue.dropped + overflow };
}

/** Whether enough has accumulated to be worth a request. */
export function shouldFlush(queue: Queue): boolean {
  return queue.samples.length >= BATCH_SIZE;
}

/**
 * What to send now, and what remains.
 *
 * Takes everything: a flush is triggered either by the batch size or by the
 * page going away, and in the second case leaving samples behind would lose
 * them entirely.
 */
export function drain(queue: Queue): { batch: Sample[]; rest: Queue } {
  return { batch: queue.samples, rest: { samples: [], dropped: queue.dropped } };
}
