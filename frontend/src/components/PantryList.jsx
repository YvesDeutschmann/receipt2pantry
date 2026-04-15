import { useState } from 'react'
import PantryItem from './PantryItem'
import { groupByConfidence } from '../utils/pantryConfidence'

function PantryList({ items, onCorrection, onRemove }) {
  const [openCorrectionId, setOpenCorrectionId] = useState(null)

  const groups = groupByConfidence(items)

  return (
    <div>
      {groups.map((group, idx) => (
        <div key={group.label} className={idx > 0 ? 'mt-6' : ''}>
          <h3 className="text-sm font-semibold text-sage-light uppercase tracking-wider mb-2">
            {group.label}
          </h3>
          <div className="space-y-1">
            {group.items.map((item) => (
              <PantryItem
                key={item.id}
                item={item}
                onCorrection={async (itemId, action) => {
                  await onCorrection(itemId, action)
                  setOpenCorrectionId(null)
                }}
                onRemove={onRemove}
                correctionOpen={openCorrectionId === item.id}
                onToggleCorrection={() =>
                  setOpenCorrectionId((prev) => (prev === item.id ? null : item.id))
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default PantryList
