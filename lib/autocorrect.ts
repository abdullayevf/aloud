/**
 * Typo repair for the composer, and ONLY for the composer.
 *
 * ## Where this runs, and why that is the whole design
 *
 * It runs in the browser, on the text in the box, before the user presses
 * Enter. It never runs on the relay path. `/api/llm/v1/chat/completions` still
 * echoes whatever arrives byte-identical, no model, no rewriting — that is the
 * product and this does not touch it. What the user reads in the composer is
 * what goes out, so the receipt still means exactly what it says: the provider
 * spoke the line the user approved.
 *
 * A correction that the user cannot see before it is spoken would be the same
 * class of failure as an LLM "tidying up" their words. So every correction is
 * visible in the box, announced, and reversible with one key.
 *
 * ## Why a table and not a spell checker
 *
 * "Only where we're really confident" is a precision requirement, and the way
 * to hit it is to make a false positive structurally impossible rather than
 * unlikely. Edit-distance matching against a dictionary cannot do that: it
 * turns a real word the dictionary happens to be missing into a different real
 * word, silently, on a live phone call. `causal` becomes `casual` and the user
 * finds out from the other person's reply.
 *
 * So: a table of known misspellings, each with exactly one sensible target.
 * Every entry is a string that is not an English word (or, for the apostrophe
 * set, one whose alternative reading is vanishingly rare in speech). Nothing is
 * generated, nothing is guessed, and the exact set of things this will ever
 * change is readable in one screen. Lookup is a single Map hit — there is no
 * faster answer available, and nothing to load.
 *
 * Deliberately absent, because both readings are ordinary English: `its`,
 * `lets`, `were`, `well`, `ill`, `id`, `wed`, `form`, `thru`, `tonite`.
 * `hwo` is absent too — it is equally `who` and `how`, so there is no
 * confident answer. Add to this list rather than the table when in doubt.
 */

const CORRECTIONS = new Map(
  Object.entries({
    // fast-typing transpositions, the dominant error when someone types at speed
    teh: "the", hte: "the", thge: "the", tehn: "then", adn: "and", nad: "and",
    taht: "that", thta: "that", tihs: "this", htis: "this", jsut: "just",
    waht: "what", hwat: "what", wnat: "want", woudl: "would", wuold: "would",
    shoudl: "should", shuold: "should", coudl: "could", cuold: "could",
    yuo: "you", yoru: "your", ti: "it", fo: "of", si: "is",
    wiht: "with", witht: "with", wihtout: "without", withou: "without",
    abotu: "about", aobut: "about", frmo: "from", knwo: "know", konw: "know",
    liek: "like", mroe: "more", nwo: "now", onyl: "only", udner: "under",
    ovre: "over", aftre: "after", befor: "before", beofre: "before",
    agian: "again", agaisnt: "against", aroudn: "around", betwen: "between",
    durring: "during", wehre: "where", wher: "where", wehn: "when", whne: "when",
    hwy: "why", ehre: "here", hree: "here", tehre: "there", rigth: "right",
    rihgt: "right", lfet: "left", frist: "first", fisrt: "first",
    secodn: "second", wrok: "work", owrk: "work", hoem: "home", tiem: "time",
    yaer: "year", todya: "today", tdoay: "today", weke: "week", mnoth: "month",
    dya: "day", huor: "hour", huors: "hours", ahve: "have", hvae: "have",
    hsa: "has", hda: "had", wil: "will", iwll: "will", cna: "can", mst: "must",
    maek: "make", taek: "take", giev: "give", gte: "get", ocme: "come",
    thnik: "think", tihnk: "think", tel: "tell", aks: "ask", hlep: "help",
    hepl: "help", cal: "call", clal: "call", tlak: "talk", sned: "send",
    pya: "pay", pirce: "price", moeny: "money", mony: "money", crad: "card",
    cerdit: "credit", bil: "bill", chrage: "charge", refnud: "refund",
    oder: "order", ordr: "order", contry: "country", ciyt: "city",
    steet: "street", stret: "street", naem: "name", phoen: "phone",
    phon: "phone", emial: "email", nubmer: "number", numbr: "number",

    // the classic misspellings
    becuase: "because", becasue: "because", beacuse: "because",
    recieve: "receive", recieved: "received", recieving: "receiving",
    seperate: "separate", seperated: "separated", seperately: "separately",
    definately: "definitely", definatly: "definitely", definitly: "definitely",
    occured: "occurred", occuring: "occurring", occurence: "occurrence",
    untill: "until", alot: "a lot", thier: "their", theri: "their",
    wich: "which", whcih: "which", somthing: "something",
    someting: "something", somethign: "something", everthing: "everything",
    everyting: "everything", everythign: "everything", anyting: "anything",
    anythign: "anything", nothign: "nothing", thign: "thing", thigns: "things",
    peopel: "people", poeple: "people", peope: "people", freind: "friend",
    freinds: "friends", familly: "family", mesage: "message",
    messege: "message", cancle: "cancel", cancell: "cancel",
    transfered: "transferred", begining: "beginning", comming: "coming",
    runing: "running", geting: "getting", puting: "putting",
    writting: "writing", writeing: "writing", useing: "using",
    hapen: "happen", hapened: "happened", happend: "happened",
    beleive: "believe", belive: "believe", acheive: "achieve", wierd: "weird",
    neccessary: "necessary", necesary: "necessary", neccesary: "necessary",
    accomodate: "accommodate", embarass: "embarrass", goverment: "government",
    enviroment: "environment", publically: "publicly", arguement: "argument",
    independant: "independent", existance: "existence",
    persistant: "persistent", occassion: "occasion", dissapoint: "disappoint",
    dissapointed: "disappointed", succesful: "successful",
    successfull: "successful", grammer: "grammar", speek: "speak",
    lisen: "listen", sory: "sorry", sorrry: "sorry", thnaks: "thanks",
    thakns: "thanks", thansk: "thanks", helo: "hello", hellow: "hello",
    yse: "yes", pelase: "please", palese: "please", plase: "please",
    plese: "please",

    // the words a phone call is actually made of
    calender: "calendar", febuary: "February", wednsday: "Wednesday",
    wenesday: "Wednesday", thrusday: "Thursday", thursady: "Thursday",
    tuesdya: "Tuesday", saturady: "Saturday", tommorow: "tomorrow",
    tomorow: "tomorrow", tommorrow: "tomorrow", yesterdya: "yesterday",
    morining: "morning", mornign: "morning", afternon: "afternoon",
    oclock: "o'clock", minite: "minute", minut: "minute", mintues: "minutes",
    appoinment: "appointment", appointmnet: "appointment",
    appointmet: "appointment", shedule: "schedule", schedual: "schedule",
    scheudle: "schedule", reschedual: "reschedule", avaliable: "available",
    availalbe: "available", availible: "available", adress: "address",
    insurnace: "insurance", insurace: "insurance", perscription: "prescription",
    prescripton: "prescription", medcine: "medicine", medicin: "medicine",
    doctr: "doctor", docter: "doctor", hopsital: "hospital",
    hosptial: "hospital", emergancy: "emergency", questoin: "question",
    quesiton: "question", acount: "account", accoutn: "account",
    apartement: "apartment", appartment: "apartment", delivry: "delivery",
    delievry: "delivery", confirmaton: "confirmation",

    // contractions whose un-apostrophed form is not a word
    dont: "don't", doesnt: "doesn't", didnt: "didn't", isnt: "isn't",
    wasnt: "wasn't", arent: "aren't", werent: "weren't", hasnt: "hasn't",
    havent: "haven't", hadnt: "hadn't", wont: "won't", wouldnt: "wouldn't",
    couldnt: "couldn't", shouldnt: "shouldn't", cant: "can't",
    mustnt: "mustn't", im: "I'm", ive: "I've", youre: "you're",
    youve: "you've", youll: "you'll", youd: "you'd", hes: "he's",
    shes: "she's", theyre: "they're", theyve: "they've", theyll: "they'll",
    weve: "we've", whats: "what's", thats: "that's", theres: "there's",
    heres: "here's", wheres: "where's", whos: "who's", hows: "how's",
  }),
);

export interface Correction {
  from: string;
  to: string;
}

/** A word character for this purpose: letters and the apostrophe, so a
 * half-typed contraction is read as one token rather than two. */
const WORD = /[\p{L}']/u;
/** Typing one of these is what says "I have finished that word". */
const BOUNDARY = /[\s.,!?;:]/;

/**
 * The fix for one word, or null to leave it exactly as typed.
 *
 * Capitalisation is carried across rather than imposed: a sentence-initial
 * `Teh` becomes `The`, a shouted `TEH` becomes `THE`, and anything with
 * capitals in the middle is left alone entirely — that shape is a name, a
 * product or an acronym, and none of those belong to this table.
 */
export function correctToken(token: string): string | null {
  // Lone "i" is the one correction worth making that no table can hold, and it
  // is exact: the pronoun is never lowercase and no other word is spelled "i".
  if (token === "i") return "I";
  // No length floor beyond this: the table is the filter, and some of its most
  // frequent entries are two characters ("im", "ti", "fo").
  if (token.length < 2 || /[\d\u0001]/.test(token)) return null;

  const lower = token.toLowerCase();
  const fix = CORRECTIONS.get(lower);
  if (!fix || fix === token) return null;

  if (token === lower) return fix;
  if (token === token.toUpperCase()) return fix.toUpperCase();
  if (token.slice(1) === lower.slice(1)) return fix[0].toUpperCase() + fix.slice(1);
  return null; // mixed case mid-word — a name or an acronym, not a typo
}

/**
 * Called after every keystroke. Fires only when the key just pressed ended a
 * word, so a word is never rewritten while it is still being typed — the
 * failure that makes phone keyboards infuriating.
 *
 * Returns the whole new value plus where the caret must land, because the
 * replacement can be a different length ("alot" → "a lot").
 */
export function correctAtBoundary(
  text: string,
  caret: number,
): { text: string; caret: number; correction: Correction } | null {
  if (caret < 2 || caret > text.length) return null;
  if (!BOUNDARY.test(text[caret - 1])) return null;

  const end = caret - 1;
  let start = end;
  while (start > 0 && WORD.test(text[start - 1])) start -= 1;
  if (start === end) return null;

  const token = text.slice(start, end);
  const fix = correctToken(token);
  if (fix === null) return null;

  return {
    text: text.slice(0, start) + fix + text.slice(end),
    caret: caret + (fix.length - token.length),
    correction: { from: token, to: fix },
  };
}

/**
 * The same pass for the last word of the line, run on Enter.
 *
 * Without it the composer would fix every word except the one the user just
 * finished, which reads as the feature being broken rather than careful. The
 * corrected line is what lands in the ledger and on screen, so it is still
 * visible — after the fact rather than before, which is the honest cost of
 * pressing Enter without a trailing space.
 */
export function correctFinalWord(text: string): { text: string; correction: Correction | null } {
  const match = /[\p{L}']+$/u.exec(text);
  if (!match) return { text, correction: null };

  const fix = correctToken(match[0]);
  if (fix === null) return { text, correction: null };

  return {
    text: text.slice(0, match.index) + fix,
    correction: { from: match[0], to: fix },
  };
}
