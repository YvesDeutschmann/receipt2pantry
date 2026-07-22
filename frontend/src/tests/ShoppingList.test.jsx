import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShoppingList from '../components/ShoppingList'

const USER_ID = 'user-1'
const HOUSEHOLD_ID = 'house-1'

const { shoppingListGet, markPurchased } = vi.hoisted(() => ({
  shoppingListGet: vi.fn(),
  markPurchased: vi.fn(),
}))

vi.mock('../services/apiClient', () => ({
  api: { shoppingList: { get: shoppingListGet, markPurchased } },
}))

function itemFixture(overrides = {}) {
  return {
    id: 'item-1',
    ingredient_name: 'Tomatoes',
    quantity: 2,
    unit: 'lb',
    is_purchased: false,
    needed_for_recipe: 'Pasta Night',
    ...overrides,
  }
}

function renderShoppingList(items = []) {
  shoppingListGet.mockResolvedValue({ items })
  return render(<ShoppingList userId={USER_ID} householdId={HOUSEHOLD_ID} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  markPurchased.mockResolvedValue({ ok: true })
})

describe('ShoppingList display polish', () => {
  it('SHOPPING_LIST_GROUPS_BY_RECIPE', async () => {
    renderShoppingList([
      itemFixture({ id: 'item-1', ingredient_name: 'Pasta', needed_for_recipe: 'Pasta Night' }),
      itemFixture({ id: 'item-2', ingredient_name: 'Sauce', needed_for_recipe: 'Pasta Night' }),
      itemFixture({ id: 'item-3', ingredient_name: 'Tortillas', needed_for_recipe: 'Taco Tuesday' }),
    ])

    await screen.findByText('Pasta Night')
    expect(screen.getByText('Taco Tuesday')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(2)
    expect(screen.getByText('Pasta')).toBeInTheDocument()
    expect(screen.getByText('Sauce')).toBeInTheDocument()
    expect(screen.getByText('Tortillas')).toBeInTheDocument()
  })

  it('SHOPPING_LIST_NULL_RECIPE_KEY_GOES_TO_GENERAL', async () => {
    renderShoppingList([
      itemFixture({ id: 'item-1', ingredient_name: 'Salt', needed_for_recipe: null }),
    ])

    await screen.findByRole('heading', { level: 4, name: 'General' })
    expect(screen.getByText('Salt')).toBeInTheDocument()
  })

  it('SHOPPING_LIST_EMPTY_STRING_RECIPE_KEY_GOES_TO_GENERAL', async () => {
    renderShoppingList([
      itemFixture({ id: 'item-1', ingredient_name: 'Pepper', needed_for_recipe: '' }),
    ])

    await screen.findByRole('heading', { level: 4, name: 'General' })
    expect(screen.getByText('Pepper')).toBeInTheDocument()
  })

  it('SHOPPING_LIST_ITEM_COUNT_BADGE_SINGULAR', async () => {
    renderShoppingList([
      itemFixture({ id: 'item-1' }),
    ])

    expect(await screen.findByText('1 item to buy')).toBeInTheDocument()
  })

  it('SHOPPING_LIST_ITEM_COUNT_BADGE_PLURAL', async () => {
    renderShoppingList([
      itemFixture({ id: 'item-1', ingredient_name: 'A' }),
      itemFixture({ id: 'item-2', ingredient_name: 'B', needed_for_recipe: 'Taco Tuesday' }),
      itemFixture({ id: 'item-3', ingredient_name: 'C', needed_for_recipe: 'Taco Tuesday' }),
    ])

    expect(await screen.findByText('3 items to buy')).toBeInTheDocument()
  })

  it('SHOPPING_LIST_ITEM_COUNT_BADGE_NOT_SHOWN_WHEN_EMPTY', async () => {
    renderShoppingList([])

    expect(await screen.findByText('All ingredients available!')).toBeInTheDocument()
    expect(screen.queryByText(/item(s)? to buy/)).not.toBeInTheDocument()
  })

  it('SHOPPING_LIST_PURCHASED_NOT_GROUPED', async () => {
    const user = userEvent.setup()
    const purchasedItem = itemFixture({
      id: 'item-purchased',
      ingredient_name: 'Olive Oil',
      is_purchased: true,
      needed_for_recipe: 'Pasta Night',
    })
    const unpurchasedItem = itemFixture({
      id: 'item-unpurchased',
      ingredient_name: 'Garlic',
      needed_for_recipe: 'Pasta Night',
    })

    shoppingListGet.mockImplementation((_userId, includePurchased) => {
      if (includePurchased) {
        return Promise.resolve({ items: [unpurchasedItem, purchasedItem] })
      }
      return Promise.resolve({ items: [unpurchasedItem] })
    })

    render(<ShoppingList userId={USER_ID} householdId={HOUSEHOLD_ID} />)
    await screen.findByText('Garlic')

    const recipeHeadingsBefore = screen.getAllByRole('heading', { level: 4 })
    expect(recipeHeadingsBefore).toHaveLength(1)
    expect(recipeHeadingsBefore[0]).toHaveTextContent('Pasta Night')

    await user.click(screen.getByLabelText('Show purchased'))

    await waitFor(() => {
      expect(screen.getByText('Olive Oil')).toBeInTheDocument()
    })

    const purchasedSection = screen.getByRole('heading', { level: 3, name: 'Purchased' }).parentElement
    expect(within(purchasedSection).queryByRole('heading', { level: 4 })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(1)
  })

  it('SHOPPING_LIST_FOR_LABEL_REMOVED_FROM_ITEM_ROW', async () => {
    renderShoppingList([
      itemFixture({ id: 'item-1', ingredient_name: 'Basil', needed_for_recipe: 'Pasta Night' }),
    ])

    await screen.findByText('Basil')
    expect(screen.queryByText(/For:/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'Pasta Night' })).toBeInTheDocument()
  })

  it('SHOPPING_LIST_MARK_PURCHASED_CALLS_API', async () => {
    const user = userEvent.setup()
    renderShoppingList([
      itemFixture({ id: 'item-42', ingredient_name: 'Onion' }),
    ])

    await screen.findByText('Onion')
    const checkboxes = screen.getAllByRole('checkbox')
    const itemCheckbox = checkboxes.find((cb) => cb.closest('li')?.textContent?.includes('Onion'))
    expect(itemCheckbox).toBeDefined()

    await user.click(itemCheckbox)

    await waitFor(() => {
      expect(markPurchased).toHaveBeenCalledWith('item-42')
    })
  })
})
