import { motion } from 'framer-motion'
import { Check } from 'lucide-react'

/**
 * Three-step cold-start progress: grocery → pantry → What's for Dinner
 * @param {Object} props
 * @param {1|2|3} props.highlightStep - 1-based step to emphasize (2 = pantry template)
 * @param {boolean} props.step3Unlocked - terminal unlock (after template confirm)
 */
export default function ColdStartProgressBar({ highlightStep = 2, step3Unlocked = false }) {
  const steps = [
    { id: 1, label: 'Grocery store', sub: 'Connected' },
    { id: 2, label: 'Your pantry', sub: 'Set up' },
    { id: 3, label: "What's for Dinner", sub: step3Unlocked ? 'Ready' : 'Next' },
  ]

  return (
    <div className="w-full px-1 py-4">
      <div className="flex items-start justify-between gap-2 max-w-lg mx-auto">
        {steps.map((step) => {
          const done = step.id < highlightStep || (step.id === 3 && step3Unlocked)
          const active = step.id === highlightStep && !step3Unlocked

          return (
            <div key={step.id} className="flex-1 flex flex-col items-center text-center min-w-0">
              <motion.div
                initial={false}
                animate={{
                  scale: active || (step.id === 3 && step3Unlocked) ? 1.05 : 1,
                }}
                className={[
                  'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 mb-2 transition-colors',
                  done
                    ? 'bg-[var(--color-terra)] border-[var(--color-terra)] text-cream'
                    : active
                      ? 'border-[var(--color-terra)] text-cream bg-forest-light'
                      : 'border-[var(--color-sage)] text-sage-light bg-transparent',
                ].join(' ')}
              >
                {done ? <Check className="w-4 h-4" /> : step.id}
              </motion.div>
              <p
                className={`text-xs font-medium leading-tight ${
                  active || done ? 'text-cream' : 'text-sage-light'
                }`}
              >
                {step.label}
              </p>
              <p className="text-[10px] text-sage-light mt-0.5 hidden sm:block">{step.sub}</p>
            </div>
          )
        })}
      </div>
      <div className="max-w-lg mx-auto flex mt-1 px-4">
        <div
          className="h-0.5 flex-1 rounded-full bg-[var(--color-sage)]/40 overflow-hidden"
          style={{ marginRight: '-1px' }}
        >
          <motion.div
            className="h-full bg-[var(--color-terra)]"
            initial={false}
            animate={{
              width:
                highlightStep >= 3 || step3Unlocked
                  ? '100%'
                  : highlightStep === 2
                    ? '50%'
                    : '16%',
            }}
            transition={{ type: 'spring', stiffness: 120, damping: 18 }}
          />
        </div>
      </div>
    </div>
  )
}
