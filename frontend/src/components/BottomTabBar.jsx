import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Package,
  UtensilsCrossed,
  CalendarDays,
  Settings,
} from 'lucide-react'
import { hapticSelection } from '../utils/haptics'
import { FEATURES } from '../config/features'

function getTabs() {
  return [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard', enabled: true },
    { path: '/pantry', icon: Package, label: 'Pantry', enabled: true },
    {
      path: '/recipes',
      icon: UtensilsCrossed,
      label: 'Dinner',
      ariaLabel: "What's for Dinner",
      enabled: true,
    },
    {
      path: '/meal-plan',
      icon: CalendarDays,
      label: 'Meal Plan',
      enabled: FEATURES.mealPlanner,
    },
    { path: '/settings', icon: Settings, label: 'Settings', enabled: true },
  ].filter((tab) => tab.enabled)
}

function TabLink({ to, icon: Icon, label, ariaLabel }) {
  const handleClick = () => {
    hapticSelection()
  }

  return (
    <NavLink
      to={to}
      aria-label={ariaLabel ?? label}
      onClick={handleClick}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center flex-1 min-h-[56px] pt-2 pb-2 pb-safe-bottom transition-colors border-t-2 border-transparent ${
          isActive ? 'text-cream border-t-terra' : 'text-sage-light'
        }`
      }
    >
      {({ isActive }) => (
        <motion.span
          className="flex flex-col items-center justify-center"
          whileTap={{ scale: 0.9 }}
        >
          <Icon className="w-6 h-6" strokeWidth={2} />
          <span className="text-xs mt-1 font-medium">{label}</span>
        </motion.span>
      )}
    </NavLink>
  )
}

function BottomTabBar() {
  const tabs = getTabs()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 min-h-[56px] pt-2 pb-safe-bottom bg-forest-mid backdrop-blur-lg border-t border-forest-light z-50"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="flex h-full">
        {tabs.map(({ path, icon, label, ariaLabel }) => (
          <TabLink
            key={path}
            to={path}
            icon={icon}
            label={label}
            ariaLabel={ariaLabel}
          />
        ))}
      </div>
    </nav>
  )
}

export default BottomTabBar
