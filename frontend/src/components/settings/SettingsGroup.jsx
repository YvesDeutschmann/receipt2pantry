/**
 * iOS-style settings section with inset list.
 * @param {{ title: string, children: import('react').ReactNode, footer?: string }} props
 */
export default function SettingsGroup({ title, children, footer }) {
  return (
    <section className="mb-6">
      <h2 className="text-xs font-medium uppercase tracking-wide text-sage-light px-4 mb-2">
        {title}
      </h2>
      <div className="bg-forest-mid rounded-meald-lg overflow-hidden divide-y divide-forest-light/80">
        {children}
      </div>
      {footer ? (
        <p className="text-xs text-sage-light px-4 mt-2">{footer}</p>
      ) : null}
    </section>
  )
}
