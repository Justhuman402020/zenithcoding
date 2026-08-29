export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_traces: {
        Row: {
          created_at: string
          detail: Json
          duration_ms: number | null
          id: string
          message: string | null
          phase: string
          project_id: string
          seq: number
          status: string
          trace_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          id?: string
          message?: string | null
          phase: string
          project_id: string
          seq?: number
          status?: string
          trace_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          id?: string
          message?: string | null
          phase?: string
          project_id?: string
          seq?: number
          status?: string
          trace_id?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          created_at: string
          delta: number
          id: string
          reason: string
          ref: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          id?: string
          reason: string
          ref?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          reason?: string
          ref?: string | null
          user_id?: string
        }
        Relationships: []
      }
      files: {
        Row: {
          content: string
          created_at: string
          id: string
          kind: string
          path: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          kind?: string
          path: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          kind?: string
          path?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      github_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          state?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      github_tokens: {
        Row: {
          access_token: string
          created_at: string
          github_login: string | null
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          github_login?: string | null
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          github_login?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          active: boolean
          created_at: string
          id: string
          monthly_credits: number
          name: string
          price_cents: number
          slug: string
          stripe_price_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          monthly_credits?: number
          name: string
          price_cents?: number
          slug: string
          stripe_price_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          monthly_credits?: number
          name?: string
          price_cents?: number
          slug?: string
          stripe_price_id?: string | null
        }
        Relationships: []
      }
      project_domains: {
        Row: {
          created_at: string
          hostname: string
          id: string
          last_check_at: string | null
          last_check_error: string | null
          project_id: string
          updated_at: string
          user_id: string
          verification_token: string
          verified: boolean
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          hostname: string
          id?: string
          last_check_at?: string | null
          last_check_error?: string | null
          project_id: string
          updated_at?: string
          user_id: string
          verification_token?: string
          verified?: boolean
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          hostname?: string
          id?: string
          last_check_at?: string | null
          last_check_error?: string | null
          project_id?: string
          updated_at?: string
          user_id?: string
          verification_token?: string
          verified?: boolean
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_domains_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_github_links: {
        Row: {
          created_at: string
          default_branch: string
          id: string
          last_pushed_at: string | null
          last_pushed_branch: string | null
          last_pushed_message: string | null
          last_pushed_sha: string | null
          owner: string
          project_id: string
          repo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_branch?: string
          id?: string
          last_pushed_at?: string | null
          last_pushed_branch?: string | null
          last_pushed_message?: string | null
          last_pushed_sha?: string | null
          owner: string
          project_id: string
          repo: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_branch?: string
          id?: string
          last_pushed_at?: string | null
          last_pushed_branch?: string | null
          last_pushed_message?: string | null
          last_pushed_sha?: string | null
          owner?: string
          project_id?: string
          repo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_github_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_secrets: {
        Row: {
          created_at: string
          description: string | null
          expose_to_client: boolean
          id: string
          key: string
          project_id: string
          updated_at: string
          user_id: string
          value_encrypted: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          expose_to_client?: boolean
          id?: string
          key: string
          project_id: string
          updated_at?: string
          user_id: string
          value_encrypted: string
        }
        Update: {
          created_at?: string
          description?: string | null
          expose_to_client?: boolean
          id?: string
          key?: string
          project_id?: string
          updated_at?: string
          user_id?: string
          value_encrypted?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_secrets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_snapshots: {
        Row: {
          created_at: string
          files: Json
          id: string
          label: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          files: Json
          id?: string
          label?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          files?: Json
          id?: string
          label?: string
          project_id?: string
          user_id?: string
        }
        Relationships: []
      }
      project_transfers: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          created_at: string
          expires_at: string
          from_user_id: string
          id: string
          project_id: string
          status: string
          to_email: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          expires_at?: string
          from_user_id: string
          id?: string
          project_id: string
          status?: string
          to_email: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          expires_at?: string
          from_user_id?: string
          id?: string
          project_id?: string
          status?: string
          to_email?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_transfers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          lovable_project_id: string | null
          name: string
          published: boolean
          remix_of_project_id: string | null
          slug: string | null
          template_id: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          lovable_project_id?: string | null
          name: string
          published?: boolean
          remix_of_project_id?: string | null
          slug?: string | null
          template_id?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          lovable_project_id?: string | null
          name?: string
          published?: boolean
          remix_of_project_id?: string | null
          slug?: string | null
          template_id?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_remix_of_project_id_fkey"
            columns: ["remix_of_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      share_links: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          label: string | null
          project_id: string
          revoked: boolean
          token: string
          user_id: string
          view_count: number
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          label?: string | null
          project_id: string
          revoked?: boolean
          token: string
          user_id: string
          view_count?: number
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          label?: string | null
          project_id?: string
          revoked?: boolean
          token?: string
          user_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "share_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_data: {
        Row: {
          collection: string
          created_at: string
          data: Json
          id: string
          is_public: boolean
          owner_site_user_id: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          collection: string
          created_at?: string
          data?: Json
          id?: string
          is_public?: boolean
          owner_site_user_id?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          collection?: string
          created_at?: string
          data?: Json
          id?: string
          is_public?: boolean
          owner_site_user_id?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_data_owner_site_user_id_fkey"
            columns: ["owner_site_user_id"]
            isOneToOne: false
            referencedRelation: "site_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_data_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          project_id: string
          site_user_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          project_id: string
          site_user_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          project_id?: string
          site_user_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_sessions_site_user_id_fkey"
            columns: ["site_user_id"]
            isOneToOne: false
            referencedRelation: "site_users"
            referencedColumns: ["id"]
          },
        ]
      }
      site_users: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          metadata: Json
          password_hash: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          metadata?: Json
          password_hash: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          metadata?: Json
          password_hash?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_users_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          plan_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          author_user_id: string | null
          category: string | null
          created_at: string
          description: string | null
          featured: boolean
          files: Json
          id: string
          name: string
          slug: string
          thumbnail_url: string | null
        }
        Insert: {
          author_user_id?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          featured?: boolean
          files?: Json
          id?: string
          name: string
          slug: string
          thumbnail_url?: string | null
        }
        Update: {
          author_user_id?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          featured?: boolean
          files?: Json
          id?: string
          name?: string
          slug?: string
          thumbnail_url?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          personal: boolean
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          personal?: boolean
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          personal?: boolean
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_credit_balance: { Args: { _user: string }; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { _user: string; _ws: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
