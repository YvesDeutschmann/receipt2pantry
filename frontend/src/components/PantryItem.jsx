import { useRef } from 'react'
import { motion, useMotionValue, animate } from 'framer-motion'
import IngredientCorrection from './IngredientCorrection'
import { getStatusLabel, getStatusLabelClassName } from '../utils/pantryConfidence'

function formatPantryQuantity(item) {
  const q = item?.quantity
  if (q == null || q === '') return null
  const n = Number(q)
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = String(item.unit || '').trim()
  const qtyStr = Number.isInteger(n) ? String(n) : String(n)
  return unit ? `${qtyStr} ${unit}` : qtyStr
}

function PantryItem({
  item,
  onCorrection,
  onRemove,
  correctionOpen,
  onToggleCorrection,
}) {
  const x = useMotionValue(0)
  const dragMoved = useRef(false)

  const displayName = item.normalized_name || item.base_ingredient || ''
  const quantityLine = formatPantryQuantity(item)
  const statusLabel = getStatusLabel(item)
  const statusClass = getStatusLabelClassName(item)
  const isFaded = (item.confidence ?? 0) < 0.2

  const handleCorrection = async (itemId, action) => {
    await onCorrection(itemId, action)
  }

  return (
    <div className="relative overflow-hidden rounded-meald-md border border-forest-light/80">
      <div className="absolute inset-0 flex items-center justify-end pr-4 bg-[var(--color-error)]/90 text-cream text-sm font-medium pointer-events-none">
        Remove
      </div>
      <motion.div
        style={{ x }}
        drag="x"
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={0.1}
        onDragStart={() => {
          dragMoved.current = false
        }}
        onDrag={(_, info) => {
          if (Math.abs(info.offset.x) > 12) dragMoved.current = true
        }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -80) {
            onRemove(item.id)
            void animate(x, 0, { duration: 0.15 })
            return
          }
          void animate(x, 0, { type: 'spring', stiffness: 400, damping: 35 })
        }}
        onTap={() => {
          if (dragMoved.current) return
          onToggleCorrection()
        }}
        className={`relative bg-forest ${isFaded ? 'opacity-50' : ''}`}
      >
        <div className="p-3 min-h-touch">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span className="text-cream font-medium leading-snug block">{displayName}</span>
              {quantityLine ? (
                <span className="text-xs text-sage-light mt-0.5 block">{quantityLine}</span>
              ) : null}
            </div>
            <span className={`text-sm shrink-0 ${statusClass}`}>{statusLabel}</span>
          </div>
          {correctionOpen ? (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <IngredientCorrection
                itemId={item.id}
                ingredientName=""
                onCorrection={handleCorrection}
                onDismiss={() => {}}
              />
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  )
}

export default PantryItem
