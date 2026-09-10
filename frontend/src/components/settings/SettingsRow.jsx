import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

const rowBase =
  'flex w-full items-center justify-between gap-3 px-4 py-3.5 min-h-touch text-left transition-colors'

/**
 * @param {{
 *   title: string,
 *   value?: string,
 *   subtitle?: string,
 *   onClick?: () => void,
 *   to?: string,
 *   destructive?: boolean,
 *   disabled?: boolean,
 *   showChevron?: boolean,
 * }} props
 */
export default function SettingsRow({
  title,
  value,
  subtitle,
  onClick,
  to,
  destructive = false,
  disabled = false,
  showChevron = true,
}) {
  const titleClass = destructive
    ? 'font-medium text-[var(--color-error)]'
    : 'font-medium text-cream'
  const valueClass = 'text-sm text-sage-light text-right shrink-0 max-w-[50%] truncate'

  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <p className={titleClass}>{title}</p>
        {subtitle ? <p className="text-xs text-sage-light mt-0.5">{subtitle}</p> : null}
      </div>
      {value ? <span className={valueClass}>{value}</span> : null}
      {showChevron && (onClick || to) && !disabled ? (
        <ChevronRight className="w-5 h-5 text-sage-light shrink-0" aria-hidden />
      ) : null}
    </>
  )

  if (to && !disabled) {
    return (
      <Link to={to} className={`${rowBase} hover:bg-forest-light/40`}>
        {inner}
      </Link>
    )
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`${rowBase} hover:bg-forest-light/40 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={`${rowBase} ${disabled ? 'opacity-50' : ''}`} aria-disabled={disabled || undefined}>
      {inner}
    </div>
  )
}
