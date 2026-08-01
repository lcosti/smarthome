/**
 * An icon for an aisle, from its name.
 *
 * A lookup rather than a column on `aisles`, because an icon is a rendering
 * decision and not a fact about the household's shop. Aisles are renameable and
 * addable, so anything unrecognised has to land somewhere sensible rather than
 * leaving a hole in the row of cards — hence the fallback.
 *
 * Keys are normalised, not literal: the seed writes "Fruit & veg" and "Meat &
 * fish", somebody typing the same aisle by hand writes "Fruit and Veg", and
 * both should draw the same carrot.
 */

const ICONS: Record<string, string> = {
  'fruit & veg': 'i-lucide-carrot',
  'fruit & vegetables': 'i-lucide-carrot',
  'bakery': 'i-lucide-croissant',
  'chilled': 'i-lucide-milk',
  'dairy': 'i-lucide-milk',
  'meat & fish': 'i-lucide-beef',
  'frozen': 'i-lucide-snowflake',
  'cupboard': 'i-lucide-package',
  'household': 'i-lucide-spray-can',
  'drinks': 'i-lucide-cup-soda',
  'other': 'i-lucide-shopping-basket'
}

export const AISLE_FALLBACK_ICON = 'i-lucide-shopping-basket'

function normalise(name: string) {
  return name
    .toLowerCase()
    .replace(/\band\b/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export function aisleIcon(name: string): string {
  return ICONS[normalise(name)] ?? AISLE_FALLBACK_ICON
}

// --- guessing where something lives -------------------------------------------

/**
 * The shelves the seed creates, as categories a guess can name.
 *
 * A guess cannot name an aisle id — aisles are per-household rows somebody can
 * rename or delete — so it names a shelf and {@link guessAisleId} resolves that
 * against whatever the household actually has. A household that renamed "Fruit &
 * veg" to "Fruit and Vegetables" still gets its garlic filed correctly; one that
 * deleted the aisle gets no guess, which is the honest answer.
 */
export type AisleCategory
  = 'fruit & veg' | 'bakery' | 'chilled' | 'meat & fish' | 'frozen' | 'cupboard' | 'household' | 'drinks'

/** What a household might have called each shelf. Normalised, so "and" is "&". */
const CATEGORY_NAMES: Record<AisleCategory, string[]> = {
  'fruit & veg': ['fruit & veg', 'fruit & vegetables', 'fruit', 'veg', 'vegetables', 'produce', 'greengrocer', 'fresh produce'],
  'bakery': ['bakery', 'bread', 'bread & bakery'],
  'chilled': ['chilled', 'dairy', 'dairy & eggs', 'fridge', 'chiller'],
  'meat & fish': ['meat & fish', 'meat', 'fish', 'butcher', 'meat & poultry', 'fish & seafood'],
  'frozen': ['frozen', 'freezer'],
  'cupboard': ['cupboard', 'ambient', 'dry goods', 'store cupboard', 'pantry', 'tins & packets', 'groceries'],
  'household': ['household', 'cleaning', 'toiletries', 'home'],
  'drinks': ['drinks', 'beverages', 'alcohol', 'wine & beer']
}

/**
 * Ingredient words and the shelf they are found on.
 *
 * Deliberately a list rather than a model call: this is one household's weekly
 * shop, the same eighty things over and over, and a lookup answers instantly,
 * offline, for free, and the same way every time. Anything it does not know
 * simply gets no aisle — which is exactly what happens today — and the moment
 * somebody files it by hand, `rememberedAisle` knows better than this list ever
 * will and takes over.
 *
 * Keys are matched as whole words against the tidied name, longest first, so
 * "chestnut mushrooms" finds `mushroom` and "spring onion" beats `onion`.
 */
const INGREDIENT_AISLES: Record<string, AisleCategory> = {
  // Fruit & veg
  'onion': 'fruit & veg', 'spring onion': 'fruit & veg', 'shallot': 'fruit & veg',
  'garlic': 'fruit & veg', 'ginger': 'fruit & veg', 'chilli': 'fruit & veg',
  'potato': 'fruit & veg', 'sweet potato': 'fruit & veg', 'carrot': 'fruit & veg',
  'celery': 'fruit & veg', 'leek': 'fruit & veg', 'mushroom': 'fruit & veg',
  'pepper': 'fruit & veg', 'courgette': 'fruit & veg', 'aubergine': 'fruit & veg',
  'broccoli': 'fruit & veg', 'cauliflower': 'fruit & veg', 'cabbage': 'fruit & veg',
  'spinach': 'fruit & veg', 'kale': 'fruit & veg', 'lettuce': 'fruit & veg',
  'rocket': 'fruit & veg', 'cucumber': 'fruit & veg', 'tomato': 'fruit & veg',
  'peas': 'fruit & veg', 'green beans': 'fruit & veg', 'sweetcorn': 'fruit & veg',
  'squash': 'fruit & veg', 'butternut': 'fruit & veg', 'parsnip': 'fruit & veg',
  'swede': 'fruit & veg', 'turnip': 'fruit & veg', 'beetroot': 'fruit & veg',
  'asparagus': 'fruit & veg', 'fennel': 'fruit & veg', 'radish': 'fruit & veg',
  'lemon': 'fruit & veg', 'lime': 'fruit & veg', 'orange': 'fruit & veg',
  'apple': 'fruit & veg', 'pear': 'fruit & veg', 'banana': 'fruit & veg',
  'berries': 'fruit & veg', 'strawberr': 'fruit & veg', 'raspberr': 'fruit & veg',
  'blueberr': 'fruit & veg', 'grape': 'fruit & veg', 'avocado': 'fruit & veg',
  'parsley': 'fruit & veg', 'coriander': 'fruit & veg', 'basil': 'fruit & veg',
  'mint': 'fruit & veg', 'thyme': 'fruit & veg', 'rosemary': 'fruit & veg',
  'dill': 'fruit & veg', 'chives': 'fruit & veg', 'sage': 'fruit & veg',

  // Meat & fish
  'chicken': 'meat & fish', 'beef': 'meat & fish', 'pork': 'meat & fish',
  'lamb': 'meat & fish', 'mince': 'meat & fish', 'sausage': 'meat & fish',
  'bacon': 'meat & fish', 'ham': 'meat & fish', 'chorizo': 'meat & fish',
  'pancetta': 'meat & fish', 'turkey': 'meat & fish', 'duck': 'meat & fish',
  'salmon': 'meat & fish', 'cod': 'meat & fish', 'haddock': 'meat & fish',
  'tuna': 'meat & fish', 'prawn': 'meat & fish', 'mackerel': 'meat & fish',
  'sea bass': 'meat & fish', 'white fish': 'meat & fish',

  // Chilled
  'milk': 'chilled', 'butter': 'chilled', 'cheese': 'chilled',
  'parmesan': 'chilled', 'cheddar': 'chilled', 'mozzarella': 'chilled',
  'feta': 'chilled', 'halloumi': 'chilled', 'ricotta': 'chilled',
  'mascarpone': 'chilled', 'creme fraiche': 'chilled', 'crème fraîche': 'chilled',
  'cream': 'chilled', 'yoghurt': 'chilled', 'yogurt': 'chilled',
  'egg': 'chilled', 'tofu': 'chilled', 'pastry': 'chilled',

  // Bakery
  'bread': 'bakery', 'roll': 'bakery', 'baguette': 'bakery', 'pitta': 'bakery',
  'tortilla': 'bakery', 'wrap': 'bakery', 'naan': 'bakery', 'brioche': 'bakery',
  'crumpet': 'bakery', 'bagel': 'bakery',

  // Frozen
  'frozen': 'frozen', 'ice cream': 'frozen', 'puff pastry': 'frozen',

  // Cupboard
  'rice': 'cupboard', 'pasta': 'cupboard', 'spaghetti': 'cupboard',
  'noodle': 'cupboard', 'couscous': 'cupboard', 'quinoa': 'cupboard',
  'lentil': 'cupboard', 'chickpea': 'cupboard', 'beans': 'cupboard',
  'flour': 'cupboard', 'sugar': 'cupboard', 'salt': 'cupboard',
  'oil': 'cupboard', 'vinegar': 'cupboard', 'stock': 'cupboard',
  'stock cube': 'cupboard', 'passata': 'cupboard', 'tomato puree': 'cupboard',
  'coconut milk': 'cupboard', 'soy sauce': 'cupboard', 'honey': 'cupboard',
  'mustard': 'cupboard', 'ketchup': 'cupboard', 'mayonnaise': 'cupboard',
  'peanut butter': 'cupboard', 'jam': 'cupboard', 'oats': 'cupboard',
  'cereal': 'cupboard', 'nuts': 'cupboard', 'almond': 'cupboard',
  'raisin': 'cupboard', 'cumin': 'cupboard', 'paprika': 'cupboard',
  'cinnamon': 'cupboard', 'turmeric': 'cupboard', 'oregano': 'cupboard',
  'bay leaf': 'cupboard', 'curry powder': 'cupboard', 'baking powder': 'cupboard',
  'bicarbonate': 'cupboard', 'vanilla': 'cupboard', 'chocolate': 'cupboard',
  'tea': 'cupboard', 'coffee': 'cupboard', 'crisps': 'cupboard',
  'biscuit': 'cupboard',

  // Drinks
  'wine': 'drinks', 'beer': 'drinks', 'juice': 'drinks', 'squash drink': 'drinks',

  // Household
  'bin bag': 'household', 'washing up liquid': 'household', 'kitchen roll': 'household',
  'toilet roll': 'household', 'cling film': 'household', 'foil': 'household',
  'detergent': 'household', 'soap': 'household', 'shampoo': 'household',
  'nappies': 'household', 'sponge': 'household'
}

/** Longest first, so a two-word key is tested before the word inside it. */
const KEYWORDS = Object.keys(INGREDIENT_AISLES).sort((a, b) => b.length - a.length)

function normaliseIngredient(name: string) {
  return ` ${name.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()} `
}

/**
 * The shelf an ingredient is usually found on, or null when the list has never
 * heard of it. Null is a fine answer: the item simply lands unfiled, exactly as
 * everything does today.
 */
export function guessAisleCategory(name: string): AisleCategory | null {
  const haystack = normaliseIngredient(name)
  if (haystack.trim().length < 2) return null

  for (const keyword of KEYWORDS) {
    // Whole words, so "pepper" does not match inside "peppercorn" by accident —
    // but a trailing plural or possessive still counts as the same word.
    if (new RegExp(`\\s${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?\\s`).test(haystack)) {
      return INGREDIENT_AISLES[keyword]!
    }
  }
  return null
}

/**
 * That shelf as one of the household's own aisle rows, or null.
 *
 * Matched by name rather than by id because the guess knows about shelves and
 * only this household knows about its aisles. An aisle it cannot find is not an
 * error — somebody who deleted "Frozen" gets no frozen guesses.
 */
export function guessAisleId(
  name: string,
  aisles: Iterable<{ id: string, name: string, deleted_at?: string | null }>
): string | null {
  const category = guessAisleCategory(name)
  if (!category) return null

  const wanted = CATEGORY_NAMES[category]
  for (const aisle of aisles) {
    if (aisle.deleted_at) continue
    if (wanted.includes(normalise(aisle.name))) return aisle.id
  }
  return null
}
