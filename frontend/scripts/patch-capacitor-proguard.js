#!/usr/bin/env node
/**
 * Patches Capacitor plugin build.gradle files to use proguard-android-optimize.txt
 * instead of deprecated proguard-android.txt (required for newer AGP/R8).
 * Run before: npm run build, npx cap sync, npx cap run android
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeModules = path.join(__dirname, '..', 'node_modules')

const PLUGINS = [
  '@capacitor/haptics',
  '@capacitor/keyboard',
]

const OLD = "getDefaultProguardFile('proguard-android.txt')"
const NEW = "getDefaultProguardFile('proguard-android-optimize.txt')"

let patched = 0
for (const plugin of PLUGINS) {
  const buildGradle = path.join(nodeModules, plugin, 'android', 'build.gradle')
  if (!fs.existsSync(buildGradle)) continue

  let content = fs.readFileSync(buildGradle, 'utf8')
  if (content.includes(OLD)) {
    content = content.replace(OLD, NEW)
    fs.writeFileSync(buildGradle, content)
    console.log(`Patched: ${plugin}`)
    patched++
  }
}

if (patched > 0) {
  console.log(`Done. Patched ${patched} Capacitor plugin(s) for proguard compatibility.`)
}
