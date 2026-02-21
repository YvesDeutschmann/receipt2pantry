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

const tabs = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/pantry', icon: Package, label: 'Pantry' },
  { path: '/recipes', icon: UtensilsCrossed, label: 'Recipes' },
  { path: '/meal-plan', icon: CalendarDays, label: 'Meal Plan' },
  { path: '/settings', icon: Settings, label: 'Settings' },
]

function TabLink({ to, icon: Icon, label }) {
  const handleClick = () => {
    hapticSelection()
  }

  return (
    <NavLink
      to={to}
      onClick={handleClick}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center flex-1 min-h-[56px] pt-2 pb-2 pb-safe-bottom transition-colors ${
          isActive ? 'text-primary-600' : 'text-gray-400'
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
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 min-h-[56px] pt-2 pb-safe-bottom bg-white/80 dark:bg-gray-900/80 backdrop-blur-lg border-t border-gray-200/80 z-50"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="flex h-full">
        {tabs.map(({ path, icon, label }) => (
          <TabLink key={path} to={path} icon={icon} label={label} />
        ))}
      </div>
    </nav>
  )
}

export default BottomTabBar
