export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      aisles: {
        Row: {
          created_at: string
          deleted_at: string | null
          household_id: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          household_id: string
          id: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          household_id?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aisles_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          created_at: string
          date: string
          deleted_at: string | null
          household_id: string
          id: string
          meal: string
          person_id: string
          present: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          deleted_at?: string | null
          household_id: string
          id: string
          meal?: string
          person_id: string
          present: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          deleted_at?: string | null
          household_id?: string
          id?: string
          meal?: string
          person_id?: string
          present?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          all_day: boolean
          calendar_id: string
          created_at: string
          deleted_at: string | null
          end_date: string
          ends_at: string
          google_event_id: string
          google_updated_at: string | null
          household_id: string
          id: string
          person_id: string | null
          start_date: string
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day: boolean
          calendar_id: string
          created_at?: string
          deleted_at?: string | null
          end_date: string
          ends_at: string
          google_event_id: string
          google_updated_at?: string | null
          household_id: string
          id: string
          person_id?: string | null
          start_date: string
          starts_at: string
          title?: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          calendar_id?: string
          created_at?: string
          deleted_at?: string | null
          end_date?: string
          ends_at?: string
          google_event_id?: string
          google_updated_at?: string | null
          household_id?: string
          id?: string
          person_id?: string | null
          start_date?: string
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      dietary_constraints: {
        Row: {
          created_at: string
          deleted_at: string | null
          household_id: string
          id: string
          kind: string
          person_id: string
          tag: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          household_id: string
          id: string
          kind: string
          person_id: string
          tag: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          household_id?: string
          id?: string
          kind?: string
          person_id?: string
          tag?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dietary_constraints_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dietary_constraints_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          id: string
          invite_code: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          invite_code?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          invite_code?: string
          name?: string
        }
        Relationships: []
      }
      ingredient_aliases: {
        Row: {
          alias: string
          created_at: string
          deleted_at: string | null
          household_id: string
          id: string
          ingredient_id: string
          updated_at: string
        }
        Insert: {
          alias: string
          created_at?: string
          deleted_at?: string | null
          household_id: string
          id: string
          ingredient_id: string
          updated_at?: string
        }
        Update: {
          alias?: string
          created_at?: string
          deleted_at?: string | null
          household_id?: string
          id?: string
          ingredient_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_aliases_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_aliases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_purchase_units: {
        Row: {
          amount: number
          created_at: string
          deleted_at: string | null
          household_id: string
          id: string
          ingredient_id: string
          name: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          deleted_at?: string | null
          household_id: string
          id: string
          ingredient_id: string
          name: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          deleted_at?: string | null
          household_id?: string
          id?: string
          ingredient_id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_purchase_units_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_purchase_units_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          aisle_id: string | null
          base_unit: string
          created_at: string
          deleted_at: string | null
          household_id: string
          id: string
          merged_into: string | null
          name: string
          updated_at: string
        }
        Insert: {
          aisle_id?: string | null
          base_unit?: string
          created_at?: string
          deleted_at?: string | null
          household_id: string
          id: string
          merged_into?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          aisle_id?: string | null
          base_unit?: string
          created_at?: string
          deleted_at?: string | null
          household_id?: string
          id?: string
          merged_into?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_aisle_id_fkey"
            columns: ["aisle_id"]
            isOneToOne: false
            referencedRelation: "aisles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_plan_entries: {
        Row: {
          cook_person_id: string | null
          created_at: string
          date: string
          deleted_at: string | null
          eat_time: string | null
          household_id: string
          id: string
          meal: string
          note: string | null
          recipe_id: string
          servings: number
          updated_at: string
        }
        Insert: {
          cook_person_id?: string | null
          created_at?: string
          date: string
          deleted_at?: string | null
          eat_time?: string | null
          household_id: string
          id: string
          meal?: string
          note?: string | null
          recipe_id: string
          servings: number
          updated_at?: string
        }
        Update: {
          cook_person_id?: string | null
          created_at?: string
          date?: string
          deleted_at?: string | null
          eat_time?: string | null
          household_id?: string
          id?: string
          meal?: string
          note?: string | null
          recipe_id?: string
          servings?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_plan_entries_cook_person_id_fkey"
            columns: ["cook_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_plan_entries_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_plan_entries_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          auth_user_id: string | null
          created_at: string
          date_of_birth: string | null
          deleted_at: string | null
          household_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          household_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          household_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          aisle_id: string | null
          created_at: string
          deleted_at: string | null
          household_id: string
          id: string
          ingredient_id: string | null
          name: string
          quantity: string | null
          recipe_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          aisle_id?: string | null
          created_at?: string
          deleted_at?: string | null
          household_id: string
          id: string
          ingredient_id?: string | null
          name: string
          quantity?: string | null
          recipe_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          aisle_id?: string | null
          created_at?: string
          deleted_at?: string | null
          household_id?: string
          id?: string
          ingredient_id?: string | null
          name?: string
          quantity?: string | null
          recipe_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_aisle_id_fkey"
            columns: ["aisle_id"]
            isOneToOne: false
            referencedRelation: "aisles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          base_servings: number
          cook_minutes: number | null
          created_at: string
          deleted_at: string | null
          household_id: string
          id: string
          method: string | null
          name: string
          prep_minutes: number | null
          source_url: string | null
          updated_at: string
        }
        Insert: {
          base_servings?: number
          cook_minutes?: number | null
          created_at?: string
          deleted_at?: string | null
          household_id: string
          id: string
          method?: string | null
          name: string
          prep_minutes?: number | null
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          base_servings?: number
          cook_minutes?: number | null
          created_at?: string
          deleted_at?: string | null
          household_id?: string
          id?: string
          method?: string | null
          name?: string
          prep_minutes?: number | null
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_list_items: {
        Row: {
          added_by: string | null
          aisle_id: string | null
          checked: boolean
          checked_at: string | null
          created_at: string
          deleted_at: string | null
          household_id: string
          id: string
          ingredient_id: string | null
          name: string
          plan_entry_id: string | null
          quantity: string | null
          recipe_ingredient_id: string | null
          source: string
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          aisle_id?: string | null
          checked?: boolean
          checked_at?: string | null
          created_at?: string
          deleted_at?: string | null
          household_id: string
          id: string
          ingredient_id?: string | null
          name: string
          plan_entry_id?: string | null
          quantity?: string | null
          recipe_ingredient_id?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          aisle_id?: string | null
          checked?: boolean
          checked_at?: string | null
          created_at?: string
          deleted_at?: string | null
          household_id?: string
          id?: string
          ingredient_id?: string | null
          name?: string
          plan_entry_id?: string | null
          quantity?: string | null
          recipe_ingredient_id?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_list_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_list_items_aisle_id_fkey"
            columns: ["aisle_id"]
            isOneToOne: false
            referencedRelation: "aisles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_list_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_list_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_list_items_plan_entry_id_fkey"
            columns: ["plan_entry_id"]
            isOneToOne: false
            referencedRelation: "meal_plan_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_list_items_recipe_ingredient_id_fkey"
            columns: ["recipe_ingredient_id"]
            isOneToOne: false
            referencedRelation: "recipe_ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_household: {
        Args: { hname: string; pname: string }
        Returns: string
      }
      gen_invite_code: { Args: never; Returns: string }
      is_member: { Args: { hid: string }; Returns: boolean }
      join_household: { Args: { code: string; pname: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

