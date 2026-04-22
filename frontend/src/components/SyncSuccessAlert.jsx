/**
 * Shared success alert after a receipt sync (Costco, Safeway, real or dev mock).
 */
export default function SyncSuccessAlert({ count, itemsAddedToPantry, errors, isMock = false, className = '' }) {
  const hasItems = itemsAddedToPantry != null && itemsAddedToPantry > 0;
  return (
    <div className={`alert alert-success ${className}`}>
      <p className="font-semibold">{isMock ? 'Mock sync complete' : 'Sync complete'}</p>
      <p className="text-sm mt-1 opacity-95">
        {count} receipt{count !== 1 ? 's' : ''} synced
        {hasItems && (
          <>
            {' '}
            · {itemsAddedToPantry} item{itemsAddedToPantry !== 1 ? 's' : ''} added to pantry
          </>
        )}
      </p>
      {errors?.length > 0 && (
        <p className="text-sm mt-1 text-terra-light">Some issues: {errors.join('; ')}</p>
      )}
    </div>
  );
}
