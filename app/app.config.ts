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
    }
  }
})
