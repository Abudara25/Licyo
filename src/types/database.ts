// Types alignés sur supabase/migrations/0001_initial_complete_schema.sql.
// À régénérer avec `supabase gen types typescript` une fois le projet Supabase créé.

export type ClubStatus = 'demo' | 'active' | 'suspended' | 'archived';
export type SubscriptionPlan = 'vitrine' | 'integral';
export type EmailProvider = 'platform' | 'gmail' | 'smtp';
export type StaffRole = 'super_admin' | 'president' | 'secretary' | 'treasurer' | 'coach';
export type MedicalRequirement = 'health_questionnaire' | 'medical_cert_standard' | 'medical_cert_competition';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded';
export type PaymentMethod = 'card' | 'check' | 'cash' | 'transfer' | 'pass_sport' | 'mixed';
export type InstallmentType = 'card' | 'check' | 'cash' | 'transfer' | 'pass_sport' | 'caf' | 'other_aid';
export type InstallmentStatus = 'pending' | 'deposited' | 'cashed' | 'rejected';
export type RegistrationType = 'full' | 'trial' | 'renewal' | 'import';
export type DossierStatus =
  | 'pending_review'
  | 'needs_correction'
  | 'validated'
  | 'rejected'
  | 'trial_requested'
  | 'trial_done';
export type EventType = 'competition' | 'tournament' | 'training_camp' | 'club_event' | 'meeting';
export type ConvocationStatus = 'pending' | 'present' | 'absent';
export type ProspectStage = 'lead' | 'contacted' | 'demo' | 'quote_sent' | 'won' | 'lost';
export type DeliveryStatus = 'to_order' | 'ordered' | 'received' | 'delivered';
export type SponsorLeadStatus = 'new' | 'contacted' | 'won' | 'lost';

export type SocialLinks = {
  facebook?: string;
  instagram?: string;
  whatsapp?: string;
};

export type SiblingDiscountRules = {
  enabled: boolean;
  second_member_discount: number;
  third_member_discount: number;
  discount_type: 'fixed_euros' | 'percent';
};

export type EnabledModules = {
  vitrine: boolean;
  inscriptions: boolean;
  trials: boolean;
  payments: boolean;
  boutique: boolean;
  attendance: boolean;
  sponsors: boolean;
  social_generator: boolean;
};

export type Club = {
  id: string;
  name: string;
  slug: string;
  custom_domain: string | null;
  sport_type: string;
  theme_preset: string;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  hero_image_url: string | null;
  club_history_text: string | null;
  president_word_text: string | null;
  president_name: string | null;
  president_signature_url: string | null;
  rna_number: string | null;
  siret_number: string | null;
  federation_name: string | null;
  affiliation_number: string | null;
  city: string;
  postal_code: string;
  nearby_cities: string[];
  contact_email: string;
  contact_phone: string | null;
  social_links: SocialLinks;
  sibling_discount_rules: SiblingDiscountRules;
  accepts_pass_sport: boolean;
  pass_sport_amount: number;
  accepts_caf_aids: boolean;
  accepts_installments: boolean;
  pass_stripe_fees_to_parents: boolean;
  enabled_modules: EnabledModules;
  email_provider: EmailProvider;
  email_sender_address: string | null;
  status: ClubStatus;
  demo_expires_at: string | null;
  subscription_plan: SubscriptionPlan;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarded: boolean;
  current_season: string;
  created_at: string;
};

export type ClubMailCredentials = {
  club_id: string;
  google_refresh_token_enc: string | null;
  google_account_email: string | null;
  smtp_settings_enc: string | null;
  updated_at: string;
};

export type StaffMember = {
  id: string;
  user_id: string;
  club_id: string | null;
  full_name: string;
  email: string;
  role: StaffRole;
  assigned_category_ids: string[];
  created_at: string;
};

export type Facility = {
  id: string;
  club_id: string;
  name: string;
  address: string;
  city: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
};

export type Category = {
  id: string;
  club_id: string;
  name: string;
  min_birth_year: number;
  max_birth_year: number;
  gender_filter: 'mixed' | 'M' | 'F';
  annual_price: number;
  max_capacity: number;
  medical_requirement: MedicalRequirement;
  coach_name: string | null;
  description: string | null;
  display_order: number;
};

export type Schedule = {
  id: string;
  club_id: string;
  category_id: string;
  facility_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

export type ClubProduct = {
  id: string;
  club_id: string;
  name: string;
  price: number;
  available_sizes: string[];
  photo_url: string | null;
};

export type FamilyRegistration = {
  id: string;
  club_id: string;
  season: string;
  is_adult_self_registration: boolean;
  payer_first_name: string;
  payer_last_name: string;
  payer_email: string;
  payer_phone: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  address: string;
  city: string;
  postal_code: string;
  licenses_subtotal: number;
  products_subtotal: number;
  sibling_discount_amount: number;
  aids_deduction_amount: number;
  stripe_fee_added: number;
  final_total_amount: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  stripe_checkout_session_id: string | null;
  invoice_number: string | null;
  created_at: string;
};

export type PaymentInstallment = {
  id: string;
  club_id: string;
  family_id: string;
  amount: number;
  payment_type: InstallmentType;
  check_number: string | null;
  scheduled_deposit_date: string;
  status: InstallmentStatus;
  created_at: string;
};

export type Member = {
  id: string;
  club_id: string;
  family_id: string | null;
  category_id: string | null;
  season: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  is_minor: boolean;
  gender: 'M' | 'F' | 'X';
  photo_storage_path: string | null;
  medical_doc_storage_path: string | null;
  id_doc_storage_path: string | null;
  health_questionnaire_passed: boolean;
  pass_sport_code: string | null;
  pass_sport_verified: boolean;
  consent_image_rights: boolean;
  consent_emergency_medical: boolean;
  consent_autonomous_exit: boolean;
  signature_data_url: string | null;
  registration_type: RegistrationType;
  dossier_status: DossierStatus;
  rejection_reason: string | null;
  magic_action_token: string;
  created_at: string;
};

export type MemberProductOrder = {
  id: string;
  club_id: string;
  member_id: string;
  product_id: string;
  selected_size: string;
  price_at_order: number;
  delivery_status: DeliveryStatus;
  created_at: string;
};

export type Attendance = {
  id: string;
  club_id: string;
  schedule_id: string;
  member_id: string;
  session_date: string;
  is_present: boolean;
};

export type ClubEvent = {
  id: string;
  club_id: string;
  category_id: string | null;
  event_type: EventType;
  title: string;
  event_date: string;
  location_text: string | null;
  is_home: boolean;
  score_club: number | null;
  score_opponent: number | null;
  created_at: string;
};

export type EventConvocation = {
  id: string;
  club_id: string;
  event_id: string;
  member_id: string;
  response_status: ConvocationStatus;
  response_token: string;
};

export type Post = {
  id: string;
  club_id: string;
  title: string;
  slug: string;
  content: string;
  cover_image_url: string | null;
  is_published: boolean;
  published_at: string;
};

export type Sponsor = {
  id: string;
  club_id: string;
  company_name: string;
  logo_url: string;
  website_url: string | null;
  description: string | null;
  display_order: number;
};

export type SponsorLead = {
  id: string;
  club_id: string;
  company_name: string;
  contact_name: string;
  phone: string;
  email: string;
  estimated_budget: string | null;
  status: SponsorLeadStatus;
  created_at: string;
};

export type AnonymousPageView = {
  id: string;
  club_id: string;
  view_month: string;
  page_path: string;
  views_count: number;
};

export type SaasProspect = {
  id: string;
  club_name: string;
  sport_type: string;
  city: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  stage: ProspectStage;
  demo_club_id: string | null;
  quote_number: string | null;
  created_at: string;
};

export type PlatformAnnouncement = {
  id: string;
  title: string;
  message: string;
  is_active: boolean;
  created_at: string;
};

// ----------------------------------------------------------------------------
// Forme attendue par supabase-js pour typer les requêtes.
// Insert : colonnes obligatoires sans valeur par défaut + le reste en optionnel.
// ----------------------------------------------------------------------------
type TableDef<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      clubs: TableDef<Club, 'name' | 'slug' | 'city' | 'postal_code' | 'contact_email'>;
      club_mail_credentials: TableDef<ClubMailCredentials, 'club_id'>;
      staff_members: TableDef<StaffMember, 'user_id' | 'full_name' | 'email' | 'role'>;
      facilities: TableDef<Facility, 'club_id' | 'name' | 'address' | 'city' | 'postal_code'>;
      categories: TableDef<Category, 'club_id' | 'name' | 'min_birth_year' | 'max_birth_year' | 'annual_price'>;
      schedules: TableDef<Schedule, 'club_id' | 'category_id' | 'day_of_week' | 'start_time' | 'end_time'>;
      club_products: TableDef<ClubProduct, 'club_id' | 'name' | 'price'>;
      family_registrations: TableDef<
        FamilyRegistration,
        | 'club_id'
        | 'season'
        | 'payer_first_name'
        | 'payer_last_name'
        | 'payer_email'
        | 'payer_phone'
        | 'emergency_contact_name'
        | 'emergency_contact_phone'
        | 'address'
        | 'city'
        | 'postal_code'
      >;
      payment_installments: TableDef<PaymentInstallment, 'club_id' | 'family_id' | 'amount' | 'payment_type'>;
      members: TableDef<Member, 'club_id' | 'season' | 'first_name' | 'last_name' | 'birth_date'>;
      member_product_orders: TableDef<
        MemberProductOrder,
        'club_id' | 'member_id' | 'product_id' | 'selected_size' | 'price_at_order'
      >;
      attendances: TableDef<Attendance, 'club_id' | 'schedule_id' | 'member_id'>;
      events: TableDef<ClubEvent, 'club_id' | 'event_type' | 'title' | 'event_date'>;
      event_convocations: TableDef<EventConvocation, 'club_id' | 'event_id' | 'member_id'>;
      posts: TableDef<Post, 'club_id' | 'title' | 'slug' | 'content'>;
      sponsors: TableDef<Sponsor, 'club_id' | 'company_name' | 'logo_url'>;
      sponsor_leads: TableDef<SponsorLead, 'club_id' | 'company_name' | 'contact_name' | 'phone' | 'email'>;
      anonymous_page_views: TableDef<AnonymousPageView, 'club_id' | 'view_month' | 'page_path'>;
      saas_prospects: TableDef<SaasProspect, 'club_name' | 'sport_type' | 'city'>;
      platform_announcements: TableDef<PlatformAnnouncement, 'title' | 'message'>;
    };
    Views: { [_ in never]: never };
    Functions: {
      is_super_admin: { Args: Record<string, never>; Returns: boolean };
      increment_page_view: { Args: { target_club: string; path: string }; Returns: undefined };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
