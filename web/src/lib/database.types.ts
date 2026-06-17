// Auto-generate this file from Supabase CLI: `npx supabase gen types typescript --local > src/lib/database.types.ts`
// For now these are hand-written to match our schema.sql

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string           // uuid, matches auth.users.id
          username: string
          display_name: string
          emoji: string
          is_pro: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at'>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      groups: {
        Row: {
          id: string
          name: string
          code: string         // 6-char join code
          owner_id: string
          max_members: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['groups']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['groups']['Insert']>
      }
      group_members: {
        Row: {
          group_id: string
          user_id: string
          joined_at: string
        }
        Insert: Omit<Database['public']['Tables']['group_members']['Row'], 'joined_at'>
        Update: never
      }
      bets: {
        Row: {
          id: string
          user_id: string
          group_id: string
          game_id: string | null   // The Odds API game key
          sport: string
          type: string             // spread | moneyline | over_under | parlay | prop | other
          description: string
          odds: number             // American odds
          stake: number
          status: 'pending' | 'won' | 'lost' | 'push'
          sportsbook: string
          legs: Json | null        // parlay legs array
          created_at: string
          settled_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['bets']['Row'], 'id' | 'created_at' | 'settled_at'>
        Update: Partial<Database['public']['Tables']['bets']['Insert']>
      }
      games: {
        Row: {
          id: string               // The Odds API game key
          sport_key: string
          home_team: string
          away_team: string
          commence_time: string
          home_score: number | null
          away_score: number | null
          completed: boolean
          last_fetched: string
        }
        Insert: Omit<Database['public']['Tables']['games']['Row'], 'last_fetched'>
        Update: Partial<Database['public']['Tables']['games']['Insert']>
      }
    }
  }
}
