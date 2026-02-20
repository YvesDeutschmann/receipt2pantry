function PageHeader({ title, subtitle, actions, sticky = true }) {
  const stickyClass = sticky
    ? 'sticky top-0 z-40 bg-gray-50/95 backdrop-blur-sm -mx-4 px-4 py-4 pt-safe md:static md:bg-transparent md:backdrop-blur-none md:mx-0 md:px-0 md:pt-0'
    : ''

  return (
    <div className={`mb-6 ${stickyClass}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          {subtitle && (
            <p className="text-gray-600 mt-2">{subtitle}</p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </div>
  )
}

export default PageHeader
