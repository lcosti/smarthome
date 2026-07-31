// The contract every extraction answers in, whatever it read: a photograph, or
// the text of a web page that had no structured data to offer.
//
// The model either extracts a recipe or says the source is not one; the schema
// makes both outcomes machine-readable rather than prose. The client revalidates
// the same shape in app/utils/recipe-import.ts, because a deployed bundle and a
// deployed function change independently.

export const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_recipe', 'recipe'],
  properties: {
    is_recipe: { type: 'boolean' },
    recipe: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'base_servings', 'prep_minutes', 'cook_minutes', 'steps', 'ingredients'],
          properties: {
            name: { type: 'string' },
            base_servings: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            prep_minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            cook_minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            // An array rather than one string of paragraphs. The model is being
            // asked to read a method that is already a numbered list on the page,
            // so making it flatten that and the client unflatten it again only
            // creates a place for the split to be wrong.
            steps: { type: 'array', items: { type: 'string' } },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'quantity'],
                properties: {
                  name: { type: 'string' },
                  quantity: { anyOf: [{ type: 'string' }, { type: 'null' }] }
                }
              }
            }
          }
        }
      ]
    }
  }
} as const

export interface ExtractedLine {
  name: string
  quantity: string | null
}

export interface ExtractedRecipe {
  name: string
  base_servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  steps: string[]
  ingredients: ExtractedLine[]
  /**
   * Absolute address of the recipe's photograph, or null.
   *
   * Deliberately absent from RECIPE_SCHEMA above: the model is handed the page
   * as plain text with every tag stripped, so it has no way to know what the
   * image address was and would have to invent one. This is read from the markup
   * instead — JSON-LD's `image`, or the page's og:image — and merged onto
   * whichever extraction answered.
   */
  image_url: string | null
}
