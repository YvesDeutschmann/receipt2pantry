function IngredientCorrection({
  itemId,
  ingredientName,
  onCorrection,
  onDismiss,
}) {
  if (itemId == null || itemId === '') {
    return null
  }

  const handle = async (action) => {
    await Promise.resolve(onCorrection(itemId, action))
    onDismiss?.()
  }

  return (
    <div className="mt-2 pl-2 border-l-2 border-forest-light space-y-2">
      {ingredientName ? (
        <p className="text-sm text-cream font-medium">{ingredientName}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-sage/30 text-sage-light hover:bg-forest-light"
          onClick={() => void handle('still_have_it')}
        >
          Still have it
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-sage/30 text-sage-light hover:bg-forest-light"
          onClick={() => void handle('used_it_up')}
        >
          Used it up
        </button>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-sage/30 text-sage-light hover:bg-forest-light"
          onClick={() => void handle('never_had_it')}
        >
          Never had it
        </button>
      </div>
    </div>
  )
}

export default IngredientCorrection
