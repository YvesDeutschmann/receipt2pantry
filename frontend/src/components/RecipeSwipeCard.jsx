import { motion, useMotionValue } from 'framer-motion'
import { useEffect } from 'react'

const RecipeSwipeCard = ({ 
  recipe, 
  onAccept, 
  onReject,
  onBan,
  onSkip,
  isFirstCard = false,
  zIndex = 0 
}) => {
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onAccept()
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        onReject()
      } else if (e.key === 'ArrowUp' && onBan) {
        e.preventDefault()
        onBan()
      }
      // Note: Escape key is handled by MealPlanWizard to close modal
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onAccept, onReject, onBan])

  const matchPercentage = recipe.match_percentage || 
    (recipe.usedIngredientCount / (recipe.usedIngredientCount + recipe.missedIngredientCount)) || 0

  return (
    <motion.div
      className="relative bg-forest-mid rounded-meald-lg shadow-meald-lg overflow-hidden cursor-grab active:cursor-grabbing"
      style={{ zIndex, x, y }}
      drag
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.2}
      onDragEnd={(e, info) => {
        // Swipe up (ban) takes priority
        if (info.offset.y < -100 && onBan) {
          onBan()
        } else if (info.offset.x > 100) {
          onAccept()
        } else if (info.offset.x < -100) {
          onReject()
        }
      }}
      whileDrag={{ scale: 1.05 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8 }}
    >
      {/* Recipe Image */}
      {recipe.image && (
        <div className="w-full h-64 bg-forest-mid overflow-hidden">
          <img
            src={recipe.image}
            alt={recipe.title}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.target.style.display = 'none'
            }}
          />
        </div>
      )}

      {/* Recipe Content */}
      <div className="p-6">
        <h3 className="text-2xl font-display font-bold text-cream mb-2">{recipe.title}</h3>
        
        {/* Match Percentage Badge */}
        <div className="mb-4">
          <span className="inline-block px-3 py-1 bg-sage/20 text-sage-light rounded-full text-sm font-semibold border border-sage/30">
            {Math.round(matchPercentage * 100)}% Match
          </span>
        </div>

        {/* Ingredients Info */}
        <div className="mb-4 text-sm text-sage-light">
          <p>
            <span className="font-semibold text-sage">
              {recipe.usedIngredientCount || 0} ingredients available
            </span>
            {recipe.missedIngredientCount > 0 && (
              <>
                {' • '}
                <span className="text-terra-light">
                  {recipe.missedIngredientCount} missing
                </span>
              </>
            )}
          </p>
        </div>

        {/* Staple Meal Indicator */}
        {recipe.is_staple && (
          <div className="mb-4">
            <span className="inline-block px-2 py-1 bg-forest-light text-terra rounded text-xs">
              Staple Meal
            </span>
          </div>
        )}

        {/* Action Buttons Section */}
        <div className="mt-6 space-y-3">
          {/* Primary Action - Accept */}
          <button
            className="w-full btn btn-primary px-6 py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onAccept}
            disabled={recipe.accepting}
          >
            {recipe.accepting ? 'Accepting...' : 'Accept Recipe'}
          </button>

          {/* Secondary Actions - Reject Options */}
          <div className="grid grid-cols-2 gap-3">
            <button
              className="btn btn-secondary px-4 py-2.5 text-sm"
              onClick={onReject}
            >
              Not Tonight
            </button>
            <button
              className="btn px-4 py-2.5 text-sm bg-terra/20 hover:bg-terra/30 text-terra-light border-forest-light"
              onClick={onBan}
            >
              Absolutely Not
            </button>
          </div>

          {/* Skip Button - Subtle but accessible */}
          {onSkip && (
            <div className="pt-2 border-t border-forest-light">
              <button
                type="button"
                className="w-full text-sm text-sage-light hover:text-cream py-2 transition-colors"
                onClick={onSkip}
              >
                Skip this meal
              </button>
            </div>
          )}
        </div>

        {/* Hint Text for First Card */}
        {isFirstCard && (
          <p className="text-xs text-sage-light text-center mt-4">
            Swipe gestures: right to accept • left for "not tonight" • up to ban
          </p>
        )}
      </div>

      {/* Swipe Overlays */}
      <motion.div
        className="absolute inset-0 bg-green-500 bg-opacity-80 flex items-center justify-center pointer-events-none rounded-lg"
        style={{
          opacity: x.get() > 50 ? Math.min(x.get() / 200, 0.8) : 0
        }}
      >
        <span className="text-cream text-2xl font-bold">✓ Accept</span>
      </motion.div>

      <motion.div
        className="absolute inset-0 bg-red-500 bg-opacity-80 flex items-center justify-center pointer-events-none rounded-lg"
        style={{
          opacity: x.get() < -50 ? Math.min(Math.abs(x.get()) / 200, 0.8) : 0
        }}
      >
        <span className="text-white text-2xl font-bold">✗ Not Tonight</span>
      </motion.div>

      {onBan && (
        <motion.div
          className="absolute inset-0 bg-orange-500 bg-opacity-80 flex items-center justify-center pointer-events-none rounded-lg"
          style={{
            opacity: y.get() < -50 ? Math.min(Math.abs(y.get()) / 200, 0.8) : 0
          }}
        >
          <span className="text-cream text-2xl font-bold">🚫 Absolutely Not</span>
        </motion.div>
      )}
    </motion.div>
  )
}

export default RecipeSwipeCard
