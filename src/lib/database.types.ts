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
      daymark_announcement_reads: {
        Row: {
          acked_at: string | null
          announcement_id: string
          person_id: string
          read_at: string
        }
        Insert: {
          acked_at?: string | null
          announcement_id: string
          person_id: string
          read_at?: string
        }
        Update: {
          acked_at?: string | null
          announcement_id?: string
          person_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "daymark_announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_announcement_reads_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_announcements: {
        Row: {
          archived_at: string | null
          audience: string
          body: string
          created_at: string
          created_by: string
          id: string
          must_ack: boolean
          title: string
        }
        Insert: {
          archived_at?: string | null
          audience: string
          body: string
          created_at?: string
          created_by: string
          id?: string
          must_ack?: boolean
          title: string
        }
        Update: {
          archived_at?: string | null
          audience?: string
          body?: string
          created_at?: string
          created_by?: string
          id?: string
          must_ack?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
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
          actor_name?: string | null
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
          actor_name?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          id?: never
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      daymark_banners: {
        Row: {
          active: boolean
          audience: string
          created_at: string
          created_by: string
          ends_at: string | null
          id: string
          message: string
          starts_at: string
          style: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          audience: string
          created_at?: string
          created_by: string
          ends_at?: string | null
          id?: string
          message: string
          starts_at?: string
          style?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          audience?: string
          created_at?: string
          created_by?: string
          ends_at?: string | null
          id?: string
          message?: string
          starts_at?: string
          style?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_banners_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          kiosk_id: string | null
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
          kiosk_id?: string | null
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
          kiosk_id?: string | null
          person_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_clock_challenges_kiosk_id_fkey"
            columns: ["kiosk_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
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
      daymark_day_kinds: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          kind: string
          placement_id: string
          status: string | null
          work_date: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          kind: string
          placement_id: string
          status?: string | null
          work_date: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          kind?: string
          placement_id?: string
          status?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_day_kinds_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_day_kinds_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
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
      daymark_kiosk_attempts: {
        Row: {
          failures: number
          locked_until: string | null
          person_id: string
        }
        Insert: {
          failures?: number
          locked_until?: string | null
          person_id: string
        }
        Update: {
          failures?: number
          locked_until?: string | null
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_kiosk_attempts_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_kiosk_pins: {
        Row: {
          person_id: string
          pin_hash: string
          updated_at: string
        }
        Insert: {
          person_id: string
          pin_hash: string
          updated_at?: string
        }
        Update: {
          person_id?: string
          pin_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_kiosk_pins_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_labels: {
        Row: {
          archived_at: string | null
          colour: string
          id: string
          name: string
        }
        Insert: {
          archived_at?: string | null
          colour: string
          id?: string
          name: string
        }
        Update: {
          archived_at?: string | null
          colour?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      daymark_milestones: {
        Row: {
          archived_at: string | null
          due_date: string | null
          id: string
          name: string
          position: number
          project_id: string
        }
        Insert: {
          archived_at?: string | null
          due_date?: string | null
          id?: string
          name: string
          position: number
          project_id: string
        }
        Update: {
          archived_at?: string | null
          due_date?: string | null
          id?: string
          name?: string
          position?: number
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "daymark_projects"
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
          break_minutes: number
          cohort_id: string | null
          course: string
          created_at: string
          created_by: string | null
          ended_on: string | null
          hourly_rate: number | null
          id: string
          intern_id: string
          original_end_date: string | null
          paid: boolean
          planned_end_date: string | null
          report_approval_note: string | null
          report_approved_at: string | null
          report_approved_by: string | null
          site_id: string
          start_date: string
          status: string
          supervisor_id: string
          target_minutes: number | null
          target_reached_at: string | null
          uni_coordinator_email: string | null
          uni_coordinator_name: string | null
          university: string
        }
        Insert: {
          break_minutes?: number
          cohort_id?: string | null
          course: string
          created_at?: string
          created_by?: string | null
          ended_on?: string | null
          hourly_rate?: number | null
          id?: string
          intern_id: string
          original_end_date?: string | null
          paid?: boolean
          planned_end_date?: string | null
          report_approval_note?: string | null
          report_approved_at?: string | null
          report_approved_by?: string | null
          site_id: string
          start_date: string
          status?: string
          supervisor_id: string
          target_minutes?: number | null
          target_reached_at?: string | null
          uni_coordinator_email?: string | null
          uni_coordinator_name?: string | null
          university: string
        }
        Update: {
          break_minutes?: number
          cohort_id?: string | null
          course?: string
          created_at?: string
          created_by?: string | null
          ended_on?: string | null
          hourly_rate?: number | null
          id?: string
          intern_id?: string
          original_end_date?: string | null
          paid?: boolean
          planned_end_date?: string | null
          report_approval_note?: string | null
          report_approved_at?: string | null
          report_approved_by?: string | null
          site_id?: string
          start_date?: string
          status?: string
          supervisor_id?: string
          target_minutes?: number | null
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
          is_kiosk: boolean
          is_supervisor: boolean
          kiosk_site_id: string | null
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
          is_kiosk?: boolean
          is_supervisor?: boolean
          kiosk_site_id?: string | null
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
          is_kiosk?: boolean
          is_supervisor?: boolean
          kiosk_site_id?: string | null
          login_id?: string
          must_change_password?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "daymark_profiles_kiosk_site_id_fkey"
            columns: ["kiosk_site_id"]
            isOneToOne: false
            referencedRelation: "daymark_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_project_activity: {
        Row: {
          actor_id: string | null
          actor_name: string
          created_at: string
          id: string
          kind: string
          project_id: string
          text: string
        }
        Insert: {
          actor_id?: string | null
          actor_name: string
          created_at?: string
          id?: string
          kind: string
          project_id: string
          text: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          id?: string
          kind?: string
          project_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_project_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_project_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "daymark_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_project_members: {
        Row: {
          person_id: string
          project_id: string
          removed_at: string | null
        }
        Insert: {
          person_id: string
          project_id: string
          removed_at?: string | null
        }
        Update: {
          person_id?: string
          project_id?: string
          removed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_project_members_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "daymark_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_projects: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          archived_at: string | null
          client_name: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          lead_id: string | null
          links: string[] | null
          name: string
          start_date: string | null
          status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          client_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          lead_id?: string | null
          links?: string[] | null
          name: string
          start_date?: string | null
          status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          client_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          lead_id?: string | null
          links?: string[] | null
          name?: string
          start_date?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_projects_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_projects_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          is_break: boolean
          kiosk_id: string | null
          latitude: number | null
          longitude: number | null
          occurred_at: string
          offline_id: string | null
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
          is_break?: boolean
          kiosk_id?: string | null
          latitude?: number | null
          longitude?: number | null
          occurred_at?: string
          offline_id?: string | null
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
          is_break?: boolean
          kiosk_id?: string | null
          latitude?: number | null
          longitude?: number | null
          occurred_at?: string
          offline_id?: string | null
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
            foreignKeyName: "daymark_punches_kiosk_id_fkey"
            columns: ["kiosk_id"]
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
      daymark_push_outbox: {
        Row: {
          attempts: number
          error: string | null
          id: number
          notification_id: string
          person_id: string
          send_after: string
          sent_at: string | null
        }
        Insert: {
          attempts?: number
          error?: string | null
          id?: never
          notification_id: string
          person_id: string
          send_after: string
          sent_at?: string | null
        }
        Update: {
          attempts?: number
          error?: string | null
          id?: never
          notification_id?: string
          person_id?: string
          send_after?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_push_outbox_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "daymark_notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_push_outbox_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_ok_at: string | null
          p256dh: string
          person_id: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_ok_at?: string | null
          p256dh: string
          person_id: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_ok_at?: string | null
          p256dh?: string
          person_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_push_subscriptions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_reminders_sent: {
        Row: {
          kind: string
          person_id: string
          sent_at: string
          work_date: string
        }
        Insert: {
          kind: string
          person_id: string
          sent_at?: string
          work_date: string
        }
        Update: {
          kind?: string
          person_id?: string
          sent_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_reminders_sent_person_id_fkey"
            columns: ["person_id"]
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
          push_kinds: string[]
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
          push_kinds?: string[]
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
          push_kinds?: string[]
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
      daymark_task_assignees: {
        Row: {
          person_id: string
          removed_at: string | null
          task_id: string
        }
        Insert: {
          person_id: string
          removed_at?: string | null
          task_id: string
        }
        Update: {
          person_id?: string
          removed_at?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_task_assignees_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "daymark_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_task_collaborators: {
        Row: {
          person_id: string
          removed_at: string | null
          task_id: string
        }
        Insert: {
          person_id: string
          removed_at?: string | null
          task_id: string
        }
        Update: {
          person_id?: string
          removed_at?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_task_collaborators_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_task_collaborators_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "daymark_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_task_comments: {
        Row: {
          author_id: string | null
          author_name: string
          body: string
          created_at: string
          id: string
          item_id: string
          kind: string
          subtask_id: string | null
        }
        Insert: {
          author_id?: string | null
          author_name: string
          body: string
          created_at?: string
          id?: string
          item_id: string
          kind?: string
          subtask_id?: string | null
        }
        Update: {
          author_id?: string | null
          author_name?: string
          body?: string
          created_at?: string
          id?: string
          item_id?: string
          kind?: string
          subtask_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daymark_task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_task_comments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "daymark_task_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_task_comments_subtask_id_fkey"
            columns: ["subtask_id"]
            isOneToOne: false
            referencedRelation: "daymark_task_subtasks"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_task_items: {
        Row: {
          blocked_at: string | null
          blocked_reason: string | null
          created_at: string
          done_at: string | null
          done_note: string | null
          due_date: string | null
          id: string
          person_id: string
          review_requested_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          spent_minutes: number
          status: string
          task_id: string
        }
        Insert: {
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string
          done_at?: string | null
          done_note?: string | null
          due_date?: string | null
          id?: string
          person_id: string
          review_requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          spent_minutes?: number
          status?: string
          task_id: string
        }
        Update: {
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string
          done_at?: string | null
          done_note?: string | null
          due_date?: string | null
          id?: string
          person_id?: string
          review_requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          spent_minutes?: number
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_task_items_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_task_items_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_task_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "daymark_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_task_labels: {
        Row: {
          label_id: string
          removed_at: string | null
          task_id: string
        }
        Insert: {
          label_id: string
          removed_at?: string | null
          task_id: string
        }
        Update: {
          label_id?: string
          removed_at?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_task_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "daymark_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_task_labels_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "daymark_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_task_subtasks: {
        Row: {
          created_at: string
          created_by: string | null
          done_at: string | null
          done_by: string | null
          id: string
          item_id: string
          position: number
          removed_at: string | null
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          id?: string
          item_id: string
          position: number
          removed_at?: string | null
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          id?: string
          item_id?: string
          position?: number
          removed_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_task_subtasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_task_subtasks_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_task_subtasks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "daymark_task_items"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_tasks: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          due_time: string | null
          estimate_minutes: number | null
          id: string
          link: string | null
          milestone_id: string | null
          priority: string
          project_id: string | null
          repeat_days: number[] | null
          repeat_until: string | null
          reviewer_id: string | null
          subtask_titles: string[] | null
          title: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          estimate_minutes?: number | null
          id?: string
          link?: string | null
          milestone_id?: string | null
          priority?: string
          project_id?: string | null
          repeat_days?: number[] | null
          repeat_until?: string | null
          reviewer_id?: string | null
          subtask_titles?: string[] | null
          title: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          estimate_minutes?: number | null
          id?: string
          link?: string | null
          milestone_id?: string | null
          priority?: string
          project_id?: string | null
          repeat_days?: number[] | null
          repeat_until?: string | null
          reviewer_id?: string | null
          subtask_titles?: string[] | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "daymark_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "daymark_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daymark_week_signoffs: {
        Row: {
          counted_minutes: number
          id: string
          placement_id: string
          reopened_at: string | null
          reopened_reason: string | null
          signed_at: string
          signed_by: string | null
          week_start: string
        }
        Insert: {
          counted_minutes: number
          id?: string
          placement_id: string
          reopened_at?: string | null
          reopened_reason?: string | null
          signed_at: string
          signed_by?: string | null
          week_start: string
        }
        Update: {
          counted_minutes?: number
          id?: string
          placement_id?: string
          reopened_at?: string | null
          reopened_reason?: string | null
          signed_at?: string
          signed_by?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "daymark_week_signoffs_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "daymark_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daymark_week_signoffs_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "daymark_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      add_subtask: { Args: { item: string; title: string }; Returns: string }
      add_task_comment: {
        Args: { body: string; item: string; subtask?: string }
        Returns: string
      }
      announcement_reads: {
        Args: { id: string }
        Returns: {
          acked_at: string
          display_name: string
          person_id: string
          read_at: string
        }[]
      }
      approve_project: {
        Args: { approve: boolean; id: string; note?: string }
        Returns: undefined
      }
      approve_uni_report: {
        Args: { note?: string; placement: string }
        Returns: undefined
      }
      archive_announcement: { Args: { id: string }; Returns: undefined }
      archive_label: { Args: { id: string }; Returns: undefined }
      archive_milestone: { Args: { id: string }; Returns: undefined }
      archive_project: { Args: { id: string }; Returns: undefined }
      archive_task: { Args: { id: string }; Returns: undefined }
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
      catch_up_slots: { Args: { placement: string }; Returns: Json }
      checkins_due: {
        Args: never
        Returns: {
          intern_id: string
          intern_name: string
          placement_id: string
          week_start: string
        }[]
      }
      choose_day_kind: { Args: { kind: string }; Returns: Json }
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
      create_kiosk: {
        Args: {
          display_name: string
          email: string
          password: string
          site: string
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
      current_banners: {
        Args: never
        Returns: {
          active: boolean
          audience: string
          created_at: string
          created_by: string
          ends_at: string | null
          id: string
          message: string
          starts_at: string
          style: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "daymark_banners"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      decide_day_kind: {
        Args: { decision: string; placement: string; work_date: string }
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
      delete_my_notifications: { Args: { ids?: string[] }; Returns: number }
      delete_push_subscription: {
        Args: { endpoint: string }
        Returns: undefined
      }
      delete_record: { Args: { row_id: string; tbl: string }; Returns: Json }
      end_banner: { Args: { id: string }; Returns: undefined }
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
      kiosk_people: {
        Args: never
        Returns: {
          first_name: string
          initials: string
          person_id: string
        }[]
      }
      kiosk_punch: { Args: { challenge_id: string }; Returns: Json }
      kiosk_start: {
        Args: {
          day_kind?: string
          event_type: string
          person: string
          pin: string
        }
        Returns: Json
      }
      kpi_admin: { Args: never; Returns: Json }
      kpi_intern: { Args: never; Returns: Json }
      kpi_supervisor: { Args: never; Returns: Json }
      labels: {
        Args: never
        Returns: {
          colour: string
          id: string
          name: string
        }[]
      }
      log_task_time: {
        Args: { item: string; minutes: number }
        Returns: undefined
      }
      mark_announcement: {
        Args: { ack: boolean; id: string }
        Returns: undefined
      }
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
      my_announcements: {
        Args: never
        Returns: {
          acked_at: string
          author: string
          body: string
          created_at: string
          id: string
          must_ack: boolean
          read_at: string
          title: string
        }[]
      }
      my_consent: { Args: never; Returns: Json }
      my_projects: {
        Args: never
        Returns: {
          blocked: number
          client_name: string
          due_date: string
          estimate_minutes: number
          id: string
          in_review: number
          lead_name: string
          name: string
          next_milestone: string
          next_milestone_due: string
          overdue: number
          spent_minutes: number
          start_date: string
          status: string
          tasks_done: number
          tasks_total: number
          waiting: boolean
        }[]
      }
      my_tasks: {
        Args: never
        Returns: {
          blocked_reason: string
          comments: number
          created_by_name: string
          description: string
          done_at: string
          done_note: string
          due_date: string
          due_time: string
          estimate_minutes: number
          item_id: string
          labels: string[]
          link: string
          milestone_id: string
          milestone_name: string
          own: boolean
          priority: string
          project_id: string
          project_name: string
          repeat_days: number[]
          review_requested_at: string
          reviewer_id: string
          reviewer_name: string
          spent_minutes: number
          status: string
          subtasks_done: number
          subtasks_total: number
          task_id: string
          title: string
          to_review: boolean
          working_with: string[]
        }[]
      }
      my_tasks_d44: {
        Args: never
        Returns: {
          created_by_name: string
          description: string
          done_at: string
          done_note: string
          due_date: string
          due_time: string
          item_id: string
          link: string
          own: boolean
          priority: string
          repeat_days: number[]
          status: string
          task_id: string
          title: string
          working_with: string[]
        }[]
      }
      my_tasks_d48: {
        Args: never
        Returns: {
          blocked_reason: string
          comments: number
          created_by_name: string
          description: string
          done_at: string
          done_note: string
          due_date: string
          due_time: string
          estimate_minutes: number
          item_id: string
          link: string
          own: boolean
          priority: string
          repeat_days: number[]
          review_requested_at: string
          reviewer_id: string
          reviewer_name: string
          spent_minutes: number
          status: string
          subtasks_done: number
          subtasks_total: number
          task_id: string
          title: string
          to_review: boolean
          working_with: string[]
        }[]
      }
      nudge_announcement: { Args: { id: string }; Returns: number }
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
      post_announcement: {
        Args: {
          audience: string
          body: string
          must_ack: boolean
          title: string
        }
        Returns: string
      }
      posted_announcements: {
        Args: never
        Returns: {
          acked: number
          audience: string
          author: string
          body: string
          created_at: string
          id: string
          must_ack: boolean
          read: number
          recipients: number
          title: string
        }[]
      }
      preview_request: { Args: { req: Json }; Returns: Json }
      progress_all: { Args: never; Returns: Json[] }
      progress_for_supervisor: { Args: never; Returns: Json[] }
      project_activity: {
        Args: { before?: string; id: string }
        Returns: {
          actor_name: string
          created_at: string
          id: string
          kind: string
          text: string
        }[]
      }
      project_detail: { Args: { id: string }; Returns: Json }
      project_lookup: {
        Args: { q?: string }
        Returns: {
          client_name: string
          id: string
          name: string
        }[]
      }
      project_people: {
        Args: { project?: string }
        Returns: {
          display_name: string
          person_id: string
        }[]
      }
      publish_notice: {
        Args: { body: string; title: string; version: string }
        Returns: Json
      }
      purge_intern: {
        Args: { intern: string; objects_deleted?: number }
        Returns: Json
      }
      push_due: {
        Args: { max_rows?: number }
        Returns: {
          attempts: number
          auth: string
          body: string
          endpoint: string
          link: string
          outbox_id: number
          p256dh: string
          title: string
        }[]
      }
      record_consent: {
        Args: { decision: string; purpose: string; related_id?: string }
        Returns: Json
      }
      reminder_status: {
        Args: never
        Returns: {
          device: string
          last_ok_at: string
          person_id: string
        }[]
      }
      remove_closure_day: { Args: { id: string }; Returns: Json }
      remove_subtask: { Args: { id: string }; Returns: undefined }
      report_missed_time: {
        Args: { at_time: string; event: string; note?: string }
        Returns: Json
      }
      reset_kiosk_pin: { Args: { person: string }; Returns: undefined }
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
      review_task: {
        Args: { approve: boolean; comment?: string; item: string }
        Returns: undefined
      }
      run_job: { Args: { name: string }; Returns: Json }
      save_banner: {
        Args: {
          ends_at?: string
          id: string
          message: string
          starts_at?: string
          style?: string
        }
        Returns: string
      }
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
      save_label: {
        Args: { colour: string; id: string; name: string }
        Returns: string
      }
      save_milestone: {
        Args: { due_date: string; id: string; name: string; project: string }
        Returns: string
      }
      save_placement: {
        Args: { allow_extra?: boolean; p: Json }
        Returns: string
      }
      save_project: {
        Args: {
          client_name: string
          contact_email: string
          contact_name: string
          contact_phone: string
          description: string
          due_date: string
          id: string
          lead: string
          links: string[]
          members: string[]
          name: string
          start_date: string
          status: string
        }
        Returns: string
      }
      save_push_kinds: { Args: { kinds: string[] }; Returns: string[] }
      save_push_subscription: {
        Args: { auth: string; endpoint: string; p256dh: string }
        Returns: undefined
      }
      save_site: { Args: { site: Json }; Returns: Json }
      save_task: {
        Args: {
          assignees: string[]
          collaborators: string[]
          description: string
          due_date: string
          due_time: string
          estimate_minutes?: number
          id: string
          link: string
          milestone?: string
          priority: string
          project?: string
          repeat_days: number[]
          repeat_until: string
          reviewer?: string
          subtasks?: string[]
          title: string
        }
        Returns: string
      }
      save_task_d44: {
        Args: {
          assignees: string[]
          collaborators: string[]
          description: string
          due_date: string
          due_time: string
          id: string
          link: string
          priority: string
          repeat_days: number[]
          repeat_until: string
          title: string
        }
        Returns: string
      }
      save_task_d48: {
        Args: {
          assignees: string[]
          collaborators: string[]
          description: string
          due_date: string
          due_time: string
          estimate_minutes?: number
          id: string
          link: string
          priority: string
          repeat_days: number[]
          repeat_until: string
          reviewer?: string
          subtasks?: string[]
          title: string
        }
        Returns: string
      }
      save_work_log: {
        Args: { summary: string; work_date: string }
        Returns: Json
      }
      set_break_for_all: { Args: { minutes: number }; Returns: number }
      set_break_minutes: {
        Args: { minutes: number; placement: string }
        Returns: undefined
      }
      set_kiosk_pin: { Args: { pin: string }; Returns: undefined }
      set_pattern: {
        Args: {
          allow_extra?: boolean
          days: Json
          effective_from: string
          placement: string
        }
        Returns: string[]
      }
      set_pattern_range: {
        Args: {
          allow_extra?: boolean
          days: Json
          from_date: string
          placement: string
          to_date: string
        }
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
      set_placement_pay: {
        Args: { hourly_rate?: number; paid: boolean; placement: string }
        Returns: undefined
      }
      set_site_active: { Args: { active: boolean; id: string }; Returns: Json }
      set_subtask: { Args: { done: boolean; id: string }; Returns: undefined }
      set_task_blocked: {
        Args: { item: string; reason: string }
        Returns: undefined
      }
      set_task_labels: {
        Args: { labels: string[]; task: string }
        Returns: undefined
      }
      set_task_status: {
        Args: { item: string; note?: string; status: string }
        Returns: undefined
      }
      sign_week: {
        Args: { placement: string; week_start: string }
        Returns: Json
      }
      signoff_export: {
        Args: { from_date: string; to_date: string }
        Returns: {
          amount: number
          break_minutes: number
          counted_minutes: number
          hourly_rate: number
          intern_name: string
          paid: boolean
          placement_id: string
          week_start: string
          work_date: string
        }[]
      }
      site_headcounts: {
        Args: { from_date: string; site?: string; to_date: string }
        Returns: {
          full: boolean
          headcount: number
          label: string
          work_date: string
        }[]
      }
      staff_add_break: {
        Args: {
          break_end: string
          break_start: string
          placement: string
          reason: string
          work_date: string
        }
        Returns: Json
      }
      staff_add_day: {
        Args: {
          allow_extra?: boolean
          end_time: string
          placement: string
          start_time: string
          work_date: string
        }
        Returns: string
      }
      staff_cancel_day: { Args: { day: string }; Returns: undefined }
      staff_edit_times: {
        Args: {
          clock_in?: string
          clock_out?: string
          placement: string
          reason?: string
          replaces_in?: string
          replaces_out?: string
          work_date: string
        }
        Returns: Json
      }
      staff_mark_absent: {
        Args: { day: string; reason: string }
        Returns: undefined
      }
      staff_move_day: {
        Args: {
          allow_extra?: boolean
          day: string
          end_time: string
          new_date: string
          start_time: string
        }
        Returns: string
      }
      staff_tasks: {
        Args: { intern?: string }
        Returns: {
          blocked_reason: string
          comments: number
          created_by_name: string
          description: string
          done_at: string
          done_note: string
          due_date: string
          due_time: string
          estimate_minutes: number
          item_id: string
          labels: string[]
          link: string
          milestone_id: string
          milestone_name: string
          person_id: string
          person_name: string
          priority: string
          project_id: string
          project_name: string
          repeat_days: number[]
          repeat_until: string
          review_requested_at: string
          reviewer_id: string
          reviewer_name: string
          spent_minutes: number
          status: string
          subtasks_done: number
          subtasks_total: number
          task_id: string
          title: string
        }[]
      }
      staff_tasks_d44: {
        Args: { intern?: string }
        Returns: {
          created_by_name: string
          description: string
          done_at: string
          done_note: string
          due_date: string
          due_time: string
          item_id: string
          link: string
          person_id: string
          person_name: string
          priority: string
          repeat_days: number[]
          repeat_until: string
          status: string
          task_id: string
          title: string
        }[]
      }
      staff_tasks_d48: {
        Args: { intern?: string }
        Returns: {
          blocked_reason: string
          comments: number
          created_by_name: string
          description: string
          done_at: string
          done_note: string
          due_date: string
          due_time: string
          estimate_minutes: number
          item_id: string
          link: string
          person_id: string
          person_name: string
          priority: string
          repeat_days: number[]
          repeat_until: string
          review_requested_at: string
          reviewer_id: string
          reviewer_name: string
          spent_minutes: number
          status: string
          subtasks_done: number
          subtasks_total: number
          task_id: string
          title: string
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
      submit_catch_up_days: {
        Args: { days: Json; placement: string }
        Returns: Json
      }
      submit_exit_feedback: { Args: { answers: Json }; Returns: undefined }
      submit_offline_punch: {
        Args: {
          accuracy_m: number
          action: string
          day_kind?: string
          gesture?: string
          latitude: number
          longitude: number
          occurred_at: string
          offline_id: string
        }
        Returns: Json
      }
      submit_offline_typed: {
        Args: {
          at: string
          day_kind?: string
          event: string
          note?: string
          offline_id: string
        }
        Returns: Json
      }
      task_people: {
        Args: never
        Returns: {
          display_name: string
          person_id: string
        }[]
      }
      task_thread: { Args: { item: string }; Returns: Json }
      task_workload: {
        Args: { week_start: string }
        Returns: {
          blocked: number
          estimate_due_minutes: number
          in_review: number
          open_tasks: number
          overdue: number
          person_id: string
          person_name: string
          rostered_minutes: number
        }[]
      }
      today_board: { Args: { site?: string }; Returns: Json }
      update_my_name: { Args: { display_name: string }; Returns: string }
      update_record: {
        Args: { patch: Json; row_id: string; tbl: string }
        Returns: Json
      }
      update_settings: { Args: { changes: Json }; Returns: Json }
      week_open_items: {
        Args: { placement: string; week_start: string }
        Returns: {
          kind: string
          label: string
          work_date: string
        }[]
      }
      week_signoffs: {
        Args: { from_date: string; to_date: string }
        Returns: {
          counted_minutes: number
          placement_id: string
          signed_at: string
          signed_by_name: string
          week_start: string
        }[]
      }
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

