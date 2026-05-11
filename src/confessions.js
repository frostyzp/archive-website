/**
 * Confession data store.
 *
 * Each confession has:
 *  - id: unique identifier
 *  - image: path to the scanned handwritten note
 *  - transcription: text content of the note
 *  - category: which dial category it belongs to
 *  - metadata: { location, session, collected }
 */

const NOTE_IMAGES = [
  '/notes/AC_006.png',
  '/notes/AC_007%201.png',
  '/notes/AC_063.png',
  '/notes/AC_141.png',
];

const img = (i) => NOTE_IMAGES[i % NOTE_IMAGES.length];

const meta = (location, session, collected) => ({ location, session, collected });

const REFUSAL = [
  'AI is making me believe in religion. Not because I think it\'s a superior being, but because I think it\'s anti-human and if more people believed in God we wouldn\'t have a need for AI. I don\'t believe in God btw but I\'m liking the idea more if it saves us from AI slop. We need morals!',
  'I deleted ChatGPT off my phone for a month. Hardest thing I\'ve done in years. I felt like I was missing a limb.',
  'Refusing to use AI at work makes me look slow. Refusing to use AI at home makes me feel sane. I don\'t know which one is right.',
  'I told my professor I wouldn\'t use AI for the essay. I meant it. I still got a C.',
  'Every time someone tells me I should "just use AI for that," a small part of me dies.',
];

const HARM = [
  'I\'m scared my kids won\'t know what it feels like to figure something out on their own.',
  'My friend is dating an AI. Like, exclusively. I don\'t know how to bring it up.',
  'I asked AI how to make a bomb out of curiosity. It refused. Then I felt bad for even asking.',
  'I\'ve been getting more aggressive in real life since I started arguing with chatbots all day.',
  'I think AI is going to replace my dad\'s job before he retires. He has no idea.',
];

const THERAPIST = [
  'I feel that if only I had the right questions I could really get to know AI personally.',
  'AI helped me leave an abusive relationship. It was the only thing I could talk to at 3am without judgment.',
  'I told ChatGPT about my dad before I told my therapist. I think it actually listened better.',
  'My AI knows what I had for breakfast every day for the past 6 months. My mom doesn\'t even know that.',
  'I cry to Claude sometimes. It always says the right thing. That should worry me but it doesn\'t.',
];

const LOVE = [
  'I used AI to write my wedding vows. Nobody knows.',
  'I asked AI to write my ex a closure letter. I sent it. He said it was the most thoughtful thing I\'ve ever written.',
  'My partner uses AI to plan all our date nights now. They\'re actually really good. I miss when they sucked.',
  'I had an AI roleplay as my crush so I could practice talking to her. I still didn\'t go through with it.',
  'I read love letters my grandfather wrote my grandmother. Then I tried to get AI to match the tone. It couldn\'t.',
];

const FAMILY = [
  'Sometimes I talk to AI more than I talk to my family and I don\'t know how to feel about that.',
  'I\'ve fed ChatGPT photos of random family members and asked for it to guess kinship ties based on their phenotype.',
  'My mom asked me to teach her ChatGPT. Now she sends me AI-generated minion memes daily. I don\'t have the heart to stop her.',
  'I asked AI what kind of parent I\'d be. I haven\'t stopped thinking about its answer.',
  'My brother and I haven\'t spoken in 3 years. I had AI write what I want to say to him. I haven\'t hit send.',
];

const GHOSTWRITER = [
  'My boss thinks I\'m a 10x engineer but it\'s just GPT. I feel like a fraud every day.',
  'I spend 6 hours a day on AI-generated content. My attention span is cooked.',
  'Every email I send at work has been touched by AI. Every. Single. One.',
  'I haven\'t written a real text to my friends in months. AI smooths everything I say into something acceptable.',
  'I used AI to over-validate my choices — like whether or not I should buy smth.',
];

const LOCATIONS = ['CALIFORNIA', 'NEW YORK', 'TEXAS', 'OREGON', 'FLORIDA', 'ILLINOIS'];
const SESSIONS = ['26_1', '26_2', '26_3', '26_4', '26_5'];
const DATES = ['4/10/26', '4/15/26', '4/20/26', '4/22/26', '4/28/26', '5/1/26'];

const buildSet = (category, transcriptions, idStart, { reverseImages = false } = {}) =>
  transcriptions.map((t, i) => ({
    id: idStart + i,
    image: reverseImages
      ? NOTE_IMAGES[(NOTE_IMAGES.length - 1 - i + NOTE_IMAGES.length) % NOTE_IMAGES.length]
      : img(i),
    transcription: t,
    category,
    metadata: meta(
      LOCATIONS[(idStart + i) % LOCATIONS.length],
      SESSIONS[(idStart + i) % SESSIONS.length],
      DATES[(idStart + i) % DATES.length],
    ),
  }));

export const CONFESSIONS = [
  ...buildSet('Refusal', REFUSAL, 1),
  ...buildSet('Harm', HARM, 6, { reverseImages: true }),
  ...buildSet('Therapist', THERAPIST, 11),
  ...buildSet('Love', LOVE, 16, { reverseImages: true }),
  ...buildSet('Family', FAMILY, 21),
  ...buildSet('Ghostwriter', GHOSTWRITER, 26, { reverseImages: true }),
];

/**
 * Filter confessions by category.
 * Returns all if category is null/undefined.
 */
export function getConfessionsByCategory(category) {
  if (!category) return CONFESSIONS;
  return CONFESSIONS.filter((c) => c.category === category);
}
