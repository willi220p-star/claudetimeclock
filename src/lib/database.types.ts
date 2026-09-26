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
      daymark_checkins: {
        Row: {
          comment: string | null
          communication: number
          created_at: string
          id: string
          placement_id: string
          quality: number
          reliability: number
          supervisor_id: string | null
          updated_at: string
          week_start: string
        }
        Insert: {
          comment?: string | null
          communication: number
          created_at?: string
          id?: string
          placement_id: string
          quality: number
          reliability: number
          supervisor_id?: string | null
          updated_at?: string
          week_start: string
        }
        Update: {
          comment?: string | null
          communication?: number
          created_at?: string
          id?: string
          placement_id?: string
          quality?: number
          reliability?: number
          supervisor_id?: string | null
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_checkins_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_checkins_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_clock_challenges: {
        Row: {
          event_type: string
          expires_at: string
          gesture: string
          id: string
          issued_at: string
          issued_real_at: string
          person_id: string
          used_at: string | null
        }
        Insert: {
          event_type: string
          expires_at: string
          gesture: string
          id?: string
          issued_at: string
          issued_real_at?: string
          person_id: string
          used_at?: string | null
        }
        Update: {
          event_type?: string
          expires_at?: string
          gesture?: string
          id?: string
          issued_at?: string
          issued_real_at?: string
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
      daymark_cohorts: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          starts_on: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          starts_on?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          starts_on?: string | null
        }
        Relationships: []
      }
      daymark_consent_records: {
        Row: {
          decision: string
          id: number
          notice_sha256: string
          notice_version: string
          person_id: string | null
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
          person_id?: string | null
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
          person_id?: string | null
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
      daymark_day_results: {
        Row: {
          approved_ot: number
          auto_closed: boolean
          base: number
          break: number
          closed: boolean
          computed_at: string
          countable: number
          counted: number
          late: boolean
          left_early: boolean
          no_show: boolean
          over_max: number
          overtime: number
          placement_id: string
          raw: number
          scheduled: number
          short: number | null
          unscheduled: boolean
          unverified: boolean
          work_date: string
          worked: number
        }
        Insert: {
          approved_ot: number
          auto_closed: boolean
          base: number
          break: number
          closed: boolean
          computed_at: string
          countable: number
          counted: number
          late: boolean
          left_early: boolean
          no_show: boolean
          over_max: number
          overtime: number
          placement_id: string
          raw: number
          scheduled: number
          short?: number | null
          unscheduled: boolean
          unverified: boolean
          work_date: string
          worked: number
        }
        Update: {
          approved_ot?: number
          auto_closed?: boolean
          base?: number
          break?: number
          closed?: boolean
          computed_at?: string
          countable?: number
          counted?: number
          late?: boolean
          left_early?: boolean
          no_show?: boolean
          over_max?: number
          overtime?: number
          placement_id?: string
          raw?: number
          scheduled?: number
          short?: number | null
          unscheduled?: boolean
          unverified?: boolean
          work_date?: string
          worked?: number
        }
        Relationships: [
          {
            foreignKeyName: "daymark_day_results_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_exit_feedback: {
        Row: {
          answers: Json
          id: string
          placement_id: string
          submitted_at: string
        }
        Insert: {
          answers: Json
          id?: string
          placement_id: string
          submitted_at?: string
        }
        Update: {
          answers?: Json
          id?: string
          placement_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_exit_feedback_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: true
            referencedRelation: "daymark_placements"
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
      daymark_notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          link: string | null
          person_id: string
          read_at: string | null
          title: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          person_id: string
          read_at?: string | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          person_id?: string
          read_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_notifications_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_pattern_days: {
        Row: {
          end_time: string
          id: string
          pattern_version_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          end_time: string
          id?: string
          pattern_version_id: string
          start_time: string
          weekday: number
        }
        Update: {
          end_time?: string
          id?: string
          pattern_version_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "daymark_pattern_days_pattern_version_id_fkey"
            columns: ["pattern_version_id"]
            isOneToOne: false
            referencedRelation: "daymark_pattern_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_pattern_versions: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          placement_id: string
          request_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          id?: string
          placement_id: string
          request_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          placement_id?: string
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_pattern_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_pattern_versions_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_pattern_versions_request_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "daymark_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_placements: {
        Row: {
          cohort_id: string | null
          course: string
          created_at: string
          created_by: string | null
          ended_on: string | null
          id: string
          intern_id: string
          original_end_date: string
          planned_end_date: string
          report_approval_note: string | null
          report_approved_at: string | null
          report_approved_by: string | null
          site_id: string
          start_date: string
          status: string
          supervisor_id: string
          target_minutes: number
          target_reached_at: string | null
          uni_coordinator_email: string | null
          uni_coordinator_name: string | null
          university: string
        }
        Insert: {
          cohort_id?: string | null
          course: string
          created_at?: string
          created_by?: string | null
          ended_on?: string | null
          id?: string
          intern_id: string
          original_end_date: string
          planned_end_date: string
          report_approval_note?: string | null
          report_approved_at?: string | null
          report_approved_by?: string | null
          site_id: string
          start_date: string
          status?: string
          supervisor_id: string
          target_minutes: number
          target_reached_at?: string | null
          uni_coordinator_email?: string | null
          uni_coordinator_name?: string | null
          university: string
        }
        Update: {
          cohort_id?: string | null
          course?: string
          created_at?: string
          created_by?: string | null
          ended_on?: string | null
          id?: string
          intern_id?: string
          original_end_date?: string
          planned_end_date?: string
          report_approval_note?: string | null
          report_approved_at?: string | null
          report_approved_by?: string | null
          site_id?: string
          start_date?: string
          status?: string
          supervisor_id?: string
          target_minutes?: number
          target_reached_at?: string | null
          uni_coordinator_email?: string | null
          uni_coordinator_name?: string | null
          university?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_placements_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "daymark_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_placements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_placements_intern_id_fkey"
            columns: ["intern_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_placements_report_approved_by_fkey"
            columns: ["report_approved_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_placements_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "daymark_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_placements_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          distance_m: number | null
          event_type: string
          flags: string[]
          id: string
          latitude: number | null
          longitude: number | null
          occurred_at: string
          photo_deleted_at: string | null
          photo_path: string | null
          place_name: string | null
          placement_id: string | null
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
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          distance_m?: number | null
          event_type: string
          flags?: string[]
          id?: string
          latitude?: number | null
          longitude?: number | null
          occurred_at?: string
          photo_deleted_at?: string | null
          photo_path?: string | null
          place_name?: string | null
          placement_id?: string | null
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
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          distance_m?: number | null
          event_type?: string
          flags?: string[]
          id?: string
          latitude?: number | null
          longitude?: number | null
          occurred_at?: string
          photo_deleted_at?: string | null
          photo_path?: string | null
          place_name?: string | null
          placement_id?: string | null
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
            foreignKeyName: "daymark_punches_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_punches_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
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
      daymark_requests: {
        Row: {
          admin_decided_at: string | null
          admin_decision: string | null
          admin_id: string | null
          admin_note: string | null
          approved_minutes: number | null
          attachment_path: string | null
          certificate_sighted: boolean
          created_at: string
          dates: string[]
          escalated_at: string | null
          id: string
          intern_id: string
          needs_extra_spot: boolean
          payload: Json
          placement_id: string
          reason: string | null
          requested_minutes: number | null
          status: string
          supervisor_decided_at: string | null
          supervisor_decision: string | null
          supervisor_id: string | null
          supervisor_note: string | null
          system_note: string | null
          type: string
          updated_at: string
        }
        Insert: {
          admin_decided_at?: string | null
          admin_decision?: string | null
          admin_id?: string | null
          admin_note?: string | null
          approved_minutes?: number | null
          attachment_path?: string | null
          certificate_sighted?: boolean
          created_at?: string
          dates?: string[]
          escalated_at?: string | null
          id?: string
          intern_id: string
          needs_extra_spot?: boolean
          payload?: Json
          placement_id: string
          reason?: string | null
          requested_minutes?: number | null
          status?: string
          supervisor_decided_at?: string | null
          supervisor_decision?: string | null
          supervisor_id?: string | null
          supervisor_note?: string | null
          system_note?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          admin_decided_at?: string | null
          admin_decision?: string | null
          admin_id?: string | null
          admin_note?: string | null
          approved_minutes?: number | null
          attachment_path?: string | null
          certificate_sighted?: boolean
          created_at?: string
          dates?: string[]
          escalated_at?: string | null
          id?: string
          intern_id?: string
          needs_extra_spot?: boolean
          payload?: Json
          placement_id?: string
          reason?: string | null
          requested_minutes?: number | null
          status?: string
          supervisor_decided_at?: string | null
          supervisor_decision?: string | null
          supervisor_id?: string | null
          supervisor_note?: string | null
          system_note?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_requests_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_requests_intern_id_fkey"
            columns: ["intern_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_requests_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_requests_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_schedule_history: {
        Row: {
          after: Json | null
          before: Json | null
          changed_at: string
          changed_by: string | null
          id: string
          request_id: string | null
          scheduled_day_id: string
        }
        Insert: {
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: string
          request_id?: string | null
          scheduled_day_id: string
        }
        Update: {
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: string
          request_id?: string | null
          scheduled_day_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_schedule_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_schedule_history_request_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "daymark_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_schedule_history_scheduled_day_id_fkey"
            columns: ["scheduled_day_id"]
            isOneToOne: false
            referencedRelation: "daymark_scheduled_days"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_scheduled_days: {
        Row: {
          created_at: string
          end_time: string
          id: string
          leave_kind: string | null
          origin_request_id: string | null
          placement_id: string
          planned_minutes: number | null
          site_id: string
          source: string
          start_time: string
          status: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          leave_kind?: string | null
          origin_request_id?: string | null
          placement_id: string
          planned_minutes?: number | null
          site_id: string
          source?: string
          start_time: string
          status?: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          leave_kind?: string | null
          origin_request_id?: string | null
          placement_id?: string
          planned_minutes?: number | null
          site_id?: string
          source?: string
          start_time?: string
          status?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_scheduled_days_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_scheduled_days_request_fkey"
            columns: ["origin_request_id"]
            isOneToOne: false
            referencedRelation: "daymark_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_scheduled_days_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "daymark_sites"
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
      daymark_shifts: {
        Row: {
          auto_closed: boolean
          clock_in_at: string
          clock_out_at: string | null
          id: string
          in_punch_id: string
          out_punch_id: string | null
          placement_id: string
          unscheduled: boolean
          unverified: boolean
          work_date: string
        }
        Insert: {
          auto_closed?: boolean
          clock_in_at: string
          clock_out_at?: string | null
          id?: string
          in_punch_id: string
          out_punch_id?: string | null
          placement_id: string
          unscheduled?: boolean
          unverified?: boolean
          work_date: string
        }
        Update: {
          auto_closed?: boolean
          clock_in_at?: string
          clock_out_at?: string | null
          id?: string
          in_punch_id?: string
          out_punch_id?: string | null
          placement_id?: string
          unscheduled?: boolean
          unverified?: boolean
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_shifts_in_punch_id_fkey"
            columns: ["in_punch_id"]
            isOneToOne: false
            referencedRelation: "daymark_punches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_shifts_out_punch_id_fkey"
            columns: ["out_punch_id"]
            isOneToOne: false
            referencedRelation: "daymark_punches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_shifts_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
        ]
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
      daymark_work_logs: {
        Row: {
          created_at: string
          id: string
          placement_id: string
          summary: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          placement_id: string
          summary: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          id?: string
          placement_id?: string
          summary?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_work_logs_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      daymark_v_day_hours: {
        Row: {
          approved_ot: number | null
          auto_closed: boolean | null
          base: number | null
          break: number | null
          closed: boolean | null
          computed_at: string | null
          countable: number | null
          counted: number | null
          intern_id: string | null
          late: boolean | null
          left_early: boolean | null
          no_show: boolean | null
          over_max: number | null
          overtime: number | null
          placement_id: string | null
          raw: number | null
          scheduled: number | null
          short: number | null
          supervisor_id: string | null
          unscheduled: boolean | null
          unverified: boolean | null
          work_date: string | null
          worked: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_day_results_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_placements_intern_id_fkey"
            columns: ["intern_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_placements_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_v_fortnight_hours: {
        Row: {
          approved_ot: number | null
          counted: number | null
          fortnight_end: string | null
          fortnight_start: string | null
          late_days: number | null
          no_shows: number | null
          overtime: number | null
          placement_id: string | null
          scheduled: number | null
          short: number | null
          worked: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_day_results_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_v_placement_progress: {
        Row: {
          counted_to_date: number | null
          counted_total: number | null
          days_late: number | null
          expected_to_date: number | null
          forecast_finish: string | null
          forecast_ratio: number | null
          fortnight_end: string | null
          fortnight_start: string | null
          future_sched: number | null
          intern_id: string | null
          intern_name: string | null
          latest_checkin_average: number | null
          no_shows_fortnight: number | null
          owed: number | null
          pace: string | null
          placement_id: string | null
          planned_end_date: string | null
          remaining: number | null
          risk_reasons: string[] | null
          schedule_gap: number | null
          start_date: string | null
          status: string | null
          supervisor_id: string | null
          target_minutes: number | null
          target_reached_at: string | null
          total_weeks: number | null
          week_no: number | null
        }
        Relationships: []
      }
      daymark_v_week_hours: {
        Row: {
          approved_ot: number | null
          counted: number | null
          late_days: number | null
          no_shows: number | null
          overtime: number | null
          placement_id: string | null
          scheduled: number | null
          short: number | null
          week_no: number | null
          week_start: string | null
          worked: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_day_results_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_request_reason: {
        Args: { reason: string; request_id: string }
        Returns: Json
      }
      approve_uni_report: {
        Args: { note?: string; placement: string }
        Returns: undefined
      }
      attach_leave_certificate: {
        Args: { path: string; request_id: string }
        Returns: Json
      }
      audit_search: {
        Args: {
          action?: string
          actor?: string
          before_id?: number
          from_ts?: string
          page_size?: number
          table_name?: string
          to_ts?: string
        }
        Returns: Json
      }
      cancel_request: { Args: { request_id: string }; Returns: Json }
      capacity_preview: {
        Args: {
          days: Json
          end_date: string
          exclude_placement?: string
          site: string
          start_date: string
        }
        Returns: {
          closure: string
          headcount: number
          status: string
          with_new: number
          work_date: string
        }[]
      }
      catch_up_options: { Args: { placement: string }; Returns: Json }
      checkins_due: {
        Args: never
        Returns: {
          intern_id: string
          intern_name: string
          placement_id: string
          week_start: string
        }[]
      }
      cleanup_preview: { Args: { older_than_days: number }; Returns: Json }
      cleanup_run: {
        Args: { kind: string; older_than_days: number }
        Returns: Json
      }
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
      clock_status: { Args: never; Returns: Json }
      confirm_completion: {
        Args: { note?: string; placement: string }
        Returns: undefined
      }
      create_intern: {
        Args: {
          allow_extra?: boolean
          display_name: string
          email: string
          is_admin: boolean
          is_supervisor: boolean
          password: string
          placement: Json
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
      create_request: {
        Args: { payload: Json; reason?: string; type: string }
        Returns: Json
      }
      decide_request: {
        Args: {
          approved_minutes?: number
          decision: string
          note?: string
          request_id: string
        }
        Returns: Json
      }
      delete_record: { Args: { row_id: string; tbl: string }; Returns: Json }
      extend_placement: {
        Args: {
          allow_extra?: boolean
          new_end: string
          note?: string
          placement: string
        }
        Returns: undefined
      }
      flagged_events: {
        Args: { from_date: string; to_date: string }
        Returns: {
          accuracy_m: number
          display_name: string
          distance_m: number
          event_type: string
          flags: string[]
          intern_id: string
          occurred_at: string
          photo_path: string
          punch_id: string
        }[]
      }
      import_placements: {
        Args: { dry_run?: boolean; rows: Json; temp_password: string }
        Returns: Json
      }
      kpi_admin: { Args: never; Returns: Json }
      kpi_intern: { Args: never; Returns: Json }
      kpi_supervisor: { Args: never; Returns: Json }
      mark_certificate_sighted: { Args: { request_id: string }; Returns: Json }
      mark_notifications_read: { Args: { ids?: string[] }; Returns: undefined }
      monday_summary: {
        Args: { week_start?: string }
        Returns: {
          checkin: Json
          counted: number
          days_worked: number
          intern_id: string
          intern_name: string
          late_days: number
          no_shows: number
          overtime_approved: number
          overtime_pending: number
          owed: number
          pace: string
          pending_requests: number
          placement_id: string
          risk_reasons: string[]
          scheduled: number
          week: string
          work_logs: number
        }[]
      }
      my_consent: { Args: never; Returns: Json }
      people_directory: {
        Args: never
        Returns: {
          active: boolean
          created_at: string
          display_name: string
          email: string
          id: string
          is_admin: boolean
          is_intern: boolean
          is_supervisor: boolean
          last_sign_in_at: string
          must_change_password: boolean
          placement_id: string
          placement_status: string
        }[]
      }
      placement_progress: { Args: { placement: string }; Returns: Json }
      preview_request: { Args: { req: Json }; Returns: Json }
      progress_all: { Args: never; Returns: Json[] }
      progress_for_supervisor: { Args: never; Returns: Json[] }
      publish_notice: {
        Args: { body: string; title: string; version: string }
        Returns: Json
      }
      purge_intern: {
        Args: { intern: string; objects_deleted?: number }
        Returns: Json
      }
      record_consent: {
        Args: { decision: string; purpose: string; related_id?: string }
        Returns: Json
      }
      remove_closure_day: { Args: { id: string }; Returns: Json }
      request_supervisor_confirmation: {
        Args: { event_type: string }
        Returns: Json
      }
      retention_certificate_removed: {
        Args: { request_id: string }
        Returns: undefined
      }
      retention_certificates_due: {
        Args: never
        Returns: {
          attachment_path: string
          request_id: string
        }[]
      }
      retention_due: {
        Args: never
        Returns: {
          intern_id: string
        }[]
      }
      run_job: { Args: { name: string }; Returns: Json }
      save_checkin: {
        Args: {
          comment?: string
          communication: number
          placement: string
          quality: number
          reliability: number
          week_start: string
        }
        Returns: string
      }
      save_closure_day: {
        Args: { day: string; kind?: string; name: string; site_id: string }
        Returns: Json
      }
      save_cohort: {
        Args: { id: string; name: string; notes?: string; starts_on?: string }
        Returns: string
      }
      save_placement: {
        Args: { allow_extra?: boolean; p: Json }
        Returns: string
      }
      save_site: { Args: { site: Json }; Returns: Json }
      save_work_log: {
        Args: { summary: string; work_date: string }
        Returns: Json
      }
      set_pattern: {
        Args: {
          allow_extra?: boolean
          days: Json
          effective_from: string
          placement: string
        }
        Returns: string[]
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
      set_site_active: { Args: { active: boolean; id: string }; Returns: Json }
      site_headcounts: {
        Args: { from_date: string; site?: string; to_date: string }
        Returns: {
          full: boolean
          headcount: number
          label: string
          work_date: string
        }[]
      }
      start_clock: { Args: { event_type: string }; Returns: Json }
      storage_usage: {
        Args: never
        Returns: {
          bucket: string
          bytes: number
          files: number
        }[]
      }
      submit_catch_up: {
        Args: { option: string; placement: string }
        Returns: Json
      }
      submit_exit_feedback: { Args: { answers: Json }; Returns: undefined }
      today_board: { Args: { site?: string }; Returns: Json }
      update_record: {
        Args: { patch: Json; row_id: string; tbl: string }
        Returns: Json
      }
      update_settings: { Args: { changes: Json }; Returns: Json }
      withdraw_placement: {
        Args: { placement: string; reason: string }
        Returns: undefined
      }
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

