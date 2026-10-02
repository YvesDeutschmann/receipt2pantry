// @vitest-environment node
import { describe, it, expect } from 'vitest'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import tailwindConfig from '../../tailwind.config.js'

async function compileUtilities(classes) {
  const result = await postcss([
    tailwindcss({
      ...tailwindConfig,
      content: [{ raw: classes }],
    }),
  ]).process('@tailwind utilities;', { from: undefined })
  return result.css
}

describe('tailwind chrome tokens', () => {
  it('emits bottom-above-tab-bar before lg:bottom-6 and keeps pb-tab-bar scoped', async () => {
    const css = await compileUtilities('bottom-above-tab-bar lg:bottom-6 pb-tab-bar')

    expect(css).toMatch(/\.bottom-above-tab-bar\s*\{[^}]*bottom:\s*var\(--app-fab-bottom\)/)
    expect(css).toMatch(/\.pb-tab-bar\s*\{[^}]*padding-bottom:\s*var\(--app-tab-bar-offset\)/)

    const baseBottomIdx = css.indexOf('.bottom-above-tab-bar')
    const lgBottomIdx = css.indexOf('lg\\:bottom-6')
    expect(baseBottomIdx).toBeGreaterThanOrEqual(0)
    expect(lgBottomIdx).toBeGreaterThan(baseBottomIdx)

    expect(css).not.toMatch(/\.p-above-tab-bar/)
    expect(css).not.toMatch(/\.m-above-tab-bar/)
  })
})
