export default defineAppConfig({
  ui: {
    colors: {
      // Amber, not green: the wall board is the surface with the strongest
      // opinion about colour, and its CTA yellow is the one accent that has to
      // read from across a kitchen. Mapping it onto `primary` rather than
      // painting it with `warning` is what makes buttons, badges and focus rings
      // pick it up on their own.
      primary: 'amber',
      neutral: 'slate'
    },

    badge: {
      variants: {
        size: {
          // The stock md badge, with the leading collapsed. Every badge here
          // is a single line of text sitting next to a heading, and default
          // line-height leaves it visibly taller than the text beside it.
          md: {
            base: 'text-xs px-2 py-1 gap-1 rounded-md leading-none'
          }
        }
      }
    },

    empty: {
      slots: {
        // Sized for a phone, which is where most of these are read. The two
        // wide panes on the board scale their own title up; everywhere else an
        // empty list is a quiet note, not an announcement.
        avatar: 'bg-transparent text-dimmed',
        title: 'font-medium text-muted',
        description: 'text-sm text-dimmed'
      }
    },

    navigationMenu: {
      slots: {
        // The wide header's segmented control. There is one horizontal
        // navigation menu in the app; if a second one ever wants stock styling
        // this moves back inline.
        //
        // `before:hidden` removes the theme's own hover pill, which would
        // otherwise sit under this one at a different radius, and `py-0` on the
        // item removes the theme's `py-2`, which reserves room for a highlight
        // underline this nav does not use.
        list: 'gap-1 rounded-lg bg-elevated/50 p-1 ring ring-default',
        item: 'py-0',
        link: `rounded-md px-3 py-1.5 text-sm font-medium text-muted transition-colors
               before:hidden hover:bg-elevated/60 hover:text-default
               data-[active]:bg-default data-[active]:text-highlighted
               data-[active]:ring data-[active]:ring-accented`,
        linkLabel: 'truncate'
      }
    }
  }
})
