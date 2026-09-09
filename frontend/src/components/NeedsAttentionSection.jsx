import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { subscribe, PROVIDER_LABELS } from '../services/providerAttentionStore';

/**
 * Dashboard block for persisted reconnect attention items. Hidden when empty.
 */
export default function NeedsAttentionSection() {
  const [items, setItems] = useState({});
  /** @type {[Record<string, number>, React.Dispatch<React.SetStateAction<Record<string, number>>>]} */
  const [sessionDismissedAt, setSessionDismissedAt] = useState({});

  useEffect(() => {
    return subscribe(setItems);
  }, []);

  const visibleProviders = Object.keys(items).filter((provider) => {
    const item = items[provider];
    if (item?.kind !== 'needs_reconnect') return false;
    const dismissedAt = sessionDismissedAt[provider];
    return dismissedAt === undefined || dismissedAt < item.updatedAt;
  });

  if (visibleProviders.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="needs-attention-heading"
      className="mb-8 rounded-meald-lg border border-[var(--color-warning)]/40 bg-forest-light p-5"
    >
      <h2 id="needs-attention-heading" className="text-cream font-display font-semibold mb-3">
        Needs attention
      </h2>
      <ul className="space-y-3">
        {visibleProviders.map((provider) => {
          const label = PROVIDER_LABELS[provider] ?? provider;
          return (
            <li
              key={provider}
              className="flex items-start justify-between gap-3 rounded-meald-md border border-forest-mid/60 bg-forest px-4 py-3"
            >
              <p className="text-sm text-cream flex-1 min-w-0">
                {label} needs reconnect to keep your pantry up to date.
              </p>
              <div className="flex gap-2 shrink-0">
                <Link to="/providers" className="btn btn-primary text-sm py-1 px-3">
                  Reconnect
                </Link>
                <button
                  type="button"
                  aria-label={`Dismiss ${label} reconnect reminder`}
                  onClick={() =>
                    setSessionDismissedAt((prev) => ({
                      ...prev,
                      [provider]: Date.now(),
                    }))
                  }
                  className="btn btn-ghost text-sm p-1"
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
