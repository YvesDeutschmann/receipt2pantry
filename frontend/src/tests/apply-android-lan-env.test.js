import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyAndroidLanEnv,
  resolveDevLanIPv4,
} from '../../scripts/apply-android-lan-env.js'
import { updateEnvLocal } from '../../scripts/load-frontend-env-for-cap.js'

const BASE_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">10.0.2.2</domain>
    <domain includeSubdomains="true">localhost</domain>
  </domain-config>
</network-security-config>
`

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), 'meald-lan-'))
  const xmlPath = join(dir, 'network_security_config.xml')
  const envLocalPath = join(dir, '.env.local')
  writeFileSync(xmlPath, BASE_XML)
  return { xmlPath, envLocalPath }
}

describe('resolveDevLanIPv4', () => {
  it('prefers ANDROID_DEV_LAN_IP over auto-detect', () => {
    expect(
      resolveDevLanIPv4({ ANDROID_DEV_LAN_IP: '192.168.50.33' }, () => '10.9.8.7')
    ).toEqual({ ip: '192.168.50.33', source: 'env' })
  })

  it('falls back to auto-detect when env is unset', () => {
    expect(resolveDevLanIPv4({}, () => '192.168.50.33')).toEqual({
      ip: '192.168.50.33',
      source: 'auto',
    })
  })
})

describe('applyAndroidLanEnv', () => {
  it('patches cleartext XML with the auto-detected IP', () => {
    const { xmlPath, envLocalPath } = tempPaths()
    const result = applyAndroidLanEnv({
      xmlPath,
      envLocalPath,
      env: {},
      detect: () => '192.168.50.33',
    })
    expect(result).toEqual({
      skipped: false,
      ip: '192.168.50.33',
      source: 'auto',
    })
    const xml = readFileSync(xmlPath, 'utf8')
    expect(xml).toContain('192.168.50.33')
    expect(xml).toContain('localhost')
    expect(xml).toContain('10.0.2.2')
  })

  it('writes VITE_API_BASE_URL when requested', () => {
    const { xmlPath, envLocalPath } = tempPaths()
    writeFileSync(envLocalPath, 'VITE_ENABLE_DEV_SETTINGS=1\n')
    const result = applyAndroidLanEnv({
      xmlPath,
      envLocalPath,
      writeApiUrl: true,
      env: {},
      detect: () => '192.168.50.33',
    })
    expect(result.apiBaseUrl).toBe('http://192.168.50.33:5000/api')
    expect(readFileSync(envLocalPath, 'utf8')).toMatch(
      /^VITE_API_BASE_URL=http:\/\/192\.168\.50\.33:5000\/api$/m
    )
  })

  it('skips XML mutation when SKIP_ANDROID_LAN_ENV=1', () => {
    const { xmlPath, envLocalPath } = tempPaths()
    const result = applyAndroidLanEnv({
      xmlPath,
      envLocalPath,
      writeApiUrl: true,
      env: { SKIP_ANDROID_LAN_ENV: '1' },
      detect: () => '192.168.50.33',
    })
    expect(result.skipped).toBe(true)
    expect(readFileSync(xmlPath, 'utf8')).toBe(BASE_XML)
    expect(existsSync(envLocalPath)).toBe(false)
  })
})

describe('updateEnvLocal', () => {
  it('replaces an existing key and appends a missing one', () => {
    const { envLocalPath } = tempPaths()
    writeFileSync(envLocalPath, 'FOO=old\n# comment\n')
    updateEnvLocal(envLocalPath, 'FOO', 'new')
    updateEnvLocal(envLocalPath, 'BAR', 'added')
    const text = readFileSync(envLocalPath, 'utf8')
    expect(text).toMatch(/^FOO=new$/m)
    expect(text).toMatch(/^BAR=added$/m)
    expect(text).toContain('# comment')
  })
})
