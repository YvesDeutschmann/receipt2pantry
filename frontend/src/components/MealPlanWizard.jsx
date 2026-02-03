import { useState, useEffect } from 'react'
import { format, addDays, startOfWeek } from 'date-fns'
import { api } from '../services/apiClient'
import RecipeSwipeCard from './RecipeSwipeCard'
import { AnimatePresence, motion } from 'framer-motion'

const MealPlanWizard = ({ isOpen, onClose, onComplete, userId, householdId }) => {
  const [step, setStep] = useState('setup') // setup | selection | review
  const [sessionId, setSessionId] = useState(null)
  const [mealSlots, setMealSlots] = useState({
    breakfast: false,
    lunch: false,
    dinner: true
  })
  const [startDate, setStartDate] = useState(() => {
    // Default to next Monday
    const today = new Date()
    const nextMonday = startOfWeek(addDays(today, 7), { weekStartsOn: 1 })
    return format(nextMonday, 'yyyy-MM-dd')
  })
  const [currentSlot, setCurrentSlot] = useState(0)
  const [recipes, setRecipes] = useState([])
  const [plannedMeals, setPlannedMeals] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [householdMemberCount, setHouseholdMemberCount] = useState(1)
  const [rejectedRecipeIds, setRejectedRecipeIds] = useState([])
  const [acceptedRecipeIds, setAcceptedRecipeIds] = useState([])
  const [toastMessage, setToastMessage] = useState(null)
  const [lastBannedRecipe, setLastBannedRecipe] = useState(null)
  const [threshold, setThreshold] = useState(0.9)
  const [isAdjustingThreshold, setIsAdjustingThreshold] = useState(false)
  const [acceptingRecipeId, setAcceptingRecipeId] = useState(null)

  // Generate meal slots list
  const generateMealSlots = () => {
    const slots = []
    const start = new Date(startDate)
    
    for (let day = 0; day < 7; day++) {
      const date = addDays(start, day)
      const dateStr = format(date, 'yyyy-MM-dd')
      
      if (mealSlots.breakfast) {
        slots.push({ date: dateStr, mealType: 'breakfast', dateObj: date })
      }
      if (mealSlots.lunch) {
        slots.push({ date: dateStr, mealType: 'lunch', dateObj: date })
      }
      if (mealSlots.dinner) {
        slots.push({ date: dateStr, mealType: 'dinner', dateObj: date })
      }
    }
    
    return slots
  }

  const mealSlotsList = generateMealSlots()
  const currentMealSlot = mealSlotsList[currentSlot]

  // Start wizard
  const handleStart = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const result = await api.mealPlan.startWizard(userId, {
        meal_slots: mealSlots,
        start_date: startDate,
        household_id: householdId
      })
      
      setSessionId(result.session_id)
      setHouseholdMemberCount(result.household_member_count || 1)
      setStep('selection')
      await loadSuggestions()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start wizard')
    } finally {
      setLoading(false)
    }
  }

  // Load recipe suggestions
  const loadSuggestions = async (showLoadingToast = false, customThreshold = null) => {
    if (!sessionId || !currentMealSlot) return
    
    setLoading(true)
    setError(null)
    
    const thresholdToUse = customThreshold !== null ? customThreshold : threshold
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:84',message:'Load suggestions started',data:{sessionId,mealType:currentMealSlot.mealType,threshold:thresholdToUse,showLoadingToast},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    
    if (showLoadingToast) {
      setToastMessage('Finding more recipe options...')
      setTimeout(() => setToastMessage(null), 2000)
    }
    
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:103',message:'Calling getSuggestions API',data:{sessionId,mealType:currentMealSlot.mealType,threshold:thresholdToUse},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      const result = await api.mealPlan.getSuggestions(
        sessionId,
        currentMealSlot.mealType,
        thresholdToUse
      )
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:111',message:'getSuggestions API success',data:{recipeCount:result.recipes?.length || 0},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      // Backend already filters rejected/accepted/banned recipes, but filter locally too for safety
      const loadedRecipes = result.recipes || []
      const filteredRecipes = loadedRecipes.filter(
        r => {
          const recipeId = String(r.id)
          const isStaple = r.is_staple || recipeId.startsWith('staple_')
          // Filter out rejected (slot-only)
          if (rejectedRecipeIds.includes(recipeId)) return false
          // Filter out accepted (except staples can repeat)
          if (acceptedRecipeIds.includes(recipeId) && !isStaple) return false
          return true
        }
      )
      setRecipes(filteredRecipes)
      // Update threshold state if custom threshold was used
      if (customThreshold !== null) {
        setThreshold(customThreshold)
      }
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:127',message:'getSuggestions API error',data:{error:err.message,status:err.response?.status,responseData:err.response?.data},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      setError(err.response?.data?.error || 'Failed to load suggestions')
    } finally {
      setLoading(false)
    }
  }

  // Accept recipe
  const handleAcceptRecipe = async (recipe) => {
    if (!sessionId || !currentMealSlot || loading || acceptingRecipeId) return
    
    setAcceptingRecipeId(recipe.id)
    setLoading(true)
    setError(null)
    
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:136',message:'Accept recipe started',data:{sessionId,recipeId:recipe.id,mealDate:currentMealSlot.date,mealType:currentMealSlot.mealType},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      const result = await api.mealPlan.acceptRecipe(sessionId, {
        recipe_id: recipe.id,
        meal_date: currentMealSlot.date,
        meal_type: currentMealSlot.mealType
      })
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:144',message:'Accept recipe API success',data:{result},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      // Add to planned meals
      setPlannedMeals([...plannedMeals, result.meal_plan_entry])
      
      // Track accepted recipe (exclude from future suggestions for the week)
      const recipeId = String(recipe.id)
      const isStaple = recipe.is_staple || recipeId.startsWith('staple_')
      if (!isStaple && !acceptedRecipeIds.includes(recipeId)) {
        setAcceptedRecipeIds([...acceptedRecipeIds, recipeId])
      }
      
      // Clear rejected recipes for next slot (soft rejects are slot-only)
      setRejectedRecipeIds([])
      
      // Move to next slot
      if (currentSlot < mealSlotsList.length - 1) {
        setCurrentSlot(currentSlot + 1)
        setRecipes([])
        // Reset threshold for next slot
        setThreshold(0.9)
        // Load suggestions for next slot
        setTimeout(() => loadSuggestions(), 300)
      } else {
        // All slots filled, go to review
        setStep('review')
      }
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:168',message:'Accept recipe error',data:{error:err.message,status:err.response?.status,responseData:err.response?.data,recipeId:recipe?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      setError(err.response?.data?.error || 'Failed to accept recipe')
    } finally {
      setLoading(false)
      setAcceptingRecipeId(null)
    }
  }

  // Soft reject recipe (slot-only - "not tonight")
  const handleRejectRecipe = async (recipe) => {
    if (!recipe || !sessionId) return
    
    const recipeId = String(recipe.id)
    
    // Add to rejected list immediately for UI feedback
    const newRejectedIds = [...rejectedRecipeIds, recipeId]
    setRejectedRecipeIds(newRejectedIds)
    
    // Filter out rejected recipe from local state
    const filteredRecipes = recipes.filter(r => String(r.id) !== recipeId)
    
    // Call API to persist soft rejection (slot-only)
    try {
      await api.mealPlan.softRejectRecipe(sessionId, recipeId)
    } catch (err) {
      console.error('Failed to reject recipe:', err)
      // Continue anyway - local state is already updated
    }
    
    // If we have more recipes locally, show next one
    if (filteredRecipes.length > 0) {
      setRecipes(filteredRecipes)
    } else {
      // No more recipes locally, reload suggestions with loading toast
      // Backend will filter out rejected recipes
      setRecipes([])
      await loadSuggestions(true)
    }
  }

  // Ban recipe (6 months - "absolutely not")
  const handleBanRecipe = async (recipe) => {
    if (!recipe || !sessionId) return
    
    const recipeId = String(recipe.id)
    const recipeName = recipe.title || 'Recipe'
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:207',message:'Ban recipe started',data:{recipeId,recipeName,sessionId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    
    // Remove from local list immediately
    const filteredRecipes = recipes.filter(r => String(r.id) !== recipeId)
    setRecipes(filteredRecipes)
    
    // Call API to ban recipe
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:218',message:'Calling ban recipe API',data:{recipeId,recipeName},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      await api.mealPlan.banRecipe(sessionId, recipeId, recipeName, userId)
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:223',message:'Ban recipe API success',data:{recipeId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      
      // Show toast with undo button
      setLastBannedRecipe({ id: recipeId, name: recipeName })
      setToastMessage(`Recipe banned for 6 months.`)
      
      // Auto-dismiss toast after 5 seconds
      setTimeout(() => {
        setToastMessage(null)
        setLastBannedRecipe(null)
      }, 5000)
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:236',message:'Ban recipe API error',data:{error:err.message,status:err.response?.status,responseData:err.response?.data,recipeId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      console.error('Failed to ban recipe:', err)
      setError(err.response?.data?.error || 'Failed to ban recipe')
    }
    
    // If no more recipes locally, reload suggestions
    if (filteredRecipes.length === 0) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d194db0-1957-4849-9c6e-e4502771bac7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MealPlanWizard.jsx:244',message:'Reloading suggestions after ban',data:{recipeId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      await loadSuggestions(true)
    }
  }

  // Unban recipe (undo ban)
  const handleUnban = async () => {
    if (!lastBannedRecipe || !sessionId) return
    
    try {
      await api.mealPlan.unbanRecipe(sessionId, lastBannedRecipe.id, userId)
      setToastMessage('Ban removed')
      setLastBannedRecipe(null)
      
      // Auto-dismiss after 2 seconds
      setTimeout(() => setToastMessage(null), 2000)
    } catch (err) {
      console.error('Failed to unban recipe:', err)
      setError(err.response?.data?.error || 'Failed to remove ban')
    }
  }

  // Skip meal slot
  const handleSkipMeal = () => {
    if (currentSlot < mealSlotsList.length - 1) {
      setCurrentSlot(currentSlot + 1)
      // Reset threshold for next slot
      setThreshold(0.9)
      setRecipes([])
    } else {
      setStep('review')
    }
  }

  // Handle threshold adjustment
  const handleThresholdChange = async (newThreshold) => {
    setIsAdjustingThreshold(true)
    setThreshold(newThreshold)
    await loadSuggestions(true, newThreshold)
    setIsAdjustingThreshold(false)
  }

  // Complete wizard with partial plan
  const handleCompletePartial = async () => {
    if (!sessionId) return
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await api.mealPlan.completeWizard(sessionId)
      onComplete(result)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to complete wizard')
    } finally {
      setLoading(false)
    }
  }

  // Complete wizard
  const handleComplete = async () => {
    if (!sessionId) return
    
    setLoading(true)
    setError(null)
    
    try {
      const result = await api.mealPlan.completeWizard(sessionId)
      onComplete(result)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to complete wizard')
    } finally {
      setLoading(false)
    }
  }

  // Load suggestions when slot changes
  useEffect(() => {
    if (step === 'selection' && sessionId && currentMealSlot) {
      // Don't clear rejectedRecipeIds - soft rejects are tracked per slot in backend
      // Reset threshold when moving to new slot
      setThreshold(0.9)
      loadSuggestions()
    }
  }, [currentSlot, sessionId])

  // Close modal on Escape
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-2xl sm:w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 border-b border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-gray-900">
                Meal Planning Wizard
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 px-4 pt-4 pb-4 sm:p-6">
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800">{error}</p>
              </div>
            )}

            {step === 'setup' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Plan These Meals
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={mealSlots.breakfast}
                        onChange={(e) =>
                          setMealSlots({ ...mealSlots, breakfast: e.target.checked })
                        }
                        className="mr-2"
                      />
                      <span>Breakfast</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={mealSlots.lunch}
                        onChange={(e) =>
                          setMealSlots({ ...mealSlots, lunch: e.target.checked })
                        }
                        className="mr-2"
                      />
                      <span>Lunch</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={mealSlots.dinner}
                        onChange={(e) =>
                          setMealSlots({ ...mealSlots, dinner: e.target.checked })
                        }
                        className="mr-2"
                      />
                      <span>Dinner</span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    className="btn btn-secondary"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleStart}
                    disabled={loading || (!mealSlots.breakfast && !mealSlots.lunch && !mealSlots.dinner)}
                  >
                    {loading ? 'Starting...' : 'Start Planning'}
                  </button>
                </div>
              </div>
            )}

            {step === 'selection' && (
              <div className="space-y-6">
                {/* Progress */}
                <div>
                  <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>
                      Meal {currentSlot + 1} of {mealSlotsList.length}
                    </span>
                    <span>
                      {format(currentMealSlot?.dateObj, 'EEEE, MMM d')} - {currentMealSlot?.mealType}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-primary-600 h-2 rounded-full transition-all"
                      style={{ width: `${((currentSlot + 1) / mealSlotsList.length) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Recipe Cards */}
                {loading && recipes.length === 0 ? (
                  <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                  </div>
                ) : recipes.length === 0 ? (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 mb-6">
                    <div className="text-center mb-6">
                      <div className="mb-4">
                        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        No recipes found
                      </h3>
                      <p className="text-sm text-gray-600 mb-6">
                        We couldn't find recipes matching your pantry at the current threshold ({Math.round(threshold * 100)}% match required).
                      </p>
                    </div>

                    <div className="space-y-4">
                      {/* Threshold Slider */}
                      <div className="border-t border-gray-200 pt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-3">
                          Adjust Match Threshold: {Math.round(threshold * 100)}%
                        </label>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-gray-500">50%</span>
                          <input
                            type="range"
                            min="0.5"
                            max="0.9"
                            step="0.1"
                            value={threshold}
                            onChange={(e) => {
                              const newThreshold = parseFloat(e.target.value)
                              setThreshold(newThreshold)
                            }}
                            onMouseUp={() => handleThresholdChange(threshold)}
                            onTouchEnd={() => handleThresholdChange(threshold)}
                            disabled={isAdjustingThreshold}
                            className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                          />
                          <span className="text-xs text-gray-500">90%</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          Lower values will show more recipes, but they may require more ingredients you don't have.
                        </p>
                        {isAdjustingThreshold && (
                          <div className="mt-2 flex items-center gap-2 text-sm text-primary-600">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                            <span>Loading suggestions...</span>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-200">
                        <button
                          onClick={handleSkipMeal}
                          className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                        >
                          Skip this meal
                        </button>
                        <button
                          onClick={handleCompletePartial}
                          disabled={loading}
                          className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loading ? 'Completing...' : 'Complete with current selections'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative mb-6" style={{ minHeight: '500px' }}>
                    <AnimatePresence>
                      {recipes.slice(0, 3).map((recipe, index) => (
                        <motion.div
                          key={recipe.id || index}
                          className="absolute w-full"
                          style={{
                            zIndex: 3 - index,
                            transform: `scale(${1 - index * 0.05}) translateY(${index * 10}px)`
                          }}
                        >
                          <RecipeSwipeCard
                            recipe={{...recipe, accepting: acceptingRecipeId === recipe.id}}
                            onAccept={() => handleAcceptRecipe(recipe)}
                            onReject={() => handleRejectRecipe(recipe)}
                            onBan={() => handleBanRecipe(recipe)}
                            onSkip={handleSkipMeal}
                            isFirstCard={index === 0}
                            zIndex={3 - index}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            )}

            {step === 'review' && (
              <div className="space-y-6">
                <h4 className="text-lg font-semibold">Meal Plan Summary</h4>
                <div className="space-y-2">
                  {plannedMeals.map((meal, index) => (
                    <div key={index} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex justify-between">
                        <span className="font-medium">{meal.recipe_name}</span>
                        <span className="text-sm text-gray-600">
                          {format(new Date(meal.meal_date), 'MMM d')} - {meal.meal_type}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setStep('selection')}
                  >
                    Back
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleComplete}
                    disabled={loading}
                  >
                    {loading ? 'Completing...' : 'Complete & Generate Shopping List'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-4 left-1/2 transform -translate-x-1/2 
                      bg-gray-800 text-white px-4 py-3 rounded-lg shadow-lg 
                      flex items-center gap-3 z-[60]"
        >
          <span>{toastMessage}</span>
          {lastBannedRecipe && (
            <button
              onClick={handleUnban}
              className="underline font-semibold hover:text-gray-300"
            >
              Undo
            </button>
          )}
        </motion.div>
      )}
    </div>
  )
}

export default MealPlanWizard
