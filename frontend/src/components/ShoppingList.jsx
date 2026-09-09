import { useState, useEffect, useMemo } from 'react'
import { api } from '../services/apiClient'

const ShoppingList = ({ userId, householdId }) => {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [includePurchased, setIncludePurchased] = useState(false)

  const loadShoppingList = async () => {
    if (!householdId) return
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await api.shoppingList.get(userId, includePurchased, householdId)
      setItems(result.items || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load shopping list')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (householdId) {
      loadShoppingList()
    }
  }, [householdId, includePurchased])

  const handleMarkPurchased = async (itemId) => {
    try {
      await api.shoppingList.markPurchased(itemId)
      loadShoppingList()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to mark item as purchased')
    }
  }

  const handleClearPurchased = () => {
    setIncludePurchased(false)
  }

  const purchasedItems = items.filter(item => item.is_purchased)
  const unpurchasedItems = items.filter(item => !item.is_purchased)

  const groupedUnpurchased = useMemo(() => {
    const map = new Map()
    for (const item of unpurchasedItems) {
      const key = item.needed_for_recipe?.trim() || 'General'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(item)
    }
    return map
  }, [unpurchasedItems])

  if (!householdId) {
    return (
      <div className="card p-6">
        <p className="text-sage-light">Join a household to see your shopping list.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terra"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-baseline gap-0">
          <h2 className="text-2xl font-display font-bold text-cream">Shopping List</h2>
          {unpurchasedItems.length > 0 && (
            <span className="text-sm text-sage-light ml-2">
              {unpurchasedItems.length} item{unpurchasedItems.length !== 1 ? 's' : ''} to buy
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <label className="flex items-center text-sm">
            <input
              type="checkbox"
              checked={includePurchased}
              onChange={(e) => setIncludePurchased(e.target.checked)}
              className="mr-2"
            />
            Show purchased
          </label>
          {purchasedItems.length > 0 && (
            <button
              className="btn btn-secondary text-sm"
              onClick={handleClearPurchased}
            >
              Clear Purchased
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-meald-md">
          <p className="text-[var(--color-error)]">{error}</p>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sage-light text-lg mb-2">All ingredients available!</p>
          <p className="text-sage-light/90 text-sm">
            Your pantry has everything needed for your meal plan.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Unpurchased Items */}
          {unpurchasedItems.length > 0 && (
            <div>
              <h3 className="text-lg font-display font-semibold text-cream mb-2">To Buy</h3>
              {[...groupedUnpurchased.entries()].map(([recipeName, groupItems]) => (
                <div key={recipeName}>
                  <h4 className="text-sm font-semibold text-sage-light mb-1 mt-3 first:mt-0">
                    {recipeName}
                  </h4>
                  <ul className="space-y-2">
                    {groupItems.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between p-3 bg-forest-light rounded-meald-md hover:bg-forest-light/80 transition-colors"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={false}
                              onChange={() => handleMarkPurchased(item.id)}
                              className="checkbox w-5 h-5"
                            />
                            <span className="font-medium text-cream">{item.ingredient_name}</span>
                            {item.quantity && (
                              <span className="text-sage-light">
                                {item.quantity} {item.unit || ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Purchased Items */}
          {includePurchased && purchasedItems.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-2 text-sage-light">Purchased</h3>
              <ul className="space-y-2">
                {purchasedItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-forest-light rounded-meald-md"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={true}
                          onChange={() => handleMarkPurchased(item.id)}
                          className="checkbox w-5 h-5"
                        />
                        <span className="font-medium line-through text-sage-light">
                          {item.ingredient_name}
                        </span>
                        {item.quantity && (
                          <span className="text-sage-light line-through">
                            {item.quantity} {item.unit || ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ShoppingList
