import { useState } from 'react'
import PantryItem from './PantryItem'

function PantryList({ groupedItems, onUpdateQuantity, onDeleteItem }) {
  const [expandedGroups, setExpandedGroups] = useState(
    // Expand all groups by default
    new Set(groupedItems.map(g => g.base_ingredient))
  )

  const toggleGroup = (baseIngredient) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(baseIngredient)) {
        next.delete(baseIngredient)
      } else {
        next.add(baseIngredient)
      }
      return next
    })
  }

  const expandAll = () => {
    setExpandedGroups(new Set(groupedItems.map(g => g.base_ingredient)))
  }

  const collapseAll = () => {
    setExpandedGroups(new Set())
  }

  // Group items by category first, then by base_ingredient
  const groupedByCategory = groupedItems.reduce((acc, group) => {
    const category = group.variants[0]?.category || 'Other'
    if (!acc[category]) {
      acc[category] = []
    }
    acc[category].push(group)
    return acc
  }, {})

  const categories = Object.keys(groupedByCategory).sort()

  return (
    <div>
      {/* Expand/Collapse Controls */}
      <div className="flex justify-end gap-2 mb-4">
        <button
          onClick={expandAll}
          className="text-sm text-terra hover:text-terra-light"
        >
          Expand All
        </button>
        <span className="text-forest-light">|</span>
        <button
          onClick={collapseAll}
          className="text-sm text-terra hover:text-terra-light"
        >
          Collapse All
        </button>
      </div>

      {/* Category Sections */}
      <div className="space-y-6">
        {categories.map(category => (
          <div key={category}>
            {/* Category Header */}
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1 bg-gray-700 text-white text-sm font-medium rounded-full">
                {category}
              </span>
              <span className="text-sm text-gray-500">
                ({groupedByCategory[category].reduce((sum, g) => sum + g.variants.length, 0)} items)
              </span>
            </div>

            {/* Ingredient Groups */}
            <div className="space-y-2">
              {groupedByCategory[category].map(group => (
                <div 
                  key={group.base_ingredient}
                  className="border border-forest-light rounded-mise-md overflow-hidden"
                >
                  {/* Group Header */}
                  <button
                    onClick={() => toggleGroup(group.base_ingredient)}
                    className="w-full flex items-center justify-between p-3 bg-forest hover:bg-forest-light transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <svg 
                        className={`w-4 h-4 text-gray-500 transition-transform ${
                          expandedGroups.has(group.base_ingredient) ? 'rotate-90' : ''
                        }`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="font-medium text-cream capitalize">
                        {group.base_ingredient}
                      </span>
                    </div>
                    <span className="text-sm text-sage-light">
                      {group.variants.length} variant{group.variants.length !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Variants */}
                  {expandedGroups.has(group.base_ingredient) && (
                    <div className="divide-y divide-forest-light">
                      {group.variants.map(item => (
                        <PantryItem
                          key={item.id}
                          item={item}
                          onUpdateQuantity={onUpdateQuantity}
                          onDeleteItem={onDeleteItem}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default PantryList
