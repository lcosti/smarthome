// The contract every extraction answers in, whatever it read: a photograph, or
// the text of a web page that had no structured data to offer.
//
// The model either extracts a recipe or says the source is not one; the schema
// makes both outcomes machine-readable rather than prose. The client revalidates
// the same shape in app/utils/recipe-import.ts, because a deployed bundle and a
// deployed function change independently.

/**
 * The eight figures a UK label prints, all per serving, each nullable so a
 * source that states only some of them is not forced to invent the rest. Shared
 * between the importers (which transcribe a printed panel) and the estimator
 * (which is the one caller allowed to make these numbers up).
 */
export const NUTRITION_PANEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kcal', 'fat_g', 'saturates_g', 'carbs_g', 'sugars_g', 'fibre_g', 'protein_g', 'salt_g'],
  properties: {
    kcal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    fat_g: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    saturates_g: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    carbs_g: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    sugars_g: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    fibre_g: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    protein_g: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    salt_g: { anyOf: [{ type: 'number' }, { type: 'null' }] }
  }
} as const

/** What estimate-nutrition answers: a panel, or null for a list that is not food. */
export const NUTRITION_ESTIMATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nutrition'],
  properties: {
    nutrition: { anyOf: [{ type: 'null' }, NUTRITION_PANEL_SCHEMA] }
  }
} as const

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
          required: ['name', 'base_servings', 'prep_minutes', 'cook_minutes', 'steps', 'ingredients', 'nutrition'],
          properties: {
            name: { type: 'string' },
            base_servings: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            prep_minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            cook_minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            // The per-serving panel, when the source printed one. Null when it
            // did not — through this schema the model transcribes, it never
            // estimates; estimate-nutrition is the deliberate exception.
            nutrition: { anyOf: [{ type: 'null' }, NUTRITION_PANEL_SCHEMA] },
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

/** Per serving, as printed. Null per field for anything the panel left out. */
export interface ExtractedNutrition {
  kcal: number | null
  fat_g: number | null
  saturates_g: number | null
  carbs_g: number | null
  sugars_g: number | null
  fibre_g: number | null
  protein_g: number | null
  salt_g: number | null
}

export interface ExtractedRecipe {
  name: string
  base_servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  steps: string[]
  ingredients: ExtractedLine[]
  /** The source's nutrition panel, or null when it had none. */
  nutrition: ExtractedNutrition | null
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
