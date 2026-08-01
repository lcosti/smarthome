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

    // The filter chip, in the two components that draw one: the aisles on the
    // shopping list (several at once, so a checkbox group) and the facets and
    // sort on the recipe library (one at a time, so a radio group). `card` with
    // the indicator hidden is the theme's own chip — the selected border comes
    // from the variant — and the only thing wrong with it is the padding, which
    // is sized for a form row.
    //
    // Keyed to sm + card, because that pair is only ever a chip. The card groups
    // in IngredientEditor, PersonEditor and PlanNightEditor run at the default
    // md, where a form row is exactly what they are.
    //
    // The slot differs by component: a checkbox group has no padding of its own,
    // so it lands on the checkbox's root.
    radioGroup: {
      compoundVariants: [
        {
          size: 'sm',
          variant: 'card',
          class: { item: 'px-2.5 py-1.5 cursor-pointer' }
        }
      ]
    },

    checkbox: {
      compoundVariants: [
        {
          size: 'sm',
          variant: 'card',
          class: { root: 'px-2.5 py-1.5 cursor-pointer' }
        }
      ]
    },

    empty: {
      slots: {
        // Sized for a phone, which is where most of these are read, and the
        // wide layouts use the same scale rather than announcing themselves —
        // an empty list is a quiet note either way.
        avatar: 'bg-transparent text-dimmed',
        title: 'font-medium text-muted',
        description: 'text-sm text-dimmed'
      },
      variants: {
        variant: {
          // Dashed, because an empty state is a placeholder for something that
          // will be there later, not a panel in its own right. It has to be a
          // border rather than the stock `ring ring-default`: a ring is a
          // shadow, and a shadow cannot be dashed.
          outline: {
            root: 'bg-default border border-dashed border-default'
          }
        }
      }
    },

    navigationMenu: {
      slots: {
        // The wide header's segmented control. There is one horizontal
        // navigation menu in the app; if a second one ever wants stock styling
        // this moves back inline.
        //
        // `before:hidden` removes the theme's own hover pill, which would
        // otherwise sit under this one at a different radius.
        list: 'gap-1 rounded-lg bg-elevated/50 p-1 ring ring-default',
        // The pill moves to the pressed tab with no animation. It used to slide
        // there via a route-level view transition; that was removed — snapshot
        // morphing zoomed the label and smeared the ring, and the browser
        // freezes rendering until the new page mounts, so the slide always
        // started late. An instant jump reads as responsiveness here.
        link: `rounded-md text-sm font-medium text-muted transition-colors
               before:hidden hover:bg-elevated/60 hover:text-default
               data-[active]:bg-default data-[active]:text-highlighted
               data-[active]:ring data-[active]:ring-accented`,
        linkLabel: 'truncate'
      },

      variants: {
        orientation: {
          // Padding has to be overridden here and not in `slots`: the theme sets
          // it inside this variant, and a variant is applied after the slot's
          // base classes, so a `py-0` up there loses. The theme's `py-2` on the
          // item reserves room for a highlight underline this nav does not use,
          // and left in it makes the pill stand a good half-centimetre taller
          // than the tabs inside it.
          horizontal: {
            item: 'py-0',
            link: 'px-3 py-1.5'
          }
        }
      }
    }
  }
})
