// Remove build output before `vp pack`: both pack configs write into `dist`,
// and a stale client bundle is worse than no bundle.
import { rmSync } from 'node:fs'

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true })
