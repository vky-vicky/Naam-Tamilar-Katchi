type SupportedLanguage = 'en' | 'ta';

const translations = {
  unauthorized_login: {
    en: 'Unauthorized: Please log in',
    ta: 'அனுமதி இல்லை: தயவுசெய்து உள்நுழையவும்'
  },
  unauthorized_edit_member: {
    en: 'Unauthorized: Members can only edit their own profile',
    ta: 'அனுமதி இல்லை: உறுப்பினர்கள் தங்கள் சொந்த சுயவிவரத்தை மட்டுமே திருத்த முடியும்'
  },
  state_selection_mandatory: {
    en: 'State selection is mandatory for Super Admin.',
    ta: 'சூப்பர் அட்மின் (Super Admin) பொறுப்பிற்கு மாநிலத்தைத் தேர்ந்தெடுப்பது கட்டாயமாகும்.'
  },
  district_or_taluk_selection_mandatory: {
    en: 'District or Taluk selection is mandatory for Admin role.',
    ta: 'நிர்வாகி (Admin) பொறுப்பிற்கு மாவட்டம் அல்லது தாலுகாவைத் தேர்ந்தெடுப்பது கட்டாயமாகும்.'
  },
  admin_level_error: {
    en: 'Admin role can only be assigned at District or Taluk level.',
    ta: 'நிர்வாகி (Admin) பொறுப்பை மாவட்டம் அல்லது தாலுகா அளவிலான இடத்திற்கு மட்டுமே ஒதுக்க முடியும்.'
  },
  area_or_street_selection_mandatory: {
    en: 'Area or Street selection is mandatory for Sub Admin role.',
    ta: 'துணை நிர்வாகி (Sub Admin) பொறுப்பிற்கு பகுதி அல்லது தெருவைத் தேர்ந்தெடுப்பது கட்டாயமாகும்.'
  },
  subadmin_level_error: {
    en: 'Sub Admin role can only be assigned at Area or Street level.',
    ta: 'துணை நிர்வாகி (Sub Admin) பொறுப்பை பகுதி அல்லது தெரு அளவிலான இடத்திற்கு மட்டுமே ஒதுக்க முடியும்.'
  },
  user_not_found: {
    en: 'User not found',
    ta: 'பயனர் கண்டறியப்படவில்லை'
  },
  target_location_not_found: {
    en: 'Target location not found',
    ta: 'இலக்கு பகுதி கண்டறியப்படவில்லை'
  },
  admin_target_error: {
    en: 'Admins can only target Taluk (Constituency), Area (Town/Village), or Street level locations.',
    ta: 'நிர்வாகிகள் (Admins) தாலுகா, பகுதி அல்லது தெரு அளவிலான இடங்களை மட்டுமே தேர்ந்தெடுக்க முடியும்.'
  },
  admin_no_scope: {
    en: 'Admin has no assigned location scope.',
    ta: 'நிர்வாகிக்கு பகுதி ஒதுக்கப்படவில்லை.'
  },
  admin_outside_scope: {
    en: 'Unauthorized: Target location is outside your assigned constituency scope.',
    ta: 'அனுமதி இல்லை: இலக்கு உங்கள் தொகுதி எல்லைக்கு வெளியே உள்ளது.'
  },
  subadmin_target_error: {
    en: 'Sub-Admins can only target Area (Town/Village) or Street level locations.',
    ta: 'துணை நிர்வாகிகள் (Sub-Admins) பகுதி அல்லது தெரு அளவிலான இடங்களை மட்டுமே தேர்ந்தெடுக்க முடியும்.'
  },
  subadmin_no_scope: {
    en: 'Sub-Admin has no assigned location scope.',
    ta: 'துணை நிர்வாகிக்கு பகுதி ஒதுக்கப்படவில்லை.'
  },
  subadmin_outside_scope: {
    en: 'Unauthorized: Target location is outside your assigned area scope.',
    ta: 'அனுமதி இல்லை: இலக்கு உங்கள் பகுதி எல்லைக்கு வெளியே உள்ளது.'
  },
  member_not_allowed: {
    en: 'Unauthorized: Members are not allowed to perform this action.',
    ta: 'அனுமதி இல்லை: உறுப்பினர்கள் இந்தச் செயலைச் செய்ய அனுமதி இல்லை.'
  },
  member_outside_scope: {
    en: 'Unauthorized: Members can only create polls for their own location.',
    ta: 'அனுமதி இல்லை: உறுப்பினர்கள் தங்களின் சொந்த இடத்திற்கு மட்டுமே வாக்கெடுப்பை உருவாக்க முடியும்.'
  },
  event_not_found: {
    en: 'Event not found',
    ta: 'நிகழ்வு கண்டறியப்படவில்லை'
  },
  campaign_not_found: {
    en: 'Campaign not found',
    ta: 'பிரச்சாரம் கண்டறியப்படவில்லை'
  },
  unauthorized_recall_event: {
    en: 'Unauthorized: You can only recall your own events.',
    ta: 'அனுமதி இல்லை: நீங்கள் உருவாக்கிய நிகழ்வுகளை மட்டுமே நீங்கள் நீக்க முடியும்.'
  },
  unauthorized_recall_campaign: {
    en: 'Unauthorized: You can only recall your own campaigns.',
    ta: 'அனுமதி இல்லை: நீங்கள் உருவாக்கிய பிரச்சாரங்களை மட்டுமே நீங்கள் நீக்க முடியும்.'
  },
  invalid_password: {
    en: 'Invalid password',
    ta: 'தவறான கடவுச்சொல்'
  },
  invalid_role: {
    en: 'You are not registered as a',
    ta: 'நீங்கள் பதிவு செய்துள்ள பொறுப்பு இதுவல்ல:'
  },
  provide_phone_password: {
    en: 'Please provide phone and password',
    ta: 'தொலைபேசி எண் மற்றும் கடவுச்சொல்லை உள்ளிடவும்'
  },
  location_required: {
    en: 'Location is required. Please specify a location (Street, Area, Taluk, District, or Location ID).',
    ta: 'இடம் தேவைப்படுகிறது. தயவுசெய்து ஒரு இடத்தை (தெரு, பகுதி, தாலுகா, மாவட்டம், அல்லது இடத்தின் குறியீடு) குறிப்பிடவும்.'
  },
  phone_already_registered: {
    en: 'Mobile number already exists.',
    ta: 'கைபேசி எண் ஏற்கனவே பயன்படுத்தப்பட்டுள்ளது.'
  },
  invalid_referenced_data: {
    en: 'Invalid referenced data (e.g. location or profession does not exist).',
    ta: 'தவறான குறிப்புத் தரவு (எ.கா. பகுதி அல்லது தொழில் இல்லை).'
  },
  please_select_blood_group: {
    en: 'Please select Blood Group',
    ta: 'தயவுசெய்து குருதிப் பிரிவைத் தேர்ந்தெடுக்கவும்'
  },
  please_select_profession: {
    en: 'Please select Profession',
    ta: 'தயவுசெய்து தொழிலைத் தேர்ந்தெடுக்கவும்'
  },
  invalid_name_format: {
    en: 'Full Name must contain only English and Tamil letters with spaces.',
    ta: 'முழு பெயர் ஆங்கிலம் மற்றும் தமிழ் எழுத்துக்கள் மற்றும் இடைவெளிகளை மட்டுமே கொண்டிருக்க வேண்டும்.'
  },
  invalid_surname_format: {
    en: 'Surname must contain only English and Tamil letters with spaces.',
    ta: 'குடும்ப பெயர் (இனிஷியல்/இண்டிகேஷன்) ஆங்கிலம் மற்றும் தமிழ் எழுத்துக்கள் மற்றும் இடைவெளிகளை மட்டுமே கொண்டிருக்க வேண்டும்.'
  }
};

type TranslationKey = keyof typeof translations;

export class I18nService {
  /**
   * Retrieves a translated string based on the provided language.
   * Falls back to English if the translation is missing.
   */
  static translate(key: TranslationKey, lang: string = 'en'): string {
    const language = lang.startsWith('ta') ? 'ta' : 'en';
    const translation = translations[key];
    if (!translation) return key; // Fallback to key if not found
    return translation[language] || translation['en'];
  }

  /**
   * Generates a bilingual WhatsApp broadcast message for Events.
   */
  static getEventBroadcastMessage(title: string, date: string, locationName: string): string {
    return `📢 New Event Alert! / புதிய நிகழ்வு அறிவிப்பு!\n\n🌟 *${title}*\n📅 Date / தேதி: ${date}\n📍 Location / இடம்: ${locationName}\n\nJoin us and respond on the app! / ஆப் மூலம் இணைந்து உங்கள் பதிலை தெரிவிக்கவும்!`;
  }

  /**
   * Generates a bilingual WhatsApp broadcast message for Campaigns.
   */
  static getCampaignBroadcastMessage(title: string, message: string): string {
    return `📢 *Naam Tamilar Katchi - Announcement* / நாம் தமிழர் கட்சி - அறிவிப்பு\n\n🌟 *${title}*\n\n${message}`;
  }
  static getBroadcastMessage(title: string, message: string): string {
    return `📢 ${title}\n\n${message}`;
  }
}

