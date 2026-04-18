import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom'

/**
 * Wrap children with MemoryRouter (default path /onboarding/pantry-setup).
 */
export function renderWithMemoryRouter(children, { initialPath = '/onboarding/pantry-setup' } = {}) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      {children}
    </MemoryRouter>
  )
}

/**
 * StaplesTemplate + destinations used in tests (Done → /, Back → bridge).
 */
export function createStaplesTestRouter(StaplesPage, options = {}) {
  const { initialPath = '/onboarding/pantry-setup' } = options
  return createMemoryRouter(
    [
      { path: '/onboarding/pantry-setup', element: StaplesPage },
      { path: '/', element: <div data-testid="home-dest">Home</div> },
      { path: '/onboarding/bridge', element: <div data-testid="bridge-dest">Bridge</div> },
    ],
    { initialEntries: [initialPath] }
  )
}

export { MemoryRouter, RouterProvider, createMemoryRouter }
