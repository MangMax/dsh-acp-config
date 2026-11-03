// Path resolution and path-safety checks for one ACP profile.
//
// The page may only ever write inside `$DSH_HOME/profiles/<name>`, and the
// profile name arrives from configuration (never from the browser), so both
// layers are validated here: a strict name grammar plus a `realpath` containment
// check before every write.
import { dirname, join, sep } from 'node:path'
import { AcpConfigError, ERROR_CODES } from './errors.js'
import type { FsPort } from './ports.js'

/** Profile names accepted by the DSH loader (no separators, no `.`/`..`). */
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const PATCH_FILE = 'cordis.patch.yml'
export const STATE_FILE = '.dsh-acp-config.json'
export const BACKUP_SUFFIX = '.dsh-acp-config.bak'
export const TEMP_SUFFIX = '.dsh-acp-config.tmp'

export interface ProfilePaths {
  homeDir: string
  name: string
  /** `<home>/profiles/<name>` (not necessarily existing). */
  dir: string
  patchPath: string
  statePath: string
  backupPath: string
  tempPath: string
}

/** Throw `E_PROFILE` unless `name` is a safe single path segment. */
export function assertProfileName(name: string): string {
  if (typeof name !== 'string' || !PROFILE_NAME.test(name) || name.length > 64) {
    throw new AcpConfigError(ERROR_CODES.profile, `invalid profile name: ${JSON.stringify(name)}`)
  }
  return name
}

/** Build every path the engine touches for one profile. */
export function resolveProfilePaths(homeDir: string, profileName: string): ProfilePaths {
  const name = assertProfileName(profileName)
  const dir = join(homeDir, 'profiles', name)
  const patchPath = join(dir, PATCH_FILE)
  return {
    homeDir,
    name,
    dir,
    patchPath,
    statePath: join(dir, STATE_FILE),
    backupPath: patchPath + BACKUP_SUFFIX,
    tempPath: patchPath + TEMP_SUFFIX,
  }
}

/** True when `child` is `parent` itself or lies below it (both already absolute). */
function isInside(parent: string, child: string): boolean {
  const base = parent.endsWith(sep) ? parent : parent + sep
  return child === parent || child.startsWith(base)
}

/**
 * Resolve `target`'s real location and require it to stay inside the profile.
 * For a file that does not exist yet the nearest existing ancestor is checked,
 * which is exactly the directory the atomic write will create the temp file in.
 */
export function assertInsideProfile(fs: FsPort, profileDir: string, target: string): void {
  let realProfile: string
  try {
    realProfile = fs.realpath(profileDir)
  } catch {
    throw new AcpConfigError(
      ERROR_CODES.profile,
      `profile directory is not readable: ${profileDir}`,
    )
  }
  let realTarget: string
  try {
    realTarget = fs.realpath(target)
  } catch {
    let parent = dirname(target)
    for (;;) {
      try {
        realTarget = join(fs.realpath(parent), target.slice(parent.length))
        break
      } catch {
        const next = dirname(parent)
        if (next === parent) {
          throw new AcpConfigError(
            ERROR_CODES.profile,
            `write target escapes the profile: ${target}`,
          )
        }
        parent = next
      }
    }
  }
  if (!isInside(realProfile, realTarget)) {
    throw new AcpConfigError(ERROR_CODES.profile, `write target escapes the profile: ${target}`)
  }
}

/** Read `dsh.profile.bundles` from the profile's own `package.json`. */
export function readProfileBundles(fs: FsPort, profileDir: string): string[] {
  const manifest = join(profileDir, 'package.json')
  if (!fs.existsFile(manifest)) return []
  try {
    const parsed: unknown = JSON.parse(fs.readFile(manifest))
    if (typeof parsed !== 'object' || parsed === null) return []
    const dsh = (parsed as { dsh?: unknown }).dsh
    if (typeof dsh !== 'object' || dsh === null) return []
    const profile = (dsh as { profile?: unknown }).profile
    if (typeof profile !== 'object' || profile === null) return []
    const bundles = (profile as { bundles?: unknown }).bundles
    if (!Array.isArray(bundles)) return []
    return bundles.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}
