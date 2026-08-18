// What suggest-adaptations answers in: proposed versions of one recipe for the
// audiences the household actually has, as structured overrides against the
// exact ingredient lines and steps the request named.
//
// The model is handed lines and steps with their ids and must point every
// override at one of them; the function drops anything echoing an id it did not
// send. The client revalidates the same shape in app/utils/adaptations.ts,
// because a deployed bundle and a deployed function change independently.

export const ADAPTATION_SUGGESTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      anyOf: [
        { type: 'null' },
        {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['life_stage', 'diet_tag', 'note', 'ingredient_overrides', 'step_amendments'],
            properties: {
              // Exactly one of these two is set — the audience the suggestion
              // is for, echoed from the request. 'baby' is not an audience:
              // a pre-weaning baby eats nothing off the table.
              life_stage: {
                anyOf: [
                  { type: 'string', enum: ['weaning', 'toddler', 'child', 'adult'] },
                  { type: 'null' }
                ]
              },
              diet_tag: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              // Guidance that names no particular line or step, or null.
              note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              ingredient_overrides: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['recipe_ingredient_id', 'action', 'body'],
                  properties: {
                    recipe_ingredient_id: { type: 'string' },
                    action: { type: 'string', enum: ['swap', 'omit', 'reduce'] },
                    // swap: the replacement; omit/reduce: optional detail.
                    body: { type: 'string' }
                  }
                }
              },
              step_amendments: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['recipe_step_id', 'body'],
                  properties: {
                    recipe_step_id: { type: 'string' },
                    body: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      ]
    }
  }
} as const
