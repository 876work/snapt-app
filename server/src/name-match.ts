/**
 * Reconciling the name on a verified ID against the name on the account.
 *
 * An ID renders a name very differently from how a person writes it in a
 * signup box: ALL CAPS, surname first, every middle name, accents that a
 * keyboard didn't produce. None of that is a discrepancy. A different
 * SURNAME, or no given name in common, is.
 *
 * So this module does not score similarity and threshold it. It asks a
 * narrower question — "what would I have to relax to make these the same
 * person's name?" — and reports exactly which relaxations were needed. An
 * admin reading "matched after: name order, dropped middle name" can judge
 * that instantly; a bare 0.83 tells them nothing.
 *
 * Three verdicts, matching the review policy:
 *   match                — same after case/punctuation/spacing only.
 *   minor_variance       — same person after accents, order, dropped middle
 *                          names, a short form, an initial, or a small
 *                          spelling difference. Auto-apply, note it.
 *   substantial_mismatch — surname disagrees, or nothing in the given names
 *                          agrees. NEVER auto-applied: a borrowed document
 *                          looks exactly like this, and the discrepancy is
 *                          itself the evidence.
 */

/** Jaro-Winkler similarity in [0,1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array<boolean>(a.length).fill(false);
  const bFlags = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (!bFlags[j] && a[i] === b[j]) {
        aFlags[i] = true;
        bFlags[j] = true;
        matches += 1;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aFlags[i]) continue;
    while (!bFlags[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const t = transpositions / 2;
  const jaro = (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Thresholds. Deliberately high: this decides whether two spellings are the
 * same name, not whether two strings look alike. 0.92 on the surname because
 * the surname carries the identity weight — an initial is never enough for
 * it, whereas it is reasonable evidence on a given name.
 */
const GIVEN_NAME_SIMILARITY = 0.9;
const SURNAME_SIMILARITY = 0.92;

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'rev', 'hon']);
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/**
 * Short forms that are the same name, not a different one. Deliberately a
 * small, hand-checked list — a wrong entry here would let a genuinely
 * different name through as "minor", which is the failure that matters.
 */
const SHORT_FORMS: string[][] = [
  ['william', 'will', 'bill', 'billy', 'liam'],
  ['robert', 'rob', 'bob', 'bobby', 'robbie'],
  ['richard', 'rick', 'dick', 'ricky', 'richie'],
  ['john', 'jon', 'johnny', 'jack'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['michael', 'mike', 'mikey', 'mick'],
  ['christopher', 'chris', 'kit'],
  ['charles', 'charlie', 'chuck', 'chas'],
  ['joseph', 'joe', 'joey'],
  ['daniel', 'dan', 'danny'],
  ['matthew', 'matt'],
  ['anthony', 'tony', 'ant'],
  ['david', 'dave', 'davey'],
  ['thomas', 'tom', 'tommy'],
  ['edward', 'ed', 'eddie', 'ted', 'teddy'],
  ['peter', 'pete'],
  ['andrew', 'andy', 'drew'],
  ['nicholas', 'nick', 'nicky'],
  ['alexander', 'alex', 'alec', 'sandy'],
  ['benjamin', 'ben', 'benny'],
  ['samuel', 'sam', 'sammy'],
  ['stephen', 'steven', 'steve', 'stevie'],
  ['patrick', 'pat', 'paddy'],
  ['kenneth', 'ken', 'kenny'],
  ['george', 'georgie'],
  ['francis', 'frank', 'frankie'],
  ['gregory', 'greg'],
  ['jonathan', 'jon', 'jonny'],
  ['timothy', 'tim', 'timmy'],
  ['elizabeth', 'liz', 'beth', 'betty', 'lizzie', 'eliza'],
  ['margaret', 'maggie', 'peggy', 'meg'],
  ['catherine', 'katherine', 'kate', 'katie', 'cathy', 'kathy', 'kat'],
  ['patricia', 'pat', 'patty', 'trish'],
  ['jennifer', 'jen', 'jenny'],
  ['deborah', 'debra', 'deb', 'debbie'],
  ['susan', 'sue', 'susie'],
  ['rebecca', 'becky', 'becca'],
  ['jessica', 'jess', 'jessie'],
  ['stephanie', 'steph'],
  ['christina', 'christine', 'chris', 'tina', 'christy'],
  ['victoria', 'vicky', 'tori'],
  ['alexandra', 'alex', 'sandra', 'sasha'],
  ['nathalie', 'natalie', 'nat'],
  ['veronica', 'vero', 'ronnie'],
  ['antoinette', 'toni', 'netta'],
  ['marie', 'mary', 'maria'],
  ['theresa', 'teresa', 'terry', 'tess'],
  ['dominic', 'dominique', 'dom'],
  ['emmanuel', 'manny', 'manuel'],
];

const SHORT_FORM_GROUP = new Map<string, number>();
SHORT_FORMS.forEach((group, index) => group.forEach((name) => SHORT_FORM_GROUP.set(name, index)));

/** Case, punctuation and spacing only — accents PRESERVED. */
function canonicalStrict(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,'’`]/g, '')
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Everything canonicalStrict does, plus accent folding. */
function canonicalLoose(value: string): string {
  return canonicalStrict(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function tokenise(value: string): string[] {
  return canonicalLoose(value)
    .split(' ')
    .filter((t) => t.length > 0 && !TITLES.has(t) && !SUFFIXES.has(t));
}

type TokenLink =
  | { kind: 'exact' }
  | { kind: 'short_form' }
  | { kind: 'initial' }
  | { kind: 'spelling'; score: number }
  | null;

function linkTokens(a: string, b: string, threshold: number, allowInitial: boolean): TokenLink {
  if (a === b) return { kind: 'exact' };
  const groupA = SHORT_FORM_GROUP.get(a);
  const groupB = SHORT_FORM_GROUP.get(b);
  if (groupA !== undefined && groupA === groupB) return { kind: 'short_form' };
  if (allowInitial && ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b)))) {
    return { kind: 'initial' };
  }
  const score = jaroWinkler(a, b);
  if (score >= threshold) return { kind: 'spelling', score: Math.round(score * 1000) / 1000 };
  return null;
}

export type NameVerdict = 'match' | 'minor_variance' | 'substantial_mismatch' | 'unknown';

export interface NameComparison {
  verdict: NameVerdict;
  /** Human-readable relaxations that were needed, e.g. "name order". */
  reasons: string[];
  /** Which account name this verdict came from. */
  compared_with: 'declared_legal_name' | 'signup_name' | null;
  id_name: string | null;
  account_name: string | null;
  surname_matched: boolean;
  given_names_matched: number;
  given_names_total: number;
}

interface SinglePass {
  verdict: NameVerdict;
  reasons: string[];
  surnameMatched: boolean;
  givenMatched: number;
  givenTotal: number;
}

/**
 * Compare one ID name against one account name.
 *
 * `idSurname` is Didit's structured last_name when it gives us one. Without
 * it we cannot tell which token is the surname — an ID may print either
 * order — so we fall back to an order-independent set comparison and say so.
 */
function comparePair(idFull: string, idSurname: string | null, accountName: string): SinglePass {
  const idTokens = tokenise(idFull);
  const accTokens = tokenise(accountName);
  if (idTokens.length === 0 || accTokens.length === 0) {
    return { verdict: 'unknown', reasons: [], surnameMatched: false, givenMatched: 0, givenTotal: 0 };
  }

  // Identical but for case/punctuation/spacing — the only path to `match`.
  if (canonicalStrict(idFull) === canonicalStrict(accountName)) {
    return {
      verdict: 'match',
      reasons: [],
      surnameMatched: true,
      givenMatched: idTokens.length,
      givenTotal: idTokens.length,
    };
  }

  const reasons: string[] = [];
  if (canonicalLoose(idFull) === canonicalLoose(accountName)) reasons.push('accents');

  const surnameTokens = idSurname ? tokenise(idSurname) : [];
  const idGiven = surnameTokens.length
    ? idTokens.filter((t) => !surnameTokens.includes(t))
    : idTokens;

  // Surname: exact or a small spelling difference. Never an initial.
  let surnameMatched = false;
  let surnameLink: TokenLink = null;
  const consumed = new Set<number>();
  if (surnameTokens.length) {
    for (const sn of surnameTokens) {
      for (let i = 0; i < accTokens.length; i += 1) {
        if (consumed.has(i)) continue;
        const link = linkTokens(sn, accTokens[i], SURNAME_SIMILARITY, false);
        if (link) {
          surnameMatched = true;
          surnameLink = link;
          consumed.add(i);
          break;
        }
      }
      if (surnameMatched) break;
    }
    if (!surnameMatched) {
      return {
        verdict: 'substantial_mismatch',
        reasons: ['surname does not match'],
        surnameMatched: false,
        givenMatched: 0,
        givenTotal: idGiven.length,
      };
    }
    if (surnameLink && surnameLink.kind === 'spelling') reasons.push('surname spelling');
  }

  // Given names: order-independent, extras on either side tolerated.
  let givenMatched = 0;
  let usedShortForm = false;
  let usedInitial = false;
  let usedSpelling = false;
  for (const g of idGiven) {
    for (let i = 0; i < accTokens.length; i += 1) {
      if (consumed.has(i)) continue;
      const link = linkTokens(g, accTokens[i], GIVEN_NAME_SIMILARITY, true);
      if (link) {
        consumed.add(i);
        givenMatched += 1;
        if (link.kind === 'short_form') usedShortForm = true;
        if (link.kind === 'initial') usedInitial = true;
        if (link.kind === 'spelling') usedSpelling = true;
        break;
      }
    }
  }

  if (givenMatched === 0) {
    return {
      verdict: 'substantial_mismatch',
      reasons: surnameTokens.length
        ? ['surname matches but no given name does']
        : ['no name in common'],
      surnameMatched,
      givenMatched: 0,
      givenTotal: idGiven.length,
    };
  }

  // Without a structured surname we only know tokens overlap. Require the
  // whole of the shorter name to be accounted for before calling it minor.
  if (!surnameTokens.length) {
    const smaller = Math.min(idTokens.length, accTokens.length);
    if (givenMatched < smaller) {
      return {
        verdict: 'substantial_mismatch',
        reasons: ['names only partly overlap and the ID gave no surname field'],
        surnameMatched: false,
        givenMatched,
        givenTotal: idTokens.length,
      };
    }
    reasons.push('surname field not supplied by the ID — compared as a set');
  }

  if (usedShortForm) reasons.push('short form or nickname');
  if (usedInitial) reasons.push('initial only');
  if (usedSpelling) reasons.push('given-name spelling');
  if (givenMatched < idGiven.length) reasons.push('ID has extra middle name(s)');
  const accExtra = accTokens.length - consumed.size;
  if (accExtra > 0) reasons.push('account name has name(s) not on the ID');
  // Same names, different sequence — the classic surname-first ID.
  const sameMultiset =
    idTokens.length === accTokens.length &&
    [...idTokens].sort().join(' ') === [...accTokens].sort().join(' ');
  if (sameMultiset && idTokens.join(' ') !== accTokens.join(' ')) reasons.push('name order');
  if (!reasons.length) reasons.push('spacing or punctuation');

  return {
    verdict: 'minor_variance',
    reasons,
    surnameMatched: surnameMatched || !surnameTokens.length,
    givenMatched,
    givenTotal: idGiven.length,
  };
}

const RANK: Record<NameVerdict, number> = {
  match: 3,
  minor_variance: 2,
  substantial_mismatch: 1,
  unknown: 0,
};

/**
 * Compare the ID name against BOTH account names and keep the most
 * favourable result. Either one agreeing is enough — the declared legal name
 * is the stronger signal, but plenty of people never had one to declare.
 */
export function reconcileNames(input: {
  idFullName: string | null;
  idFirstName?: string | null;
  idLastName?: string | null;
  signupName: string | null;
  declaredLegalName?: string | null;
}): NameComparison {
  const idFull =
    input.idFullName?.trim() ||
    [input.idFirstName, input.idLastName].filter(Boolean).join(' ').trim() ||
    null;

  const base: NameComparison = {
    verdict: 'unknown',
    reasons: [],
    compared_with: null,
    id_name: idFull,
    account_name: null,
    surname_matched: false,
    given_names_matched: 0,
    given_names_total: 0,
  };
  if (!idFull) return base;

  const candidates: { label: 'declared_legal_name' | 'signup_name'; value: string | null }[] = [
    { label: 'declared_legal_name', value: input.declaredLegalName ?? null },
    { label: 'signup_name', value: input.signupName ?? null },
  ];

  let best: NameComparison = base;
  for (const candidate of candidates) {
    if (!candidate.value?.trim()) continue;
    const pass = comparePair(idFull, input.idLastName ?? null, candidate.value);
    const result: NameComparison = {
      verdict: pass.verdict,
      reasons: pass.reasons,
      compared_with: candidate.label,
      id_name: idFull,
      account_name: candidate.value,
      surname_matched: pass.surnameMatched,
      given_names_matched: pass.givenMatched,
      given_names_total: pass.givenTotal,
    };
    if (RANK[result.verdict] > RANK[best.verdict]) best = result;
  }
  return best;
}

/** True when the ID name may be written to the account without a human. */
export function autoAppliable(verdict: NameVerdict): boolean {
  return verdict === 'match' || verdict === 'minor_variance';
}

// ---- Face match + name, read together -------------------------------------

/**
 * Didit reports face match on 0–100. These are OUR display bands for the
 * review panel, not Didit's pass/fail — that stays in the workflow config.
 */
const FACE_STRONG = 85;
const FACE_WEAK = 65;

export type FaceBand = 'strong' | 'borderline' | 'weak' | 'unknown';

export function faceBand(score: number | null | undefined): FaceBand {
  if (score == null) return 'unknown';
  const pct = score <= 1 ? score * 100 : score;
  if (pct >= FACE_STRONG) return 'strong';
  if (pct >= FACE_WEAK) return 'borderline';
  return 'weak';
}

export interface CombinedSignal {
  level: 'ok' | 'note' | 'caution' | 'alert';
  headline: string;
  detail: string;
}

/**
 * The point of §3: a name difference means something completely different
 * depending on whether the face matched. Read together, not as two numbers.
 */
export function combinedSignal(verdict: NameVerdict, score: number | null | undefined): CombinedSignal {
  const band = faceBand(score);
  if (verdict === 'match') {
    return band === 'weak'
      ? {
          level: 'caution',
          headline: 'Name matches, face does not',
          detail:
            'The name on the document is right but the selfie is a poor match. Check the photo page before approving — a shared or stolen document from a family member looks like this.',
        }
      : { level: 'ok', headline: 'Name and face both consistent', detail: 'Nothing to reconcile.' };
  }

  if (verdict === 'minor_variance') {
    if (band === 'strong') {
      return {
        level: 'note',
        headline: 'Almost certainly the same person',
        detail:
          'The face is a strong match and the name differs only in ways people write their own name differently. Applied automatically and noted on the application.',
      };
    }
    return {
      level: 'caution',
      headline: 'Name varies and the face is not a strong match',
      detail:
        'Each signal alone would be unremarkable; together they are worth a look at the document images before approving.',
    };
  }

  if (verdict === 'substantial_mismatch') {
    if (band === 'strong') {
      return {
        level: 'caution',
        headline: 'Same face, genuinely different name',
        detail:
          'The selfie matches the document, so this is the document holder — but the name is not theirs on the account. Usually a marriage, a legal name change, or an account opened in a nickname. Ask before accepting.',
      };
    }
    return {
      level: 'alert',
      headline: 'Different name and the face does not clearly match',
      detail:
        'This is the combination that looks like a borrowed or stolen document. Nothing has been applied to the account. Do not approve without resolving it.',
    };
  }

  return {
    level: 'note',
    headline: 'Not enough information to reconcile',
    detail: 'The document did not yield a readable name. Review the images directly.',
  };
}
