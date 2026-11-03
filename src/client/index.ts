// Browser entry for the dsh-acp-config plugin: a dynamic Client half loaded by
// DSH's `__ModuleLoader__`. The bundle is a self-contained IIFE; React is NOT
// bundled — it arrives through the factory's `require` (the loader's module
// table), which is why this file must stay the only `window.__ModuleLoader__`
// call site.
//
// The page itself lives in `./page.js`; this module only wires the section into
// the settings slot and keeps the nav label reading the active locale.
import { langOf, translate } from './locale.js'
import { createPage, type ClientContextLike, type PageProps, type ReactLike } from './page.js'

/** The one loader global this entry talks to. */
interface ModuleLoaderGlobal {
  load: (module: { id: string; factory: (require: (id: string) => unknown) => unknown }) => void
}

/** Client services the settings shell injects for us, as used by this entry. */
interface SectionContext extends ClientContextLike {
  slots: {
    inject: (name: string, factory: () => unknown) => unknown
    register: (
      definition: { name: string; id: string; order: number; label: () => string },
      component: (props: PageProps) => unknown,
    ) => unknown
  }
}

const win = window as unknown as { __ModuleLoader__: ModuleLoaderGlobal }

win.__ModuleLoader__.load({
  id: 'dsh-acp-config',
  factory(require) {
    // React comes from the loader's module table; requesting it here (once)
    // keeps it out of the bundle while giving the page real hooks.
    const React = require('react') as ReactLike

    /** Read the active locale defensively: the label thunk runs outside render. */
    const activeLocale = (ctx: ClientContextLike): string => {
      try {
        return ctx.locale.getLocale().active
      } catch {
        return 'en'
      }
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx: SectionContext): void {
        const Page = createPage(React, ctx)
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'acp-config',
              order: 22,
              // The shell calls the label thunk on each render, so it follows a
              // locale switch without re-registering the section.
              label: () => translate(langOf(activeLocale(ctx)), 'section'),
            },
            Page,
          ),
        )
      },
    }
  },
})
