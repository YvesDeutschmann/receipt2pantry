import { useState } from 'react'
import { Trash2, Check, X, Minus, Plus } from 'lucide-react'

function PantryItem({ item, onUpdateQuantity, onDeleteItem }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editQuantity, setEditQuantity] = useState(item.quantity)
  const [isUpdating, setIsUpdating] = useState(false)

  const handleSave = async () => {
    const newQuantity = parseFloat(editQuantity)
    if (isNaN(newQuantity) || newQuantity < 0) {
      return
    }

    setIsUpdating(true)
    try {
      await onUpdateQuantity(item.id, newQuantity)
      setIsEditing(false)
    } catch (err) {
      console.error('Failed to update:', err)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleCancel = () => {
    setEditQuantity(item.quantity)
    setIsEditing(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  // Determine if quantity is low (less than 1 for count items, less than 0.5 for weight)
  const isLowStock = item.unit === 'count' 
    ? item.quantity <= 1 
    : item.quantity <= 0.5

  // Format quantity display
  const formatQuantity = (qty, unit) => {
    if (unit === 'count') {
      return qty % 1 === 0 ? qty.toString() : qty.toFixed(1)
    }
    return `${qty.toFixed(2)} ${unit}`
  }

  return (
    <div className="flex items-center justify-between p-3 min-h-touch hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-gray-900 truncate">
            {item.normalized_name || `${item.base_ingredient}${item.variant ? ` (${item.variant})` : ''}`}
          </span>
          {isLowStock && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">
              Low Stock
            </span>
          )}
        </div>
        {item.variant && item.variant !== item.base_ingredient && (
          <span className="text-sm text-gray-500">{item.variant}</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Quantity */}
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={editQuantity}
              onChange={(e) => setEditQuantity(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-20 px-2 py-1 border border-gray-300 rounded text-right focus:ring-2 focus:ring-primary-500"
              step={item.unit === 'count' ? '1' : '0.1'}
              min="0"
              autoFocus
            />
            <span className="text-sm text-gray-500 w-12">{item.unit}</span>
            <button
              onClick={handleSave}
              disabled={isUpdating}
              className="p-1 text-green-600 hover:bg-green-50 rounded"
              title="Save"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              onClick={handleCancel}
              disabled={isUpdating}
              className="p-1 text-gray-400 hover:bg-gray-100 rounded"
              title="Cancel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
              title="Click to edit quantity"
            >
              <span className={`font-medium ${isLowStock ? 'text-amber-600' : 'text-gray-900'}`}>
                {formatQuantity(item.quantity, item.unit)}
              </span>
            </button>

            {/* Quick adjust buttons */}
            <div className="flex items-center">
              <button
                onClick={() => onUpdateQuantity(item.id, Math.max(0, item.quantity - 1))}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                title="Decrease"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>
              <button
                onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                title="Increase"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            {/* Delete button */}
            <button
              onClick={() => onDeleteItem(item.id)}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
              title="Remove item"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default PantryItem
