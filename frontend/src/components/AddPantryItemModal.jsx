import { useState } from 'react'
import AdaptiveModal from './AdaptiveModal'

const CATEGORIES = [
  'BAKED GOODS',
  'DELI',
  'GROCERY',
  'MEAT',
  'PRODUCE',
  'REFRIG/FROZEN',
  'SEAFOOD',
  'HEALTH & BEAUTY',
  'HOUSEHOLD',
  'Other'
]

const UNITS = [
  { value: 'count', label: 'Count' },
  { value: 'lb', label: 'Pounds (lb)' },
  { value: 'oz', label: 'Ounces (oz)' },
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'g', label: 'Grams (g)' },
  { value: 'cup', label: 'Cups' },
  { value: 'tbsp', label: 'Tablespoons' },
  { value: 'tsp', label: 'Teaspoons' },
  { value: 'ml', label: 'Milliliters (ml)' },
  { value: 'l', label: 'Liters (l)' },
]

function AddPantryItemModal({ isOpen, onClose, onAdd }) {
  const [formData, setFormData] = useState({
    base_ingredient: '',
    variant: '',
    name: '',
    quantity: '',
    unit: 'count',
    category: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    
    // Auto-generate name if base_ingredient changes
    if (name === 'base_ingredient' || name === 'variant') {
      const base = name === 'base_ingredient' ? value : formData.base_ingredient
      const variant = name === 'variant' ? value : formData.variant
      setFormData(prev => ({
        ...prev,
        name: variant ? `${base} (${variant})` : base
      }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    // Validate
    if (!formData.base_ingredient.trim()) {
      setError('Ingredient name is required')
      return
    }
    if (!formData.quantity || parseFloat(formData.quantity) <= 0) {
      setError('Quantity must be greater than 0')
      return
    }

    setIsSubmitting(true)
    try {
      await onAdd({
        base_ingredient: formData.base_ingredient.trim().toLowerCase(),
        variant: formData.variant.trim() || null,
        name: formData.name.trim() || formData.base_ingredient.trim(),
        quantity: parseFloat(formData.quantity),
        unit: formData.unit,
        category: formData.category || null
      })
      
      // Reset form
      setFormData({
        base_ingredient: '',
        variant: '',
        name: '',
        quantity: '',
        unit: 'count',
        category: ''
      })
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add item')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AdaptiveModal isOpen={isOpen} onClose={onClose} title="Add Pantry Item">
      <form onSubmit={handleSubmit}>
        <div className="px-4 pt-2 pb-4 sm:px-6 sm:pb-4">
          {error && (
                <div className="mb-4 p-3 border border-[var(--color-error)] rounded-mise-md text-[var(--color-error)] bg-[var(--color-error)]/10 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {/* Base Ingredient */}
                <div>
                  <label htmlFor="base_ingredient" className="block text-sm font-medium text-gray-700 mb-1">
                    Ingredient Name *
                  </label>
                  <input
                    type="text"
                    id="base_ingredient"
                    name="base_ingredient"
                    value={formData.base_ingredient}
                    onChange={handleChange}
                    placeholder="e.g., butter, milk, eggs"
                    className="input"
                    required
                  />
                </div>

                {/* Variant */}
                <div>
                  <label htmlFor="variant" className="block text-sm font-medium text-sage-light mb-1">
                    Variant (optional)
                  </label>
                  <input
                    type="text"
                    id="variant"
                    name="variant"
                    value={formData.variant}
                    onChange={handleChange}
                    placeholder="e.g., unsalted, whole, organic"
                    className="input"
                  />
                  <p className="mt-1 text-xs text-sage-light">
                    Different variants are tracked separately (e.g., salted vs unsalted butter)
                  </p>
                </div>

                {/* Quantity and Unit */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="quantity" className="block text-sm font-medium text-sage-light mb-1">
                      Quantity *
                    </label>
                    <input
                      type="number"
                      id="quantity"
                      name="quantity"
                      value={formData.quantity}
                      onChange={handleChange}
                      placeholder="0"
                      step="0.1"
                      min="0"
                      className="input"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="unit" className="block text-sm font-medium text-sage-light mb-1">
                      Unit *
                    </label>
                    <select
                      id="unit"
                      name="unit"
                      value={formData.unit}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                      {UNITS.map(unit => (
                        <option key={unit.value} value={unit.value}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label htmlFor="category" className="block text-sm font-medium text-sage-light mb-1">
                    Category (optional)
                  </label>
                  <select
                    id="category"
                    name="category"
                    value={formData.category}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">Select a category...</option>
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>
        </div>

        <div className="bg-forest px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto btn btn-primary"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-cream"></div>
                Adding...
              </span>
            ) : (
              'Add Item'
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-full sm:w-auto btn btn-ghost mt-3 sm:mt-0"
          >
            Cancel
          </button>
        </div>
      </form>
    </AdaptiveModal>
  )
}

export default AddPantryItemModal
