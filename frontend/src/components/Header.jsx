import { Link, useLocation } from 'react-router-dom'

function Header() {
  const location = useLocation()
  
  const isActive = (path) => {
    return location.pathname === path
      ? 'text-primary-600 border-b-2 border-primary-600'
      : 'text-gray-600 hover:text-gray-900'
  }

  return (
    <header className="bg-white shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-8">
            <Link to="/" className="text-2xl font-bold text-primary-600">
              GrocerySync
            </Link>
            <nav className="flex space-x-6">
              <Link
                to="/"
                className={`pb-4 pt-5 font-medium transition-colors ${isActive('/')}`}
              >
                Dashboard
              </Link>
              <Link
                to="/providers"
                className={`pb-4 pt-5 font-medium transition-colors ${isActive('/providers')}`}
              >
                Providers
              </Link>
              <Link
                to="/settings"
                className={`pb-4 pt-5 font-medium transition-colors ${isActive('/settings')}`}
              >
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            <button className="btn btn-primary">
              Sign In
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header

