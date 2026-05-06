/**
 * Start ngrok for the Flask backend and upsert the public HTTPS URL into Supabase app_config
 * so installed apps (with VITE_ENABLE_DEV_SETTINGS=1) pick it up on launch / foreground.
 *
 * Reads repo-root .env for SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
 * Uses system `ngrok` CLI; run once: ngrok config add-authtoken <token>
 *
 * Env: CAP_BACKEND_PORT (default 5000)
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { platform } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

function loadEnvFile(envPath) {
  const env = {}
  if (!existsSync(envPath)) return env
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

function normalizeApiBaseUrl(publicUrl) {
  const t = (publicUrl || '').trim().replace(/\/+$/, '')
  if (!t) return ''
  return /\/api$/.test(t) ? t : `${t}/api`
}

async function pollHttpsTunnel(timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch('http://127.0.0.1:4040/api/tunnels')
      const j = await r.json()
      const t = j.tunnels?.find((x) => x.proto === 'https')
      if (t?.public_url) return t.public_url
    } catch {
      /* ngrok not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for ngrok tunnel (https). Is ngrok running on :4040?')
}

async function copyToClipboard(text) {
  if (platform() !== 'darwin') return
  return new Promise((resolve, reject) => {
    const p = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'inherit'] })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pbcopy exit ${code}`))))
    p.stdin.write(text)
    p.stdin.end()
  })
}

const env = { ...process.env, ...loadEnvFile(join(repoRoot, '.env')) }
const port = env.CAP_BACKEND_PORT || '5000'
const supabaseUrl = env.SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !serviceKey) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY in repo .env'
  )
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let ngrokProc = null

function shutdown(code = 0) {
  if (ngrokProc && !ngrokProc.killed) {
    ngrokProc.kill('SIGTERM')
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

;(async () => {
  try {
    const extendedPath = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/home/linuxbrew/.linuxbrew/bin',
      process.env.PATH,
    ].filter(Boolean).join(':')

    ngrokProc = spawn('ngrok', ['http', port, '--log=stdout'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, PATH: extendedPath },
    })
    ngrokProc.on('error', (err) => {
      console.error('Failed to start ngrok:', err.message)
      shutdown(1)
    })

    const publicUrl = await pollHttpsTunnel()
    const apiUrl = normalizeApiBaseUrl(publicUrl)

    const { error } = await supabase.from('app_config').upsert(
      {
        key: 'dev_api_base_url',
        value: apiUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    )

    if (error) {
      console.error('Supabase upsert failed:', error.message)
      shutdown(1)
    }

    console.log('')
    console.log('ngrok https tunnel:')
    console.log(`  ${publicUrl}  →  http://127.0.0.1:${port}`)
    console.log('')
    console.log('Supabase app_config.dev_api_base_url updated — installs with dev sync auto-pickup on next launch.')
    console.log(`Manual paste (Settings → Dev: API base URL): ${apiUrl}`)
    console.log('')

    try {
      await copyToClipboard(apiUrl)
      console.log('(Copied API URL to clipboard.)')
    } catch {
      console.log('(Could not copy to clipboard — copy the URL above.)')
    }
  } catch (e) {
    console.error(e.message || e)
    shutdown(1)
  }
})()
