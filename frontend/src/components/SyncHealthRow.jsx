import { useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { subscribeHealth } from '../services/syncHealthStore';
import { SYNC_OUTCOMES } from '../services/syncOutcomeMapper';

/**
 * Muted per-store sync health line for provider cards.
 *
 * @param {object} props
 * @param {'safeway' | 'costco'} props.provider
 * @param {boolean} [props.syncInProgress]
 */
export default function SyncHealthRow({ provider, syncInProgress = false }) {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    return subscribeHealth((all) => {
      setHealth(all[provider] ?? null);
    });
  }, [provider]);

  if (syncInProgress) {
    return <p className="text-sage-light text-sm">Sync in progress</p>;
  }

  if (!health) {
    return null;
  }

  const { lastOutcome, lastAttemptAt, lastCompletedAt, receiptsStored } = health;

  if (lastOutcome === SYNC_OUTCOMES.NEEDS_RECONNECT) {
    return <p className="text-sage-light text-sm">Reconnect needed</p>;
  }

  if (lastOutcome === SYNC_OUTCOMES.FAILED) {
    const tried = formatDistanceToNowStrict(new Date(lastAttemptAt));
    return (
      <p className="text-sage-light text-sm">
        Couldn&apos;t sync · Last tried {tried} ago
      </p>
    );
  }

  if (lastOutcome === SYNC_OUTCOMES.COMPLETED_EMPTY) {
    if (lastCompletedAt == null) return null;
    const synced = formatDistanceToNowStrict(new Date(lastCompletedAt));
    return (
      <p className="text-sage-light text-sm">
        No new receipts · Last synced {synced} ago
      </p>
    );
  }

  if (lastOutcome === SYNC_OUTCOMES.COMPLETED_ITEMS) {
    if (lastCompletedAt == null) return null;
    const synced = formatDistanceToNowStrict(new Date(lastCompletedAt));
    const noun = receiptsStored === 1 ? 'receipt' : 'receipts';
    return (
      <p className="text-sage-light text-sm">
        Synced {receiptsStored} {noun} · Last synced {synced} ago
      </p>
    );
  }

  return null;
}
