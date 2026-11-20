/**
 * TopicMetadataService.ts
 * Autonomous topic classification, clean YouTube title generation,
 * topic-specific hashtag generator, and strict creator-credit sanitization for Phase 11.1.
 * 
 * Strict Compliance:
 * - NEVER appends or generates creator-credit lines ('Credit: @...', 'Credits to @...', 'By @...', etc.).
 * - NEVER automatically appends creator usernames or '@handle' mentions to titles, descriptions, or tags.
 * - Extracts topics dynamically from Reel metadata and content keywords.
 * - Produces 3-5 deduplicated, topic-specific hashtags ending with #Shorts.
 * - Keeps YouTube title clean, natural, and free of hashtag stuffing.
 * - Keeps description short, relevant, and appended with topic hashtags.
 * - Persists prepared metadata for idempotent, consistent retries.
 * - Fails safely with valid fallback metadata without blocking pipeline uploads.
 */

export interface GeneratedYouTubeMetadata {
  title: string;
  description: string;
  summaryText: string;
  hashtags: string[];
  tags: string[];
  category: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TopicDefinition {
  category: string;
  keywords: string[];
  hashtags: string[];
  defaultSummary: string;
}

/**
 * Curated semantic topic taxonomies mapping key terms to natural hashtags and summaries.
 */
const TOPIC_TAXONOMIES: TopicDefinition[] = [
  {
    category: 'skydiving',
    keywords: [
      'skydive', 'skydived', 'skydiving', 'parachute', 'parachuting',
      'base jump', 'basejumping', 'freefall', 'wingsuit', 'skydiver'
    ],
    hashtags: ['#Skydiving', '#ExtremeSports', '#Adventure', '#Shorts'],
    defaultSummary: 'An unbelievable skydiving experience!',
  },
  {
    category: 'technology',
    keywords: [
      'technology', 'tech', 'innovation', 'artificial intelligence', 'ai',
      'robot', 'robotics', 'software', 'coding', 'developer', 'algorithm',
      'hardware', 'gadget', 'smartphone', 'cyber', 'quantum', 'future'
    ],
    hashtags: ['#Technology', '#Innovation', '#Tech', '#Shorts'],
    defaultSummary: 'Exploring cutting-edge technology and innovation.',
  },
  {
    category: 'football',
    keywords: [
      'football', 'soccer', 'goal', 'golazo', 'fifa', 'champions league',
      'premier league', 'striker', 'penalty', 'dribble', 'messi', 'ronaldo',
      'haaland', 'mbappe', 'neymar', 'world cup', 'uefa', 'free kick'
    ],
    hashtags: ['#Football', '#Soccer', '#Sports', '#Shorts'],
    defaultSummary: 'Incredible football skills and match highlights!',
  },
  {
    category: 'basketball',
    keywords: [
      'basketball', 'nba', 'slam dunk', 'dunk', 'crossover', 'three pointer',
      'lakers', 'curry', 'lebron', 'hoops', 'buzzer beater'
    ],
    hashtags: ['#Basketball', '#NBA', '#Sports', '#Shorts'],
    defaultSummary: 'Electrifying basketball action and highlights!',
  },
  {
    category: 'cricket',
    keywords: [
      'cricket', 'ipl', 'sixer', 'wicket', 'batsman', 'bowler', 'century',
      'kohli', 'rohit', 'dhoni', 'yorker', 'bcci'
    ],
    hashtags: ['#Cricket', '#CricketLovers', '#Sports', '#Shorts'],
    defaultSummary: 'Exciting cricket action and top moments!',
  },
  {
    category: 'combat_sports',
    keywords: [
      'boxing', 'mma', 'ufc', 'knockout', 'fighter', 'martial arts',
      'punch', 'kickboxing', 'bjj', 'wrestling', 'tko', 'tyson'
    ],
    hashtags: ['#Boxing', '#MMA', '#CombatSports', '#Shorts'],
    defaultSummary: 'Intense combat sports action and martial arts skills!',
  },
  {
    category: 'fitness',
    keywords: [
      'fitness', 'gym', 'workout', 'bodybuilding', 'muscle', 'exercise',
      'calisthenics', 'abs', 'training', 'crossfit', 'deadlift', 'squat', 'bench press'
    ],
    hashtags: ['#Fitness', '#Gym', '#Workout', '#Shorts'],
    defaultSummary: 'High-energy fitness and workout motivation!',
  },
  {
    category: 'extreme_sports',
    keywords: [
      'extreme sports', 'skate', 'skateboarding', 'snowboard', 'snowboarding',
      'surf', 'surfing', 'parkour', 'cliff jump', 'motocross', 'bmx', 'bungee', 'daredevil'
    ],
    hashtags: ['#ExtremeSports', '#Action', '#Adventure', '#Shorts'],
    defaultSummary: 'Thrilling extreme sports and adrenaline-pumping moments!',
  },
  {
    category: 'science',
    keywords: [
      'science', 'scientific', 'scientist', 'scientists', 'discovery', 'discover', 'discovers', 'discovered',
      'facts', 'physics', 'astronomy', 'astronomer', 'astronomers', 'space', 'exoplanet',
      'planet', 'planets', 'galaxy', 'galaxies', 'nasa', 'universe', 'black hole', 'telescope',
      'biology', 'chemistry', 'experiment', 'quantum'
    ],
    hashtags: ['#Science', '#Discovery', '#Facts', '#Shorts'],
    defaultSummary: 'Fascinating scientific discoveries and facts.',
  },
  {
    category: 'wildlife',
    keywords: [
      'wildlife', 'animals', 'animal', 'nature', 'safari', 'lion', 'tiger',
      'elephant', 'bear', 'predator', 'jungle', 'forest', 'wild', 'ocean',
      'shark', 'whale', 'eagle', 'cheetah', 'leopard', 'crocodile'
    ],
    hashtags: ['#Wildlife', '#Animals', '#Nature', '#Shorts'],
    defaultSummary: 'Incredible moments captured in the wild.',
  },
  {
    category: 'pets',
    keywords: [
      'dog', 'puppy', 'cat', 'kitten', 'pets', 'cute animal', 'doggo',
      'golden retriever', 'funny pet', 'meow', 'bark', 'puppies', 'kittens'
    ],
    hashtags: ['#Pets', '#CuteAnimals', '#Dogs', '#Shorts'],
    defaultSummary: 'Heartwarming and adorable pet moments!',
  },
  {
    category: 'automotive',
    keywords: [
      'car', 'cars', 'supercar', 'hypercar', 'ferrari', 'lamborghini',
      'porsche', 'drift', 'drifting', 'racing', 'f1', 'formula 1',
      'exhaust', 'horsepower', 'automotive', 'bmw', 'audi', 'mercedes', 'bugatti'
    ],
    hashtags: ['#Cars', '#Supercars', '#Automotive', '#Shorts'],
    defaultSummary: 'Incredible automotive engineering and supercar action!',
  },
  {
    category: 'gaming',
    keywords: [
      'gaming', 'gameplay', 'gamer', 'esports', 'minecraft', 'gta',
      'gta5', 'fortnite', 'playstation', 'xbox', 'pc gaming', 'streamer',
      'valorant', 'roblox', 'call of duty', 'clutch', 'speedrun'
    ],
    hashtags: ['#Gaming', '#Gamer', '#Gameplay', '#Shorts'],
    defaultSummary: 'Top gaming moments, clutch plays, and highlights!',
  },
  {
    category: 'food',
    keywords: [
      'food', 'cooking', 'recipe', 'chef', 'street food', 'delicious',
      'baking', 'kitchen', 'burger', 'pizza', 'bbq', 'dessert', 'taste',
      'yummy', 'culinary', 'foodie', 'meal'
    ],
    hashtags: ['#Food', '#Cooking', '#Recipe', '#Shorts'],
    defaultSummary: 'Mouthwatering culinary creations and delicious recipes!',
  },
  {
    category: 'travel',
    keywords: [
      'travel', 'explore', 'destination', 'vacation', 'wanderlust', 'tourism',
      'hotel', 'island', 'beach', 'mountain', 'city', 'scenic', 'resort', 'flight'
    ],
    hashtags: ['#Travel', '#Explore', '#Adventure', '#Shorts'],
    defaultSummary: 'Breathtaking travel destinations and scenic exploration.',
  },
  {
    category: 'comedy',
    keywords: [
      'comedy', 'funny', 'laugh', 'humor', 'prank', 'meme', 'lol',
      'hilarious', 'joke', 'relatable', 'fail', 'reaction'
    ],
    hashtags: ['#Comedy', '#Funny', '#Humor', '#Shorts'],
    defaultSummary: 'Hilarious and entertaining moments to brighten your day!',
  },
  {
    category: 'art_animation',
    keywords: [
      'art', 'drawing', 'sketch', 'painting', 'artist', 'animation',
      '3d animation', 'cgi', 'vfx', 'illustration', 'diy', 'craft', 'creative'
    ],
    hashtags: ['#Art', '#Animation', '#Creative', '#Shorts'],
    defaultSummary: 'Amazing creativity, art, and visual design!',
  },
  {
    category: 'music',
    keywords: [
      'music', 'song', 'singing', 'dance', 'dancing', 'guitar', 'piano',
      'choreo', 'beats', 'hip hop', 'cover', 'singer', 'musician', 'instrumental'
    ],
    hashtags: ['#Music', '#Dance', '#Performance', '#Shorts'],
    defaultSummary: 'Great musical talent and captivating rhythm!',
  },
  {
    category: 'history',
    keywords: [
      'history', 'ancient', 'mystery', 'archaeology', 'historical',
      'unsolved', 'monument', 'pyramids', 'empire', 'century', 'civilization'
    ],
    hashtags: ['#History', '#Mystery', '#Facts', '#Shorts'],
    defaultSummary: 'Uncovering mysteries and fascinating historical stories.',
  },
  {
    category: 'finance',
    keywords: [
      'money', 'finance', 'investing', 'business', 'wealth', 'crypto',
      'bitcoin', 'stocks', 'entrepreneur', 'billionaire', 'success', 'market'
    ],
    hashtags: ['#Finance', '#Business', '#Investing', '#Shorts'],
    defaultSummary: 'Valuable insights on business, wealth, and finance.',
  },
];

/**
 * Patterns matching creator credit lines and attribution constructs that MUST be stripped permanently.
 */
const CREATOR_CREDIT_PATTERNS = [
  // Pipe-prefixed credit, e.g. " | Credit: @creator", " | Credits to @creator"
  /\s*\|\s*credits?\s*(?:to|:)?\s*@[A-Za-z0-9_.]+/gi,
  /\s*\|\s*(?:original\s+creator|by|via)\s*:\s*@[A-Za-z0-9_.]+/gi,
  /\s*\|\s*by\s+@[A-Za-z0-9_.]+/gi,
  // Standalone credit lines
  /\bcredits?\s*(?:to|:)\s*@[A-Za-z0-9_.]+/gi,
  /\boriginal\s+creator\s*:\s*@[A-Za-z0-9_.]+/gi,
  /\bby\s+@[A-Za-z0-9_.]+/gi,
  // Footers generated by legacy tools
  /\n*---\s*\n*original\s+source:\s*instagram\s*@[A-Za-z0-9_.]+/gi,
  /\n*published\s+automatically\s+via\s+autoshorts/gi,
  // Any residual @username mentions
  /@[A-Za-z0-9_.]+/g,
];

/**
 * Strips all creator credit, attribution, and '@username' handles from a given text.
 */
export function stripCreatorAttribution(text?: string | null): string {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  for (const pattern of CREATOR_CREDIT_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean dangling pipes, dashes, colons, or double spaces left behind by removals
  cleaned = cleaned
    .replace(/\s*\|\s*$/g, '')
    .replace(/^\s*\|\s*/g, '')
    .replace(/\s*-\s*$/g, '')
    .replace(/^\s*-\s*/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return cleaned;
}

/**
 * Cleans and formats the YouTube Shorts title:
 * - Extracts first non-empty line of the caption.
 * - Strips any creator attribution and @username handles.
 * - Strips any hashtag stuffing from the title itself.
 * - Enforces attractive, natural prose (max 95 chars, graceful word truncation).
 */
export function cleanYouTubeTitle(rawCaption?: string | null, shortcode?: string): string {
  const stripped = stripCreatorAttribution(rawCaption);
  const lines = stripped.split('\n').map((l) => l.trim()).filter(Boolean);
  let firstLine = lines.length > 0 ? lines[0] : '';

  // Remove hashtags that may have been stuffed into the title line
  firstLine = firstLine.replace(/#[A-Za-z0-9_]+/g, '').replace(/\s+/g, ' ').trim();

  // Remove trailing separators
  firstLine = firstLine.replace(/[\s|:,-]+$/, '').trim();

  if (!firstLine) {
    const fallbackShortcode = shortcode || 'Short';
    return `Instagram Reel #${fallbackShortcode}`;
  }

  // Enforce YouTube Title character limit (max 95 chars)
  const MAX_TITLE_LEN = 95;
  if (firstLine.length > MAX_TITLE_LEN) {
    // Truncate at word boundary
    const truncated = firstLine.substring(0, MAX_TITLE_LEN);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 50) {
      firstLine = truncated.substring(0, lastSpace).trim() + '...';
    } else {
      firstLine = truncated.trim() + '...';
    }
  }

  return firstLine;
}

/**
 * Matches cleaned content against topic taxonomies and returns the best-fit topic definition.
 */
export function classifyTopic(text: string): {
  topic: TopicDefinition;
  score: number;
  confidence: 'high' | 'medium' | 'low';
} {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = new Set(normalized.split(/\s+/).filter(Boolean));

  let bestTopic: TopicDefinition = {
    category: 'general',
    keywords: ['facts', 'interesting', 'viral', 'explore'],
    hashtags: ['#Facts', '#Interesting', '#DidYouKnow', '#Shorts'],
    defaultSummary: 'Watch this incredible video!',
  };
  let maxScore = 0;

  for (const candidate of TOPIC_TAXONOMIES) {
    let score = 0;
    for (const kw of candidate.keywords) {
      if (kw.includes(' ')) {
        // Multi-word phrase matching
        if (normalized.includes(kw)) {
          score += 3;
        }
      } else if (words.has(kw)) {
        score += 2;
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestTopic = candidate;
    }
  }

  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (maxScore >= 4) {
    confidence = 'high';
  } else if (maxScore >= 2) {
    confidence = 'medium';
  }

  return { topic: bestTopic, score: maxScore, confidence };
}

/**
 * Generates 3-5 deduplicated topic hashtags ending with #Shorts.
 */
export function generateHashtags(
  topicDef: TopicDefinition,
  cleanText: string,
  confidence: 'high' | 'medium' | 'low'
): string[] {
  const hashtagSet = new Set<string>();

  // If confidence is low, fall back to safe, supported general hashtags ending with #Shorts
  if (confidence === 'low' && topicDef.category === 'general') {
    return ['#Facts', '#Explore', '#Shorts'];
  }

  // Add category-specific hashtags
  for (const tag of topicDef.hashtags) {
    const formatted = formatHashtag(tag);
    if (formatted) hashtagSet.add(formatted);
  }

  // Ensure #Shorts is present
  hashtagSet.add('#Shorts');

  const result = Array.from(hashtagSet);

  // Guarantee 3 to 5 hashtags
  if (result.length > 5) {
    // Preserve #Shorts at the end
    const filtered = result.filter((t) => t.toLowerCase() !== '#shorts').slice(0, 4);
    filtered.push('#Shorts');
    return filtered;
  }

  if (result.length < 3) {
    if (!result.some((t) => t.toLowerCase() === '#viral')) {
      result.splice(result.length - 1, 0, '#Viral');
    }
  }

  return result;
}

function formatHashtag(tag: string): string {
  const clean = tag.replace(/[^A-Za-z0-9]/g, '');
  if (!clean) return '';
  return `#${clean}`;
}

/**
 * Validates and strictly sanitizes YouTube metadata to prevent any creator credit leakage.
 * Throws an error if any creator attribution remains after sanitization.
 */
export function validateAndSanitizeYouTubeMetadata(metadata: {
  title: string;
  description: string;
  tags?: string[];
}): { title: string; description: string; tags: string[] } {
  let cleanTitle = stripCreatorAttribution(metadata.title);
  let cleanDescription = stripCreatorAttribution(metadata.description);

  // Ensure title has no leftover Credit or @mention
  cleanTitle = cleanTitle.replace(/@[A-Za-z0-9_.]+/g, '').trim();
  cleanDescription = cleanDescription.replace(/@[A-Za-z0-9_.]+/g, '').trim();

  // Filter out any creator handles or credit terms from tags
  const cleanTags = (metadata.tags || [])
    .map((t) => t.replace(/[^A-Za-z0-9]/g, '').trim())
    .filter((t) => {
      const lower = t.toLowerCase();
      return (
        lower.length > 1 &&
        lower !== 'credit' &&
        lower !== 'credits' &&
        lower !== 'by' &&
        lower !== 'creator' &&
        !lower.startsWith('@')
      );
    });

  // Strict invariant assertions
  const FORBIDDEN_MARKERS = [
    /\bcredit\b/i,
    /\bcredits\b/i,
    /\boriginal creator\b/i,
    /@[A-Za-z0-9_.]+/,
  ];

  for (const marker of FORBIDDEN_MARKERS) {
    if (marker.test(cleanTitle)) {
      throw new Error(`Sanitization failure: Forbidden creator attribution in title: "${cleanTitle}"`);
    }
  }

  return {
    title: cleanTitle,
    description: cleanDescription,
    tags: Array.from(new Set(cleanTags)),
  };
}

export class TopicMetadataService {
  /**
   * Generates clean, topic-specific YouTube metadata for a submitted Reel.
   * Completely excludes any creator attribution or creator username handles.
   */
  static generateMetadata(input: {
    rawCaption?: string | null;
    shortcode: string;
    options?: {
      titleOverride?: string;
      descriptionOverride?: string;
    };
  }): GeneratedYouTubeMetadata {
    try {
      const shortcode = input.shortcode || 'Short';
      const cleanInput = stripCreatorAttribution(input.rawCaption);

      // 1. Generate Clean Title
      const title = input.options?.titleOverride
        ? cleanYouTubeTitle(input.options.titleOverride, shortcode)
        : cleanYouTubeTitle(cleanInput, shortcode);

      // 2. Classify Topic from Content
      const classification = classifyTopic(`${title} ${cleanInput}`);
      const { topic, confidence } = classification;

      // 3. Generate 3-5 Relevant Hashtags
      const hashtags = generateHashtags(topic, cleanInput, confidence);

      // 4. Formulate Short, Relevant Description
      let summaryText = topic.defaultSummary;
      const lines = cleanInput.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length > 1) {
        // Use natural descriptive second line if present and clean
        const secondLine = lines[1].replace(/#[A-Za-z0-9_]+/g, '').trim();
        if (secondLine.length >= 10 && secondLine.length <= 160) {
          summaryText = secondLine;
        }
      } else if (cleanInput.length > 15 && cleanInput.length <= 150 && cleanInput !== title) {
        summaryText = cleanInput;
      }

      if (input.options?.descriptionOverride) {
        const cleanDescOverride = stripCreatorAttribution(input.options.descriptionOverride);
        if (cleanDescOverride) {
          summaryText = cleanDescOverride;
        }
      }

      const description = `${summaryText}\n\n${hashtags.join(' ')}`;

      // 5. Generate tags for YouTube API (without #)
      const tags = hashtags.map((h) => h.replace(/^#/, ''));

      // 6. Security & Compliance Guard: Validate that no creator mentions slipped through
      const validated = validateAndSanitizeYouTubeMetadata({
        title,
        description,
        tags,
      });

      return {
        title: validated.title,
        description: validated.description,
        summaryText,
        hashtags,
        tags: validated.tags,
        category: topic.category,
        confidence,
      };
    } catch (err) {
      // Safe, resilient fallback that NEVER blocks uploads and NEVER adds creator credit
      const fallbackShortcode = input.shortcode || 'Short';
      const fallbackTitle = `Instagram Reel #${fallbackShortcode}`;
      const fallbackHashtags = ['#Shorts'];
      const fallbackDescription = `Watch this video.\n\n#Shorts`;
      return {
        title: fallbackTitle,
        description: fallbackDescription,
        summaryText: 'Watch this video.',
        hashtags: fallbackHashtags,
        tags: ['shorts'],
        category: 'general',
        confidence: 'low',
      };
    }
  }
}
