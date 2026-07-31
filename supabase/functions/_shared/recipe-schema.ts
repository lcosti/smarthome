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
          required: ['name', 'base_servings', 'prep_minutes', 'cook_minutes', 'method', 'ingredients'],
          properties: {
            name: { type: 'string' },
            base_servings: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            prep_minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            cook_minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            method: { anyOf: [{ type: 'string' }, { type: 'null' }] },
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
  method: string | null
  ingredients: ExtractedLine[]
}
