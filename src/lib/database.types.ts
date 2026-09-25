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
      daymark_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          at: string
          before: Json | null
          id: number
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          id?: never
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          id?: never
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      daymark_clock_challenges: {
        Row: {
          event_type: string
          expires_at: string
          gesture: string
          id: string
          issued_at: string
          person_id: string
          used_at: string | null
        }
        Insert: {
          event_type: string
          expires_at: string
          gesture: string
          id?: string
          issued_at: string
          person_id: string
          used_at?: string | null
        }
        Update: {
          event_type?: string
          expires_at?: string
          gesture?: string
          id?: string
          issued_at?: string
          person_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_clock_challenges_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_closure_days: {
        Row: {
          created_at: string
          day: string
          id: string
          kind: string
          name: string
          site_id: string | null
        }
        Insert: {
          created_at?: string
          day: string
          id?: string
          kind?: string
          name: string
          site_id?: string | null
        }
        Update: {
          created_at?: string
          day?: string
          id?: string
          kind?: string
          name?: string
          site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_closure_days_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "daymark_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_consent_records: {
        Row: {
          decision: string
          id: number
          notice_sha256: string
          notice_version: string
          person_id: string
          purpose: string
          recorded_at: string
          recorded_by: string
          related_id: string | null
          user_agent: string | null
        }
        Insert: {
          decision: string
          id?: never
          notice_sha256: string
          notice_version: string
          person_id: string
          purpose: string
          recorded_at?: string
          recorded_by: string
          related_id?: string | null
          user_agent?: string | null
        }
        Update: {
          decision?: string
          id?: never
          notice_sha256?: string
          notice_version?: string
          person_id?: string
          purpose?: string
          recorded_at?: string
          recorded_by?: string
          related_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_consent_records_notice_version_fkey"
            columns: ["notice_version"]
            isOneToOne: false
            referencedRelation: "daymark_notices"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "daymark_consent_records_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_notices: {
        Row: {
          body: string
          published_at: string
          sha256: string | null
          title: string
          version: string
        }
        Insert: {
          body: string
          published_at?: string
          sha256?: string | null
          title: string
          version: string
        }
        Update: {
          body?: string
          published_at?: string
          sha256?: string | null
          title?: string
          version?: string
        }
        Relationships: []
      }
      daymark_profiles: {
        Row: {
          active: boolean
          contact_email: string | null
          created_at: string
          display_name: string
          id: string
          is_admin: boolean
          is_intern: boolean
          is_supervisor: boolean
          login_id: string
          must_change_password: boolean
        }
        Insert: {
          active?: boolean
          contact_email?: string | null
          created_at?: string
          display_name: string
          id: string
          is_admin?: boolean
          is_intern?: boolean
          is_supervisor?: boolean
          login_id: string
          must_change_password?: boolean
        }
        Update: {
          active?: boolean
          contact_email?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_admin?: boolean
          is_intern?: boolean
          is_supervisor?: boolean
          login_id?: string
          must_change_password?: boolean
        }
        Relationships: []
      }
      daymark_punches: {
        Row: {
          accuracy_m: number | null
          challenge_id: string | null
          client_reported_at: string | null
          created_at: string
          distance_m: number | null
          event_type: string
          flags: string[]
          id: string
          latitude: number | null
          longitude: number | null
          occurred_at: string
          photo_path: string | null
          place_name: string | null
          replaces_punch_id: string | null
          source: string
          user_agent: string | null
          user_id: string
          verification_method: string | null
        }
        Insert: {
          accuracy_m?: number | null
          challenge_id?: string | null
          client_reported_at?: string | null
          created_at?: string
          distance_m?: number | null
          event_type: string
          flags?: string[]
          id?: string
          latitude?: number | null
          longitude?: number | null
          occurred_at?: string
          photo_path?: string | null
          place_name?: string | null
          replaces_punch_id?: string | null
          source?: string
          user_agent?: string | null
          user_id: string
          verification_method?: string | null
        }
        Update: {
          accuracy_m?: number | null
          challenge_id?: string | null
          client_reported_at?: string | null
          created_at?: string
          distance_m?: number | null
          event_type?: string
          flags?: string[]
          id?: string
          latitude?: number | null
          longitude?: number | null
          occurred_at?: string
          photo_path?: string | null
          place_name?: string | null
          replaces_punch_id?: string | null
          source?: string
          user_agent?: string | null
          user_id?: string
          verification_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_punches_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: true
            referencedRelation: "daymark_clock_challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_punches_replaces_punch_id_fkey"
            columns: ["replaces_punch_id"]
            isOneToOne: false
            referencedRelation: "daymark_punches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_punches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_settings: {
        Row: {
          break_minutes: number
          break_threshold_minutes: number
          cert_retention_days: number
          escalation_hours: number
          fortnight_anchor: string
          grace_minutes: number
          id: number
          idle_signout_minutes: number
          max_accuracy_m: number
          max_day_minutes: number
          notice_hours: number
          notice_version: string
          punch_fix_days: number
          punch_fix_max_per_fortnight: number
          punch_fix_min_reason: number
          retention_days: number
          sick_backdate_days: number
          updated_at: string
        }
        Insert: {
          break_minutes?: number
          break_threshold_minutes?: number
          cert_retention_days?: number
          escalation_hours?: number
          fortnight_anchor?: string
          grace_minutes?: number
          id?: number
          idle_signout_minutes?: number
          max_accuracy_m?: number
          max_day_minutes?: number
          notice_hours?: number
          notice_version?: string
          punch_fix_days?: number
          punch_fix_max_per_fortnight?: number
          punch_fix_min_reason?: number
          retention_days?: number
          sick_backdate_days?: number
          updated_at?: string
        }
        Update: {
          break_minutes?: number
          break_threshold_minutes?: number
          cert_retention_days?: number
          escalation_hours?: number
          fortnight_anchor?: string
          grace_minutes?: number
          id?: number
          idle_signout_minutes?: number
          max_accuracy_m?: number
          max_day_minutes?: number
          notice_hours?: number
          notice_version?: string
          punch_fix_days?: number
          punch_fix_max_per_fortnight?: number
          punch_fix_min_reason?: number
          retention_days?: number
          sick_backdate_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      daymark_sites: {
        Row: {
          active: boolean
          address: string
          created_at: string
          hard_capacity: number
          id: string
          latitude: number
          longitude: number
          name: string
          radius_m: number
          standard_capacity: number
          window_end: string
          window_start: string
        }
        Insert: {
          active?: boolean
          address: string
          created_at?: string
          hard_capacity?: number
          id?: string
          latitude: number
          longitude: number
          name: string
          radius_m?: number
          standard_capacity?: number
          window_end?: string
          window_start?: string
        }
        Update: {
          active?: boolean
          address?: string
          created_at?: string
          hard_capacity?: number
          id?: string
          latitude?: number
          longitude?: number
          name?: string
          radius_m?: number
          standard_capacity?: number
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clock_punch: {
        Args: {
          accuracy_m: number
          challenge_id: string
          client_reported_at?: string
          latitude: number
          longitude: number
        }
        Returns: Json
      }
      create_person: {
        Args: {
          display_name: string
          email: string
          is_admin: boolean
          is_intern: boolean
          is_supervisor: boolean
          password: string
        }
        Returns: Json
      }
      my_consent: { Args: never; Returns: Json }
      record_consent: {
        Args: { decision: string; purpose: string; related_id?: string }
        Returns: Json
      }
      set_person_access: {
        Args: {
          active: boolean
          is_admin: boolean
          is_intern: boolean
          is_supervisor: boolean
          target_id: string
        }
        Returns: undefined
      }
      set_person_email: {
        Args: { email: string; target_id: string }
        Returns: undefined
      }
      set_person_password: {
        Args: { password: string; target_id: string }
        Returns: undefined
      }
      start_clock: { Args: { event_type: string }; Returns: Json }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

