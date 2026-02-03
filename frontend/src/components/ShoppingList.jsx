import { useState, useEffect } from 'react'
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

  if (!householdId) {
    return (
      <div className="card p-6">
        <p className="text-gray-600">Join a household to see your shopping list.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </div>
    )
  }

  const purchasedItems = items.filter(item => item.is_purchased)
  const unpurchasedItems = items.filter(item => !item.is_purchased)

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Shopping List</h2>
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
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg mb-2">All ingredients available!</p>
          <p className="text-gray-500 text-sm">
            Your pantry has everything needed for your meal plan.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Unpurchased Items */}
          {unpurchasedItems.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-2">To Buy</h3>
              <ul className="space-y-2">
                {unpurchasedItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => handleMarkPurchased(item.id)}
                          className="w-5 h-5"
                        />
                        <span className="font-medium">{item.ingredient_name}</span>
                        {item.quantity && (
                          <span className="text-gray-600">
                            {item.quantity} {item.unit || ''}
                          </span>
                        )}
                      </div>
                      {item.needed_for_recipe && (
                        <p className="text-sm text-gray-500 mt-1 ml-7">
                          For: {item.needed_for_recipe}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Purchased Items */}
          {includePurchased && purchasedItems.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-2 text-gray-500">Purchased</h3>
              <ul className="space-y-2">
                {purchasedItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-green-50 rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={true}
                          onChange={() => handleMarkPurchased(item.id)}
                          className="w-5 h-5"
                        />
                        <span className="font-medium line-through text-gray-500">
                          {item.ingredient_name}
                        </span>
                        {item.quantity && (
                          <span className="text-gray-500 line-through">
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
