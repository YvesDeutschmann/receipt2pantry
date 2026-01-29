import { useState, useEffect } from 'react'
import { api } from '../services/apiClient'
import PantryList from '../components/PantryList'
import AddPantryItemModal from '../components/AddPantryItemModal'

function Pantry() {
  const [pantryData, setPantryData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [addModalOpen, setAddModalOpen] = useState(false)
  
  // For demo purposes - in production this would come from auth
  // Use a valid UUID for demo purposes (no real auth yet)
  const userId = localStorage.getItem('user_id') || '00000000-0000-0000-0000-000000000001'

  useEffect(() => {
    fetchPantry()
  }, [userId])

  const fetchPantry = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPantry(userId)
      setPantryData(data)
    } catch (err) {
      console.error('Failed to fetch pantry:', err)
      setError('Failed to load pantry. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateQuantity = async (itemId, newQuantity) => {
    try {
      await api.updatePantryItem(userId, itemId, newQuantity)
      // Refresh pantry data
      fetchPantry()
    } catch (err) {
      console.error('Failed to update item:', err)
      setError('Failed to update item quantity.')
    }
  }

  const handleDeleteItem = async (itemId) => {
    if (!confirm('Are you sure you want to remove this item?')) return
    
    try {
      await api.deletePantryItem(userId, itemId)
      fetchPantry()
    } catch (err) {
      console.error('Failed to delete item:', err)
      setError('Failed to remove item.')
    }
  }

  const handleAddItem = async (item) => {
    try {
      await api.addPantryItem(userId, item)
      setAddModalOpen(false)
      fetchPantry()
    } catch (err) {
      console.error('Failed to add item:', err)
      throw err // Let the modal handle the error
    }
  }

  // Filter items based on search
  const getFilteredData = () => {
    if (!pantryData || !searchTerm) return pantryData

    const term = searchTerm.toLowerCase()
    const filteredGrouped = pantryData.grouped
      .map(group => ({
        ...group,
        variants: group.variants.filter(v => 
          v.normalized_name?.toLowerCase().includes(term) ||
          v.base_ingredient?.toLowerCase().includes(term) ||
          v.category?.toLowerCase().includes(term)
        )
      }))
      .filter(group => group.variants.length > 0)

    return {
      ...pantryData,
      grouped: filteredGrouped,
      total_items: filteredGrouped.reduce((sum, g) => sum + g.variants.length, 0),
      unique_ingredients: filteredGrouped.length
    }
  }

  const filteredData = getFilteredData()

  return (
    <div>
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Pantry</h1>
            <p className="text-gray-600 mt-2">
              Track your ingredients and see what you have on hand.
            </p>
          </div>
          <button
            onClick={() => setAddModalOpen(true)}
            className="btn btn-primary flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Item
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {pantryData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="card">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Total Items</h3>
            <p className="text-3xl font-bold text-gray-900">{pantryData.total_items}</p>
          </div>
          <div className="card">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Unique Ingredients</h3>
            <p className="text-3xl font-bold text-gray-900">{pantryData.unique_ingredients}</p>
          </div>
          <div className="card">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Categories</h3>
            <p className="text-3xl font-bold text-gray-900">
              {new Set(pantryData.items?.map(i => i.category).filter(Boolean)).size}
            </p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <input
            type="text"
            placeholder="Search pantry..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-3 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <svg 
            className="absolute left-3 top-3.5 w-5 h-5 text-gray-400" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
          <button 
            onClick={() => setError(null)} 
            className="ml-2 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Pantry Content */}
      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : !pantryData || pantryData.total_items === 0 ? (
          <div className="text-center py-12">
            <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Your pantry is empty</h3>
            <p className="text-gray-600 mb-4">
              Add items manually or sync receipts from your grocery store.
            </p>
            <button
              onClick={() => setAddModalOpen(true)}
              className="btn btn-primary"
            >
              Add Your First Item
            </button>
          </div>
        ) : filteredData.total_items === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600">No items match your search.</p>
          </div>
        ) : (
          <PantryList
            groupedItems={filteredData.grouped}
            onUpdateQuantity={handleUpdateQuantity}
            onDeleteItem={handleDeleteItem}
          />
        )}
      </div>

      {/* Add Item Modal */}
      <AddPantryItemModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onAdd={handleAddItem}
      />
    </div>
  )
}

export default Pantry
